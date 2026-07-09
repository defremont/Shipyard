import { readFile, writeFile, mkdir, unlink, rename, copyFile } from 'fs/promises';
import { join } from 'path';
import { DATA_DIR } from './dataDir.js';

// Server-side sync store.
//
// Data model (v3):
//   - providers: one record per provider holding GLOBAL credentials
//     (apiKey, token) that apply across all projects.
//   - projects: nested by milestone — each (projectId, providerId, milestoneId)
//     gets its own integration record (board/list state, settings, status).
//     The default milestone uses the literal id 'default'.
//
// v2 → v3 migration: per-project integration records are discarded so users
// reconnect manually (Trello/ClickUp didn't have milestone awareness before;
// the old single-board-per-project state would be wrong if we mapped it onto
// a single milestone). Global provider credentials are preserved so users
// don't have to paste API tokens again.

const STORE_FILE = join(DATA_DIR, 'sync-config.json');

export type SyncProviderId = 'trello' | 'clickup';

const SECRET_KEYS: Record<SyncProviderId, string[]> = {
  trello: ['apiKey', 'token'],
  clickup: ['token'],
};

export const DEFAULT_MILESTONE = 'default';

function normalizeMilestone(milestoneId?: string): string {
  return milestoneId && milestoneId !== '' ? milestoneId : DEFAULT_MILESTONE;
}

// ── Types ───────────────────────────────────────────────────────────────

export interface ProviderCredentials {
  providerId: SyncProviderId;
  settings: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSyncConfig {
  providerId: SyncProviderId;
  projectId: string;
  milestoneId: string;
  enabled: boolean;
  autoSync: boolean;
  settings: Record<string, any>; // per-project, e.g. spaceId for ClickUp, milestoneName for board naming
  state: Record<string, any>;
  lastSyncAt: string | null;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoreV3 {
  version: 3;
  providers: Partial<Record<SyncProviderId, ProviderCredentials>>;
  // projects[projectId][providerId][milestoneId]
  projects: Record<string, Partial<Record<SyncProviderId, Record<string, ProjectSyncConfig>>>>;
}

// v2 shape (kept only for migration discard).
interface StoreV2 {
  version: 2;
  providers: Partial<Record<SyncProviderId, ProviderCredentials>>;
  projects: Record<string, Partial<Record<SyncProviderId, any>>>;
}

// ── Low-level IO + migration ────────────────────────────────────────────
//
// All mutations are serialized through a single mutex and writes are atomic
// (tmp file + rename). Without this, concurrent read-modify-write cycles
// (auto-push debounce, 30s client pulls, status patches) could interleave and
// silently drop provider credentials / project links — which surfaced as
// "Trello keeps disconnecting". A read that hits a corrupt/partial file falls
// back to the last good in-memory copy instead of an empty store, so a bad
// read can never wipe existing connections on the next write.
//
// This process is the only writer, so once the file has been read the
// in-memory copy IS the store: reads are served from it without touching the
// disk. That matters because a single task mutation fans out into a dozen
// reads (listProjectConfigs → getProviderCredentials per config → push's
// getEffectiveConfig/patchState/patchStatus), and each one used to re-read and
// re-parse the whole JSON file.

let storeLock: Promise<unknown> = Promise.resolve();
function withStoreLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = storeLock.then(fn, fn);
  storeLock = next.catch(() => {});
  return next;
}

let cachedStore: StoreV3 | null = null;

async function readStore(): Promise<StoreV3> {
  if (cachedStore) return cachedStore;

  let data: string;
  try {
    data = await readFile(STORE_FILE, 'utf-8');
  } catch {
    // File doesn't exist yet — genuinely empty store
    return { version: 3, providers: {}, projects: {} };
  }

  try {
    const parsed = JSON.parse(data);
    if (parsed?.version === 3 && parsed.projects && parsed.providers) {
      cachedStore = parsed;
      return parsed;
    }
    if (parsed?.version === 2 && parsed.providers) {
      return migrateFromV2(parsed as StoreV2);
    }
    // v1 or unknown shape — discard project state, no creds worth keeping
    return { version: 3, providers: {}, projects: {} };
  } catch (err) {
    // Corrupt file (e.g. partial write). Keep a backup for recovery and use
    // the last good copy so we never wipe existing connections.
    console.error('[syncStore] sync-config.json is corrupt, using last good copy:', (err as Error).message);
    try { await copyFile(STORE_FILE, `${STORE_FILE}.corrupt-${Date.now()}.bak`); } catch {}
    return cachedStore ?? { version: 3, providers: {}, projects: {} };
  }
}

function migrateFromV2(v2: StoreV2): StoreV3 {
  // Keep global credentials; discard per-project records so the user reconnects
  // each project/milestone fresh under the new schema. Persist immediately so
  // we never re-migrate.
  const v3: StoreV3 = {
    version: 3,
    providers: v2.providers ?? {},
    projects: {},
  };
  cachedStore = v3;
  void writeStore(v3);
  return v3;
}

async function writeStore(store: StoreV3): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  // Atomic write: a reader can never observe a partially written file
  const tmp = `${STORE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8');
  await rename(tmp, STORE_FILE);
  cachedStore = store;
}

// ── Provider (global) API ───────────────────────────────────────────────

export async function getProviderCredentials(
  providerId: SyncProviderId,
): Promise<ProviderCredentials | null> {
  const store = await readStore();
  return store.providers[providerId] ?? null;
}

export async function saveProviderCredentials(
  providerId: SyncProviderId,
  patch: Record<string, any>,
): Promise<ProviderCredentials> {
  return withStoreLock(async () => {
    const store = await readStore();
    const existing = store.providers[providerId];
    const now = new Date().toISOString();
    const next: ProviderCredentials = {
      providerId,
      settings: { ...(existing?.settings ?? {}), ...patch },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    store.providers[providerId] = next;
    await writeStore(store);
    return next;
  });
}

export async function deleteProviderCredentials(providerId: SyncProviderId): Promise<boolean> {
  return withStoreLock(async () => {
    const store = await readStore();
    if (!store.providers[providerId]) return false;
    delete store.providers[providerId];
    // Disable every milestone integration that depended on these credentials.
    for (const projectId of Object.keys(store.projects)) {
      const byProvider = store.projects[projectId][providerId];
      if (!byProvider) continue;
      for (const mid of Object.keys(byProvider)) {
        const entry = byProvider[mid];
        if (!entry) continue;
        entry.enabled = false;
        entry.autoSync = false;
        entry.updatedAt = new Date().toISOString();
      }
    }
    await writeStore(store);
    return true;
  });
}

/** Which providers have credentials saved? Safe to send to the client. */
export async function listProviderStatus(): Promise<Array<{
  providerId: SyncProviderId;
  connected: boolean;
  settingsSet: Record<string, boolean>;
  updatedAt: string | null;
}>> {
  const store = await readStore();
  return (['trello', 'clickup'] as SyncProviderId[]).map(providerId => {
    const creds = store.providers[providerId];
    const settingsSet: Record<string, boolean> = {};
    for (const k of SECRET_KEYS[providerId]) {
      settingsSet[`${k}Set`] = !!creds?.settings?.[k];
    }
    const connected = SECRET_KEYS[providerId].every(k => !!creds?.settings?.[k]);
    return {
      providerId,
      connected,
      settingsSet,
      updatedAt: creds?.updatedAt ?? null,
    };
  });
}

// ── Per-(project, milestone) config API ────────────────────────────────

export async function getProjectConfig(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId?: string,
): Promise<ProjectSyncConfig | null> {
  const mid = normalizeMilestone(milestoneId);
  const store = await readStore();
  return store.projects[projectId]?.[providerId]?.[mid] ?? null;
}

export interface SaveProjectInput {
  projectId: string;
  providerId: SyncProviderId;
  milestoneId?: string;
  settings?: Record<string, any>;
  state?: Record<string, any>;
  enabled?: boolean;
  autoSync?: boolean;
}

export async function saveProjectConfig(input: SaveProjectInput): Promise<ProjectSyncConfig> {
  return withStoreLock(async () => {
  const mid = normalizeMilestone(input.milestoneId);
  const store = await readStore();
  store.projects[input.projectId] ??= {};
  store.projects[input.projectId][input.providerId] ??= {};
  const byMilestone = store.projects[input.projectId][input.providerId]!;
  const existing = byMilestone[mid];
  const now = new Date().toISOString();

  // Strip any secret keys that slipped in — those belong to the provider scope.
  const cleaned: Record<string, any> = { ...(input.settings ?? {}) };
  for (const k of SECRET_KEYS[input.providerId]) delete cleaned[k];

  const next: ProjectSyncConfig = {
    providerId: input.providerId,
    projectId: input.projectId,
    milestoneId: mid,
    enabled: input.enabled ?? existing?.enabled ?? true,
    autoSync: input.autoSync ?? existing?.autoSync ?? false,
    settings: { ...(existing?.settings ?? {}), ...cleaned },
    state: { ...(existing?.state ?? {}), ...(input.state ?? {}) },
    lastSyncAt: existing?.lastSyncAt ?? null,
    lastSyncStatus: existing?.lastSyncStatus ?? null,
    lastSyncError: existing?.lastSyncError ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  byMilestone[mid] = next;
  await writeStore(store);
  return next;
  });
}

export async function patchState(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId: string | undefined,
  patch: Record<string, any>,
): Promise<void> {
  return withStoreLock(async () => {
    const mid = normalizeMilestone(milestoneId);
    const store = await readStore();
    const entry = store.projects[projectId]?.[providerId]?.[mid];
    if (!entry) return;
    entry.state = { ...entry.state, ...patch };
    entry.updatedAt = new Date().toISOString();
    await writeStore(store);
  });
}

export async function patchStatus(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId: string | undefined,
  status: { ok: boolean; error?: string },
): Promise<void> {
  return withStoreLock(async () => {
    const mid = normalizeMilestone(milestoneId);
    const store = await readStore();
    const entry = store.projects[projectId]?.[providerId]?.[mid];
    if (!entry) return;
    entry.lastSyncAt = new Date().toISOString();
    entry.lastSyncStatus = status.ok ? 'ok' : 'error';
    entry.lastSyncError = status.ok ? null : (status.error ?? 'unknown error');
    entry.updatedAt = entry.lastSyncAt;
    await writeStore(store);
  });
}

export async function deleteProjectConfig(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId?: string,
): Promise<boolean> {
  return withStoreLock(async () => {
    const mid = normalizeMilestone(milestoneId);
    const store = await readStore();
    const byProvider = store.projects[projectId]?.[providerId];
    if (!byProvider?.[mid]) return false;
    delete byProvider[mid];
    if (Object.keys(byProvider).length === 0) {
      delete store.projects[projectId][providerId];
    }
    if (Object.keys(store.projects[projectId]).length === 0) {
      delete store.projects[projectId];
    }
    await writeStore(store);
    return true;
  });
}

/**
 * List every per-milestone config (optionally filtered to one project).
 * Each returned entry is one (projectId, providerId, milestoneId) record.
 */
export async function listProjectConfigs(projectId?: string): Promise<ProjectSyncConfig[]> {
  const store = await readStore();
  const out: ProjectSyncConfig[] = [];
  const projectEntries = projectId
    ? ([[projectId, store.projects[projectId]]] as Array<[string, StoreV3['projects'][string] | undefined]>)
    : Object.entries(store.projects);
  for (const [, byProvider] of projectEntries) {
    if (!byProvider) continue;
    for (const byMilestone of Object.values(byProvider)) {
      if (!byMilestone) continue;
      for (const entry of Object.values(byMilestone)) {
        if (entry) out.push(entry);
      }
    }
  }
  return out;
}

// ── Merged view used by the sync engine ─────────────────────────────────

export interface EffectiveConfig {
  providerId: SyncProviderId;
  projectId: string;
  milestoneId: string;
  settings: Record<string, any>; // merged: provider creds + per-project settings
  state: Record<string, any>;
  enabled: boolean;
  autoSync: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
}

/**
 * Build the config the provider implementation actually uses: global creds
 * from the provider record, per-(project, milestone) options/state on top.
 */
export async function getEffectiveConfig(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId?: string,
): Promise<EffectiveConfig | null> {
  const mid = normalizeMilestone(milestoneId);
  const store = await readStore();
  const creds = store.providers[providerId];
  if (!creds) return null;
  const project = store.projects[projectId]?.[providerId]?.[mid];

  return {
    providerId,
    projectId,
    milestoneId: mid,
    settings: { ...creds.settings, ...(project?.settings ?? {}) },
    state: project?.state ?? {},
    enabled: project?.enabled ?? false,
    autoSync: project?.autoSync ?? false,
    lastSyncAt: project?.lastSyncAt ?? null,
    lastSyncStatus: project?.lastSyncStatus ?? null,
    lastSyncError: project?.lastSyncError ?? null,
  };
}

/** Strip secrets before returning provider-level config to the client. */
export function sanitizeProject(config: ProjectSyncConfig) {
  return {
    providerId: config.providerId,
    projectId: config.projectId,
    milestoneId: config.milestoneId,
    enabled: config.enabled,
    autoSync: config.autoSync,
    settings: config.settings,
    state: config.state,
    lastSyncAt: config.lastSyncAt,
    lastSyncStatus: config.lastSyncStatus,
    lastSyncError: config.lastSyncError,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function clearAll(): Promise<void> {
  return withStoreLock(async () => {
    cachedStore = null;
    try { await unlink(STORE_FILE); } catch { /* already gone */ }
  });
}
