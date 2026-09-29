import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { join } from 'path';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { DATA_DIR } from './dataDir.js';
import * as taskStore from './taskStore.js';
import { getProjects } from './projectDiscovery.js';
import { triggerAutoSync } from './sync/syncEngine.js';
import * as log from './logService.js';

/**
 * WhatsApp inbox: a hosted service (`C:\Code\whatsapp-inbox`, Railway) reads the
 * messages of chosen clients, turns them into demands and holds them for review.
 * Shipyard runs on this machine and cannot take a webhook, so it asks: every
 * minute it sends its project list (so the web area knows where each client
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
}

export async function disconnect(): Promise<void> {
  // Keeps `imported`: reconnecting must not recreate tasks already made.
  await mutate(c => {
    c.url = '';
    c.token = '';
    c.lastError = null;
  });
}

// ── Sync ─────────────────────────────────────────────────────────────────

interface InboxDemand {
  id: string;
  projectId: string;
  milestoneId: string | null;
  title: string;
  description: string;
  prompt: string;
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

async function deliver(d: InboxDemand, knownProjects: Set<string>): Promise<{ taskId: string; taskNumber?: number }> {
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
        ...(parent.status === 'done' ? { status: 'todo' as const } : {}),
      });
      return { taskId: parent.id, taskNumber: task?.number };
    }
  }

  const effort = EFFORTS.includes(d.effort as any) ? (d.effort as (typeof EFFORTS)[number]) : undefined;
  const task = await taskStore.createTask(d.projectId, {
    title: d.title.slice(0, 300),
    description: d.description || '',
    prompt: d.prompt || '',
    priority: d.priority || 'medium',
    status: 'todo',
    ...(d.milestoneId && d.milestoneId !== 'default' ? { milestoneId: d.milestoneId } : {}),
    // Reviewed by a person before it got here.
    ...(effort ? { effort, effortSource: 'manual' as const } : {}),
  });
  return { taskId: task.id, taskNumber: task.number };
}

let inFlight: Promise<{ created: number }> | null = null;

export function syncNow(): Promise<{ created: number }> {
  if (!inFlight) inFlight = runSync().finally(() => { inFlight = null; });
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

    const { demands } = await call<{ demands: InboxDemand[] }>(c, '/api/shipyard/sync', {
      projects: payloadProjects,
      tasks: statusChanges,
    });

    const known = new Set(projects.map(p => p.id));
    const results: { demandId: string; taskId?: string; taskNumber?: number; error?: string }[] = [];
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
        const { taskId, taskNumber } = await deliver(d, known);
        newlyImported[d.id] = { projectId: d.projectId, taskId, reported: 'todo' };
        results.push({ demandId: d.id, taskId, taskNumber });
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

let timer: NodeJS.Timeout | null = null;

export function startInboxSync(): void {
  if (timer) return;
  const tick = () => {
    syncNow().catch(() => {
      // Already recorded in lastError; the settings card shows it.
    });
  };
  timer = setInterval(tick, POLL_MS);
  setTimeout(tick, 5_000);
}
