import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { DATA_DIR } from './dataDir.js';

// Server-side sync credential store.
//
// Plain JSON under SHIPYARD_DATA_DIR — the file never hits git (data/ is
// gitignored) and only the user of the installed .exe has access to it.
// Each entry holds per-project/per-provider credentials + non-sensitive
// state (board ids, card/task maps, auto-sync toggle, last-sync status).

const STORE_FILE = join(DATA_DIR, 'sync-config.json');

export type SyncProviderId = 'trello' | 'clickup';

const SECRET_KEYS = new Set(['apiKey', 'token']);

export interface SyncConfig {
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
}

interface StoreShape {
  version: 1;
  entries: Record<string, SyncConfig>;
}

const keyOf = (projectId: string, providerId: SyncProviderId) => `${projectId}:${providerId}`;

async function readStore(): Promise<StoreShape> {
  try {
    const data = await readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(data);
    if (!parsed.entries) return { version: 1, entries: {} };
    return parsed;
  } catch {
    return { version: 1, entries: {} };
  }
}

async function writeStore(store: StoreShape): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export async function listConfigs(projectId?: string): Promise<SyncConfig[]> {
  const store = await readStore();
  const out: SyncConfig[] = [];
  for (const entry of Object.values(store.entries)) {
    if (projectId && entry.projectId !== projectId) continue;
    out.push(entry);
  }
  return out;
}

export async function getConfig(
  projectId: string,
  providerId: SyncProviderId,
): Promise<SyncConfig | null> {
  const store = await readStore();
  return store.entries[keyOf(projectId, providerId)] ?? null;
}

export interface SaveConfigInput {
  projectId: string;
  providerId: SyncProviderId;
  settings?: Record<string, any>;
  state?: Record<string, any>;
  enabled?: boolean;
  autoSync?: boolean;
}

export async function saveConfig(input: SaveConfigInput): Promise<SyncConfig> {
  const store = await readStore();
  const key = keyOf(input.projectId, input.providerId);
  const existing = store.entries[key];
  const now = new Date().toISOString();

  const next: SyncConfig = {
    providerId: input.providerId,
    projectId: input.projectId,
    enabled: input.enabled ?? existing?.enabled ?? true,
    autoSync: input.autoSync ?? existing?.autoSync ?? false,
    settings: { ...(existing?.settings ?? {}), ...(input.settings ?? {}) },
    state: { ...(existing?.state ?? {}), ...(input.state ?? {}) },
    lastSyncAt: existing?.lastSyncAt ?? null,
    lastSyncStatus: existing?.lastSyncStatus ?? null,
    lastSyncError: existing?.lastSyncError ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  store.entries[key] = next;
  await writeStore(store);
  return next;
}

export async function patchState(
  projectId: string,
  providerId: SyncProviderId,
  patch: Record<string, any>,
): Promise<void> {
  const store = await readStore();
  const key = keyOf(projectId, providerId);
  const entry = store.entries[key];
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
  const key = keyOf(projectId, providerId);
  const entry = store.entries[key];
  if (!entry) return;
  entry.lastSyncAt = new Date().toISOString();
  entry.lastSyncStatus = status.ok ? 'ok' : 'error';
  entry.lastSyncError = status.ok ? null : (status.error ?? 'unknown error');
  entry.updatedAt = entry.lastSyncAt;
  await writeStore(store);
}

export async function deleteConfig(projectId: string, providerId: SyncProviderId): Promise<boolean> {
  const store = await readStore();
  const key = keyOf(projectId, providerId);
  if (!store.entries[key]) return false;
  delete store.entries[key];
  await writeStore(store);
  return true;
}

/** Strip secrets before returning to the client; replace with a presence flag. */
export function sanitize(config: SyncConfig) {
  const settings: Record<string, any> = {};
  for (const [k, v] of Object.entries(config.settings)) {
    if (SECRET_KEYS.has(k)) {
      settings[`${k}Set`] = !!v;
    } else {
      settings[k] = v;
    }
  }
  return {
    providerId: config.providerId,
    projectId: config.projectId,
    enabled: config.enabled,
    autoSync: config.autoSync,
    settings,
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
