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
 * Which Railway project, service and environment a deploy link watches.
 *
 * The unit is a **deploy**, not a Shipyard project and not a checkout either: a
 * client folder holds a dozen repositories that each deploy somewhere of their
 * own, and one repository can be deployed several times over — one service per
 * city, per tenant, per environment. So a project holds a list of links, each
 * identified by what it points at in Railway, and `subrepo` is only a label
 * saying which checkout it came from.
 */
export interface ProjectDeployLink {
  /** Stable id derived from the Railway target — see `linkId`. */
  id: string;
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

/** Key a link is stored under when it has no sub-repository. */
export const ROOT_SCOPE = '__root__';

export function scopeKey(subrepo?: string | null): string {
  return subrepo && subrepo.trim() ? subrepo : ROOT_SCOPE;
}

/**
 * What a link points at, as one string. Two links to the same Railway service
 * in the same environment are the same link — that is what makes saving an
 * upsert instead of a duplicate.
 */
export function linkId(link: {
  provider: DeployProvider;
  projectId: string;
  serviceId?: string;
  environmentId?: string;
}): string {
  return [link.provider, link.projectId, link.serviceId || 'project', link.environmentId || 'default'].join(':');
}

interface DeployConfig {
  tokens: Partial<Record<DeployProvider, string>>;
  /** projectId → every deploy watched for it */
  projects: Record<string, ProjectDeployLink[]>;
}

const EMPTY: DeployConfig = { tokens: {}, projects: {} };

function withId(raw: any, subrepo?: string): ProjectDeployLink {
  const link: ProjectDeployLink = {
    ...raw,
    provider: raw.provider || 'railway',
    ...(subrepo && subrepo !== ROOT_SCOPE ? { subrepo } : {}),
  };
  return { ...link, id: link.id || linkId(link) };
}

/**
 * v1 stored one link per project, unscoped; v2 one per checkout, keyed by
 * sub-repository. Both fold into the list without anyone reconnecting.
 */
function migrateProjects(raw: any): DeployConfig['projects'] {
  const projects: DeployConfig['projects'] = {};
  for (const [projectId, value] of Object.entries(raw || {})) {
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      projects[projectId] = value.map(link => withId(link));
    } else if ((value as any).provider) {
      projects[projectId] = [withId(value)];
    } else {
      projects[projectId] = Object.entries(value as Record<string, any>).map(([scope, link]) =>
        withId(link, scope),
      );
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
  const payload = JSON.stringify({ version: 3, tokens, projects: config.projects }, null, 2);
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

/** One link by its id. */
export async function getLink(projectId: string, id: string): Promise<ProjectDeployLink | null> {
  return (await load()).projects[projectId]?.find(link => link.id === id) ?? null;
}

/** Every deploy watched for one project. */
export async function getProjectLinks(projectId: string): Promise<ProjectDeployLink[]> {
  return [...((await load()).projects[projectId] || [])];
}

/** Every deploy watched for one checkout of a project. */
export async function getScopeLinks(projectId: string, subrepo?: string | null): Promise<ProjectDeployLink[]> {
  const scope = scopeKey(subrepo);
  return (await getProjectLinks(projectId)).filter(link => scopeKey(link.subrepo) === scope);
}

/** Every link of every project, flattened. */
export async function listLinks(): Promise<{ projectId: string; link: ProjectDeployLink }[]> {
  const { projects } = await load();
  const list: { projectId: string; link: ProjectDeployLink }[] = [];
  for (const [projectId, links] of Object.entries(projects)) {
    for (const link of links) list.push({ projectId, link });
  }
  return list;
}

/** Save a link, replacing the one pointing at the same Railway target. */
export async function setLink(
  projectId: string,
  link: Omit<ProjectDeployLink, 'updatedAt' | 'id'>,
): Promise<ProjectDeployLink> {
  const stored: ProjectDeployLink = { ...link, id: linkId(link), updatedAt: new Date().toISOString() };
  await mutate(config => {
    const existing = config.projects[projectId] || [];
    config.projects[projectId] = [...existing.filter(entry => entry.id !== stored.id), stored];
  });
  return stored;
}

function drop(projectId: string, keep: (link: ProjectDeployLink) => boolean): Promise<void> {
  return mutate(config => {
    const existing = config.projects[projectId];
    if (!existing) return;
    const next = existing.filter(keep);
    if (next.length === 0) delete config.projects[projectId];
    else config.projects[projectId] = next;
  });
}

/** Drop one link. */
export async function clearLink(projectId: string, id: string): Promise<void> {
  await drop(projectId, link => link.id !== id);
}

/** Drop every link of one checkout. */
export async function clearScope(projectId: string, subrepo?: string | null): Promise<void> {
  const scope = scopeKey(subrepo);
  await drop(projectId, link => scopeKey(link.subrepo) !== scope);
}

/** Drop every link of a project — used when the user unlinks the whole thing. */
export async function clearProject(projectId: string): Promise<void> {
  await mutate(config => {
    delete config.projects[projectId];
  });
}

// ── Cloud sync ───────────────────────────────────────────────────────────

export async function exportForCloud(): Promise<DeployConfig> {
  return load();
}

export async function replaceFromCloud(config: DeployConfig): Promise<void> {
  await mutate(next => {
    next.tokens = { ...(config.tokens || {}) };
    next.projects = migrateProjects(config.projects);
  });
}
