import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { nanoid } from 'nanoid';
import type { Task, TasksFile } from '../types/index.js';

const DATA_DIR = resolve(import.meta.dirname, '../../../data');
export const TASKS_DIR = join(DATA_DIR, 'tasks');

async function ensureTasksDir(): Promise<void> {
  await mkdir(TASKS_DIR, { recursive: true });
}

function getTasksFilePath(projectId: string): string {
  return join(TASKS_DIR, `${projectId}.json`);
}

async function readTasks(projectId: string): Promise<Task[]> {
  try {
    const data = await readFile(getTasksFilePath(projectId), 'utf-8');
    const file: TasksFile = JSON.parse(data);
    return file.tasks;
  } catch {
    return [];
  }
}

async function writeTasks(projectId: string, tasks: Task[]): Promise<void> {
  await ensureTasksDir();
  const file: TasksFile = { tasks };
  await writeFile(getTasksFilePath(projectId), JSON.stringify(file, null, 2), 'utf-8');
}

export async function getTasks(projectId: string): Promise<Task[]> {
  const tasks = await readTasks(projectId);
  for (const t of tasks) {
    if (!t.projectId) t.projectId = projectId;
    if (!t.createdAt) t.createdAt = t.updatedAt || new Date().toISOString();
    if (t.order == null) t.order = 0;
  }
  return tasks;
}

export async function getAllTasks(): Promise<Task[]> {
  await ensureTasksDir();
  const { readdir: rd } = await import('fs/promises');
  const files = await rd(TASKS_DIR);
  const allTasks: Task[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const projectId = file.replace('.json', '');
    const tasks = await readTasks(projectId);
    for (const t of tasks) {
      if (!t.projectId) t.projectId = projectId;
      if (!t.createdAt) t.createdAt = t.updatedAt || new Date().toISOString();
      if (t.order == null) t.order = 0;
    }
    allTasks.push(...tasks);
  }
  return allTasks;
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

export async function createTask(projectId: string, data: Omit<Task, 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'order' | 'inboxAt' | 'inProgressAt' | 'doneAt'>): Promise<Task> {
  const tasks = await readTasks(projectId);
  const now = new Date().toISOString();
  const status = data.status || 'todo';
  const task: Task = {
    ...data,
    status,
    id: nanoid(10),
    projectId,
    createdAt: now,
    updatedAt: now,
    order: tasks.length,
    ...buildCascadingTimestamps(status, now),
  };
  tasks.push(task);
  await writeTasks(projectId, tasks);
  return task;
}

export async function updateTask(projectId: string, taskId: string, data: Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>): Promise<Task | null> {
  const tasks = await readTasks(projectId);
  const idx = tasks.findIndex(t => t.id === taskId);
  if (idx === -1) return null;

  const now = new Date().toISOString();
  const oldStatus = tasks[idx].status;
  const newStatus = data.status;

  // Track status change timestamps (cascading: later stages fill in missing earlier ones)
  const statusTimestamps: Partial<Task> = {};
  if (newStatus && newStatus !== oldStatus) {
    const existing = tasks[idx];
    if (newStatus === 'backlog' || newStatus === 'todo') {
      statusTimestamps.inboxAt = now;
    } else if (newStatus === 'in_progress') {
      if (!existing.inboxAt) statusTimestamps.inboxAt = now;
      statusTimestamps.inProgressAt = now;
    } else if (newStatus === 'done') {
      if (!existing.inboxAt) statusTimestamps.inboxAt = now;
      if (!existing.inProgressAt) statusTimestamps.inProgressAt = now;
      statusTimestamps.doneAt = now;
    }
  }

  tasks[idx] = {
    ...tasks[idx],
    ...data,
    ...statusTimestamps,
    updatedAt: now,
  };
  await writeTasks(projectId, tasks);
  return tasks[idx];
}

export async function deleteTask(projectId: string, taskId: string): Promise<boolean> {
  const tasks = await readTasks(projectId);
  const filtered = tasks.filter(t => t.id !== taskId);
  if (filtered.length === tasks.length) return false;
  await writeTasks(projectId, filtered);
  return true;
}

export async function importTasks(projectId: string, importedTasks: Partial<Task>[]): Promise<number> {
  const existing = await readTasks(projectId);
  const now = new Date().toISOString();
  const created: Task[] = [];

  for (const t of importedTasks) {
    const status = (t.status as Task['status']) || 'todo';
    created.push({
      title: t.title || 'Untitled',
      description: t.description || '',
      priority: (t.priority as Task['priority']) || 'medium',
      status,
      prompt: t.prompt,
      id: nanoid(10),
      projectId,
      createdAt: t.createdAt || now,
      updatedAt: now,
      order: existing.length + created.length,
      ...buildCascadingTimestamps(status, now, { inboxAt: t.inboxAt, inProgressAt: t.inProgressAt, doneAt: t.doneAt }),
    });
  }

  await writeTasks(projectId, [...existing, ...created]);
  return created.length;
}

export async function applyCsvChanges(
  projectId: string,
  changes: {
    update: Array<{ id: string } & Partial<Omit<Task, 'id' | 'projectId' | 'createdAt'>>>;
    create: Array<Partial<Omit<Task, 'id' | 'projectId' | 'createdAt' | 'updatedAt' | 'order'>>>;
    remove: string[];
  }
): Promise<{ updated: number; created: number; removed: number }> {
  let tasks = await readTasks(projectId);
  const now = new Date().toISOString();

  // Remove
  const removeSet = new Set(changes.remove);
  const removedCount = tasks.filter(t => removeSet.has(t.id)).length;
  tasks = tasks.filter(t => !removeSet.has(t.id));

  // Update
  let updatedCount = 0;
  for (const upd of changes.update) {
    const idx = tasks.findIndex(t => t.id === upd.id);
    if (idx !== -1) {
      const existing = tasks[idx];
      const oldStatus = existing.status;
      const newStatus = upd.status;
      const statusTimestamps: Partial<Task> = {};
      if (newStatus && newStatus !== oldStatus) {
        if (newStatus === 'backlog' || newStatus === 'todo') {
          statusTimestamps.inboxAt = now;
        } else if (newStatus === 'in_progress') {
          if (!existing.inboxAt) statusTimestamps.inboxAt = now;
          statusTimestamps.inProgressAt = now;
        } else if (newStatus === 'done') {
          if (!existing.inboxAt) statusTimestamps.inboxAt = now;
          if (!existing.inProgressAt) statusTimestamps.inProgressAt = now;
          statusTimestamps.doneAt = now;
        }
      }
      tasks[idx] = { ...tasks[idx], ...upd, ...statusTimestamps, updatedAt: now };
      updatedCount++;
    }
  }

  // Create
  for (const newTask of changes.create) {
    const status = (newTask.status as Task['status']) || 'todo';
    tasks.push({
      title: newTask.title || 'Untitled',
      description: newTask.description || '',
      priority: (newTask.priority as Task['priority']) || 'medium',
      status,
      prompt: newTask.prompt,
      id: nanoid(10),
      projectId,
      createdAt: now,
      updatedAt: now,
      order: tasks.length,
      ...buildCascadingTimestamps(status, now),
    });
  }

  await writeTasks(projectId, tasks);
  return { updated: updatedCount, created: changes.create.length, removed: removedCount };
}

export async function reorderTasks(projectId: string, taskIds: string[]): Promise<Task[]> {
  const tasks = await readTasks(projectId);
  const reordered: Task[] = [];

  for (let i = 0; i < taskIds.length; i++) {
    const task = tasks.find(t => t.id === taskIds[i]);
    if (task) {
      reordered.push({ ...task, order: i, updatedAt: new Date().toISOString() });
    }
  }

  // Add any tasks not in the reorder list at the end
  const reorderedIds = new Set(taskIds);
  for (const task of tasks) {
    if (!reorderedIds.has(task.id)) {
      reordered.push({ ...task, order: reordered.length });
    }
  }

  await writeTasks(projectId, reordered);
  return reordered;
}
