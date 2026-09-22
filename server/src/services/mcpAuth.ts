import { readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomBytes, createHash } from 'crypto';
import * as jose from 'jose';
import type { McpAuthData, OAuthClient } from '../types/index.js';
import { DATA_DIR } from './dataDir.js';
import { writeJsonAtomic } from './atomicJson.js';

const AUTH_FILE = join(DATA_DIR, 'mcp-auth.json');

const DEFAULT_DATA: McpAuthData = {
  jwtSecret: '',
  clients: [],
  authCodes: [],
  refreshTokens: [],
};

let authData: McpAuthData = { ...DEFAULT_DATA };

export async function loadAuthData(): Promise<McpAuthData> {
  try {
    const raw = await readFile(AUTH_FILE, 'utf-8');
    authData = { ...DEFAULT_DATA, ...JSON.parse(raw) };
  } catch {
    authData = { ...DEFAULT_DATA };
  }

  // Generate JWT secret on first run
  if (!authData.jwtSecret) {
    authData.jwtSecret = randomBytes(32).toString('hex');
    await saveAuthData();
  }

  return authData;
}

async function saveAuthData(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeJsonAtomic(AUTH_FILE, authData);
}

function getJwtSecret(): Uint8Array {
  return new TextEncoder().encode(authData.jwtSecret);
}

// ── Client Registration (RFC 7591) ──────────────────────

export async function registerClient(
  clientName: string,
  redirectUris: string[],
): Promise<OAuthClient> {
  const client: OAuthClient = {
    clientId: randomBytes(16).toString('hex'),
    clientSecret: randomBytes(32).toString('hex'),
    clientName,
    redirectUris,
    createdAt: new Date().toISOString(),
  };
  authData.clients.push(client);
  await saveAuthData();
  return client;
}

export function getClient(clientId: string): OAuthClient | undefined {
  return authData.clients.find(c => c.clientId === clientId);
}

export function listClients(): OAuthClient[] {
  return authData.clients;
}

export async function revokeClient(clientId: string): Promise<boolean> {
  const idx = authData.clients.findIndex(c => c.clientId === clientId);
  if (idx === -1) return false;
  authData.clients.splice(idx, 1);
  // Also revoke all tokens for this client
  authData.refreshTokens = authData.refreshTokens.filter(t => t.clientId !== clientId);
  authData.authCodes = authData.authCodes.filter(c => c.clientId !== clientId);
  await saveAuthData();
  return true;
}

// ── Authorization Code ──────────────────────────────────

export async function createAuthCode(
  clientId: string,
  codeChallenge: string,
  codeChallengeMethod: string,
  redirectUri: string,
  scope: string,
): Promise<string> {
  const code = randomBytes(32).toString('hex');
  authData.authCodes.push({
    code,
    clientId,
    codeChallenge,
    codeChallengeMethod,
    redirectUri,
    expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    scope,
  });
  await saveAuthData();
  return code;
}

export async function exchangeCode(
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: string } | null> {
  const idx = authData.authCodes.findIndex(c => c.code === code);
  if (idx === -1) return null;

  const authCode = authData.authCodes[idx];

  // Validate
  if (authCode.clientId !== clientId) return null;
  if (authCode.redirectUri !== redirectUri) return null;
  if (authCode.expiresAt < Date.now()) {
    authData.authCodes.splice(idx, 1);
    await saveAuthData();
    return null;
  }

  // Verify PKCE
  const hash = createHash('sha256').update(codeVerifier).digest('base64url');
  if (hash !== authCode.codeChallenge) return null;

  // Remove used code
  authData.authCodes.splice(idx, 1);

  // Generate tokens
  const expiresIn = 3600; // 1 hour
  const accessToken = await new jose.SignJWT({
    clientId,
    scope: authCode.scope,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setIssuer('shipyard-mcp')
    .sign(getJwtSecret());

  const refreshToken = randomBytes(32).toString('hex');
  authData.refreshTokens.push({
    token: refreshToken,
    clientId,
    scope: authCode.scope,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  });

  await saveAuthData();

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    token_type: 'Bearer',
  };
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: string } | null> {
  const idx = authData.refreshTokens.findIndex(t => t.token === refreshToken && t.clientId === clientId);
  if (idx === -1) return null;

  const rt = authData.refreshTokens[idx];
  if (rt.expiresAt < Date.now()) {
    authData.refreshTokens.splice(idx, 1);
    await saveAuthData();
    return null;
  }

  // Rotate refresh token
  authData.refreshTokens.splice(idx, 1);

  const expiresIn = 3600;
  const accessToken = await new jose.SignJWT({
    clientId,
    scope: rt.scope,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .setIssuer('shipyard-mcp')
    .sign(getJwtSecret());

  const newRefreshToken = randomBytes(32).toString('hex');
  authData.refreshTokens.push({
    token: newRefreshToken,
    clientId,
    scope: rt.scope,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
  });

  await saveAuthData();

  return {
    access_token: accessToken,
    refresh_token: newRefreshToken,
    expires_in: expiresIn,
    token_type: 'Bearer',
  };
}

export async function validateBearerToken(
  authHeader: string | undefined,
): Promise<{ valid: boolean; clientId?: string; scope?: string }> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { valid: false };
  }

  const token = authHeader.slice(7);
  try {
    const { payload } = await jose.jwtVerify(token, getJwtSecret(), {
      issuer: 'shipyard-mcp',
    });
    return {
      valid: true,
      clientId: payload.clientId as string,
      scope: payload.scope as string,
    };
  } catch {
    return { valid: false };
  }
}

// Clean up expired codes and tokens
export async function cleanup(): Promise<void> {
  const now = Date.now();
  authData.authCodes = authData.authCodes.filter(c => c.expiresAt > now);
  authData.refreshTokens = authData.refreshTokens.filter(t => t.expiresAt > now);
  await saveAuthData();
}
