import { join, resolve, isAbsolute, basename } from 'path';
import { mkdir, readdir, rm, stat } from 'fs/promises';
import * as gitService from './gitService.js';
import * as taskStore from './taskStore.js';
import { getProjects } from './projectDiscovery.js';
import { getSettings, saveSettings } from './settingsStore.js';
import { DATA_DIR } from './dataDir.js';
import * as log from './logService.js';
import type { Project, Task } from '../types/index.js';

/**
 * Worktree per task.
 *
 * With the setting on, starting a task checks the repo out into its own
 * directory on its own branch. Several agents can then work on the same
 * project at once without overwriting each other's files or fighting over
 * which branch is checked out. The path lands on the task, and the terminal
 * opens there instead of in the project folder.
 */

export const DEFAULT_WORKTREE_DIR = join(DATA_DIR, 'worktrees');

/** Worktrees of tasks finished longer ago than this are swept away. */
export const WORKTREE_TTL_DAYS = 7;

export interface WorktreeConfig {
  enabled: boolean;
  basePath: string;
  /** True when basePath comes from the setting rather than the default. */
  custom: boolean;
}

export function getConfig(): WorktreeConfig {
  const settings = getSettings();
  const raw = settings.worktreeBasePath?.trim();
  return {
    enabled: !!settings.worktreePerTask,
    basePath: raw ? resolve(raw) : DEFAULT_WORKTREE_DIR,
    custom: !!raw,
  };
}

export async function saveConfig(input: { enabled?: boolean; basePath?: string | null }): Promise<WorktreeConfig> {
  const next = { ...getSettings() };

  if (input.enabled !== undefined) next.worktreePerTask = !!input.enabled;

  if (input.basePath !== undefined) {
    const raw = (input.basePath || '').trim();
    if (!raw) {
      delete next.worktreeBasePath;
    } else {
      if (!isAbsolute(raw)) throw new Error('Worktree folder must be an absolute path');
      next.worktreeBasePath = resolve(raw);
    }
  }

  await saveSettings(next);
  return getConfig();
}

// -- Naming ---------------------------------------------------------------

const COMBINING_MARKS = /[̀-ͯ]/g;

function slugify(title: string): string {
  return title
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/**
 * Branch for a task: `shipyard/task-12-fix-login`. Two worktrees can never
 * share a branch, so the task number (or its id, for older tasks without one)
 * carries the uniqueness and the slug only makes it readable.
 */
export function branchNameFor(task: Task): string {
  const key = task.number ? String(task.number) : task.id;
  const slug = slugify(task.title);
  return `shipyard/task-${key}${slug ? `-${slug}` : ''}`;
}

/**
 * Does this folder look like one Shipyard created? The base path is the
 * user's to choose, and it may well hold other things — the orphan sweep only
 * touches directories that match the naming scheme and carry git's worktree
 * marker, so a badly chosen folder cannot cost anyone their files.
 */
async function looksLikeTaskWorktree(path: string): Promise<boolean> {
  if (!/-task-/.test(basename(path))) return false;
  return exists(join(path, '.git'));
}

/** Directory name: same shape as the branch, flattened for the filesystem. */
export function dirNameFor(projectId: string, task: Task): string {
  const key = task.number ? String(task.number) : task.id;
  const slug = slugify(task.title);
  return `${projectId}-task-${key}${slug ? `-${slug}` : ''}`;
}

// -- Creating and resolving -----------------------------------------------

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The directory an agent working on this task should run in: its worktree if
 * one exists on disk, the project folder otherwise. Never throws — a missing
 * worktree falls back instead of blocking the launch.
 */
export async function resolveTaskCwd(project: Project, task?: Task | null): Promise<string> {
  if (!task?.worktreePath) return project.path;
  return (await exists(task.worktreePath)) ? task.worktreePath : project.path;
}

export interface EnsureResult {
  path: string;
  branch?: string;
  created: boolean;
  /** Why the task kept the project path, when it did. */
  reason?: string;
}

/**
 * Give the task a worktree, or hand back the project path with the reason it
 * did not get one. Repeat calls on the same task reuse what is already there.
 */
export async function ensureTaskWorktree(project: Project, task: Task): Promise<EnsureResult> {
  const config = getConfig();
  if (!config.enabled) return { path: project.path, created: false, reason: 'disabled' };
  if (!project.isGitRepo) return { path: project.path, created: false, reason: 'not a git repository' };

  if (task.worktreePath && (await exists(task.worktreePath))) {
    return { path: task.worktreePath, branch: task.worktreeBranch, created: false };
  }

  const branch = task.worktreeBranch || branchNameFor(task);
  const dest = task.worktreePath || join(config.basePath, dirNameFor(project.id, task));

  try {
    await mkdir(config.basePath, { recursive: true });
    await gitService.createWorktree(project.path, branch, dest);
  } catch (err: any) {
    log.error('git', 'Failed to create task worktree', err?.message || String(err), project.id);
    return { path: project.path, created: false, reason: err?.message || 'git worktree add failed' };
  }

  await taskStore.updateTask(task.projectId, task.id, { worktreePath: dest, worktreeBranch: branch });
  log.info('git', `Worktree created for task #${task.number ?? task.id}`, `${branch} -> ${dest}`, project.id);
  return { path: dest, branch, created: true };
}

// -- Removing -------------------------------------------------------------

/**
 * Drop a task's worktree and its branch, and clear the fields on the task.
 * Best effort: a worktree that is already gone counts as removed.
 */
export async function removeTaskWorktree(
  task: Task,
  options: { project?: Project; deleteBranch?: boolean; clearTask?: boolean } = {},
): Promise<boolean> {
  if (!task.worktreePath) return false;

  const project = options.project || (await getProjects()).find(p => p.id === task.projectId);

  try {
    if (project?.isGitRepo) {
      await gitService.removeWorktree(project.path, task.worktreePath);
      if (options.deleteBranch !== false && task.worktreeBranch) {
        await gitService.deleteBranch(project.path, task.worktreeBranch);
      }
    } else {
      await rm(task.worktreePath, { recursive: true, force: true });
    }
  } catch (err: any) {
    log.error('git', 'Failed to remove task worktree', err?.message || String(err), task.projectId);
    return false;
  }

  if (options.clearTask !== false) {
    await taskStore.updateTask(task.projectId, task.id, {
      worktreePath: undefined,
      worktreeBranch: undefined,
    });
  }
  log.info('git', `Worktree removed for task #${task.number ?? task.id}`, task.worktreePath, task.projectId);
  return true;
}

// -- Listing and cleanup --------------------------------------------------

export interface WorktreeInfo {
  path: string;
  branch?: string;
  projectId: string;
  projectName?: string;
  taskId: string;
  taskNumber?: number;
  taskTitle: string;
  taskStatus: Task['status'];
  doneAt?: string;
  /** True when the recorded directory is no longer on disk. */
  missing: boolean;
  /** True when the automatic sweep would remove it on its next pass. */
  stale: boolean;
}

function isStale(task: Task, cutoff: number): boolean {
  if (task.status !== 'done') return false;
  const doneAt = task.doneAt ? Date.parse(task.doneAt) : NaN;
  // A done task with no usable doneAt falls back to updatedAt.
  const at = Number.isNaN(doneAt) ? Date.parse(task.updatedAt) : doneAt;
  return !Number.isNaN(at) && at < cutoff;
}

/** Every worktree Shipyard knows about, with the task that owns it. */
export async function listWorktrees(): Promise<WorktreeInfo[]> {
  const [tasks, projects] = await Promise.all([taskStore.getAllTasks(), getProjects()]);
  const byId = new Map(projects.map(p => [p.id, p]));
  const cutoff = Date.now() - WORKTREE_TTL_DAYS * 24 * 60 * 60 * 1000;

  const out: WorktreeInfo[] = [];
  for (const task of tasks) {
    if (!task.worktreePath) continue;
    out.push({
      path: task.worktreePath,
      branch: task.worktreeBranch,
      projectId: task.projectId,
      projectName: byId.get(task.projectId)?.name,
      taskId: task.id,
      taskNumber: task.number,
      taskTitle: task.title,
      taskStatus: task.status,
      doneAt: task.doneAt,
      missing: !(await exists(task.worktreePath)),
      stale: isStale(task, cutoff),
    });
  }
  return out.sort((a, b) => a.projectId.localeCompare(b.projectId) || (a.taskNumber ?? 0) - (b.taskNumber ?? 0));
}

export interface CleanupResult {
  removed: number;
  orphans: number;
  errors: number;
  /** Left alone by the scheduled sweep because they hold uncommitted work. */
  kept: number;
}

/** Does the worktree still hold changes nobody committed? */
async function hasUncommittedWork(path: string): Promise<boolean> {
  try {
    const status = await gitService.getStatus(path);
    return !status.isClean();
  } catch {
    // Unreadable worktree — treat it as empty so the sweep can clear it.
    return false;
  }
}

/**
 * Sweep worktrees of tasks done more than WORKTREE_TTL_DAYS ago, plus any
 * directory under the base path no task claims any more. `all` drops the age
 * check and removes every worktree of a done task — that is what the manual
 * "Clean worktrees" button asks for.
 */
export async function cleanupWorktrees(options: { all?: boolean } = {}): Promise<CleanupResult> {
  const config = getConfig();
  const [tasks, projects] = await Promise.all([taskStore.getAllTasks(), getProjects()]);
  const byId = new Map(projects.map(p => [p.id, p]));
  const cutoff = Date.now() - WORKTREE_TTL_DAYS * 24 * 60 * 60 * 1000;

  let removed = 0;
  let errors = 0;
  let kept = 0;
  const claimed = new Set<string>();
  const touched = new Set(tasks.filter(t => t.worktreePath).map(t => t.projectId));

  for (const task of tasks) {
    if (!task.worktreePath) continue;
    const sweep = options.all ? task.status === 'done' : isStale(task, cutoff);
    // The scheduled sweep never throws away work nobody committed; the manual
    // clean does, because the user asked for it.
    if (sweep && !options.all && (await hasUncommittedWork(task.worktreePath))) {
      claimed.add(resolve(task.worktreePath).toLowerCase());
      kept++;
      continue;
    }
    if (!sweep) {
      claimed.add(resolve(task.worktreePath).toLowerCase());
      continue;
    }
    if (await removeTaskWorktree(task, { project: byId.get(task.projectId) })) removed++;
    else errors++;
  }

  // Directories left behind by a deleted task or a half-finished create.
  let orphans = 0;
  try {
    const entries = await readdir(config.basePath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(config.basePath, entry.name);
      if (claimed.has(resolve(full).toLowerCase())) continue;
      if (!(await looksLikeTaskWorktree(full))) continue;
      try {
        await rm(full, { recursive: true, force: true });
        orphans++;
      } catch {
        errors++;
      }
    }
  } catch {
    // No base directory yet — nothing to sweep.
  }

  // A repo keeps the record of a worktree until it is told the folder is gone.
  await Promise.all(
    [...touched].map(async id => {
      const project = byId.get(id);
      if (project?.isGitRepo) await gitService.pruneWorktrees(project.path);
    }),
  );

  if (removed || orphans || kept) {
    log.info('git', 'Worktree cleanup', `${removed} removed, ${orphans} orphan folders, ${kept} kept (uncommitted work), ${errors} errors`);
  }
  return { removed, orphans, errors, kept };
}

// -- Scheduled sweep ------------------------------------------------------

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Run the age-based sweep shortly after boot and every six hours. Nothing
 * happens while the setting is off, so the timer costs nothing.
 */
export function startWorktreeCleanup(): void {
  const run = () => {
    if (!getConfig().enabled) return;
    cleanupWorktrees().catch(() => {});
  };
  setTimeout(run, 30_000).unref?.();
  setInterval(run, SWEEP_INTERVAL_MS).unref?.();
}
