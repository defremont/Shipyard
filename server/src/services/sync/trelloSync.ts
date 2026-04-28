import type { Task } from '../../types/index.js';
import type { EffectiveConfig } from '../syncStore.js';
import { patchState } from '../syncStore.js';

type SyncConfig = EffectiveConfig;

const BASE = 'https://api.trello.com/1';

type TaskStatus = Task['status'];
type TaskPriority = Task['priority'];

const STATUS_ORDER: TaskStatus[] = ['backlog', 'todo', 'in_progress', 'done'];
const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};
const STATUS_FROM_LIST: Record<string, TaskStatus> = {
  Backlog: 'backlog',
  'To Do': 'todo',
  Todo: 'todo',
  'In Progress': 'in_progress',
  Doing: 'in_progress',
  Done: 'done',
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  urgent: 'red',
  high: 'orange',
  medium: 'yellow',
  low: 'sky',
};
const PRIORITY_FROM_COLOR: Record<string, TaskPriority> = {
  red: 'urgent',
  orange: 'high',
  yellow: 'medium',
  sky: 'low',
};
const PRIORITY_FROM_NAME: Record<string, TaskPriority> = {
  urgent: 'urgent',
  high: 'high',
  medium: 'medium',
  low: 'low',
};

interface TrelloState {
  boardId?: string;
  boardUrl?: string;
  listIds?: Record<TaskStatus, string>;
  labelIds?: Record<TaskPriority, string>;
  cardMap?: Record<string, string>;
}

function credentials(config: SyncConfig): { apiKey: string; token: string } {
  const { apiKey, token } = config.settings;
  if (!apiKey || !token) throw new Error('Trello not configured — apiKey and token required');
  return { apiKey, token };
}

async function trelloRequest<T = any>(
  config: SyncConfig,
  path: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  query?: Record<string, any>,
  body?: unknown,
): Promise<T> {
  const { apiKey, token } = credentials(config);
  const params = new URLSearchParams();
  params.set('key', apiKey);
  params.set('token', token);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.set(k, String(v));
    }
  }
  const url = `${BASE}${path}?${params.toString()}`;

  const init: RequestInit = { method, redirect: 'follow' };
  if (body !== undefined && method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  if (!res.ok) {
    const message = typeof data === 'string' ? data : data?.message || `Status ${res.status}`;
    throw new Error(`Trello: ${message}`);
  }
  return data as T;
}

export async function testConnection(config: SyncConfig): Promise<{ ok: boolean; message: string }> {
  try {
    const me = await trelloRequest<{ username: string }>(config, '/members/me');
    return { ok: true, message: `Connected as @${me.username}` };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Connection failed' };
  }
}

// ── Board discovery (for "link to existing" onboarding) ────────────────

export interface DiscoveredBoard {
  id: string;
  name: string;
  url: string;
  closed: boolean;
}

export async function listBoards(config: SyncConfig): Promise<DiscoveredBoard[]> {
  const boards = await trelloRequest<DiscoveredBoard[]>(
    config,
    '/members/me/boards',
    'GET',
    { filter: 'open', fields: 'name,url,closed' },
  );
  return boards.filter(b => !b.closed);
}

/**
 * Build the URL the user should open to authorize Shipyard and copy back the
 * personal token. The API key itself comes from trello.com/power-ups/admin.
 */
export function buildAuthorizeUrl(apiKey: string): string {
  const params = new URLSearchParams({
    expiration: 'never',
    name: 'Shipyard',
    scope: 'read,write,account',
    response_type: 'token',
    key: apiKey,
  });
  return `https://trello.com/1/authorize?${params.toString()}`;
}

async function ensureBoard(config: SyncConfig, projectName: string): Promise<TrelloState> {
  let state: TrelloState = { ...(config.state ?? {}) };

  if (!state.boardId) {
    const board = await trelloRequest<{ id: string; url: string }>(
      config,
      '/boards/',
      'POST',
      { name: `Shipyard · ${projectName}`, defaultLists: false, desc: 'Auto-created by Shipyard sync' },
    );
    state.boardId = board.id;
    state.boardUrl = board.url;
    await patchState(config.projectId, 'trello', state);
  }

  if (!state.listIds || Object.keys(state.listIds).length !== STATUS_ORDER.length) {
    const listIds = {} as Record<TaskStatus, string>;
    for (const status of STATUS_ORDER) {
      const list = await trelloRequest<{ id: string }>(config, '/lists', 'POST', {
        name: STATUS_LABELS[status],
        idBoard: state.boardId!,
        pos: 'bottom',
      });
      listIds[status] = list.id;
    }
    state.listIds = listIds;
    await patchState(config.projectId, 'trello', { listIds });
  }

  if (!state.labelIds || Object.keys(state.labelIds).length !== 4) {
    const labelIds = {} as Record<TaskPriority, string>;
    for (const [priority, color] of Object.entries(PRIORITY_COLORS) as [TaskPriority, string][]) {
      const label = await trelloRequest<{ id: string }>(config, '/labels', 'POST', {
        name: priority,
        color,
        idBoard: state.boardId!,
      });
      labelIds[priority] = label.id;
    }
    state.labelIds = labelIds;
    await patchState(config.projectId, 'trello', { labelIds });
  }

  return state;
}

function renderDesc(task: Task): string {
  const desc = task.description || '';
  const prompt = task.prompt ? `\n\n---\n**Details**\n${task.prompt}` : '';
  return desc + prompt;
}

async function upsertCard(
  config: SyncConfig,
  state: TrelloState,
  task: Task,
): Promise<{ cardId: string }> {
  const listId = state.listIds![task.status];
  const labelId = state.labelIds![task.priority];
  const existingCardId = state.cardMap?.[task.id];

  const payload = {
    name: task.title,
    desc: renderDesc(task),
    idList: listId,
    idLabels: [labelId],
    closed: false,
  };

  if (existingCardId) {
    try {
      await trelloRequest(config, `/cards/${existingCardId}`, 'PUT', undefined, payload);
      return { cardId: existingCardId };
    } catch (err: any) {
      if (!/not found|404/i.test(String(err?.message))) throw err;
    }
  }

  const card = await trelloRequest<{ id: string }>(config, '/cards', 'POST', undefined, payload);
  return { cardId: card.id };
}

export interface PushResult {
  pushed: number;
  total: number;
  errors: string[];
  boardUrl?: string;
}

export async function pushTasks(config: SyncConfig, tasks: Task[]): Promise<PushResult> {
  const projectName = config.settings.projectName || config.projectId;
  const state = await ensureBoard(config, projectName);

  const nextMap: Record<string, string> = { ...(state.cardMap ?? {}) };
  const errors: string[] = [];
  let pushed = 0;

  for (const task of tasks) {
    try {
      const { cardId } = await upsertCard(config, state, task);
      nextMap[task.id] = cardId;
      pushed++;
    } catch (err: any) {
      errors.push(`${task.title}: ${err?.message ?? 'failed'}`);
    }
  }

  // Archive cards whose local task no longer exists
  const liveIds = new Set(tasks.map(t => t.id));
  for (const [taskId, cardId] of Object.entries(state.cardMap ?? {})) {
    if (liveIds.has(taskId)) continue;
    try {
      await trelloRequest(config, `/cards/${cardId}`, 'PUT', undefined, { closed: true });
    } catch { /* ignore */ }
    delete nextMap[taskId];
  }

  await patchState(config.projectId, 'trello', { cardMap: nextMap });

  return { pushed, total: tasks.length, errors, boardUrl: state.boardUrl };
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idLabels: string[];
  closed: boolean;
  dateLastActivity: string;
}

export interface PulledTask {
  cardId: string;
  taskId?: string;
  title: string;
  description: string;
  prompt?: string;
  status: TaskStatus;
  priority: TaskPriority;
  updatedAt: string;
}

export async function pullCards(config: SyncConfig): Promise<PulledTask[]> {
  const state: TrelloState = config.state ?? {};
  if (!state.boardId) return [];

  // Fetch cards, labels, and lists in parallel. Lists are needed so we can
  // resolve a list id we didn't push to (e.g. a manually-named "Backlog"
  // list created on Trello after we set up state.listIds, or an existing
  // board the user linked to where lists rotated).
  const [cards, labels, lists] = await Promise.all([
    trelloRequest<TrelloCard[]>(config, `/boards/${state.boardId}/cards`, 'GET', { fields: 'name,desc,idList,idLabels,closed,dateLastActivity' }),
    trelloRequest<Array<{ id: string; name: string; color: string }>>(config, `/boards/${state.boardId}/labels`),
    trelloRequest<Array<{ id: string; name: string; closed: boolean }>>(config, `/boards/${state.boardId}/lists`, 'GET', { fields: 'name,closed' }),
  ]);

  const labelById: Record<string, { name: string; color: string }> = {};
  for (const l of labels) labelById[l.id] = l;

  // Primary lookup: list ids we tracked when pushing.
  const listToStatus: Record<string, TaskStatus> = {};
  if (state.listIds) {
    for (const status of STATUS_ORDER) {
      const lid = state.listIds[status];
      if (lid) listToStatus[lid] = status;
    }
  }

  // Fallback lookup: any list whose name matches a known status label —
  // this catches new lists the user created in Trello, or the case where a
  // user linked to an existing board mid-sync. We only set the entry if the
  // primary map didn't already cover this list id.
  for (const list of lists) {
    if (list.closed) continue;
    if (listToStatus[list.id]) continue;
    const byCanonical = STATUS_FROM_LIST[list.name];
    if (byCanonical) {
      listToStatus[list.id] = byCanonical;
      continue;
    }
    const lower = (list.name || '').toLowerCase();
    for (const status of STATUS_ORDER) {
      if (STATUS_LABELS[status].toLowerCase() === lower) {
        listToStatus[list.id] = status;
        break;
      }
    }
  }

  const reverseCardMap: Record<string, string> = {};
  for (const [taskId, cardId] of Object.entries(state.cardMap ?? {})) {
    reverseCardMap[cardId] = taskId;
  }

  const out: PulledTask[] = [];
  for (const card of cards) {
    if (card.closed) continue;
    // Cards in unrecognised lists default to backlog so they're not dropped.
    const status = listToStatus[card.idList] ?? 'backlog';

    let priority: TaskPriority = 'medium';
    for (const labelId of card.idLabels) {
      const label = labelById[labelId];
      if (!label) continue;
      const pByName = PRIORITY_FROM_NAME[label.name?.toLowerCase()];
      const pByColor = PRIORITY_FROM_COLOR[label.color];
      if (pByName) { priority = pByName; break; }
      if (pByColor) { priority = pByColor; }
    }

    const desc = card.desc || '';
    const split = desc.split(/\n\n---\n\*\*Details\*\*\n/);
    const description = split[0] ?? '';
    const prompt = split[1];

    out.push({
      cardId: card.id,
      taskId: reverseCardMap[card.id],
      title: card.name,
      description,
      prompt,
      status,
      priority,
      updatedAt: card.dateLastActivity || new Date().toISOString(),
    });
  }

  return out;
}

// ── Link to existing board ─────────────────────────────────────────────

function normalizeTitle(s: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface LinkBoardResult {
  boardId: string;
  boardUrl: string;
  matchedCount: number;
  totalCards: number;
  listsCreated: number;
  labelsCreated: number;
}

/**
 * Connect a project to an ALREADY EXISTING Trello board.
 * Maps status lists + priority labels by name/color (creates missing).
 * Reconciles cardMap by matching card names to local task titles.
 */
export async function linkToExistingBoard(
  config: SyncConfig,
  boardId: string,
  localTasks: Task[],
): Promise<{ state: Required<Pick<TrelloState, 'boardId' | 'boardUrl' | 'listIds' | 'labelIds' | 'cardMap'>>; result: LinkBoardResult }> {
  const [board, boardLists, boardLabels, boardCards] = await Promise.all([
    trelloRequest<{ id: string; name: string; url: string }>(
      config, `/boards/${boardId}`, 'GET', { fields: 'name,url' },
    ),
    trelloRequest<Array<{ id: string; name: string; closed: boolean }>>(
      config, `/boards/${boardId}/lists`, 'GET', { fields: 'name,closed' },
    ),
    trelloRequest<Array<{ id: string; name: string; color: string }>>(
      config, `/boards/${boardId}/labels`,
    ),
    trelloRequest<Array<{ id: string; name: string; closed: boolean }>>(
      config, `/boards/${boardId}/cards`, 'GET', { fields: 'name,closed' },
    ),
  ]);

  // Map status → list id; reuse by canonical name, create missing
  const openLists = boardLists.filter(l => !l.closed);
  const listIds = {} as Record<TaskStatus, string>;
  let listsCreated = 0;
  for (const status of STATUS_ORDER) {
    const existing = openLists.find(l => {
      const mapped = STATUS_FROM_LIST[l.name];
      return mapped === status || l.name?.toLowerCase() === STATUS_LABELS[status].toLowerCase();
    });
    if (existing) {
      listIds[status] = existing.id;
    } else {
      const created = await trelloRequest<{ id: string }>(config, '/lists', 'POST', {
        name: STATUS_LABELS[status], idBoard: boardId, pos: 'bottom',
      });
      listIds[status] = created.id;
      listsCreated++;
    }
  }

  // Map priority → label id; reuse by name first, then color, create missing
  const labelIds = {} as Record<TaskPriority, string>;
  let labelsCreated = 0;
  for (const [priority, color] of Object.entries(PRIORITY_COLORS) as [TaskPriority, string][]) {
    const byName = boardLabels.find(l => l.name?.toLowerCase() === priority);
    const byColor = !byName ? boardLabels.find(l => l.color === color && !l.name) : undefined;
    const existing = byName ?? byColor;
    if (existing) {
      labelIds[priority] = existing.id;
    } else {
      const created = await trelloRequest<{ id: string }>(config, '/labels', 'POST', {
        name: priority, color, idBoard: boardId,
      });
      labelIds[priority] = created.id;
      labelsCreated++;
    }
  }

  // Build cardMap by matching card name → local task title
  const localByTitle = new Map<string, string>();
  for (const t of localTasks) {
    const key = normalizeTitle(t.title);
    if (key && !localByTitle.has(key)) localByTitle.set(key, t.id);
  }
  const openCards = boardCards.filter(c => !c.closed);
  const cardMap: Record<string, string> = {};
  let matchedCount = 0;
  for (const card of openCards) {
    const key = normalizeTitle(card.name);
    const taskId = localByTitle.get(key);
    if (taskId && !cardMap[taskId]) {
      cardMap[taskId] = card.id;
      matchedCount++;
    }
  }

  return {
    state: { boardId: board.id, boardUrl: board.url, listIds, labelIds, cardMap },
    result: {
      boardId: board.id,
      boardUrl: board.url,
      matchedCount,
      totalCards: openCards.length,
      listsCreated,
      labelsCreated,
    },
  };
}
