import { readFile, writeFile, mkdir, rename, unlink } from 'fs/promises';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { DATA_DIR } from './dataDir.js';

// Encrypted, multi-provider AI credential store.
//
// Supersedes the single-provider `claude.json`. On first read the legacy file
// is migrated in place (same `.claude-key`, so the ciphertext is reusable) and
// then left alone — deleting it would strand users who roll back.

const CONFIG_FILE = join(DATA_DIR, 'ai-config.json');
const LEGACY_CLAUDE_FILE = join(DATA_DIR, 'claude.json');
const ENCRYPTION_KEY_FILE = join(DATA_DIR, '.claude-key');

export const AI_PROVIDERS = ['claude', 'openai', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value);
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface AiConfig {
  preferredProvider: AiProvider;
  providers: Partial<Record<AiProvider, ProviderConfig>>;
}

/** Model used for one-shot structured work (analyze, effort, commit messages). */
export const FAST_MODELS: Record<AiProvider, string> = {
  claude: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-2.5-flash',
};

/** Model used for chat, and the default when a provider is first configured. */
export const CHAT_MODELS: Record<AiProvider, string> = {
  claude: 'claude-sonnet-4-5-20250929',
  openai: 'gpt-4.1',
  gemini: 'gemini-2.5-pro',
};

export const PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: 'Claude',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

// ── Encryption (AES-256-GCM, key kept beside the data dir) ──────────────

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

// ── Store (in-memory cache + serialized atomic writes, per the JSON store rules) ──

const EMPTY: AiConfig = { preferredProvider: 'claude', providers: {} };

let cached: AiConfig | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function parseStored(raw: string, key: Buffer): AiConfig {
  const data = JSON.parse(raw);
  const providers: AiConfig['providers'] = {};
  for (const provider of AI_PROVIDERS) {
    const entry = data.providers?.[provider];
    if (!entry?.apiKey) continue;
    try {
      providers[provider] = {
        apiKey: decrypt(entry.apiKey, key),
        model: entry.model || CHAT_MODELS[provider],
        maxTokens: entry.maxTokens || 4096,
      };
    } catch {
      // A key encrypted with a different .claude-key is unrecoverable; drop it
      // rather than failing the whole store.
    }
  }
  return {
    preferredProvider: isAiProvider(data.preferredProvider) ? data.preferredProvider : 'claude',
    providers,
  };
}

/** Read the legacy single-provider claude.json, if it is still the only source. */
async function readLegacy(key: Buffer): Promise<AiConfig | null> {
  try {
    const data = JSON.parse(await readFile(LEGACY_CLAUDE_FILE, 'utf-8'));
    if (!data.apiKey) return null;
    return {
      preferredProvider: 'claude',
      providers: {
        claude: {
          apiKey: decrypt(data.apiKey, key),
          model: data.model || CHAT_MODELS.claude,
          maxTokens: data.maxTokens || 4096,
        },
      },
    };
  } catch {
    return null;
  }
}

export async function loadAiConfig(): Promise<AiConfig> {
  if (cached) return cached;
  const key = await getEncryptionKey();
  try {
    cached = parseStored(await readFile(CONFIG_FILE, 'utf-8'), key);
    return cached;
  } catch {
    // No ai-config.json yet — migrate the legacy file on the way in.
    const legacy = await readLegacy(key);
    if (legacy) {
      cached = legacy;
      await persist(legacy);
      return legacy;
    }
    cached = EMPTY;
    return cached;
  }
}

async function persist(config: AiConfig): Promise<void> {
  const key = await getEncryptionKey();
  const providers: Record<string, unknown> = {};
  for (const [provider, entry] of Object.entries(config.providers)) {
    if (!entry) continue;
    providers[provider] = {
      apiKey: encrypt(entry.apiKey, key),
      model: entry.model,
      maxTokens: entry.maxTokens,
    };
  }
  const payload = JSON.stringify({ version: 3, preferredProvider: config.preferredProvider, providers }, null, 2);
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${CONFIG_FILE}.tmp`;
  await writeFile(tmp, payload, 'utf-8');
  await rename(tmp, CONFIG_FILE);
}

/** Serialize every mutation; the process is the only writer. */
function mutate<T>(fn: (config: AiConfig) => Promise<T> | T): Promise<T> {
  const run = writeChain.then(async () => {
    const config = await loadAiConfig();
    const next: AiConfig = { preferredProvider: config.preferredProvider, providers: { ...config.providers } };
    const result = await fn(next);
    cached = next;
    await persist(next);
    return result;
  });
  writeChain = run.catch(() => {});
  return run;
}

export async function getProviderConfig(provider: AiProvider): Promise<ProviderConfig | null> {
  return (await loadAiConfig()).providers[provider] ?? null;
}

export async function saveProviderConfig(provider: AiProvider, config: ProviderConfig): Promise<void> {
  await mutate(next => { next.providers[provider] = config; });
}

export async function deleteProviderConfig(provider: AiProvider): Promise<void> {
  await mutate(next => { delete next.providers[provider]; });
  if (provider === 'claude') {
    // The legacy file would resurrect the key on the next cold start.
    try { await unlink(LEGACY_CLAUDE_FILE); } catch {}
  }
}

export async function getPreferredProvider(): Promise<AiProvider> {
  return (await loadAiConfig()).preferredProvider;
}

export async function setPreferredProvider(provider: AiProvider): Promise<void> {
  await mutate(next => { next.preferredProvider = provider; });
}
