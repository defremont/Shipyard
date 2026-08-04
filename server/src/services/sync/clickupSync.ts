import type { Task } from '../../types/index.js';
import type { EffectiveConfig } from '../syncStore.js';
import { patchState } from '../syncStore.js';

type SyncConfig = EffectiveConfig;

const BASE = 'https://api.clickup.com/api/v2';

type TaskStatus = Task['status'];
type TaskPriority = Task['priority'];

const STATUS_MAP: Record<TaskStatus, string> = {
  backlog: 'backlog',
  todo: 'to do',
  in_progress: 'in progress',
  done: 'complete',
};

const STATUS_FROM_CLICKUP: Record<string, TaskStatus> = {
  backlog: 'backlog',
  'to do': 'todo',
  open: 'todo',
  'in progress': 'in_progress',
  review: 'in_progress',
  complete: 'done',
  closed: 'done',
  done: 'done',
};

const PRIORITY_TO_NUM: Record<TaskPriority, number> = {
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

const PRIORITY_FROM_NUM: Record<number, TaskPriority> = {
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
};

interface ClickUpState {
  listId?: string;
  listUrl?: string;
  taskMap?: Record<string, string>;
}

function credentials(config: SyncConfig): string {
  const { token } = config.settings;
  if (!token) throw new Error('ClickUp not configured — token required');
  return token;
}

async function clickupRequest<T = any>(
  config: SyncConfig,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  query?: Record<string, any>,
  body?: unknown,
): Promise<T> {
  const token = credentials(config);
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ''}`;

  const headers: Record<string, string> = { Authorization: token };
  const init: RequestInit = { method, headers, redirect: 'follow' };
  if (body !== undefined && method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    const message =
      typeof data === 'string' ? data :
      data?.err || data?.ECODE || data?.message || `Status ${res.status}`;
    throw new Error(`ClickUp: ${message}`);
  }
  return data as T;
}

export async function testConnection(config: SyncConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const me = await clickupRequest<{ user: { username: string } }>(config, '/user');
    const username = me.user?.username || 'user';
    return { ok: true, message: `Connected as ${username}` };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Connection failed' };
  }
}

// ── Workspace / space discovery (for the onboarding UI) ────────────────

export interface DiscoveredTeam { id: string; name: string; color?: string }
export interface DiscoveredSpace { id: string; name: string; private: boolean }

export async function listTeams(config: SyncConfig): Promise<DiscoveredTeam[]> {
  const data = await clickupRequest<{ teams: DiscoveredTeam[] }>(config, '/team');
  return data.teams ?? [];
}

export async function listSpaces(config: SyncConfig, teamId: string): Promise<DiscoveredSpace[]> {
  const data = await clickupRequest<{ spaces: DiscoveredSpace[] }>(config, `/team/${teamId}/space`);
  return data.spaces ?? [];
}

export interface DiscoveredList { id: string; name: string; url?: string }

export async function listLists(config: SyncConfig, spaceId: string): Promise<DiscoveredList[]> {
  const data = await clickupRequest<{ lists: DiscoveredList[] }>(
    config,
    `/space/${spaceId}/list`,
    'GET',
    { archived: false },
  );
  return data.lists ?? [];
}

// ── Push / Pull ────────────────────────────────────────────────────────

function buildListName(projectName: string, milestoneName?: string | null): string {
  if (milestoneName) return `Shipyard · ${projectName} · ${milestoneName}`;
  return `Shipyard · ${projectName}`;
}

async function ensureList(config: SyncConfig, projectName: string, milestoneName?: string | null): Promise<ClickUpState> {
  const state: ClickUpState = { ...(config.state ?? {}) };
  const spaceId = config.settings.spaceId;
  if (!spaceId) throw new Error('ClickUp Space is not selected');

  if (!state.listId) {
    const list = await clickupRequest<{ id: string; url?: string }>(
      config,
      `/space/${spaceId}/list`,
      'POST',
      undefined,
      { name: buildListName(projectName, milestoneName), content: 'Auto-created by Shipyard sync' },
    );
    state.listId = list.id;
    state.listUrl = list.url;
    await patchState(config.projectId, 'clickup', config.milestoneId, state);
  }
  return state;
}

function buildTaskPayload(task: Task) {
  const desc = task.description || '';
  const effort = task.effort ? `\n\n**Effort:** ${task.effort}` : '';
  const prompt = task.prompt ? `\n\n---\n**Details**\n${task.prompt}` : '';
  return {
    name: task.title,
    description: desc + effort + prompt,
    status: STATUS_MAP[task.status],
    priority: PRIORITY_TO_NUM[task.priority],
  };
}

interface RemoteTaskSummary {
  id: string;
  name: string;
  date_updated?: string;
}

interface UpsertContext {
  byId: Map<string, RemoteTaskSummary>;
  byTitle: Map<string, RemoteTaskSummary>;
  adoptedRemoteIds: Set<string>;
}

async function upsertTask(
  config: SyncConfig,
  state: ClickUpState,
  task: Task,
  ctx: UpsertContext,
): Promise<{ clickupId: string; skipped: boolean }> {
  let existing = state.taskMap?.[task.id];
  const payload = buildTaskPayload(task);

  // Drop stale mapping if the remote task is gone.
  if (existing && !ctx.byId.has(existing)) {
    existing = undefined;
  }

  // Title-match fallback to avoid creating duplicate ClickUp tasks when the
  // taskMap is stale (race with pull, or a recently adopted list).
  if (!existing) {
    const candidate = ctx.byTitle.get(normalizeTitle(task.title));
    if (candidate && !ctx.adoptedRemoteIds.has(candidate.id)) {
      existing = candidate.id;
      ctx.adoptedRemoteIds.add(candidate.id);
    }
  }

  if (existing) {
    const remote = ctx.byId.get(existing);
    if (remote?.date_updated) {
      const remoteTs = Number(remote.date_updated);
      const localTs = new Date(task.updatedAt).getTime();
      if (Number.isFinite(remoteTs) && Number.isFinite(localTs) && remoteTs > localTs) {
        // Remote is fresher than us — let pull reconcile, don't overwrite.
        return { clickupId: existing, skipped: true };
      }
    }
    try {
      await clickupRequest(config, `/task/${existing}`, 'PUT', undefined, payload);
      return { clickupId: existing, skipped: false };
    } catch (err: any) {
      if (!/not found|404/i.test(String(err?.message))) throw err;
    }
  }

  const created = await clickupRequest<{ id: string }>(
    config,
    `/list/${state.listId!}/task`,
    'POST',
    undefined,
    payload,
  );
  return { clickupId: created.id, skipped: false };
}

export interface PushResult {
  pushed: number;
  total: number;
  errors: string[];
  listUrl?: string;
}

export async function pushTasks(config: SyncConfig, tasks: Task[]): Promise<PushResult> {
  const projectName = config.settings.projectName || config.projectId;
  const milestoneName = config.settings.milestoneName as string | undefined;
  const state = await ensureList(config, projectName, milestoneName);

  // Snapshot list contents once so smart-push can compare timestamps and
  // do title-match fallback for stale taskMap entries.
  const remote = await clickupRequest<{ tasks: RemoteTaskSummary[] }>(
    config,
    `/list/${state.listId}/task`,
    'GET',
    { archived: false, subtasks: false },
  );
  const byId = new Map<string, RemoteTaskSummary>();
  const byTitle = new Map<string, RemoteTaskSummary>();
  for (const t of remote.tasks ?? []) {
    byId.set(t.id, t);
    const key = normalizeTitle(t.name);
    if (key && !byTitle.has(key)) byTitle.set(key, t);
  }
  const adoptedRemoteIds = new Set<string>();
  for (const cid of Object.values(state.taskMap ?? {})) {
    if (byId.has(cid)) adoptedRemoteIds.add(cid);
  }
  const ctx: UpsertContext = { byId, byTitle, adoptedRemoteIds };

  const nextMap: Record<string, string> = { ...(state.taskMap ?? {}) };
  const errors: string[] = [];
  let pushed = 0;

  for (const task of tasks) {
    try {
      const { clickupId } = await upsertTask(config, state, task, ctx);
      nextMap[task.id] = clickupId;
      pushed++;
    } catch (err: any) {
      errors.push(`${task.title}: ${err?.message ?? 'failed'}`);
    }
  }

  // Archive orphans we owned; never touch tasks that exist on ClickUp but
  // were never linked to one of ours.
  const liveIds = new Set(tasks.map(t => t.id));
  for (const [taskId, clickupId] of Object.entries(state.taskMap ?? {})) {
    if (liveIds.has(taskId)) continue;
    if (Object.values(nextMap).includes(clickupId) && nextMap[taskId] !== clickupId) {
      delete nextMap[taskId];
      continue;
    }
    try {
      await clickupRequest(config, `/task/${clickupId}`, 'PUT', undefined, {
        status: STATUS_MAP.done,
        archived: true,
      });
    } catch { /* ignore */ }
    delete nextMap[taskId];
  }

  await patchState(config.projectId, 'clickup', config.milestoneId, { taskMap: nextMap });

  return { pushed, total: tasks.length, errors, listUrl: state.listUrl };
}

interface ClickUpTask {
  id: string;
  name: string;
  description?: string;
  text_content?: string;
  status: { status: string; type?: string };
  priority: { priority?: string; id?: string } | null;
  date_updated?: string;
}

export interface PulledTask {
  clickupId: string;
  taskId?: string;
  title: string;
  description: string;
  prompt?: string;
  effort?: Task['effort'];
  status: TaskStatus;
  priority: TaskPriority;
  updatedAt: string;
}

// ── Link to existing list ──────────────────────────────────────────────

function normalizeTitle(s: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface LinkListResult {
  listId: string;
  listUrl?: string;
  matchedCount: number;
  totalTasks: number;
}

/**
 * Connect a project to an ALREADY EXISTING ClickUp list.
 * Reconciles taskMap by matching remote task names to local task titles.
 */
export async function linkToExistingList(
  config: SyncConfig,
  listId: string,
  localTasks: Task[],
): Promise<{ state: Required<Pick<ClickUpState, 'listId' | 'listUrl' | 'taskMap'>>; result: LinkListResult }> {
  const [list, tasksData] = await Promise.all([
    clickupRequest<{ id: string; name: string; url?: string }>(config, `/list/${listId}`),
    clickupRequest<{ tasks: Array<{ id: string; name: string }> }>(
      config, `/list/${listId}/task`, 'GET', { archived: false, subtasks: false },
    ),
  ]);

  const localByTitle = new Map<string, string>();
  for (const t of localTasks) {
    const key = normalizeTitle(t.title);
    if (key && !localByTitle.has(key)) localByTitle.set(key, t.id);
  }

  const taskMap: Record<string, string> = {};
  let matchedCount = 0;
  const remoteTasks = tasksData.tasks ?? [];
  for (const remote of remoteTasks) {
    const key = normalizeTitle(remote.name);
    const taskId = localByTitle.get(key);
    if (taskId && !taskMap[taskId]) {
      taskMap[taskId] = remote.id;
      matchedCount++;
    }
  }

  return {
    state: { listId: list.id, listUrl: list.url ?? '', taskMap },
    result: {
      listId: list.id,
      listUrl: list.url,
      matchedCount,
      totalTasks: remoteTasks.length,
    },
  };
}

export async function pullTasks(config: SyncConfig): Promise<PulledTask[]> {
  const state: ClickUpState = config.state ?? {};
  if (!state.listId) return [];

  const reverseMap: Record<string, string> = {};
  for (const [taskId, clickupId] of Object.entries(state.taskMap ?? {})) {
    reverseMap[clickupId] = taskId;
  }

  const data = await clickupRequest<{ tasks: ClickUpTask[] }>(
    config,
    `/list/${state.listId}/task`,
    'GET',
    { archived: false, subtasks: false },
  );

  const out: PulledTask[] = [];
  for (const t of data.tasks ?? []) {
    const rawStatus = (t.status?.status || '').toLowerCase();
    // ClickUp lets users rename their statuses freely. Treat any
    // closed/done-like status as done (via type), then fall back to backlog
    // so unknown custom statuses don't all pile into one wrong column.
    const fromMap = STATUS_FROM_CLICKUP[rawStatus];
    const fromType = t.status?.type === 'closed' ? 'done' : t.status?.type === 'done' ? 'done' : undefined;
    const status: TaskStatus = fromMap ?? fromType ?? 'backlog';

    const priorityId = t.priority?.id ? Number(t.priority.id) : undefined;
    const priority = (priorityId && PRIORITY_FROM_NUM[priorityId]) ||
      (t.priority?.priority && PRIORITY_FROM_NUM[Number(t.priority.priority)]) ||
      'medium';

    const fullDesc = t.text_content || t.description || '';
    const effortMatch = fullDesc.match(/\n\n\*\*Effort:\*\*\s*(1|2|3|5|8)(?=\n|$)/);
    const effort = effortMatch ? Number(effortMatch[1]) as Task['effort'] : undefined;
    const withoutEffort = fullDesc.replace(/\n\n\*\*Effort:\*\*\s*(1|2|3|5|8)(?=\n|$)/, '');
    const split = withoutEffort.split(/\n\n---\n\*\*Details\*\*\n/);
    const description = split[0] ?? '';
    const prompt = split[1];

    out.push({
      clickupId: t.id,
      taskId: reverseMap[t.id],
      title: t.name,
      description,
      prompt,
      effort,
      status,
      priority,
      updatedAt: t.date_updated ? new Date(Number(t.date_updated)).toISOString() : new Date().toISOString(),
    });
  }

  return out;
}
