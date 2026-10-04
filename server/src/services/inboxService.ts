import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { DATA_DIR } from './dataDir.js';
import * as taskStore from './taskStore.js';
import { getProjects } from './projectDiscovery.js';
import { triggerAutoSync } from './sync/syncEngine.js';
import * as log from './logService.js';

/**
 * WhatsApp inbox: a hosted service (`C:\Code\dcoder\whatsapp-inbox`, Railway) reads the
 * messages of chosen clients, turns them into demands and holds them for review.
 * Shipyard runs on this machine and cannot take a webhook, so it asks: it keeps
 * a live channel open (SSE) and syncs the moment a demand is approved, and every
 * minute, as a fallback, it sends its project list (so the web area knows where each client
 * lands) and the status of the tasks it created (so the record shows what got
 * done), and takes the demands that were approved.
 *
 * Taking is a claim on the other side: a demand only counts as delivered after
 * the ack. `imported` is the local guard — a demand already turned into a task
 * here is acked again, never created twice, even if the last ack was lost.
 */

const CONFIG_FILE = join(DATA_DIR, 'inbox-config.json');
const ENCRYPTION_KEY_FILE = join(DATA_DIR, '.claude-key');
const POLL_MS = 60_000;

interface ImportedRef {
  projectId: string;
  taskId: string;
  /** Last status reported back, so only changes travel. */
  reported?: string;
}

interface InboxConfig {
  url: string;
  token: string;
  imported: Record<string, ImportedRef>;
  lastSyncAt?: string;
  lastError?: string | null;
  lastCreated?: number;
  /** Set once the tasks made before `context` existed had their prompt split. */
  contextSplitAt?: string;
}

const EMPTY: InboxConfig = { url: '', token: '', imported: {} };

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

let cached: InboxConfig | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function load(): Promise<InboxConfig> {
  if (cached) return cached;
  try {
    const data = JSON.parse(await readFile(CONFIG_FILE, 'utf-8'));
    let token = '';
    if (data.token) {
      try {
        token = decrypt(data.token, await getEncryptionKey());
      } catch {
        // Encrypted with a different key — ask for it again.
      }
    }
    cached = { ...EMPTY, ...data, token, imported: data.imported || {} };
  } catch {
    cached = { ...EMPTY };
  }
  return cached!;
}

function mutate(fn: (config: InboxConfig) => void): Promise<void> {
  const run = writeChain.then(async () => {
    const next: InboxConfig = { ...(await load()) };
    next.imported = { ...next.imported };
    fn(next);
    cached = next;
    const payload = JSON.stringify(
      { ...next, token: next.token ? encrypt(next.token, await getEncryptionKey()) : '' },
      null,
      2,
    );
    await mkdir(DATA_DIR, { recursive: true });
    const tmp = `${CONFIG_FILE}.tmp`;
    await writeFile(tmp, payload, 'utf-8');
    await rename(tmp, CONFIG_FILE);
  });
  writeChain = run.catch(() => {});
  return run;
}

export async function getStatus() {
  const c = await load();
  return {
    configured: !!(c.url && c.token),
    url: c.url || null,
    lastSyncAt: c.lastSyncAt ?? null,
    lastError: c.lastError ?? null,
    lastCreated: c.lastCreated ?? 0,
    imported: Object.keys(c.imported).length,
    live: liveConnected,
  };
}

export async function configure(url: string, token: string): Promise<void> {
  const clean = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(clean)) throw new Error('URL must start with https://');
  await mutate(c => {
    c.url = clean;
    c.token = token.trim();
    c.lastError = null;
  });
  restartListen();
}

export async function disconnect(): Promise<void> {
  // Keeps `imported`: reconnecting must not recreate tasks already made.
  await mutate(c => {
    c.url = '';
    c.token = '';
    c.lastError = null;
  });
  restartListen();
}

// ── Sync ─────────────────────────────────────────────────────────────────

interface InboxDemand {
  id: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  description: string;
  prompt: string;
  /** Doubts, origin and the message transcript: stays in Shipyard, never pushed to a board. */
  context?: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  effort: number | null;
  parentTaskId: string | null;
}

async function call<T>(c: InboxConfig, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${c.url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 401) throw new Error('The inbox refused the token');
  if (!res.ok) throw new Error(`Inbox answered ${res.status}`);
  return (await res.json()) as T;
}

const EFFORTS = [1, 2, 3, 5, 8] as const;

// ── Catalog ───────────────────────────────────────────────────────────────
//
// The inbox never sees code. What it gets from here is the next best thing:
// each project's stack and notes, and the tasks that already exist, so its AI
// can tie a client's message to task #N instead of opening a duplicate, and
// pick the project when a chat has none. Built at most every 5 minutes (it
// reads every tasks file) and sent only when its hash differs from the one the
// inbox reports.

const CATALOG_TTL_MS = 5 * 60_000;
const CATALOG_TASKS_PER_PROJECT = 120;
const RECENT_DONE_MS = 30 * 86_400_000;

interface CatalogPayload {
  hash: string;
  projects: {
    id: string;
    name: string;
    techStack: string[];
    notes: string;
    tasks: { id: string; number?: number; title: string; status: string }[];
  }[];
}

let catalogMemo: { at: number; value: CatalogPayload } | null = null;

async function buildCatalog(projects: Awaited<ReturnType<typeof getProjects>>): Promise<CatalogPayload> {
  if (catalogMemo && Date.now() - catalogMemo.at < CATALOG_TTL_MS) return catalogMemo.value;
  const out: CatalogPayload['projects'] = [];
  for (const p of projects) {
    const tasks = await taskStore.getTasks(p.id).catch(() => []);
    const relevant = tasks
      .filter(t => t.status !== 'done' || (t.doneAt && Date.now() - new Date(t.doneAt).getTime() < RECENT_DONE_MS))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, CATALOG_TASKS_PER_PROJECT)
      .map(t => ({ id: t.id, number: t.number, title: t.title, status: t.status }));
    out.push({
      id: p.id,
      name: p.name,
      techStack: p.techStack || [],
      notes: (p.notes || '').slice(0, 600),
      tasks: relevant,
    });
  }
  const hash = createHash('sha1').update(JSON.stringify(out)).digest('hex');
  catalogMemo = { at: Date.now(), value: { hash, projects: out } };
  return catalogMemo.value;
}

async function deliver(d: InboxDemand, knownProjects: Set<string>): Promise<{ taskId: string; taskNumber?: number; asNote?: boolean }> {
  if (!knownProjects.has(d.projectId)) throw new Error(`project "${d.projectId}" is not in this Shipyard`);

  if (d.parentTaskId) {
    const parent = await taskStore.getTask(d.projectId, d.parentTaskId);
    if (parent) {
      // A follow-up from the client is more work on the same task: a dated
      // note (the shape the activity feed reads) and, if it was closed, back
      // to the inbox.
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const note = [`Client follow-up (WhatsApp): ${d.title}`, d.description, d.prompt].filter(Boolean).join('\n\n');
      const task = await taskStore.updateTask(d.projectId, parent.id, {
        prompt: taskStore.appendPromptSection(parent.prompt, `— Note ${ts}`, note),
        ...(d.context ? { context: taskStore.appendPromptSection(parent.context, `— Follow-up ${ts}`, d.context) } : {}),
        ...(parent.status === 'done' ? { status: 'todo' as const } : {}),
      });
      return { taskId: parent.id, taskNumber: task?.number, asNote: true };
    }
  }

  const effort = EFFORTS.includes(d.effort as any) ? (d.effort as (typeof EFFORTS)[number]) : undefined;
  const task = await taskStore.createTask(d.projectId, {
    title: d.title.slice(0, 300),
    description: d.description || '',
    prompt: d.prompt || '',
    ...(d.context ? { context: d.context } : {}),
    priority: d.priority || 'medium',
    status: 'todo',
    ...(d.milestoneId && d.milestoneId !== 'default' ? { milestoneId: d.milestoneId } : {}),
    // Reviewed by a person before it got here.
    // Reviewed by a person, but estimated without seeing the code.
    ...(effort ? { effort, effortSource: 'manual' as const, effortConfidence: 'low' as const } : {}),
  });
  return { taskId: task.id, taskNumber: task.number };
}

// ── Private context ───────────────────────────────────────────────────────
//
// Until v1.25 the inbox sent one text and it all landed in `prompt`, which the
// Trello and ClickUp push writes on the card the client reads: doubts, the
// link to the inbox and the whole message transcript. Those now arrive as
// `context`. This moves them out of the tasks made before, once; the push that
// follows cleans the cards.

const PRIVATE_START_RE = /^## (?:Dúvidas respondidas pelo André|Dúvidas ainda em aberto \(perguntar ao cliente\)|Origem: WhatsApp)/m;
const ORIGIN_RE = /^## Origem: WhatsApp/m;

/** Null when the prompt holds nothing the inbox wrote as private. */
export function splitInboxPrompt(prompt: string): { prompt: string; context: string } | null {
  if (!ORIGIN_RE.test(prompt)) return null;
  // A follow-up was appended as a dated note with its own private tail, so
  // each section is cut on its own.
  const kept: string[] = [];
  const moved: string[] = [];
  for (const section of prompt.split(/(?=^— (?:Note |Summary))/m)) {
    if (!ORIGIN_RE.test(section)) {
      kept.push(section);
      continue;
    }
    const at = section.search(PRIVATE_START_RE);
    kept.push(section.slice(0, at));
    const noteDate = section.match(/^— Note (\S+ \S+)/)?.[1];
    moved.push((noteDate ? `— Follow-up ${noteDate}\n` : '') + section.slice(at).trim());
  }
  return {
    prompt: kept.map(part => part.trim()).filter(Boolean).join('\n\n'),
    context: moved.join('\n\n'),
  };
}

async function splitExistingContext(): Promise<void> {
  if ((await load()).contextSplitAt) return;
  const touched = new Set<string>();
  for (const task of await taskStore.getAllTasks()) {
    const split = task.prompt ? splitInboxPrompt(task.prompt) : null;
    if (!split) continue;
    await taskStore.updateTask(task.projectId, task.id, {
      prompt: split.prompt,
      context: [task.context, split.context].filter(Boolean).join('\n\n'),
    });
    touched.add(task.projectId);
  }
  await mutate(c => {
    c.contextSplitAt = new Date().toISOString();
  });
  for (const projectId of touched) triggerAutoSync(projectId);
  if (touched.size) log.info('tasks', `WhatsApp context moved out of the prompt in ${touched.size} project(s)`);
}

let inFlight: Promise<{ created: number }> | null = null;
/** A wake-up that arrived mid-sync: that sync may have missed it, run again. */
let rerun = false;

export function syncNow(): Promise<{ created: number }> {
  if (inFlight) {
    rerun = true;
    return inFlight;
  }
  inFlight = runSync().finally(() => {
    inFlight = null;
    if (rerun) {
      rerun = false;
      syncNow().catch(() => {});
    }
  });
  return inFlight;
}

async function runSync(): Promise<{ created: number }> {
  const c = await load();
  if (!c.url || !c.token) return { created: 0 };

  try {
    const projects = await getProjects();
    const payloadProjects = await Promise.all(
      projects.map(async p => ({
        id: p.id,
        name: p.name,
        // The virtual General milestone is the project itself on the other side.
        milestones: (await taskStore.getMilestones(p.id))
          .filter(m => m.id !== 'default' && m.status === 'active')
          .map(m => ({ id: m.id, name: m.name })),
      })),
    );

    // Status of the tasks this inbox created, only when it changed.
    const byProject = new Map<string, [string, ImportedRef][]>();
    for (const entry of Object.entries(c.imported)) {
      const list = byProject.get(entry[1].projectId) || [];
      list.push(entry);
      byProject.set(entry[1].projectId, list);
    }
    const statusChanges: { demandId: string; taskId: string; number?: number; status: string }[] = [];
    for (const [projectId, entries] of byProject) {
      const tasks = await taskStore.getTasks(projectId).catch(() => []);
      const byId = new Map(tasks.map(t => [t.id, t]));
      for (const [demandId, ref] of entries) {
        const task = byId.get(ref.taskId);
        const status = task ? task.status : 'deleted';
        if (status !== ref.reported) statusChanges.push({ demandId, taskId: ref.taskId, number: task?.number, status });
      }
    }

    const { demands, catalogHash } = await call<{ demands: InboxDemand[]; catalogHash?: string | null }>(c, '/api/shipyard/sync', {
      projects: payloadProjects,
      tasks: statusChanges,
      // Tells the inbox to send the private part apart from the prompt.
      accepts: ['context'],
    });

    // The inbox reports the catalog it holds; send ours only when it differs.
    const catalog = await buildCatalog(projects);
    if (catalogHash !== catalog.hash) {
      await call(c, '/api/shipyard/catalog', catalog).catch(err =>
        log.warn('server', 'WhatsApp inbox catalog not sent', err.message),
      );
    }

    const known = new Set(projects.map(p => p.id));
    const results: { demandId: string; taskId?: string; taskNumber?: number; asNote?: boolean; error?: string }[] = [];
    const newlyImported: Record<string, ImportedRef> = {};
    const touched = new Set<string>();
    let created = 0;

    for (const d of demands || []) {
      const already = c.imported[d.id];
      if (already) {
        results.push({ demandId: d.id, taskId: already.taskId });
        continue;
      }
      try {
        const { taskId, taskNumber, asNote } = await deliver(d, known);
        newlyImported[d.id] = { projectId: d.projectId, taskId, reported: 'todo' };
        results.push({ demandId: d.id, taskId, taskNumber, asNote });
        touched.add(d.projectId);
        created++;
        log.info('tasks', `WhatsApp demand → "${d.title}"`, undefined, d.projectId);
      } catch (err: any) {
        results.push({ demandId: d.id, error: err.message });
        log.warn('server', `WhatsApp demand "${d.title}" not delivered`, err.message);
      }
    }

    // Record locally before the ack: a lost ack must not mean a second task.
    await mutate(next => {
      Object.assign(next.imported, newlyImported);
      for (const change of statusChanges) {
        if (next.imported[change.demandId]) next.imported[change.demandId].reported = change.status;
      }
      next.lastSyncAt = new Date().toISOString();
      next.lastError = null;
      if (created) next.lastCreated = created;
    });
    for (const projectId of touched) triggerAutoSync(projectId);
    if (results.length) await call(c, '/api/shipyard/ack', { results });
    return { created };
  } catch (err: any) {
    await mutate(next => {
      next.lastError = err.message;
    }).catch(() => {});
    throw err;
  }
}

// ── Live channel ──────────────────────────────────────────────────────────
//
// GET /api/shipyard/events on the inbox: an `approved` event means "sync now",
// so an approved demand lands here in seconds instead of up to a minute. The
// poll above stays as the fallback. Silence past IDLE_MS (the inbox pings every
// 25 s) counts as a dead connection; reconnects back off up to a minute, which
// also covers an inbox that does not have the channel yet.

const IDLE_MS = 70_000;
let liveConnected = false;
let liveCtrl: AbortController | null = null;
let liveRetry = 0;
let liveTimer: NodeJS.Timeout | null = null;
let liveStarted = false;

function tick(): void {
  syncNow().catch(() => {
    // Already recorded in lastError; the settings card shows it.
  });
}

function scheduleListen(ms: number): void {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveTimer = null;
    void listen();
  }, ms);
}

function restartListen(): void {
  if (!liveStarted) return;
  liveCtrl?.abort();
  liveRetry = 0;
  scheduleListen(500);
}

async function listen(): Promise<void> {
  const c = await load();
  if (!c.url || !c.token) return scheduleListen(POLL_MS);
  const ctrl = new AbortController();
  liveCtrl = ctrl;
  let idle: NodeJS.Timeout | null = null;
  const arm = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => ctrl.abort(), IDLE_MS);
  };
  try {
    arm();
    const res = await fetch(`${c.url}/api/shipyard/events`, {
      headers: { Authorization: `Bearer ${c.token}`, Accept: 'text/event-stream' },
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Inbox live channel answered ${res.status}`);
    liveConnected = true;
    liveRetry = 0;
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      arm();
      buf += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, end);
        buf = buf.slice(end + 2);
        if (/^event: approved$/m.test(block)) tick();
      }
    }
  } catch {
    // Closed, timed out or refused: retry below.
  } finally {
    if (idle) clearTimeout(idle);
    liveConnected = false;
    if (liveCtrl === ctrl) liveCtrl = null;
  }
  scheduleListen(Math.min(POLL_MS, 2_000 * 2 ** liveRetry++));
}

let timer: NodeJS.Timeout | null = null;

export function startInboxSync(): void {
  if (timer) return;
  splitExistingContext().catch(err => log.warn('server', 'WhatsApp context split failed', err.message));
  timer = setInterval(tick, POLL_MS);
  setTimeout(tick, 5_000);
  liveStarted = true;
  scheduleListen(3_000);
}
