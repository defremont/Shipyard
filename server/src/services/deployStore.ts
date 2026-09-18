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

/**
 * Which Railway project and service a checkout deploys to.
 *
 * The unit is a **checkout**, not a Shipyard project: a client folder holds a
 * dozen repositories that each deploy somewhere of their own, so a project can
 * hold several links — one per sub-repository, plus one for the root.
 */
export interface ProjectDeployLink {
  provider: DeployProvider;
  projectId: string;
  projectName?: string;
  environmentId?: string;
  environmentName?: string;
  serviceId?: string;
  serviceName?: string;
  /** Sub-repository this link belongs to; absent means the project root. */
  subrepo?: string;
  updatedAt: string;
}

/** Key a link is stored under inside a project. */
export const ROOT_SCOPE = '__root__';

export function scopeKey(subrepo?: string | null): string {
  return subrepo && subrepo.trim() ? subrepo : ROOT_SCOPE;
}

interface DeployConfig {
  tokens: Partial<Record<DeployProvider, string>>;
  /** projectId → scope key → link */
  projects: Record<string, Record<string, ProjectDeployLink>>;
}

const EMPTY: DeployConfig = { tokens: {}, projects: {} };

/**
 * v1 stored one link per project, unscoped. Reading it as the root scope keeps
 * every link people already have — nobody reconnects because of this change.
 */
function migrateProjects(raw: any): DeployConfig['projects'] {
  const projects: DeployConfig['projects'] = {};
  for (const [projectId, value] of Object.entries(raw || {})) {
    if (!value || typeof value !== 'object') continue;
    if ((value as any).provider) {
      projects[projectId] = { [ROOT_SCOPE]: value as ProjectDeployLink };
    } else {
      projects[projectId] = value as Record<string, ProjectDeployLink>;
    }
  }
  return projects;
}

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
    cached = { tokens, projects: migrateProjects(data.projects) };
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
  const payload = JSON.stringify({ version: 2, tokens, projects: config.projects }, null, 2);
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

/** One checkout's link: the root, or a named sub-repository. */
export async function getLink(projectId: string, subrepo?: string | null): Promise<ProjectDeployLink | null> {
  return (await load()).projects[projectId]?.[scopeKey(subrepo)] ?? null;
}

/** Every link of one project, keyed by scope. */
export async function getProjectLinks(projectId: string): Promise<Record<string, ProjectDeployLink>> {
  return { ...((await load()).projects[projectId] || {}) };
}

/** Every link of every project, flattened. */
export async function listLinks(): Promise<{ projectId: string; scope: string; link: ProjectDeployLink }[]> {
  const { projects } = await load();
  const list: { projectId: string; scope: string; link: ProjectDeployLink }[] = [];
  for (const [projectId, scopes] of Object.entries(projects)) {
    for (const [scope, link] of Object.entries(scopes)) {
      list.push({ projectId, scope, link });
    }
  }
  return list;
}

export async function setLink(
  projectId: string,
  link: Omit<ProjectDeployLink, 'updatedAt'>,
): Promise<ProjectDeployLink> {
  const stored: ProjectDeployLink = { ...link, updatedAt: new Date().toISOString() };
  const scope = scopeKey(link.subrepo);
  await mutate(config => {
    config.projects[projectId] = { ...(config.projects[projectId] || {}), [scope]: stored };
  });
  return stored;
}

export async function clearLink(projectId: string, subrepo?: string | null): Promise<void> {
  const scope = scopeKey(subrepo);
  await mutate(config => {
    const scopes = config.projects[projectId];
    if (!scopes) return;
    const next = { ...scopes };
    delete next[scope];
    if (Object.keys(next).length === 0) delete config.projects[projectId];
    else config.projects[projectId] = next;
  });
}

/** Drop every link of a project — used when the user unlinks the whole thing. */
export async function clearProject(projectId: string): Promise<void> {
  await mutate(config => {
    delete config.projects[projectId];
  });
}
