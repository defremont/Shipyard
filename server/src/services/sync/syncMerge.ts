import { nanoid } from 'nanoid';
import type { Task } from '../../types/index.js';

// Bidirectional merge: local tasks vs pulled remote tasks (Trello cards or
// ClickUp tasks, already normalized to PulledTask shape). Strategy:
//   - For each remote task that maps to a local task (via id map): newer
//     updatedAt wins per-field.
//   - Remote tasks without a local counterpart become new local tasks.
//   - Local tasks without a remote counterpart are kept (push will create
//     them next cycle).
//
// We intentionally do not delete local tasks based on absence from the
// remote side — Trello/ClickUp treat "archived" as separate, and we don't
// want a pull to destroy local work.

export interface RemoteTask {
  remoteId: string;
  taskId?: string;
  title: string;
  description: string;
  prompt?: string;
  status: Task['status'];
  priority: Task['priority'];
  updatedAt: string;
}

export interface MergeResult {
  merged: Task[];
  created: number;
  updated: number;
  idMapPatch: Record<string, string>; // localTaskId -> remoteId (for newly linked tasks)
}

export function mergeRemoteIntoLocal(
  localTasks: Task[],
  remote: RemoteTask[],
  projectId: string,
  milestoneId?: string,
): MergeResult {
  // localTasks should already be filtered to the milestone we're syncing —
  // we only stitch the merged result back into that milestone, leaving the
  // rest of the project's tasks untouched. milestoneId is recorded on tasks
  // newly pulled from the remote so they land in the right column.
  const normalizedMilestone = milestoneId && milestoneId !== 'default' ? milestoneId : undefined;
  const byId = new Map(localTasks.map(t => [t.id, t]));
  const result: Task[] = localTasks.map(t => ({ ...t }));
  const idMapPatch: Record<string, string> = {};
  let created = 0;
  let updated = 0;

  for (const r of remote) {
    const localIdx = r.taskId ? result.findIndex(t => t.id === r.taskId) : -1;

    if (localIdx >= 0) {
      const local = result[localIdx];
      const remoteNewer = new Date(r.updatedAt).getTime() > new Date(local.updatedAt).getTime();
      if (remoteNewer) {
        result[localIdx] = {
          ...local,
          title: r.title || local.title,
          description: r.description ?? local.description,
          prompt: r.prompt ?? local.prompt,
          status: r.status,
          priority: r.priority,
          updatedAt: r.updatedAt,
          ...statusTimestamps(local, r.status, r.updatedAt),
        };
        updated++;
      }
    } else {
      // No link — treat as a new remote task (happens when someone creates a
      // card/task directly on Trello/ClickUp).
      const now = r.updatedAt || new Date().toISOString();
      const newTask: Task = {
        id: nanoid(10),
        projectId,
        title: r.title,
        description: r.description || '',
        prompt: r.prompt,
        priority: r.priority,
        status: r.status,
        order: result.length,
        createdAt: now,
        updatedAt: now,
        ...(normalizedMilestone ? { milestoneId: normalizedMilestone } : {}),
        ...statusTimestamps(undefined, r.status, now),
      };
      result.push(newTask);
      idMapPatch[newTask.id] = r.remoteId;
      created++;
    }
  }

  void byId;
  return { merged: result, created, updated, idMapPatch };
}

function statusTimestamps(
  prev: Task | undefined,
  status: Task['status'],
  when: string,
): Pick<Task, 'inboxAt' | 'inProgressAt' | 'doneAt'> {
  const out: Pick<Task, 'inboxAt' | 'inProgressAt' | 'doneAt'> = {
    inboxAt: prev?.inboxAt,
    inProgressAt: prev?.inProgressAt,
    doneAt: prev?.doneAt,
  };
  if (status === 'backlog' || status === 'todo') {
    out.inboxAt = prev?.inboxAt ?? when;
  } else if (status === 'in_progress') {
    out.inboxAt = prev?.inboxAt ?? when;
    out.inProgressAt = prev?.inProgressAt ?? when;
  } else if (status === 'done') {
    out.inboxAt = prev?.inboxAt ?? when;
    out.inProgressAt = prev?.inProgressAt ?? when;
    out.doneAt = prev?.doneAt ?? when;
  }
  return out;
}
