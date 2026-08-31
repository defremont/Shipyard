import * as taskStore from '../taskStore.js';
import * as store from '../syncStore.js';
import * as log from '../logService.js';
import * as trello from './trelloSync.js';
import * as clickup from './clickupSync.js';
import { mergeRemoteIntoLocal, type RemoteTask } from './syncMerge.js';
import type { EffectiveConfig, SyncProviderId, ProjectSyncConfig } from '../syncStore.js';

export interface SyncOperationResult {
  success: boolean;
  message: string;
  pushed?: number;
  pulled?: number;
  created?: number;
  updated?: number;
  errors?: string[];
  remoteUrl?: string;
  matchedCount?: number;
  totalRemote?: number;
  milestoneId?: string;
}

const DEFAULT_MILESTONE = 'default';

function normalizeMilestone(milestoneId?: string): string {
  return milestoneId && milestoneId !== '' ? milestoneId : DEFAULT_MILESTONE;
}

// Per-integration serialization. Without this, the 30s auto-pull tick and
// the 2.5s mutation-debounced push can run in parallel for the same
// (project, provider, milestone). The pull reads cardMap from a stale
// snapshot, sees the card the parallel push just created as unmapped, and
// creates a duplicate local task; the next push then creates a second card
// for the original task. Locking prevents that race.
const integrationLocks = new Map<string, Promise<unknown>>();

function lockKey(projectId: string, providerId: SyncProviderId, milestoneId: string): string {
  return `${projectId}:${providerId}:${milestoneId}`;
}

async function withIntegrationLock<T>(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = lockKey(projectId, providerId, milestoneId);
  const prev = integrationLocks.get(key);
  const run = (async () => {
    if (prev) {
      try { await prev; } catch { /* prior failure must not block our turn */ }
    }
    return fn();
  })();
  integrationLocks.set(key, run);
  try {
    return await run;
  } finally {
    if (integrationLocks.get(key) === run) integrationLocks.delete(key);
  }
}

async function getMilestoneName(projectId: string, milestoneId: string): Promise<string | null> {
  if (milestoneId === DEFAULT_MILESTONE) return null;
  try {
    const milestones = await taskStore.getMilestones(projectId);
    const m = milestones.find(x => x.id === milestoneId);
    return m?.name ?? null;
  } catch {
    return null;
  }
}

function buildEffective(
  providerId: SyncProviderId,
  projectId: string,
  milestoneId: string,
  overrides?: Record<string, any>,
): EffectiveConfig {
  return {
    providerId,
    projectId,
    milestoneId,
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
  milestoneId?: string,
  overrides?: Record<string, any>,
): Promise<{ ok: boolean; message: string }> {
  const mid = normalizeMilestone(milestoneId);
  let config: EffectiveConfig | null = null;
  if (overrides && Object.keys(overrides).length > 0) {
    // Test with proposed credentials before they're saved globally.
    const stored = await store.getEffectiveConfig(projectId, providerId, mid);
    config = {
      ...(stored ?? buildEffective(providerId, projectId, mid)),
      settings: { ...(stored?.settings ?? {}), ...overrides },
    };
  } else {
    config = await store.getEffectiveConfig(projectId, providerId, mid);
  }
  if (!config) return { ok: false, message: 'Not connected — add credentials first' };

  if (providerId === 'trello') return trello.testConnection(config);
  if (providerId === 'clickup') return clickup.testConnection(config);
  return { ok: false, message: `Unknown provider: ${providerId}` };
}

async function ensureEnabled(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId: string,
): Promise<EffectiveConfig | { error: string }> {
  const config = await store.getEffectiveConfig(projectId, providerId, milestoneId);
  if (!config) return { error: `${providerId} not connected — add credentials in Settings` };
  const project = await store.getProjectConfig(projectId, providerId, milestoneId);
  if (!project?.enabled) return { error: `${providerId} not enabled for this milestone` };
  return config;
}

function tasksForMilestone(milestoneId: string) {
  // taskStore.getTasks expects 'default' to mean "tasks without milestoneId".
  // Pass the milestoneId straight through; everything else is filtered server-side.
  return milestoneId;
}

export async function pushAll(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId?: string,
): Promise<SyncOperationResult> {
  const mid = normalizeMilestone(milestoneId);
  return withIntegrationLock(projectId, providerId, mid, async () => {
    const config = await ensureEnabled(projectId, providerId, mid);
    if ('error' in config) return { success: false, message: config.error, milestoneId: mid };

    const tasks = await taskStore.getTasks(projectId, tasksForMilestone(mid));

    try {
      if (providerId === 'trello') {
        const r = await trello.pushTasks(config, tasks);
        await store.patchStatus(projectId, providerId, mid, { ok: r.errors.length === 0, error: r.errors[0] });
        return { ...toResult(r.errors, r.pushed, r.total, r.boardUrl), milestoneId: mid };
      }
      if (providerId === 'clickup') {
        const r = await clickup.pushTasks(config, tasks);
        await store.patchStatus(projectId, providerId, mid, { ok: r.errors.length === 0, error: r.errors[0] });
        return { ...toResult(r.errors, r.pushed, r.total, r.listUrl), milestoneId: mid };
      }
      return { success: false, message: `Unknown provider: ${providerId}`, milestoneId: mid };
    } catch (err: any) {
      const message = err?.message ?? 'Push failed';
      await store.patchStatus(projectId, providerId, mid, { ok: false, error: message });
      return { success: false, message, milestoneId: mid };
    }
  });
}

export async function pullAll(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId?: string,
): Promise<SyncOperationResult> {
  const mid = normalizeMilestone(milestoneId);
  return withIntegrationLock(projectId, providerId, mid, async () => {
    const config = await ensureEnabled(projectId, providerId, mid);
    if ('error' in config) return { success: false, message: config.error, milestoneId: mid };

    try {
      const remote = await fetchRemote(config, providerId);
      const localTasks = await taskStore.getTasks(projectId, tasksForMilestone(mid));
      const { merged, created, updated, idMapPatch } = mergeRemoteIntoLocal(localTasks, remote, projectId, mid);

      if (created > 0 || updated > 0 || Object.keys(idMapPatch).length > 0) {
        // Scoped replace: only this milestone's tasks are rewritten; other
        // milestones in the project are untouched.
        if (created > 0 || updated > 0) {
          await taskStore.replaceTasks(projectId, merged, mid);
        }
        // Always persist new title-match links — even when no fields changed —
        // so the next push won't re-create a card we already adopted.
        await mergeIdMap(config, providerId, idMapPatch);
      }
      await store.patchStatus(projectId, providerId, mid, { ok: true });

      return {
        success: true,
        pulled: remote.length,
        created,
        updated,
        milestoneId: mid,
        message: `Pulled ${remote.length} (${created} new, ${updated} updated)`,
      };
    } catch (err: any) {
      const message = err?.message ?? 'Pull failed';
      await store.patchStatus(projectId, providerId, mid, { ok: false, error: message });
      return { success: false, message, milestoneId: mid };
    }
  });
}

export async function mergeBoth(
  projectId: string,
  providerId: SyncProviderId,
  milestoneId?: string,
): Promise<SyncOperationResult> {
  const mid = normalizeMilestone(milestoneId);
  // pullAll + pushAll each take the same lock, so they're already serialized
  // against other operations on this integration. The sequencing here is just
  // to compose the result; we still hand both off to their own lock acquisition
  // (recursion on the same async chain re-enters cleanly because each call
  // awaits the prior promise stored under the same key).
  const pull = await pullAll(projectId, providerId, mid);
  if (!pull.success) return pull;
  const push = await pushAll(projectId, providerId, mid);
  return {
    success: pull.success && push.success,
    pulled: pull.pulled,
    created: pull.created,
    updated: pull.updated,
    pushed: push.pushed,
    errors: [...(pull.errors ?? []), ...(push.errors ?? [])],
    remoteUrl: push.remoteUrl,
    milestoneId: mid,
    message: `${pull.message}; ${push.message}`,
  };
}

// ── Link to existing remote board/list ─────────────────────────────────

export async function linkTrelloBoard(
  projectId: string,
  boardId: string,
  milestoneId?: string,
): Promise<SyncOperationResult> {
  const mid = normalizeMilestone(milestoneId);
  const config = await store.getEffectiveConfig(projectId, 'trello', mid);
  if (!config) return { success: false, message: 'Trello not connected — add credentials first' };

  try {
    const tasks = await taskStore.getTasks(projectId, tasksForMilestone(mid));
    const milestoneName = await getMilestoneName(projectId, mid);
    const { state, result } = await trello.linkToExistingBoard(config, boardId, tasks);

    await store.saveProjectConfig({
      projectId,
      providerId: 'trello',
      milestoneId: mid,
      enabled: true,
      autoSync: true,
      settings: {
        projectName: config.settings.projectName ?? projectId,
        ...(milestoneName ? { milestoneName } : {}),
      },
      state,
    });
    await store.patchStatus(projectId, 'trello', mid, { ok: true });

    return {
      success: true,
      remoteUrl: result.boardUrl,
      matchedCount: result.matchedCount,
      totalRemote: result.totalCards,
      milestoneId: mid,
      message: `Linked to existing board — ${result.matchedCount} of ${tasks.length} local tasks matched by title (${result.listsCreated} lists + ${result.labelsCreated} labels created as needed)`,
    };
  } catch (err: any) {
    const message = err?.message ?? 'Link failed';
    await store.patchStatus(projectId, 'trello', mid, { ok: false, error: message });
    return { success: false, message, milestoneId: mid };
  }
}

export async function linkClickupList(
  projectId: string,
  spaceId: string,
  listId: string,
  milestoneId?: string,
): Promise<SyncOperationResult> {
  const mid = normalizeMilestone(milestoneId);
  const base = await store.getEffectiveConfig(projectId, 'clickup', mid);
  if (!base) return { success: false, message: 'ClickUp not connected — add credentials first' };

  const config: EffectiveConfig = { ...base, settings: { ...base.settings, spaceId } };

  try {
    const tasks = await taskStore.getTasks(projectId, tasksForMilestone(mid));
    const milestoneName = await getMilestoneName(projectId, mid);
    const { state, result } = await clickup.linkToExistingList(config, listId, tasks);

    await store.saveProjectConfig({
      projectId,
      providerId: 'clickup',
      milestoneId: mid,
      enabled: true,
      autoSync: true,
      settings: {
        projectName: config.settings.projectName ?? projectId,
        spaceId,
        ...(milestoneName ? { milestoneName } : {}),
      },
      state,
    });
    await store.patchStatus(projectId, 'clickup', mid, { ok: true });

    return {
      success: true,
      remoteUrl: result.listUrl,
      matchedCount: result.matchedCount,
      totalRemote: result.totalTasks,
      milestoneId: mid,
      message: `Linked to existing list — ${result.matchedCount} of ${tasks.length} local tasks matched by title`,
    };
  } catch (err: any) {
    const message = err?.message ?? 'Link failed';
    await store.patchStatus(projectId, 'clickup', mid, { ok: false, error: message });
    return { success: false, message, milestoneId: mid };
  }
}

/**
 * Find the Trello card a task is linked to. The link lives in the sync config
 * state (cardMap), never on the task itself, and a project can have one
 * integration per milestone — so when the caller doesn't know the milestone we
 * search every enabled Trello config of the project.
 */
export async function resolveTrelloCard(
  projectId: string,
  taskId: string,
  milestoneId?: string,
): Promise<{ config: EffectiveConfig; cardId: string } | null> {
  const candidates: string[] = [];
  if (milestoneId) {
    candidates.push(normalizeMilestone(milestoneId));
  } else {
    const configs = await store.listProjectConfigs(projectId);
    for (const c of configs) {
      if (c.providerId === 'trello' && c.enabled) candidates.push(c.milestoneId);
    }
  }

  for (const mid of candidates) {
    const config = await store.getEffectiveConfig(projectId, 'trello', mid);
    const cardId = config?.state?.cardMap?.[taskId];
    if (config && cardId) return { config, cardId };
  }
  return null;
}

async function fetchRemote(config: EffectiveConfig, providerId: SyncProviderId): Promise<RemoteTask[]> {
  if (providerId === 'trello') {
    const cards = await trello.pullCards(config);
    return cards.map(c => ({ remoteId: c.cardId, taskId: c.taskId, title: c.title, description: c.description, prompt: c.prompt, effort: c.effort, status: c.status, priority: c.priority, updatedAt: c.updatedAt, attachments: c.attachments, comments: c.comments }));
  }
  if (providerId === 'clickup') {
    const tasks = await clickup.pullTasks(config);
    return tasks.map(t => ({ remoteId: t.clickupId, taskId: t.taskId, title: t.title, description: t.description, prompt: t.prompt, effort: t.effort, status: t.status, priority: t.priority, updatedAt: t.updatedAt }));
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
    await store.patchState(config.projectId, 'trello', config.milestoneId, { cardMap: nextMap });
  } else if (providerId === 'clickup') {
    const nextMap = { ...(config.state.taskMap ?? {}), ...patch };
    await store.patchState(config.projectId, 'clickup', config.milestoneId, { taskMap: nextMap });
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
//
// Local task mutations debounce a push for every enabled (providerId, milestoneId)
// pair on the project. We don't try to limit to "the milestone whose task
// changed" because that requires task-level knowledge in the routes; pushing
// every enabled milestone is correct (each push only writes that milestone's
// own tasks), at the cost of a few extra API calls when many milestones are
// connected.

const timers = new Map<string, NodeJS.Timeout>();
const DEBOUNCE_MS = 2500;

export function triggerAutoSync(projectId: string): void {
  void (async () => {
    try {
      const configs = await store.listProjectConfigs(projectId);
      for (const cfg of configs) {
        if (!cfg.enabled) continue;
        const creds = await store.getProviderCredentials(cfg.providerId);
        if (!creds) continue;
        const key = `${projectId}:${cfg.providerId}:${cfg.milestoneId}`;
        const prev = timers.get(key);
        if (prev) clearTimeout(prev);
        const milestoneId = cfg.milestoneId;
        const providerId = cfg.providerId;
        const timer = setTimeout(() => runAutoSync(projectId, providerId, milestoneId), DEBOUNCE_MS);
        timers.set(key, timer);
      }
    } catch (err: any) {
      log.warn('sync', `auto-sync schedule failed: ${err?.message ?? err}`, undefined, projectId);
    }
  })();
}

async function runAutoSync(projectId: string, providerId: SyncProviderId, milestoneId: string): Promise<void> {
  try {
    const result = await pushAll(projectId, providerId, milestoneId);
    if (!result.success) {
      log.warn('sync', `auto-sync push (${providerId}/${milestoneId}) failed: ${result.message}`, undefined, projectId);
    }
  } catch (err: any) {
    log.error('sync', `auto-sync error (${providerId}/${milestoneId})`, err?.message ?? String(err), projectId);
    await store.patchStatus(projectId, providerId, milestoneId, { ok: false, error: err?.message ?? 'unknown' });
  }
}

// Re-export for typings used by callers
export type { ProjectSyncConfig };
