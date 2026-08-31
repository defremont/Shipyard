import { nanoid } from 'nanoid';
import type { Task, TaskAttachment, TaskComment } from '../../types/index.js';

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
  effort?: Task['effort'];
  status: Task['status'];
  priority: Task['priority'];
  updatedAt: string;
  // Attachments and comments only ever exist on the remote board, so the
  // remote copy is authoritative. Undefined means "the provider didn't report
  // them this pull" — keep whatever we already had.
  attachments?: TaskAttachment[];
  comments?: TaskComment[];
}

export interface MergeResult {
  merged: Task[];
  created: number;
  updated: number;
  idMapPatch: Record<string, string>; // localTaskId -> remoteId (for newly linked tasks)
}

function normalizeTitle(s: string): string {
  return (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Stable fingerprint of attachments/comments so re-pulling identical data
 *  never reads as a change (which would churn a pull→push loop), while a new
 *  client screenshot, a deleted one, or an edited comment does. Editing a
 *  comment on Trello keeps its id, so the text has to be part of the key. */
function fingerprint(items?: Array<{ id: string; text?: string; url?: string; name?: string }>): string {
  if (!items) return '';
  return items
    .map(i => `${i.id}|${i.text ?? ''}|${i.url ?? ''}|${i.name ?? ''}`)
    .sort()
    .join('\n');
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
  const result: Task[] = localTasks.map(t => ({ ...t }));
  const idMapPatch: Record<string, string> = {};
  let created = 0;
  let updated = 0;

  // Title fallback: when the cardMap is stale (race with a concurrent push,
  // or the user linked to an existing remote board after creating local
  // tasks with matching titles), match remote → local by normalized title
  // before creating a duplicate. Tracks which local ids we've already
  // adopted so two remote items with the same title can't both grab the
  // same local task.
  const titleToLocal = new Map<string, string>();
  for (const t of result) {
    const key = normalizeTitle(t.title);
    if (key && !titleToLocal.has(key)) titleToLocal.set(key, t.id);
  }
  const adoptedLocalIds = new Set<string>();

  for (const r of remote) {
    let localIdx = r.taskId ? result.findIndex(t => t.id === r.taskId) : -1;

    // Title-match fallback when we have no id link or it points to a
    // deleted task. This is what stops the same task from being created
    // twice when push/pull race.
    if (localIdx < 0) {
      const candidate = titleToLocal.get(normalizeTitle(r.title));
      if (candidate && !adoptedLocalIds.has(candidate)) {
        const idx = result.findIndex(t => t.id === candidate);
        if (idx >= 0) {
          localIdx = idx;
          adoptedLocalIds.add(candidate);
          // Record the new link so the caller persists it into cardMap/taskMap.
          // We only emit a patch if the existing link is missing or stale.
          idMapPatch[candidate] = r.remoteId;
        }
      }
    }

    if (localIdx >= 0) {
      const local = result[localIdx];

      // Attachments and comments only ever exist on the board — Shipyard never
      // writes them — so the remote copy always wins, no timestamp gate. Left
      // inside the gate below, a client's new comment would stay invisible
      // whenever a local edit happened to be more recent.
      const remoteMedia: Partial<Task> = {};
      if (r.attachments !== undefined && fingerprint(r.attachments) !== fingerprint(local.attachments)) {
        remoteMedia.attachments = r.attachments;
      }
      if (r.comments !== undefined && fingerprint(r.comments) !== fingerprint(local.comments)) {
        remoteMedia.comments = r.comments;
      }
      const mediaChanged = Object.keys(remoteMedia).length > 0;
      if (mediaChanged) {
        result[localIdx] = { ...local, ...remoteMedia };
        updated++;
      }

      const remoteNewer = new Date(r.updatedAt).getTime() > new Date(local.updatedAt).getTime();
      if (remoteNewer) {
        const fieldsChanged =
          (r.title || local.title) !== local.title ||
          (r.description ?? local.description) !== local.description ||
          (r.prompt ?? local.prompt) !== local.prompt ||
          (r.effort ?? local.effort) !== local.effort ||
          r.status !== local.status ||
          r.priority !== local.priority;
        // Skip when only the remote timestamp moved (our own push bumped
        // Trello's dateLastActivity, no real change). Otherwise we'd churn
        // a pull→push loop every 30s with no actual data change.
        if (fieldsChanged) {
          // Build on result[localIdx], not on `local` — the media merge above
          // may already have written to it.
          const editedByHand = r.effort !== undefined && r.effort !== local.effort;
          result[localIdx] = {
            ...result[localIdx],
            title: r.title || local.title,
            description: r.description ?? local.description,
            prompt: r.prompt ?? local.prompt,
            effort: r.effort ?? local.effort,
            // Only an actual change on the board makes the estimate manual —
            // otherwise every unrelated pull would relabel an AI estimate.
            effortSource: editedByHand ? 'manual' : local.effortSource,
            effortConfidence: editedByHand ? undefined : local.effortConfidence,
            status: r.status,
            priority: r.priority,
            updatedAt: r.updatedAt,
            ...statusTimestamps(local, r.status, r.updatedAt),
          };
          if (!mediaChanged) updated++;
        }
      }
    } else {
      // No link and no title match — treat as a genuinely new remote task
      // (created directly on Trello/ClickUp by the user).
      const now = r.updatedAt || new Date().toISOString();
      const newTask: Task = {
        id: nanoid(10),
        projectId,
        title: r.title,
        description: r.description || '',
        prompt: r.prompt,
        effort: r.effort,
        effortSource: r.effort ? 'manual' : undefined,
        priority: r.priority,
        status: r.status,
        order: result.length,
        createdAt: now,
        updatedAt: now,
        ...(r.attachments?.length ? { attachments: r.attachments } : {}),
        ...(r.comments?.length ? { comments: r.comments } : {}),
        ...(normalizedMilestone ? { milestoneId: normalizedMilestone } : {}),
        ...statusTimestamps(undefined, r.status, now),
      };
      result.push(newTask);
      // Reserve this title so a subsequent remote item with the same title
      // doesn't also grab the same local entry.
      const k = normalizeTitle(newTask.title);
      if (k && !titleToLocal.has(k)) titleToLocal.set(k, newTask.id);
      adoptedLocalIds.add(newTask.id);
      idMapPatch[newTask.id] = r.remoteId;
      created++;
    }
  }

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
