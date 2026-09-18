import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { DATA_DIR } from './dataDir.js';

/**
 * Where each project's deploys live, and the token to ask about them.
 *
 * The token is an account credential, so it is encrypted at rest with the same
 * key as the AI credentials. Like every other JSON store here: one in-memory
 * cache, serialized atomic writes, and this process is the only writer.
 */

const CONFIG_FILE = join(DATA_DIR, 'deploy-config.json');
const ENCRYPTION_KEY_FILE = join(DATA_DIR, '.claude-key');

export const DEPLOY_PROVIDERS = ['railway'] as const;
export type DeployProvider = (typeof DEPLOY_PROVIDERS)[number];

/** Which Railway project (and optionally which service) a project deploys to. */
export interface ProjectDeployLink {
  provider: DeployProvider;
  projectId: string;
  projectName?: string;
  environmentId?: string;
  environmentName?: string;
  serviceId?: string;
  serviceName?: string;
  updatedAt: string;
}

interface DeployConfig {
  tokens: Partial<Record<DeployProvider, string>>;
  projects: Record<string, ProjectDeployLink>;
}

const EMPTY: DeployConfig = { tokens: {}, projects: {} };

// ── Encryption (AES-256-GCM, same key file as the AI credentials) ────────

async function getEncryptionKey(): Promise<Buffer> {
  try {
    const keyHex = await readFile(ENCRYPTION_KEY_FILE, 'utf-8');
    return Buffer.from(keyHex.trim(), 'hex');
  } catch {
    const key = randomBytes(32);
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(ENCRYPTION_KEY_FILE, key.toString('hex'), 'utf-8');
    return key;
  }
}

function encrypt(text: string, key: Buffer): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
}

function decrypt(data: string, key: Buffer): string {
  const [ivHex, tagHex, encrypted] = data.split(':');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

// ── Store ────────────────────────────────────────────────────────────────

let cached: DeployConfig | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function load(): Promise<DeployConfig> {
  if (cached) return cached;
  try {
    const key = await getEncryptionKey();
    const data = JSON.parse(await readFile(CONFIG_FILE, 'utf-8'));
    const tokens: DeployConfig['tokens'] = {};
    for (const provider of DEPLOY_PROVIDERS) {
      const stored = data.tokens?.[provider];
      if (!stored) continue;
      try {
        tokens[provider] = decrypt(stored, key);
      } catch {
        // Encrypted with a different key — unrecoverable, ask for it again.
      }
    }
    cached = { tokens, projects: data.projects || {} };
  } catch {
    cached = { ...EMPTY };
  }
  return cached;
}

async function persist(config: DeployConfig): Promise<void> {
  const key = await getEncryptionKey();
  const tokens: Record<string, string> = {};
  for (const [provider, token] of Object.entries(config.tokens)) {
    if (token) tokens[provider] = encrypt(token, key);
  }
  const payload = JSON.stringify({ version: 1, tokens, projects: config.projects }, null, 2);
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp`;
  await writeFile(tmp, payload, 'utf-8');
  await rename(tmp, CONFIG_FILE);
}

function mutate<T>(fn: (config: DeployConfig) => T): Promise<T> {
  const run = writeChain.then(async () => {
    const config = await load();
    const next: DeployConfig = { tokens: { ...config.tokens }, projects: { ...config.projects } };
    const result = fn(next);
    cached = next;
    await persist(next);
    return result;
  });
  writeChain = run.catch(() => {});
  return run;
}

export async function getToken(provider: DeployProvider): Promise<string | null> {
  return (await load()).tokens[provider] ?? null;
}

export async function setToken(provider: DeployProvider, token: string): Promise<void> {
  await mutate(config => {
    config.tokens[provider] = token;
  });
}

export async function clearToken(provider: DeployProvider): Promise<void> {
  await mutate(config => {
    delete config.tokens[provider];
  });
}

export async function getLink(projectId: string): Promise<ProjectDeployLink | null> {
  return (await load()).projects[projectId] ?? null;
}

export async function listLinks(): Promise<Record<string, ProjectDeployLink>> {
  return { ...(await load()).projects };
}

export async function setLink(
  projectId: string,
  link: Omit<ProjectDeployLink, 'updatedAt'>,
): Promise<ProjectDeployLink> {
  const stored: ProjectDeployLink = { ...link, updatedAt: new Date().toISOString() };
  await mutate(config => {
    config.projects[projectId] = stored;
  });
  return stored;
}

export async function clearLink(projectId: string): Promise<void> {
  await mutate(config => {
    delete config.projects[projectId];
  });
}
