import type { Task, TaskAttachment, TaskComment } from '../../types/index.js';
import type { EffectiveConfig } from '../syncStore.js';
import { patchState } from '../syncStore.js';
import * as log from '../logService.js';

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

// Trello allows ~100 requests per 10s per token. Pushing a board sequentially
// is slow, pushing it wide-open gets us throttled — so cap concurrency and
// back off on 429.
const MAX_CONCURRENT_REQUESTS = 6;
const MAX_RETRIES = 3;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Run `worker` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
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
      if (v === undefined) continue;
      params.set(k, v === null ? '' : String(v));
    }
  }
  const url = `${BASE}${path}?${params.toString()}`;

  const init: RequestInit = { method, redirect: 'follow' };
  if (body !== undefined && method !== 'GET') {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, init);
    const text = await res.text();
    let data: any = text;
    try { data = JSON.parse(text); } catch { /* keep text */ }

    if (res.ok) return data as T;

    // 429 = rate limited, 5xx = transient. Honour Retry-After when present.
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 500 * 2 ** attempt;
      await sleep(delay);
      continue;
    }

    const message = typeof data === 'string' ? data : data?.message || `Status ${res.status}`;
    throw new Error(`Trello: ${message}`);
  }
}

// A Trello card can hold two kinds of attachment: a file the client uploaded,
// which Trello serves from its own hosts, and a plain link, whose URL is
// whatever the client typed. Only the uploaded kind may ever receive our
// credentials — sending the OAuth header to an arbitrary host would hand a
// stranger a never-expiring read/write token for every board the user has.
const TRELLO_ATTACHMENT_HOSTS = new Set([
  'trello.com',
  'api.trello.com',
  'trello-attachments.s3.amazonaws.com',
]);

function isTrelloHosted(url: string): boolean {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  return TRELLO_ATTACHMENT_HOSTS.has(host)
    || host.endsWith('.trello.com')
    || host.endsWith('.trellousercontent.com');
}

const ATTACHMENT_ID_RE = /^[0-9a-f]{24}$/i;
const ATTACHMENT_TIMEOUT_MS = 15_000;
const MAX_ATTACHMENT_DOWNLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Download an attachment's bytes. Trello locked uploaded-attachment URLs behind
 * an OAuth header — key/token in the query string (what trelloRequest does) is
 * not enough, and the raw url in an <img> tag returns 401. So this is the only
 * way the UI or an agent can ever see a client's screenshot.
 *
 * Returns null for anything we will not fetch: a bad id, a link attachment, or
 * a file hosted somewhere other than Trello.
 */
export async function fetchAttachmentBytes(
  config: SyncConfig,
  cardId: string,
  attachmentId: string,
  opts: { preview?: boolean } = {},
): Promise<{ data: Buffer; mimeType: string; name: string } | null> {
  // The id lands in the request path; '../..' would walk us onto a different
  // Trello endpoint once the URL parser normalises it.
  if (!ATTACHMENT_ID_RE.test(attachmentId)) return null;

  const attachment = await trelloRequest<TrelloAttachment>(
    config,
    `/cards/${cardId}/attachments/${attachmentId}`,
    'GET',
    { fields: 'name,url,mimeType,bytes,date,previews,isUpload' },
  ).catch(() => null);
  if (!attachment?.url) return null;
  if (attachment.isUpload === false) return null;

  // Previews are much smaller than the original — pick the first one wide
  // enough to look sharp in the thumbnail grid and the lightbox.
  let target = attachment.url;
  if (opts.preview && attachment.previews?.length) {
    const sorted = [...attachment.previews].sort((a, b) => a.width - b.width);
    target = (sorted.find(p => p.width >= 400) ?? sorted[sorted.length - 1]).url;
  }
  if (!isTrelloHosted(target)) return null;

  const { apiKey, token } = credentials(config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ATTACHMENT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, {
      headers: { Authorization: `OAuth oauth_consumer_key="${apiKey}", oauth_token="${token}"` },
      // A redirect could walk the credentials off Trello, so follow it by hand.
      redirect: 'manual',
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      const next = location ? new URL(location, target).toString() : '';
      if (!next || !isTrelloHosted(next)) return null;
      res = await fetch(next, { redirect: 'error', signal: controller.signal });
    }
    if (!res.ok) throw new Error(`Trello: attachment download failed (status ${res.status})`);

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_DOWNLOAD_BYTES) {
      throw new Error('Trello: attachment is too large to load');
    }

    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_ATTACHMENT_DOWNLOAD_BYTES) {
      throw new Error('Trello: attachment is too large to load');
    }

    return {
      data,
      mimeType: res.headers.get('content-type') || attachment.mimeType || 'application/octet-stream',
      name: attachment.name || 'attachment',
    };
  } finally {
    clearTimeout(timeout);
  }
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

function buildBoardName(projectName: string, milestoneName?: string | null): string {
  if (milestoneName) return `Shipyard · ${projectName} · ${milestoneName}`;
  return `Shipyard · ${projectName}`;
}

async function ensureBoard(config: SyncConfig, projectName: string, milestoneName?: string | null): Promise<TrelloState> {
  let state: TrelloState = { ...(config.state ?? {}) };

  if (!state.boardId) {
    const board = await trelloRequest<{ id: string; url: string }>(
      config,
      '/boards/',
      'POST',
      { name: buildBoardName(projectName, milestoneName), defaultLists: false, desc: 'Auto-created by Shipyard sync' },
    );
    state.boardId = board.id;
    state.boardUrl = board.url;
    await patchState(config.projectId, 'trello', config.milestoneId, state);
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
    await patchState(config.projectId, 'trello', config.milestoneId, { listIds });
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
    await patchState(config.projectId, 'trello', config.milestoneId, { labelIds });
  }

  return state;
}

function renderDesc(task: Task): string {
  const desc = task.description || '';
  const effort = task.effort ? `\n\n**Effort:** ${task.effort}` : '';
  const prompt = task.prompt ? `\n\n---\n**Details**\n${task.prompt}` : '';
  return desc + effort + prompt;
}

// ── Card ordering ─────────────────────────────────────────────────────────
//
// Trello can only auto-sort a list by creation date or alphabetically, and
// Shipyard's agent creates a whole milestone's cards within the same second —
// so creation order carries no information. We therefore own each card's `pos`
// and rewrite it on every push:
//
//   Done         → most recently completed first
//   In Progress  → most recently started first
//   To Do/Backlog→ the Shipyard kanban order (priority, then manual order)
//
// The result is a board that reads correctly the moment it's opened, with no
// sort setting to change — which is what makes it shareable with a client.

const POS_STEP = 1024;

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/** Epoch ms, or 0 when absent/unparseable — keeps sorts total and stable. */
function timeOf(value?: string): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/** Newest-completed-first; tasks that predate `doneAt` fall back to updatedAt. */
function byCompletedDesc(a: Task, b: Task): number {
  return (timeOf(b.doneAt) || timeOf(b.updatedAt)) - (timeOf(a.doneAt) || timeOf(a.updatedAt));
}

function byStartedDesc(a: Task, b: Task): number {
  return (timeOf(b.inProgressAt) || timeOf(b.updatedAt)) - (timeOf(a.inProgressAt) || timeOf(a.updatedAt));
}

function byKanbanOrder(a: Task, b: Task): number {
  const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  return p !== 0 ? p : a.order - b.order;
}

function comparatorFor(status: TaskStatus): (a: Task, b: Task) => number {
  if (status === 'done') return byCompletedDesc;
  if (status === 'in_progress') return byStartedDesc;
  return byKanbanOrder;
}

/** Desired Trello `pos` for every task, computed per list. */
export function computePositions(tasks: Task[]): Map<string, number> {
  const positions = new Map<string, number>();
  for (const status of STATUS_ORDER) {
    const inList = tasks.filter(t => t.status === status).sort(comparatorFor(status));
    inList.forEach((task, i) => positions.set(task.id, (i + 1) * POS_STEP));
  }
  return positions;
}

// ── Card payloads ─────────────────────────────────────────────────────────

interface RemoteCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idLabels: string[];
  pos: number;
  due: string | null;
  dueComplete: boolean;
  dateLastActivity: string;
  closed?: boolean;
}

const REMOTE_CARD_FIELDS = 'name,desc,idList,idLabels,pos,due,dueComplete,dateLastActivity,closed';

interface CardPayload {
  name: string;
  desc: string;
  idList: string;
  idLabels: string[];
  pos: number;
  /** Completion date, surfaced as Trello's date badge. Null on open cards. */
  due: string | null;
  dueComplete: boolean;
  closed: false;
}

function desiredCard(task: Task, state: TrelloState, pos: number): CardPayload {
  const completedAt = task.status === 'done' ? (task.doneAt || task.updatedAt) : null;
  return {
    name: task.title,
    desc: renderDesc(task),
    idList: state.listIds![task.status],
    idLabels: [state.labelIds![task.priority]],
    pos,
    // Stamping `due` on completed cards gives every Done card a visible date
    // badge and lets the board be sorted by it in the Trello UI.
    due: completedAt,
    dueComplete: completedAt !== null,
    closed: false,
  };
}

function sameLabels(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every(id => set.has(id));
}

function sameDue(a: string | null, b: string | null): boolean {
  if (!a || !b) return !a && !b;
  return timeOf(a) === timeOf(b);
}

/** Fields of `desired` that differ from what Trello currently holds. */
function diffCard(desired: CardPayload, remote: RemoteCard, knownListIds: Set<string>): Partial<CardPayload> {
  const patch: Partial<CardPayload> = {};
  if (desired.name !== remote.name) patch.name = desired.name;
  if (desired.desc !== (remote.desc ?? '')) patch.desc = desired.desc;
  // Only move a card back into its status list when it's currently sitting in
  // one of the four lists Shipyard manages. If the user dragged it into a
  // list of their own (onboarding, reference, whatever), leave it there —
  // Shipyard has no business reorganising a list it doesn't own.
  if (desired.idList !== remote.idList && knownListIds.has(remote.idList)) patch.idList = desired.idList;
  if (!sameLabels(desired.idLabels, remote.idLabels ?? [])) patch.idLabels = desired.idLabels;
  if (desired.pos !== remote.pos) patch.pos = desired.pos;
  if (!sameDue(desired.due, remote.due ?? null)) patch.due = desired.due;
  if (desired.dueComplete !== !!remote.dueComplete) patch.dueComplete = desired.dueComplete;
  // Deliberately not touching `closed` here: if the user archived this card
  // (e.g. tidying up Done), that's a real signal from them, not staleness —
  // forcing it back open on every push is exactly what re-surfaced archived
  // cards and confused everyone. Archived-in-Trello stays archived unless
  // the task itself gets deleted locally (handled by the orphan-archiving
  // pass below, which only ever closes, never reopens).
  return patch;
}

interface UpsertContext {
  byId: Map<string, RemoteCard>;
  byTitle: Map<string, RemoteCard>;
  adoptedRemoteIds: Set<string>;
  knownListIds: Set<string>;
}

function normalizeTitle(s: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function upsertCard(
  config: SyncConfig,
  state: TrelloState,
  task: Task,
  pos: number,
  ctx: UpsertContext,
): Promise<{ cardId: string; changed: boolean }> {
  let existingCardId = state.cardMap?.[task.id];

  // If cardMap points at a card that no longer exists on the board, drop the
  // stale mapping so we can either adopt by title or create a fresh card —
  // without this, a deleted-in-Trello card would force a 404 on every push.
  if (existingCardId && !ctx.byId.has(existingCardId)) {
    existingCardId = undefined;
  }

  // Title-match fallback when this task has no link yet. Stops push from
  // creating a second card for a task that already has one on the board
  // (e.g. after a pull/push race, or when the user manually renamed a card
  // before we got around to mapping it).
  if (!existingCardId) {
    const candidate = ctx.byTitle.get(normalizeTitle(task.title));
    if (candidate && !ctx.adoptedRemoteIds.has(candidate.id)) {
      existingCardId = candidate.id;
      ctx.adoptedRemoteIds.add(candidate.id);
    }
  }

  const desired = desiredCard(task, state, pos);

  if (existingCardId) {
    const remote = ctx.byId.get(existingCardId);
    if (remote) {
      let patch = diffCard(desired, remote, ctx.knownListIds);

      // Trello holds a newer edit than our local task: don't clobber the
      // user's change — the next pull reconciles it. Position is the one
      // exception: it's derived from Shipyard state, not user-authored, so
      // reordering stays correct even between content syncs.
      if (timeOf(remote.dateLastActivity) > timeOf(task.updatedAt)) {
        patch = patch.pos !== undefined ? { pos: patch.pos } : {};
      }

      // Nothing to say — skip the round-trip entirely. This is what keeps a
      // debounced auto-push from re-PUTting every card on the board.
      if (Object.keys(patch).length === 0) return { cardId: existingCardId, changed: false };

      try {
        await trelloRequest(config, `/cards/${existingCardId}`, 'PUT', undefined, patch);
        return { cardId: existingCardId, changed: true };
      } catch (err: any) {
        if (!/not found|404/i.test(String(err?.message))) throw err;
        // Card vanished between our fetch and PUT — fall through to create.
      }
    }
  }

  const card = await trelloRequest<{ id: string }>(config, '/cards', 'POST', undefined, desired);
  return { cardId: card.id, changed: true };
}

export interface PushResult {
  pushed: number;
  total: number;
  errors: string[];
  boardUrl?: string;
}

export async function pushTasks(config: SyncConfig, tasks: Task[]): Promise<PushResult> {
  const projectName = config.settings.projectName || config.projectId;
  const milestoneName = config.settings.milestoneName as string | undefined;
  const state = await ensureBoard(config, projectName, milestoneName);

  // Snapshot remote state once at the start of the push so we can: (a) send
  // only the fields that actually changed, (b) fall back to title matching
  // when cardMap is stale, and (c) detect cards already deleted in Trello
  // before we PUT them.
  // filter: 'all' — including archived cards is what lets a task the user
  // archived on Trello (e.g. tidying up Done) get matched and patched below
  // instead of looking "gone" and getting a fresh duplicate POSTed back.
  const remoteCards = await trelloRequest<RemoteCard[]>(
    config,
    `/boards/${state.boardId}/cards`,
    'GET',
    { fields: REMOTE_CARD_FIELDS, filter: 'all' },
  );
  const byId = new Map<string, RemoteCard>();
  const byTitle = new Map<string, RemoteCard>();
  for (const c of remoteCards) {
    byId.set(c.id, c);
    const key = normalizeTitle(c.name);
    if (key && !byTitle.has(key)) byTitle.set(key, c);
  }
  // Don't let two local tasks adopt the same remote card by title.
  const adoptedRemoteIds = new Set<string>();
  // Prime adopted set with cardMap entries so title-match doesn't try to
  // re-adopt a card we already track for a different task.
  for (const cid of Object.values(state.cardMap ?? {})) {
    if (byId.has(cid)) adoptedRemoteIds.add(cid);
  }
  const knownListIds = new Set(Object.values(state.listIds ?? {}));
  const ctx: UpsertContext = { byId, byTitle, adoptedRemoteIds, knownListIds };

  // Safe to fan out: upsertCard resolves title adoption synchronously, before
  // its first await, so two tasks can never claim the same remote card.
  const positions = computePositions(tasks);
  const nextMap: Record<string, string> = { ...(state.cardMap ?? {}) };
  const errors: string[] = [];
  let pushed = 0;

  await mapLimit(tasks, MAX_CONCURRENT_REQUESTS, async task => {
    try {
      const { cardId } = await upsertCard(config, state, task, positions.get(task.id) ?? POS_STEP, ctx);
      nextMap[task.id] = cardId;
      pushed++;
    } catch (err: any) {
      errors.push(`${task.title}: ${err?.message ?? 'failed'}`);
    }
  });

  // Archive cards whose local task no longer exists. Only touch cards we
  // actually owned (in the old cardMap) — never archive cards we found on
  // the board but never linked to, since those may belong to the user.
  const liveIds = new Set(tasks.map(t => t.id));
  const pushedCardIds = new Set(Object.values(nextMap));
  const orphans: Array<[string, string]> = [];
  for (const [taskId, cardId] of Object.entries(state.cardMap ?? {})) {
    if (liveIds.has(taskId)) continue;
    // Skip archive if we re-adopted this card under a different local task
    // (rare but possible after id churn).
    if (pushedCardIds.has(cardId) && nextMap[taskId] !== cardId) {
      delete nextMap[taskId];
      continue;
    }
    orphans.push([taskId, cardId]);
  }
  await mapLimit(orphans, MAX_CONCURRENT_REQUESTS, async ([taskId, cardId]) => {
    try {
      await trelloRequest(config, `/cards/${cardId}`, 'PUT', undefined, { closed: true });
    } catch { /* ignore */ }
    delete nextMap[taskId];
  });

  await patchState(config.projectId, 'trello', config.milestoneId, { cardMap: nextMap });

  return { pushed, total: tasks.length, errors, boardUrl: state.boardUrl };
}

interface TrelloAttachment {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
  bytes?: number;
  date?: string;
  /** False for link attachments, whose url is whatever the client typed. */
  isUpload?: boolean;
  previews?: Array<{ url: string; width: number; height: number }>;
}

interface TrelloCommentAction {
  id: string;
  date: string;
  data?: { card?: { id: string }; text?: string };
  memberCreator?: { fullName?: string; username?: string };
}

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  idList: string;
  idLabels: string[];
  closed: boolean;
  dateLastActivity: string;
  attachments?: TrelloAttachment[];
}

export interface PulledTask {
  cardId: string;
  taskId?: string;
  title: string;
  description: string;
  prompt?: string;
  effort?: Task['effort'];
  status: TaskStatus;
  priority: TaskPriority;
  updatedAt: string;
  /** Always present on a successful pull ([] when the card has none) so a
   *  deletion on Trello propagates. */
  attachments?: TaskAttachment[];
  /** Undefined when the board-level comments request failed — the merge then
   *  keeps whatever comments were pulled before. */
  comments?: TaskComment[];
}

const MAX_ATTACHMENTS_PER_CARD = 20;
const MAX_COMMENTS_PER_CARD = 50;
const COMMENT_ACTIONS_LIMIT = 1000;

const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)(\?|$)/i;

function mapAttachment(a: TrelloAttachment): TaskAttachment {
  // Only an uploaded file can be rendered through the proxy; a link attachment
  // points at an arbitrary host we will not fetch, so it stays a plain link.
  const looksLikeImage = (a.mimeType ?? '').startsWith('image/') || IMAGE_URL_RE.test(a.url);
  return {
    id: a.id,
    name: a.name,
    url: a.url,
    mimeType: a.mimeType || undefined,
    bytes: a.bytes,
    isImage: (a.isUpload !== false && looksLikeImage) || undefined,
    date: a.date,
    source: 'trello',
  };
}

export async function pullCards(config: SyncConfig): Promise<PulledTask[]> {
  const state: TrelloState = config.state ?? {};
  if (!state.boardId) return [];

  // Fetch cards, labels, lists, and comment actions in parallel. Lists are
  // needed so we can resolve a list id we didn't push to (e.g. a manually-named
  // "Backlog" list created on Trello after we set up state.listIds, or an
  // existing board the user linked to where lists rotated). Attachments ride
  // the cards request itself (attachments=true) — zero extra fan-out. Comments
  // come from ONE board-level actions request; if it fails we degrade to
  // attachments only (comments === null) rather than failing the whole pull.
  const [cards, labels, lists, commentActions] = await Promise.all([
    trelloRequest<TrelloCard[]>(config, `/boards/${state.boardId}/cards`, 'GET', {
      fields: 'name,desc,idList,idLabels,closed,dateLastActivity',
      attachments: 'true',
      attachment_fields: 'name,url,mimeType,bytes,date,previews,isUpload',
    }),
    trelloRequest<Array<{ id: string; name: string; color: string }>>(config, `/boards/${state.boardId}/labels`),
    trelloRequest<Array<{ id: string; name: string; closed: boolean }>>(config, `/boards/${state.boardId}/lists`, 'GET', { fields: 'name,closed' }),
    trelloRequest<TrelloCommentAction[]>(config, `/boards/${state.boardId}/actions`, 'GET', {
      filter: 'commentCard',
      limit: String(COMMENT_ACTIONS_LIMIT),
      fields: 'data,date',
      memberCreator_fields: 'fullName,username',
    }).catch((err: any): null => {
      log.warn('sync', `Trello comments fetch failed — pulling without comments: ${err?.message ?? err}`, undefined, config.projectId);
      return null;
    }),
  ]);

  // 1000 is Trello's per-request ceiling. On a board with more comment actions
  // than that, older cards simply do not appear in the response — and reporting
  // them as "no comments" would wipe comments we had already stored.
  const commentsTruncated = commentActions?.length === COMMENT_ACTIONS_LIMIT;

  // Comments per card, capped at the most recent 50 then re-sorted oldest-first
  // so the thread reads top-to-bottom.
  const commentsByCard = new Map<string, TaskComment[]>();
  if (commentActions) {
    for (const action of commentActions) {
      const cardId = action.data?.card?.id;
      if (!cardId || typeof action.data?.text !== 'string') continue;
      let list = commentsByCard.get(cardId);
      if (!list) { list = []; commentsByCard.set(cardId, list); }
      list.push({
        id: action.id,
        author: action.memberCreator?.fullName || action.memberCreator?.username || undefined,
        text: action.data.text,
        date: action.date,
        source: 'trello',
      });
    }
    for (const list of commentsByCard.values()) {
      list.sort((a, b) => timeOf(b.date) - timeOf(a.date));
      if (list.length > MAX_COMMENTS_PER_CARD) list.length = MAX_COMMENTS_PER_CARD;
      list.reverse();
    }
  }

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
    // Cards in lists Shipyard doesn't manage (anything besides Backlog/To
    // Do/In Progress/Done) are the user's own board organisation — e.g. an
    // onboarding or reference list added straight in Trello. Importing them
    // as tasks would both clutter the task list and, on the next push, snap
    // them out of that list and into Backlog (since push only knows how to
    // place a task in one of the four managed lists). So we leave them alone
    // entirely: never pulled in, never touched by push.
    const status = listToStatus[card.idList];
    if (!status) continue;

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
    const effortMatch = desc.match(/\n\n\*\*Effort:\*\*\s*(1|2|3|5|8)(?=\n|$)/);
    const effort = effortMatch ? Number(effortMatch[1]) as Task['effort'] : undefined;
    const withoutEffort = desc.replace(/\n\n\*\*Effort:\*\*\s*(1|2|3|5|8)(?=\n|$)/, '');
    const split = withoutEffort.split(/\n\n---\n\*\*Details\*\*\n/);
    const description = split[0] ?? '';
    const prompt = split[1];

    const attachments = (card.attachments ?? [])
      .slice(0, MAX_ATTACHMENTS_PER_CARD)
      .map(mapAttachment);

    out.push({
      cardId: card.id,
      taskId: reverseCardMap[card.id],
      title: card.name,
      description,
      prompt,
      effort,
      status,
      priority,
      updatedAt: card.dateLastActivity || new Date().toISOString(),
      attachments,
      // Undefined means "we don't know" — the merge then keeps whatever was
      // already stored. That is what we want when the request failed, and on a
      // truncated board, where the window is filled in per card below.
      ...(commentActions && !commentsTruncated
        ? { comments: commentsByCard.get(card.id) ?? [] }
        : {}),
    });
  }

  // A board past the action ceiling only reports its most recent comments, and
  // a card's older ones would look deleted. Boards this busy are rare, so pay
  // for one request per card rather than lose a client's history.
  if (commentsTruncated) {
    await mapLimit(out, MAX_CONCURRENT_REQUESTS, async (task) => {
      try {
        const actions = await trelloRequest<TrelloCommentAction[]>(
          config,
          `/cards/${task.cardId}/actions`,
          'GET',
          { filter: 'commentCard', limit: String(MAX_COMMENTS_PER_CARD), fields: 'data,date', memberCreator_fields: 'fullName,username' },
        );
        task.comments = actions
          .filter(a => typeof a.data?.text === 'string')
          .map(a => ({
            id: a.id,
            author: a.memberCreator?.fullName || a.memberCreator?.username || undefined,
            text: a.data!.text as string,
            date: a.date,
            source: 'trello' as const,
          }))
          .reverse();
      } catch {
        // Leave comments undefined so the merge keeps what it had.
      }
    });
  }

  return out;
}

// ── Link to existing board ─────────────────────────────────────────────

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
