import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { DATA_DIR } from './dataDir.js';

// Server-side sync store.
//
// Data model (v2):
//   - providers: one record per provider holding GLOBAL credentials
//     (apiKey, token) that apply across all projects. The user configures
//     them once.
//   - projects: per-project toggle + per-project non-shared settings
//     (e.g. ClickUp spaceId) + non-sensitive state (boardId, cardMap, ...).
//
// v1 → v2 migration: the old shape combined credentials and per-project
// state in a single entry. The first provider entry we see donates its
// apiKey/token to the global provider record; every project entry becomes
// a `projects[id][providerId]` row with its own state/settings (minus the
// credentials).

const STORE_FILE = join(DATA_DIR, 'sync-config.json');

export type SyncProviderId = 'trello' | 'clickup';

const SECRET_KEYS: Record<SyncProviderId, string[]> = {
  trello: ['apiKey', 'token'],
  clickup: ['token'],
};

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
  enabled: boolean;
  autoSync: boolean;
  settings: Record<string, any>; // per-project, e.g. spaceId for ClickUp
  state: Record<string, any>;
  lastSyncAt: string | null;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoreV2 {
  version: 2;
  providers: Partial<Record<SyncProviderId, ProviderCredentials>>;
  projects: Record<string, Partial<Record<SyncProviderId, ProjectSyncConfig>>>;
}

// v1 shape, kept only for migration.
interface StoreV1 {
  version: 1;
  entries: Record<string, {
    providerId: SyncProviderId;
    projectId: string;
    enabled: boolean;
    autoSync: boolean;
    settings: Record<string, any>;
    state: Record<string, any>;
    lastSyncAt: string | null;
    lastSyncStatus: 'ok' | 'error' | null;
    lastSyncError: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

// ── Low-level IO + migration ────────────────────────────────────────────

async function readStore(): Promise<StoreV2> {
  try {
    const data = await readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed?.version === 2 && parsed.projects && parsed.providers) {
      return parsed;
    }
    if (parsed?.version === 1 && parsed.entries) {
      return migrateFromV1(parsed as StoreV1);
    }
    return { version: 2, providers: {}, projects: {} };
  } catch {
    return { version: 2, providers: {}, projects: {} };
  }
}

function migrateFromV1(v1: StoreV1): StoreV2 {
  const v2: StoreV2 = { version: 2, providers: {}, projects: {} };
  const now = new Date().toISOString();

  for (const entry of Object.values(v1.entries)) {
    // Extract credentials the first time we see this provider.
    const providerId = entry.providerId;
    const secretKeys = SECRET_KEYS[providerId];
    if (!v2.providers[providerId]) {
      const creds: Record<string, any> = {};
      for (const k of secretKeys) {
        if (entry.settings[k]) creds[k] = entry.settings[k];
      }
      if (Object.keys(creds).length > 0) {
        v2.providers[providerId] = {
          providerId,
          settings: creds,
          createdAt: entry.createdAt ?? now,
          updatedAt: entry.updatedAt ?? now,
        };
      }
    }

    // Per-project config keeps everything except the credentials.
    const projectSettings: Record<string, any> = {};
    for (const [k, v] of Object.entries(entry.settings)) {
      if (!secretKeys.includes(k)) projectSettings[k] = v;
    }

    v2.projects[entry.projectId] ??= {};
    v2.projects[entry.projectId][providerId] = {
      providerId,
      projectId: entry.projectId,
      enabled: entry.enabled,
      autoSync: entry.autoSync,
      settings: projectSettings,
      state: entry.state ?? {},
      lastSyncAt: entry.lastSyncAt,
      lastSyncStatus: entry.lastSyncStatus,
      lastSyncError: entry.lastSyncError,
      createdAt: entry.createdAt ?? now,
      updatedAt: entry.updatedAt ?? now,
    };
  }

  // Persist the migrated shape immediately so we never re-migrate.
  void writeStore(v2);
  return v2;
}

async function writeStore(store: StoreV2): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
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
}

export async function deleteProviderCredentials(providerId: SyncProviderId): Promise<boolean> {
  const store = await readStore();
  if (!store.providers[providerId]) return false;
  delete store.providers[providerId];
  // Disable every project config that depended on these credentials.
  for (const projectId of Object.keys(store.projects)) {
    const entry = store.projects[projectId][providerId];
    if (!entry) continue;
    entry.enabled = false;
    entry.autoSync = false;
    entry.updatedAt = new Date().toISOString();
  }
  await writeStore(store);
  return true;
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

// ── Per-project config API ──────────────────────────────────────────────

export async function getProjectConfig(
  projectId: string,
  providerId: SyncProviderId,
): Promise<ProjectSyncConfig | null> {
  const store = await readStore();
  return store.projects[projectId]?.[providerId] ?? null;
}

export interface SaveProjectInput {
  projectId: string;
  providerId: SyncProviderId;
  settings?: Record<string, any>;
  state?: Record<string, any>;
  enabled?: boolean;
  autoSync?: boolean;
}

export async function saveProjectConfig(input: SaveProjectInput): Promise<ProjectSyncConfig> {
  const store = await readStore();
  store.projects[input.projectId] ??= {};
  const existing = store.projects[input.projectId][input.providerId];
  const now = new Date().toISOString();

  // Strip any secret keys that slipped in — those belong to the provider scope.
  const cleaned: Record<string, any> = { ...(input.settings ?? {}) };
  for (const k of SECRET_KEYS[input.providerId]) delete cleaned[k];

  const next: ProjectSyncConfig = {
    providerId: input.providerId,
    projectId: input.projectId,
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
  store.projects[input.projectId][input.providerId] = next;
  await writeStore(store);
  return next;
}

export async function patchState(
  projectId: string,
  providerId: SyncProviderId,
  patch: Record<string, any>,
): Promise<void> {
  const store = await readStore();
  const entry = store.projects[projectId]?.[providerId];
  if (!entry) return;
  entry.state = { ...entry.state, ...patch };
  entry.updatedAt = new Date().toISOString();
  await writeStore(store);
}

export async function patchStatus(
  projectId: string,
  providerId: SyncProviderId,
  status: { ok: boolean; error?: string },
): Promise<void> {
  const store = await readStore();
  const entry = store.projects[projectId]?.[providerId];
  if (!entry) return;
  entry.lastSyncAt = new Date().toISOString();
  entry.lastSyncStatus = status.ok ? 'ok' : 'error';
  entry.lastSyncError = status.ok ? null : (status.error ?? 'unknown error');
  entry.updatedAt = entry.lastSyncAt;
  await writeStore(store);
}

export async function deleteProjectConfig(
  projectId: string,
  providerId: SyncProviderId,
): Promise<boolean> {
  const store = await readStore();
  if (!store.projects[projectId]?.[providerId]) return false;
  delete store.projects[projectId][providerId];
  if (Object.keys(store.projects[projectId]).length === 0) delete store.projects[projectId];
  await writeStore(store);
  return true;
}

/** List every per-project config (optionally filtered to one project). */
export async function listProjectConfigs(projectId?: string): Promise<ProjectSyncConfig[]> {
  const store = await readStore();
  const out: ProjectSyncConfig[] = [];
  const entries = projectId ? [[projectId, store.projects[projectId]]] as const : Object.entries(store.projects);
  for (const [, byProvider] of entries) {
    if (!byProvider) continue;
    for (const entry of Object.values(byProvider)) {
      if (entry) out.push(entry);
    }
  }
  return out;
}

// ── Merged view used by the sync engine ─────────────────────────────────

export interface EffectiveConfig {
  providerId: SyncProviderId;
  projectId: string;
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
 * from the provider record, per-project options/state layered on top.
 */
export async function getEffectiveConfig(
  projectId: string,
  providerId: SyncProviderId,
): Promise<EffectiveConfig | null> {
  const store = await readStore();
  const creds = store.providers[providerId];
  if (!creds) return null;
  const project = store.projects[projectId]?.[providerId];

  return {
    providerId,
    projectId,
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
  try { await unlink(STORE_FILE); } catch { /* already gone */ }
}
