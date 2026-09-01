import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { nanoid } from 'nanoid';
import type { Task, Milestone, TasksFile, EffortPoints, EffortConfidence } from '../types/index.js';
import { DATA_DIR } from './dataDir.js';

export const TASKS_DIR = join(DATA_DIR, 'tasks');
const EFFORT_POINTS = new Set<EffortPoints>([1, 2, 3, 5, 8]);
function isEffort(value: unknown): value is EffortPoints {
  return typeof value === 'number' && EFFORT_POINTS.has(value as EffortPoints);
}

async function ensureTasksDir(): Promise<void> {
  await mkdir(TASKS_DIR, { recursive: true });
}

function getTasksFilePath(projectId: string): string {
  return join(TASKS_DIR, `${projectId}.json`);
}

async function readFile_(projectId: string): Promise<TasksFile> {
  let data: string;
  try {
    data = await readFile(getTasksFilePath(projectId), 'utf-8');
  } catch {
    // File doesn't exist yet — fresh project.
    return { tasks: [] };
  }
  try {
    return JSON.parse(data);
  } catch (err) {
    // The file exists but is unparseable. Returning an empty list here would
    // cause the next write to overwrite the corrupted file with [], destroying
    // the user's data. Side-step that by snapshotting the broken content for
    // recovery and refusing the read so callers surface an error instead.
    const backup = `${getTasksFilePath(projectId)}.corrupt-${Date.now()}.bak`;
    try { await writeFile(backup, data, 'utf-8'); } catch { /* best effort */ }
    throw new Error(`Tasks file for "${projectId}" is corrupted (snapshot saved at ${backup}): ${(err as Error).message}`);
  }
}

async function readTasks(projectId: string): Promise<Task[]> {
  const file = await readFile_(projectId);
  return file.tasks;
}

async function writeFile_(projectId: string, file: TasksFile): Promise<void> {
  await ensureTasksDir();
  await writeFile(getTasksFilePath(projectId), JSON.stringify(file, null, 2), 'utf-8');
}

async function writeTasks(projectId: string, tasks: Task[]): Promise<void> {
  // Preserve milestones when writing tasks
  const file = await readFile_(projectId);
  file.tasks = tasks;
  await writeFile_(projectId, file);
}

// Per-project mutation lock. Without this, parallel mutations (especially
// bulk operations driven from the client) read-modify-write the same JSON
// file concurrently — overlapping writes can interleave bytes and corrupt
// the file. Every public mutation below should run inside withLock(projectId).
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>(res => { release = res; });
  locks.set(projectId, prev.then(() => next));
  try {
    await prev;
    return await fn();
  } finally {
    release!();
    if (locks.get(projectId) === next) locks.delete(projectId);
  }
}

function getNextNumber(tasks: Task[]): number {
  let max = 0;
  for (const t of tasks) {
    if (t.number && t.number > max) max = t.number;
  }
  return max + 1;
}

// Backfill missing numbers on existing tasks (sorted by createdAt to assign in order)
function backfillNumbers(tasks: Task[]): boolean {
  const missing = tasks.filter(t => !t.number);
  if (missing.length === 0) return false;
  let next = getNextNumber(tasks);
  // Sort missing by createdAt so older tasks get lower numbers
  missing.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  for (const t of missing) {
    t.number = next++;
  }
  return true;
}

// Filter tasks by milestoneId: 'default' or undefined matches tasks with no milestoneId
function filterByMilestone(tasks: Task[], milestoneId?: string): Task[] {
  if (!milestoneId) return tasks;
  if (milestoneId === 'default') {
    return tasks.filter(t => !t.milestoneId || t.milestoneId === 'default');
  }
  return tasks.filter(t => t.milestoneId === milestoneId);
}

/** Repair fields that older task files may be missing. In-memory only. */
function normalizeTasks(tasks: Task[], projectId: string): void {
  for (const t of tasks) {
    if (!t.projectId) t.projectId = projectId;
    if (!t.createdAt) t.createdAt = t.updatedAt || new Date().toISOString();
    if (t.order == null) t.order = 0;
    if (!isEffort(t.effort)) { delete t.effort; delete t.effortSource; delete t.effortConfidence; }
  }
}

async function readNormalized(projectId: string): Promise<Task[]> {
  const tasks = await readTasks(projectId);
  normalizeTasks(tasks, projectId);
  return tasks;
}

/**
 * Assign `number` to tasks created before numbering existed. This is a
 * one-time migration per project: it persists under the lock and returns the
 * authoritative list, so a read path never has to re-read what it just wrote.
 */
async function ensureNumbers(projectId: string, tasks: Task[]): Promise<Task[]> {
  if (tasks.every(t => t.number)) return tasks;
  return withLock(projectId, async () => {
    // Re-read inside the lock so we don't clobber a concurrent mutation.
    const fresh = await readNormalized(projectId);
    if (backfillNumbers(fresh)) await writeTasks(projectId, fresh);
    return fresh;
  });
}

export async function getTasks(projectId: string, milestoneId?: string): Promise<Task[]> {
  const tasks = await ensureNumbers(projectId, await readNormalized(projectId));
  return filterByMilestone(tasks, milestoneId);
}

export async function getAllTasks(): Promise<Task[]> {
  await ensureTasksDir();
  const { readdir: rd } = await import('fs/promises');
  const files = (await rd(TASKS_DIR)).filter(f => f.endsWith('.json'));
  // Read every project's file concurrently — this is the hot path behind
  // GET /api/tasks/all, which the dashboard polls.
  const perProject = await Promise.all(files.map(async file => {
    const projectId = file.replace(/\.json$/, '');
    return ensureNumbers(projectId, await readNormalized(projectId));
  }));
  return perProject.flat();
}

export async function getTask(projectId: string, taskId: string): Promise<Task | undefined> {
  const tasks = await readTasks(projectId);
  return tasks.find(t => t.id === taskId);
}

// Build cascading timestamps: later stages imply earlier ones happened too
function buildCascadingTimestamps(status: Task['status'], now: string, existing?: { inboxAt?: string; inProgressAt?: string; doneAt?: string }) {
  const ts: { inboxAt?: string; inProgressAt?: string; doneAt?: string } = {}
  if (status === 'backlog' || status === 'todo' || status === 'in_progress' || status === 'done') {
    ts.inboxAt = existing?.inboxAt || now
  }
  if (status === 'in_progress' || status === 'done') {
    ts.inProgressAt = existing?.inProgressAt || now
  }
  if (status === 'done') {
    ts.doneAt = existing?.doneAt || now
  }
  return ts
}

function applyStatusTimestamps(existing: Task, newStatus: Task['status'] | undefined, now: string): Partial<Task> {
  if (!newStatus || newStatus === existing.status) return {};
  const ts: Partial<Task> = {};
  if (newStatus === 'backlog' || newStatus === 'todo') {
    ts.inboxAt = now;
  } else if (newStatus === 'in_progress') {
    if (!existing.inboxAt) ts.inboxAt = now;
    ts.inProgressAt = now;
  } else if (newStatus === 'done') {
    if (!existing.inboxAt) ts.inboxAt = now;
    if (!existing.inProgressAt) ts.inProgressAt = now;
    ts.doneAt = now;
  }
  return ts;
}

export function createTask(projectId: string, data: Omit<Task, 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'order' | 'inboxAt' | 'inProgressAt' | 'doneAt'>): Promise<Task> {
  return withLock(projectId, async () => {
    const tasks = await readTasks(projectId);
    const now = new Date().toISOString();
    const status = data.status || 'todo';
    const task: Task = {
      ...data,
      status,
      id: nanoid(10),
      number: getNextNumber(tasks),
      projectId,
      createdAt: now,
      updatedAt: now,
      order: tasks.length,
      ...buildCascadingTimestamps(status, now),
    };
    tasks.push(task);
    await writeTasks(projectId, tasks);
    return task;
  });
}

export function updateTask(projectId: string, taskId: string, data: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>): Promise<Task | null> {
  return withLock(projectId, async () => {
    const tasks = await readTasks(projectId);
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return null;
    const now = new Date().toISOString();
    tasks[idx] = {
      ...tasks[idx],
      ...data,
      ...applyStatusTimestamps(tasks[idx], data.status, now),
      updatedAt: now,
    };
    if ((data as any).effort === null) {
      delete tasks[idx].effort;
      delete tasks[idx].effortSource;
      delete tasks[idx].effortConfidence;
    }
    await writeTasks(projectId, tasks);
    return tasks[idx];
  });
}

export function deleteTask(projectId: string, taskId: string): Promise<boolean> {
  return withLock(projectId, async () => {
    const tasks = await readTasks(projectId);
    const filtered = tasks.filter(t => t.id !== taskId);
    if (filtered.length === tasks.length) return false;
    await writeTasks(projectId, filtered);
    return true;
  });
}

// Bulk operations: do the read-modify-write in a single locked pass so that
// large kanban-level actions (move all / delete all) hit the disk as one
// atomic write instead of N concurrent writes that race and corrupt the file.
export function bulkUpdateTasks(
  projectId: string,
  taskIds: string[],
  data: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>,
): Promise<{ updated: number }> {
  return withLock(projectId, async () => {
    if (taskIds.length === 0) return { updated: 0 };
    const tasks = await readTasks(projectId);
    const idSet = new Set(taskIds);
    const now = new Date().toISOString();
    let updated = 0;
    for (let i = 0; i < tasks.length; i++) {
      if (!idSet.has(tasks[i].id)) continue;
      tasks[i] = {
        ...tasks[i],
        ...data,
        ...applyStatusTimestamps(tasks[i], data.status, now),
        updatedAt: now,
      };
      updated++;
    }
    if (updated > 0) await writeTasks(projectId, tasks);
    return { updated };
  });
}

export function applyEffortAssignments(
  projectId: string,
  assignments: Array<{ taskId: string; effort: EffortPoints; confidence?: EffortConfidence }>,
): Promise<{ updated: number }> {
  return withLock(projectId, async () => {
    const validEfforts = new Set<EffortPoints>([1, 2, 3, 5, 8]);
    const byId = new Map(assignments.filter(a => validEfforts.has(a.effort)).map(a => [a.taskId, a]));
    if (byId.size === 0) return { updated: 0 };
    const tasks = await readTasks(projectId);
    const now = new Date().toISOString();
    let updated = 0;
    for (let i = 0; i < tasks.length; i++) {
      const assignment = byId.get(tasks[i].id);
      // Backfill is deliberately non-destructive: manual/previous values win.
      if (!assignment || tasks[i].effort !== undefined) continue;
      tasks[i] = {
        ...tasks[i],
        effort: assignment.effort,
        effortSource: 'backfill',
        effortConfidence: assignment.confidence || 'medium',
        updatedAt: now,
      };
      updated++;
    }
    if (updated > 0) await writeTasks(projectId, tasks);
    return { updated };
  });
}
export function bulkDeleteTasks(projectId: string, taskIds: string[]): Promise<{ deleted: number }> {
  return withLock(projectId, async () => {
    if (taskIds.length === 0) return { deleted: 0 };
    const tasks = await readTasks(projectId);
    const idSet = new Set(taskIds);
    const filtered = tasks.filter(t => !idSet.has(t.id));
    const deleted = tasks.length - filtered.length;
    if (deleted > 0) await writeTasks(projectId, filtered);
    return { deleted };
  });
}

export function importTasks(projectId: string, importedTasks: Partial<Task>[]): Promise<number> {
  return withLock(projectId, async () => {
    const existing = await readTasks(projectId);
    const now = new Date().toISOString();
    const created: Task[] = [];

    let nextNum = getNextNumber(existing);
    for (const t of importedTasks) {
      const status = (t.status as Task['status']) || 'todo';
      created.push({
        title: t.title || 'Untitled',
        description: t.description || '',
        priority: (t.priority as Task['priority']) || 'medium',
        ...(isEffort(t.effort) ? { effort: t.effort, effortSource: t.effortSource, effortConfidence: t.effortConfidence } : {}),
        status,
        prompt: t.prompt,
        milestoneId: t.milestoneId,
        id: nanoid(10),
        number: nextNum++,
        projectId,
        createdAt: t.createdAt || now,
        updatedAt: now,
        order: existing.length + created.length,
        ...buildCascadingTimestamps(status, now, { inboxAt: t.inboxAt, inProgressAt: t.inProgressAt, doneAt: t.doneAt }),
      });
    }

    await writeTasks(projectId, [...existing, ...created]);
    return created.length;
  });
}

export function applyCsvChanges(
  projectId: string,
  changes: {
    update: Array<{ id: string } & Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>>;
    create: Array<Partial<Omit<Task, 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'order'>>>;
    remove: string[];
  }
): Promise<{ updated: number; created: number; removed: number }> {
  return withLock(projectId, async () => {
    let tasks = await readTasks(projectId);
    const now = new Date().toISOString();

    const removeSet = new Set(changes.remove);
    const removedCount = tasks.filter(t => removeSet.has(t.id)).length;
    tasks = tasks.filter(t => !removeSet.has(t.id));

    let updatedCount = 0;
    for (const upd of changes.update) {
      const idx = tasks.findIndex(t => t.id === upd.id);
      if (idx !== -1) {
        tasks[idx] = {
          ...tasks[idx],
          ...upd,
          ...applyStatusTimestamps(tasks[idx], upd.status, now),
          updatedAt: now,
        };
        if ((upd as any).effort === null) {
          delete tasks[idx].effort;
          delete tasks[idx].effortSource;
          delete tasks[idx].effortConfidence;
        }
        updatedCount++;
      }
    }

    let csvNextNum = getNextNumber(tasks);
    for (const newTask of changes.create) {
      const status = (newTask.status as Task['status']) || 'todo';
      tasks.push({
        title: newTask.title || 'Untitled',
        description: newTask.description || '',
        priority: (newTask.priority as Task['priority']) || 'medium',
        ...(isEffort(newTask.effort) ? { effort: newTask.effort, effortSource: newTask.effortSource || 'manual', effortConfidence: newTask.effortConfidence } : {}),
        status,
        prompt: newTask.prompt,
        id: nanoid(10),
        number: csvNextNum++,
        projectId,
        createdAt: now,
        updatedAt: now,
        order: tasks.length,
        ...buildCascadingTimestamps(status, now),
      });
    }

    await writeTasks(projectId, tasks);
    return { updated: updatedCount, created: changes.create.length, removed: removedCount };
  });
}

export function replaceTasks(projectId: string, incoming: Partial<Task>[], milestoneId?: string): Promise<Task[]> {
  return withLock(projectId, async () => {
    const existingTasks = await readTasks(projectId);
    const existingMap = new Map(existingTasks.map(t => [t.id, t]));
    const now = new Date().toISOString();

    const allNumbers = [...existingTasks, ...incoming].map(t => t.number || 0);
    let replaceNextNum = Math.max(0, ...allNumbers) + 1;
    const tasks: Task[] = incoming.map((t, i) => {
      const status = (t.status as Task['status']) || 'todo';
      const existing = t.id ? existingMap.get(t.id) : undefined;
      const number = t.number || existing?.number || replaceNextNum++;
      return {
        title: t.title || 'Untitled',
        description: t.description || '',
        priority: (t.priority as Task['priority']) || 'medium',
        effort: isEffort(t.effort) ? t.effort : existing?.effort,
        effortSource: t.effortSource || existing?.effortSource,
        effortConfidence: t.effortConfidence || existing?.effortConfidence,
        status,
        prompt: t.prompt,
        milestoneId: t.milestoneId || milestoneId || existing?.milestoneId,
        id: t.id || nanoid(10),
        number,
        projectId,
        createdAt: t.createdAt || existing?.createdAt || now,
        updatedAt: t.updatedAt || now,
        order: t.order ?? i,
        // This function rebuilds every task from a whitelist, and every sync
        // pull writes through it. Fields the caller doesn't know about have to
        // be carried over explicitly or a Sheets/Trello pull silently erases
        // them.
        subtasks: t.subtasks ?? existing?.subtasks,
        needsReview: t.needsReview ?? existing?.needsReview,
        attachments: t.attachments ?? existing?.attachments,
        comments: t.comments ?? existing?.comments,
        ...buildCascadingTimestamps(status, now, {
          inboxAt: t.inboxAt || existing?.inboxAt,
          inProgressAt: t.inProgressAt || existing?.inProgressAt,
          doneAt: t.doneAt || existing?.doneAt,
        }),
      };
    });

    if (milestoneId && milestoneId !== 'default') {
      const otherTasks = existingTasks.filter(t => t.milestoneId !== milestoneId);
      await writeTasks(projectId, [...otherTasks, ...tasks]);
    } else if (milestoneId === 'default') {
      const otherTasks = existingTasks.filter(t => t.milestoneId && t.milestoneId !== 'default');
      await writeTasks(projectId, [...otherTasks, ...tasks]);
    } else {
      await writeTasks(projectId, tasks);
    }
    return tasks;
  });
}

export function reorderTasks(projectId: string, taskIds: string[]): Promise<Task[]> {
  return withLock(projectId, async () => {
    const tasks = await readTasks(projectId);
    const reordered: Task[] = [];

    for (let i = 0; i < taskIds.length; i++) {
      const task = tasks.find(t => t.id === taskIds[i]);
      if (task) {
        reordered.push({ ...task, order: i, updatedAt: new Date().toISOString() });
      }
    }

    const reorderedIds = new Set(taskIds);
    for (const task of tasks) {
      if (!reorderedIds.has(task.id)) {
        reordered.push({ ...task, order: reordered.length });
      }
    }

    await writeTasks(projectId, reordered);
    return reordered;
  });
}

// ── Milestone CRUD ─────────────────────────────────────────

const DEFAULT_MILESTONE: Milestone = {
  id: 'default',
  projectId: '',
  name: 'General',
  status: 'active',
  createdAt: '',
  updatedAt: '',
  order: 0,
};

export async function getMilestones(projectId: string): Promise<Milestone[]> {
  const file = await readFile_(projectId);
  const milestones = (file.milestones || []).map(m => ({ ...m, projectId }));
  // Always prepend virtual "default" milestone
  return [{ ...DEFAULT_MILESTONE, projectId }, ...milestones];
}

export async function createMilestone(projectId: string, data: { name: string; description?: string }): Promise<Milestone> {
  const file = await readFile_(projectId);
  const milestones = file.milestones || [];
  const now = new Date().toISOString();
  const milestone: Milestone = {
    id: nanoid(10),
    projectId,
    name: data.name,
    description: data.description,
    status: 'active',
    createdAt: now,
    updatedAt: now,
    order: milestones.length + 1,
  };
  milestones.push(milestone);
  file.milestones = milestones;
  await writeFile_(projectId, file);
  return milestone;
}

export async function updateMilestone(projectId: string, milestoneId: string, data: { name?: string; description?: string; status?: 'active' | 'closed' }): Promise<Milestone | null> {
  if (milestoneId === 'default') return null; // Cannot edit virtual default
  const file = await readFile_(projectId);
  const milestones = file.milestones || [];
  const idx = milestones.findIndex(m => m.id === milestoneId);
  if (idx === -1) return null;
  milestones[idx] = {
    ...milestones[idx],
    ...data,
    updatedAt: new Date().toISOString(),
  };
  file.milestones = milestones;
  await writeFile_(projectId, file);
  return { ...milestones[idx], projectId };
}

export async function deleteMilestone(projectId: string, milestoneId: string): Promise<boolean> {
  if (milestoneId === 'default') return false; // Cannot delete virtual default
  const file = await readFile_(projectId);
  const milestones = file.milestones || [];
  const filtered = milestones.filter(m => m.id !== milestoneId);
  if (filtered.length === milestones.length) return false;
  // Move tasks from deleted milestone to default
  for (const t of file.tasks) {
    if (t.milestoneId === milestoneId) {
      delete t.milestoneId;
    }
  }
  file.milestones = filtered;
  await writeFile_(projectId, file);
  return true;
}

/**
 * Append a titled section to a task prompt. Shared by the MCP progress tools
 * and the HTTP note route so both write the same shape.
 */
export function appendPromptSection(existing: string | undefined, header: string, body: string): string {
  const base = (existing || '').trimEnd();
  const section = `${header}\n${body.trim()}`;
  return base ? `${base}\n\n${section}` : section;
}
