import { basename, dirname, join } from 'path';
import { readdir, stat } from 'fs/promises';
import type { Milestone, Task } from '../../types/index.js';
import * as taskStore from '../taskStore.js';
import * as syncStore from '../syncStore.js';
import * as deployStore from '../deployStore.js';
import * as aiConfigStore from '../aiConfigStore.js';
import { getSettings, saveSettings } from '../settingsStore.js';
import { addProjects, getProjects, removeProject, updateProject } from '../projectDiscovery.js';

/**
 * What the cloud sync moves, and how each piece maps to a local store.
 *
 * Every record has a key (`task/{project}/{id}`, `settings`, …) and data that
 * must read the same on every machine. Anything tied to one machine — paths,
 * worktrees, when the last Trello push ran — stays out: if it went in, each
 * machine would see the other's value as a change and push it back forever.
 */

export type LocalRecords = Map<string, unknown>;

/** Project as it travels: no path, since each machine keeps it somewhere else. */
export interface ProjectRecord {
  folder: string;
  name: string;
  favorite?: boolean;
  externalLink?: string;
  notes?: string;
  links?: { label: string; url: string }[];
  remote?: string;
}

const SHARED_SETTINGS = ['customAgents', 'defaultAgent', 'terminalAiTitles', 'worktreePerTask'] as const;

function projectRecord(p: Awaited<ReturnType<typeof getProjects>>[number]): ProjectRecord {
  return {
    folder: basename(p.path),
    name: p.name,
    favorite: p.favorite || undefined,
    externalLink: p.externalLink || undefined,
    notes: p.notes || undefined,
    links: p.links?.length ? p.links : undefined,
    remote: p.gitRemoteUrl || undefined,
  };
}

function taskRecord(t: Task): Task {
  const { worktreePath: _p, worktreeBranch: _b, ...rest } = t;
  return rest as Task;
}

function milestoneRecord(m: Milestone): Omit<Milestone, 'projectId'> {
  const { projectId: _id, ...rest } = m;
  return rest;
}

function integrationRecord(c: syncStore.ProjectSyncConfig) {
  const { lastSyncAt: _a, lastSyncStatus: _s, lastSyncError: _e, updatedAt: _u, ...rest } = c;
  return rest;
}

export async function collectLocal(): Promise<LocalRecords> {
  const out: LocalRecords = new Map();

  for (const projectId of await taskStore.listTaskProjectIds()) {
    let file;
    try {
      file = await taskStore.readTasksFileForSync(projectId);
    } catch {
      // A corrupt file must not read as "every task deleted".
      throw new Error(`tasks file for ${projectId} is unreadable; cloud sync paused`);
    }
    for (const t of file.tasks) out.set(`task/${projectId}/${t.id}`, taskRecord(t));
    for (const m of file.milestones || []) out.set(`milestone/${projectId}/${m.id}`, milestoneRecord(m));
  }

  for (const p of await getProjects()) out.set(`project/${p.id}`, projectRecord(p));

  const settings = getSettings() as unknown as Record<string, unknown>;
  const shared: Record<string, unknown> = {};
  for (const k of SHARED_SETTINGS) if (settings[k] !== undefined) shared[k] = settings[k];
  out.set('settings', shared);

  const ai = await aiConfigStore.loadAiConfig();
  out.set('ai', { preferredProvider: ai.preferredProvider, providers: ai.providers });

  out.set('deploy', await deployStore.exportForCloud());

  const sync = await syncStore.exportForCloud();
  for (const [providerId, creds] of Object.entries(sync.providers)) {
    if (creds) out.set(`integration/${providerId}`, creds);
  }
  for (const c of await syncStore.listProjectConfigs()) {
    out.set(`integration/${c.providerId}/${c.projectId}/${c.milestoneId}`, integrationRecord(c));
  }
  return out;
}

/** The record's own clock, for records that carry one. */
export function recordUpdatedAt(data: unknown): number | null {
  const at = (data as { updatedAt?: string } | null)?.updatedAt;
  const t = at ? Date.parse(at) : NaN;
  return Number.isFinite(t) ? t : null;
}

async function isDir(path: string): Promise<boolean> {
  try { return (await stat(path)).isDirectory(); } catch { return false; }
}

/**
 * Find a project another machine added. Projects tend to live side by side,
 * so the folder is looked for next to the ones this machine already has, and
 * one level into their parents (client folders: C:\Code\<client>\<repo>).
 */
async function locate(folder: string): Promise<string | null> {
  const roots = new Set<string>();
  for (const p of getSettings().selectedProjects) {
    roots.add(dirname(p));
    roots.add(dirname(dirname(p)));
  }
  for (const root of roots) {
    const direct = join(root, folder);
    if (await isDir(direct)) return direct;
  }
  for (const root of roots) {
    let entries: string[] = [];
    try { entries = await readdir(root); } catch { continue; }
    for (const entry of entries) {
      if (entry.startsWith('.') || entry === 'node_modules') continue;
      const candidate = join(root, entry, folder);
      if (await isDir(candidate)) return candidate;
    }
  }
  return null;
}

export interface RemoteRecord {
  key: string;
  deleted: boolean;
  data: unknown;
}

/**
 * Write records another machine sent into the local stores. Returns projects
 * this machine does not have a folder for — their tasks are stored anyway and
 * show up as soon as the folder is added.
 */
export async function applyRemote(records: RemoteRecord[]): Promise<{ missing: Record<string, ProjectRecord>; found: string[] }> {
  const byProject = new Map<string, { tasks: Task[]; deletedTasks: string[]; milestones: Milestone[]; deletedMilestones: string[] }>();
  const bucket = (projectId: string) => {
    let b = byProject.get(projectId);
    if (!b) byProject.set(projectId, b = { tasks: [], deletedTasks: [], milestones: [], deletedMilestones: [] });
    return b;
  };
  const projectRecords: Array<{ id: string; deleted: boolean; data: ProjectRecord }> = [];

  for (const r of records) {
    const [kind, a, b, c] = r.key.split('/');
    if (kind === 'task' && a && b) {
      if (r.deleted) bucket(a).deletedTasks.push(b);
      else bucket(a).tasks.push(r.data as Task);
    } else if (kind === 'milestone' && a && b) {
      if (r.deleted) bucket(a).deletedMilestones.push(b);
      else bucket(a).milestones.push(r.data as Milestone);
    } else if (kind === 'project' && a) {
      projectRecords.push({ id: a, deleted: r.deleted, data: r.data as ProjectRecord });
    } else if (kind === 'settings' && !r.deleted) {
      const data = r.data as Record<string, unknown>;
      const next = { ...getSettings() } as unknown as Record<string, unknown>;
      for (const k of SHARED_SETTINGS) {
        if (data[k] === undefined) delete next[k];
        else next[k] = data[k];
      }
      await saveSettings(next as any);
    } else if (kind === 'ai') {
      await aiConfigStore.replaceFromCloud(r.deleted ? { preferredProvider: 'claude', providers: {} } : r.data as any);
    } else if (kind === 'deploy') {
      await deployStore.replaceFromCloud(r.deleted ? { tokens: {}, projects: {} } : r.data as any);
    } else if (kind === 'integration' && a && !b) {
      await syncStore.applyCloudProvider(a as syncStore.SyncProviderId, r.deleted ? null : r.data as any);
    } else if (kind === 'integration' && a && b && c) {
      await syncStore.applyCloudProjectConfig(b, a as syncStore.SyncProviderId, c, r.deleted ? null : r.data as any);
    }
  }

  for (const [projectId, changes] of byProject) {
    await taskStore.applyCloudChanges(projectId, changes);
  }

  const missing: Record<string, ProjectRecord> = {};
  const found: string[] = [];
  if (projectRecords.length > 0) {
    const local = new Map((await getProjects()).map(p => [p.id, p]));
    const toAdd: string[] = [];
    const toUpdate: Array<{ id: string; data: ProjectRecord }> = [];
    for (const { id, deleted, data } of projectRecords) {
      const here = local.get(id);
      if (deleted) {
        if (here) await removeProject(here.path);
        continue;
      }
      if (here) {
        toUpdate.push({ id, data });
        continue;
      }
      const path = await locate(data.folder);
      if (path) {
        toAdd.push(path);
        toUpdate.push({ id, data });
        found.push(id);
      } else {
        missing[id] = data;
      }
    }
    if (toAdd.length > 0) await addProjects(toAdd);
    for (const { id, data } of toUpdate) {
      await updateProject(id, {
        name: data.name,
        favorite: !!data.favorite,
        externalLink: data.externalLink,
        notes: data.notes,
        links: data.links,
      });
    }
  }
  return { missing, found };
}
