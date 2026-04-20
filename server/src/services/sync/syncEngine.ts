import * as taskStore from '../taskStore.js';
import * as store from '../syncStore.js';
import * as log from '../logService.js';
import * as trello from './trelloSync.js';
import * as clickup from './clickupSync.js';
import { mergeRemoteIntoLocal, type RemoteTask } from './syncMerge.js';
import type { EffectiveConfig, SyncProviderId } from '../syncStore.js';

export interface SyncOperationResult {
  success: boolean;
  message: string;
  pushed?: number;
  pulled?: number;
  created?: number;
  updated?: number;
  errors?: string[];
  remoteUrl?: string;
}

function buildEffective(
  providerId: SyncProviderId,
  projectId: string,
  overrides?: Record<string, any>,
): EffectiveConfig {
  return {
    providerId,
    projectId,
    settings: overrides ?? {},
    state: {},
    enabled: true,
    autoSync: false,
    lastSyncAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
  };
}

export async function testConnection(
  projectId: string,
  providerId: SyncProviderId,
  overrides?: Record<string, any>,
): Promise<{ ok: boolean; message: string }> {
  let config: EffectiveConfig | null = null;
  if (overrides && Object.keys(overrides).length > 0) {
    // Test with proposed credentials before they're saved globally.
    const stored = await store.getEffectiveConfig(projectId, providerId);
    config = {
      ...(stored ?? buildEffective(providerId, projectId)),
      settings: { ...(stored?.settings ?? {}), ...overrides },
    };
  } else {
    config = await store.getEffectiveConfig(projectId, providerId);
  }
  if (!config) return { ok: false, message: 'Not connected — add credentials first' };

  if (providerId === 'trello') return trello.testConnection(config);
  if (providerId === 'clickup') return clickup.testConnection(config);
  return { ok: false, message: `Unknown provider: ${providerId}` };
}

async function ensureEnabled(
  projectId: string,
  providerId: SyncProviderId,
): Promise<EffectiveConfig | { error: string }> {
  const config = await store.getEffectiveConfig(projectId, providerId);
  if (!config) return { error: `${providerId} not connected — add credentials in Settings` };
  const project = await store.getProjectConfig(projectId, providerId);
  if (!project?.enabled) return { error: `${providerId} not enabled for this project` };
  return config;
}

export async function pushAll(
  projectId: string,
  providerId: SyncProviderId,
): Promise<SyncOperationResult> {
  const config = await ensureEnabled(projectId, providerId);
  if ('error' in config) return { success: false, message: config.error };

  const tasks = await taskStore.getTasks(projectId);

  try {
    if (providerId === 'trello') {
      const r = await trello.pushTasks(config, tasks);
      await store.patchStatus(projectId, providerId, { ok: r.errors.length === 0, error: r.errors[0] });
      return toResult(r.errors, r.pushed, r.total, r.boardUrl);
    }
    if (providerId === 'clickup') {
      const r = await clickup.pushTasks(config, tasks);
      await store.patchStatus(projectId, providerId, { ok: r.errors.length === 0, error: r.errors[0] });
      return toResult(r.errors, r.pushed, r.total, r.listUrl);
    }
    return { success: false, message: `Unknown provider: ${providerId}` };
  } catch (err: any) {
    const message = err?.message ?? 'Push failed';
    await store.patchStatus(projectId, providerId, { ok: false, error: message });
    return { success: false, message };
  }
}

export async function pullAll(
  projectId: string,
  providerId: SyncProviderId,
): Promise<SyncOperationResult> {
  const config = await ensureEnabled(projectId, providerId);
  if ('error' in config) return { success: false, message: config.error };

  try {
    const remote = await fetchRemote(config, providerId);
    const localTasks = await taskStore.getTasks(projectId);
    const { merged, created, updated, idMapPatch } = mergeRemoteIntoLocal(localTasks, remote, projectId);

    if (created > 0 || updated > 0) {
      await taskStore.replaceTasks(projectId, merged);
      await mergeIdMap(config, providerId, idMapPatch);
    }
    await store.patchStatus(projectId, providerId, { ok: true });

    return {
      success: true,
      pulled: remote.length,
      created,
      updated,
      message: `Pulled ${remote.length} (${created} new, ${updated} updated)`,
    };
  } catch (err: any) {
    const message = err?.message ?? 'Pull failed';
    await store.patchStatus(projectId, providerId, { ok: false, error: message });
    return { success: false, message };
  }
}

export async function mergeBoth(
  projectId: string,
  providerId: SyncProviderId,
): Promise<SyncOperationResult> {
  const pull = await pullAll(projectId, providerId);
  if (!pull.success) return pull;
  const push = await pushAll(projectId, providerId);
  return {
    success: pull.success && push.success,
    pulled: pull.pulled,
    created: pull.created,
    updated: pull.updated,
    pushed: push.pushed,
    errors: [...(pull.errors ?? []), ...(push.errors ?? [])],
    remoteUrl: push.remoteUrl,
    message: `${pull.message}; ${push.message}`,
  };
}

async function fetchRemote(config: EffectiveConfig, providerId: SyncProviderId): Promise<RemoteTask[]> {
  if (providerId === 'trello') {
    const cards = await trello.pullCards(config);
    return cards.map(c => ({ remoteId: c.cardId, taskId: c.taskId, title: c.title, description: c.description, prompt: c.prompt, status: c.status, priority: c.priority, updatedAt: c.updatedAt }));
  }
  if (providerId === 'clickup') {
    const tasks = await clickup.pullTasks(config);
    return tasks.map(t => ({ remoteId: t.clickupId, taskId: t.taskId, title: t.title, description: t.description, prompt: t.prompt, status: t.status, priority: t.priority, updatedAt: t.updatedAt }));
  }
  return [];
}

async function mergeIdMap(
  config: EffectiveConfig,
  providerId: SyncProviderId,
  patch: Record<string, string>,
): Promise<void> {
  if (Object.keys(patch).length === 0) return;
  if (providerId === 'trello') {
    const nextMap = { ...(config.state.cardMap ?? {}), ...patch };
    await store.patchState(config.projectId, 'trello', { cardMap: nextMap });
  } else if (providerId === 'clickup') {
    const nextMap = { ...(config.state.taskMap ?? {}), ...patch };
    await store.patchState(config.projectId, 'clickup', { taskMap: nextMap });
  }
}

function toResult(errors: string[], pushed: number, total: number, remoteUrl?: string): SyncOperationResult {
  const success = errors.length === 0;
  return {
    success,
    pushed,
    errors: errors.length ? errors : undefined,
    message: success ? `Pushed ${pushed} tasks` : `Pushed ${pushed} of ${total} — ${errors.length} errors`,
    remoteUrl,
  };
}

// ── Auto-sync scheduler ─────────────────────────────────────────────────

const timers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 2500;

export function triggerAutoSync(projectId: string): void {
  void (async () => {
    try {
      const configs = await store.listProjectConfigs(projectId);
      for (const cfg of configs) {
        if (!cfg.enabled || !cfg.autoSync) continue;
        // If credentials are missing globally, skip silently.
        const creds = await store.getProviderCredentials(cfg.providerId);
        if (!creds) continue;
        const key = `${projectId}:${cfg.providerId}`;
        const prev = timers.get(key);
        if (prev) clearTimeout(prev);
        const timer = setTimeout(() => runAutoSync(projectId, cfg.providerId), DEBOUNCE_MS);
        timers.set(key, timer);
      }
    } catch (err: any) {
      log.warn('sync', `auto-sync schedule failed: ${err?.message ?? err}`, undefined, projectId);
    }
  })();
}

async function runAutoSync(projectId: string, providerId: SyncProviderId): Promise<void> {
  try {
    const result = await pushAll(projectId, providerId);
    if (!result.success) {
      log.warn('sync', `auto-sync push (${providerId}) failed: ${result.message}`, undefined, projectId);
    }
  } catch (err: any) {
    log.error('sync', `auto-sync error (${providerId})`, err?.message ?? String(err), projectId);
    await store.patchStatus(projectId, providerId, { ok: false, error: err?.message ?? 'unknown' });
  }
}
