import { getProjects, updateProject as updateProjectRecord } from './projectDiscovery.js';
import * as taskStore from './taskStore.js';
import * as gitService from './gitService.js';
import * as syncStore from './syncStore.js';
import * as syncEngine from './sync/syncEngine.js';
import type { Project, Task } from '../types/index.js';

// MCP Tool handlers - optimized for minimal token usage
// Lists return slim summaries; use get_task for full details

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ── Helpers ───────────────────────────────────────────────

// Compact JSON (no indentation = ~30% fewer tokens)
const compact = (obj: any) => JSON.stringify(obj);

const ok = (payload: Record<string, unknown>): McpToolResult =>
  ({ content: [{ type: 'text', text: compact({ ok: true, ...payload }) }] });

const fail = (message: string): McpToolResult =>
  ({ content: [{ type: 'text', text: message }], isError: true });

/**
 * Every task mutation must go through here. The HTTP routes call
 * triggerAutoSync after each write; without the same call an agent working
 * over MCP would leave Trello/ClickUp stale until the user happened to touch
 * a task in the UI.
 */
function afterTaskMutation(projectId: string): void {
  syncEngine.triggerAutoSync(projectId);
}

async function resolveProject(projectId: string): Promise<Project | undefined> {
  const projects = await getProjects();
  return projects.find(p => p.id === projectId);
}

// Slim task: only fields needed to identify and triage
function slimTask(t: Task) {
  return {
    id: t.id,
    ...(t.number ? { number: t.number } : {}),
    projectId: t.projectId,
    ...(t.milestoneId ? { milestoneId: t.milestoneId } : {}),
    title: t.title,
    status: t.status,
    priority: t.priority,
    order: t.order,
  };
}

// Slim project: essentials only
function slimProject(p: Project) {
  return {
    id: p.id,
    name: p.name,
    path: p.path,
    techStack: p.techStack,
    gitBranch: p.gitBranch,
    favorite: p.favorite,
  };
}

// ── Tool Implementations ────────────────────────────────

export async function listProjects(): Promise<McpToolResult> {
  const projects = await getProjects();
  return { content: [{ type: 'text', text: compact(projects.map(slimProject)) }] };
}

export async function getProject(projectId: string): Promise<McpToolResult> {
  const projects = await getProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) {
    return { content: [{ type: 'text', text: `Project "${projectId}" not found` }], isError: true };
  }
  // Full project but compact JSON
  const { id, name, path, category, techStack, gitBranch, gitDirty, gitAhead, gitBehind, gitStaged, gitUnstaged, gitUntracked, lastCommitMessage, favorite, externalLink } = project;
  return { content: [{ type: 'text', text: compact({ id, name, path, category, techStack, gitBranch, gitDirty, gitAhead, gitBehind, gitStaged, gitUnstaged, gitUntracked, lastCommitMessage, favorite, externalLink }) }] };
}

export async function listTasks(projectId: string, status?: string, milestoneId?: string): Promise<McpToolResult> {
  const tasks = await taskStore.getTasks(projectId, milestoneId);
  const filtered = status ? tasks.filter(t => t.status === status) : tasks;
  // Slim list — use get_task for description/prompt
  return { content: [{ type: 'text', text: compact(filtered.map(slimTask)) }] };
}

export async function getAllTasks(status?: string): Promise<McpToolResult> {
  const tasks = await taskStore.getAllTasks();
  const filtered = status ? tasks.filter(t => t.status === status) : tasks;
  return { content: [{ type: 'text', text: compact(filtered.map(slimTask)) }] };
}

export async function getTask(projectId: string, taskId: string): Promise<McpToolResult> {
  const task = await taskStore.getTask(projectId, taskId);
  if (!task) return fail(`Task "${taskId}" not found`);
  // Full task details (this is the tool for getting description/prompt)
  const { id, number, title, description, priority, status, prompt, milestoneId, createdAt, updatedAt, inboxAt, inProgressAt, doneAt, subtasks } = task;
  return { content: [{ type: 'text', text: compact({
    id, number, projectId, ...(milestoneId ? { milestoneId } : {}),
    title, description, priority, status, prompt,
    createdAt, updatedAt, inboxAt, inProgressAt, doneAt,
    ...(subtasks?.length ? { subtasks } : {}),
  }) }] };
}

interface TaskInput {
  title: string;
  description?: string;
  priority?: string;
  status?: string;
  prompt?: string;
  milestoneId?: string;
}

export async function createTask(projectId: string, data: TaskInput): Promise<McpToolResult> {
  const task = await taskStore.createTask(projectId, {
    title: data.title,
    description: data.description || '',
    priority: (data.priority as Task['priority']) || 'medium',
    status: (data.status as Task['status']) || 'todo',
    prompt: data.prompt,
    milestoneId: data.milestoneId,
  });
  afterTaskMutation(projectId);
  return ok({ id: task.id, number: task.number, title: task.title, status: task.status });
}

/**
 * Create many tasks in one locked write. Creating them one at a time costs a
 * read-modify-write per task and fires a sync push per call; this does both
 * once.
 */
export async function createTasks(projectId: string, tasks: TaskInput[], milestoneId?: string): Promise<McpToolResult> {
  if (!Array.isArray(tasks) || tasks.length === 0) return fail('tasks must be a non-empty array');
  const created = await taskStore.importTasks(projectId, tasks.map(t => ({
    title: t.title,
    description: t.description || '',
    priority: (t.priority as Task['priority']) || 'medium',
    status: (t.status as Task['status']) || 'todo',
    prompt: t.prompt,
    milestoneId: t.milestoneId ?? milestoneId,
  })));
  afterTaskMutation(projectId);
  return ok({ created });
}

export async function updateTask(projectId: string, taskId: string, data: {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  prompt?: string;
  milestoneId?: string;
}): Promise<McpToolResult> {
  const updates: Partial<Task> = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.priority !== undefined) updates.priority = data.priority as Task['priority'];
  if (data.status !== undefined) updates.status = data.status as Task['status'];
  if (data.prompt !== undefined) updates.prompt = data.prompt;
  // 'default' is the virtual General milestone — stored as an absent field.
  if (data.milestoneId !== undefined) {
    updates.milestoneId = data.milestoneId === 'default' ? undefined : data.milestoneId;
  }

  const task = await taskStore.updateTask(projectId, taskId, updates);
  if (!task) return fail(`Task "${taskId}" not found`);
  afterTaskMutation(projectId);
  return ok({ id: task.id, title: task.title, status: task.status, priority: task.priority, milestoneId: task.milestoneId ?? 'default' });
}

export async function bulkUpdateTasks(projectId: string, taskIds: string[], data: {
  status?: string;
  priority?: string;
  milestoneId?: string;
}): Promise<McpToolResult> {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return fail('taskIds must be a non-empty array');
  const updates: Partial<Task> = {};
  if (data.status !== undefined) updates.status = data.status as Task['status'];
  if (data.priority !== undefined) updates.priority = data.priority as Task['priority'];
  if (data.milestoneId !== undefined) {
    updates.milestoneId = data.milestoneId === 'default' ? undefined : data.milestoneId;
  }
  if (Object.keys(updates).length === 0) return fail('Nothing to update — pass status, priority or milestoneId');

  const result = await taskStore.bulkUpdateTasks(projectId, taskIds, updates);
  afterTaskMutation(projectId);
  return ok(result);
}

export async function bulkDeleteTasks(projectId: string, taskIds: string[]): Promise<McpToolResult> {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return fail('taskIds must be a non-empty array');
  const result = await taskStore.bulkDeleteTasks(projectId, taskIds);
  afterTaskMutation(projectId);
  return ok(result);
}

export async function reorderTasks(projectId: string, taskIds: string[]): Promise<McpToolResult> {
  if (!Array.isArray(taskIds) || taskIds.length === 0) return fail('taskIds must be a non-empty array');
  const tasks = await taskStore.reorderTasks(projectId, taskIds);
  afterTaskMutation(projectId);
  return ok({ reordered: taskIds.length, total: tasks.length });
}

export async function deleteTask(projectId: string, taskId: string): Promise<McpToolResult> {
  const deleted = await taskStore.deleteTask(projectId, taskId);
  if (!deleted) return fail(`Task "${taskId}" not found`);
  afterTaskMutation(projectId);
  return ok({ deleted: taskId });
}

export async function getGitStatus(projectId: string): Promise<McpToolResult> {
  const projects = await getProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project || !project.isGitRepo) {
    return { content: [{ type: 'text', text: 'Not a git repository' }], isError: true };
  }
  try {
    const s = await gitService.getStatus(project.path);
    // Compact summary instead of full StatusResult
    const summary = {
      branch: s.current,
      tracking: s.tracking || null,
      ahead: s.ahead,
      behind: s.behind,
      staged: s.staged.length > 0 ? s.staged : undefined,
      modified: s.modified.length > 0 ? s.modified : undefined,
      not_added: s.not_added.length > 0 ? s.not_added : undefined,
      created: s.created.length > 0 ? s.created : undefined,
      deleted: s.deleted.length > 0 ? s.deleted : undefined,
      conflicted: s.conflicted.length > 0 ? s.conflicted : undefined,
      isClean: s.isClean(),
    };
    return { content: [{ type: 'text', text: compact(summary) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: err.message }], isError: true };
  }
}

export async function getGitLog(projectId: string, limit?: number): Promise<McpToolResult> {
  const projects = await getProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project || !project.isGitRepo) {
    return { content: [{ type: 'text', text: 'Not a git repository' }], isError: true };
  }
  try {
    const log = await gitService.getLog(project.path, limit || 10);
    // Compact: only hash(7), message, date, author
    const commits = log.all.map(c => ({
      hash: c.hash.slice(0, 7),
      message: c.message,
      date: c.date,
      author: c.author_name,
    }));
    return { content: [{ type: 'text', text: compact(commits) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: err.message }], isError: true };
  }
}

export async function getGitDiff(projectId: string, file?: string, staged?: boolean): Promise<McpToolResult> {
  const project = await resolveProject(projectId);
  if (!project?.isGitRepo) return fail('Not a git repository');
  try {
    const diff = await gitService.getDiff(project.path, file, staged ?? false);
    return { content: [{ type: 'text', text: diff || '(no changes)' }] };
  } catch (err: any) {
    return fail(err.message);
  }
}

export async function updateProject(projectId: string, data: {
  name?: string;
  favorite?: boolean;
  externalLink?: string;
}): Promise<McpToolResult> {
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.favorite !== undefined) updates.favorite = data.favorite;
  if (data.externalLink !== undefined) updates.externalLink = data.externalLink;
  if (Object.keys(updates).length === 0) return fail('Nothing to update');

  const project = await updateProjectRecord(projectId, updates);
  if (!project) return fail(`Project "${projectId}" not found`);
  return ok({ id: project.id, name: project.name, favorite: project.favorite });
}

// ── Milestones ──────────────────────────────────────────

export async function listMilestones(projectId: string): Promise<McpToolResult> {
  const [milestones, tasks] = await Promise.all([
    taskStore.getMilestones(projectId),
    taskStore.getTasks(projectId),
  ]);
  // Task counts turn this into a one-call project overview, so an agent can
  // pick a milestone without a follow-up list_tasks per milestone.
  return { content: [{ type: 'text', text: compact(milestones.map(m => {
    const own = tasks.filter(t => (t.milestoneId ?? 'default') === m.id);
    return {
      id: m.id,
      name: m.name,
      status: m.status,
      ...(m.description ? { description: m.description } : {}),
      tasks: {
        total: own.length,
        todo: own.filter(t => t.status === 'todo').length,
        in_progress: own.filter(t => t.status === 'in_progress').length,
        done: own.filter(t => t.status === 'done').length,
        backlog: own.filter(t => t.status === 'backlog').length,
      },
    };
  })) }] };
}

export async function createMilestone(projectId: string, name: string, description?: string): Promise<McpToolResult> {
  if (!name?.trim()) return fail('name is required');
  const milestone = await taskStore.createMilestone(projectId, { name, description });
  return ok({ id: milestone.id, name: milestone.name, status: milestone.status });
}

export async function updateMilestone(projectId: string, milestoneId: string, data: {
  name?: string;
  description?: string;
  status?: 'active' | 'closed';
}): Promise<McpToolResult> {
  if (milestoneId === 'default') return fail('The "General" milestone cannot be edited');
  const milestone = await taskStore.updateMilestone(projectId, milestoneId, data);
  if (!milestone) return fail(`Milestone "${milestoneId}" not found`);
  return ok({ id: milestone.id, name: milestone.name, status: milestone.status });
}

export async function deleteMilestone(projectId: string, milestoneId: string): Promise<McpToolResult> {
  if (milestoneId === 'default') return fail('The "General" milestone cannot be deleted');
  const deleted = await taskStore.deleteMilestone(projectId, milestoneId);
  if (!deleted) return fail(`Milestone "${milestoneId}" not found`);
  afterTaskMutation(projectId); // its tasks moved to General
  return ok({ deleted: milestoneId, note: 'Tasks were moved to the General milestone' });
}

// ── Sync (Trello / ClickUp) ─────────────────────────────

export async function listSyncIntegrations(projectId: string): Promise<McpToolResult> {
  const configs = await syncStore.listProjectConfigs(projectId);
  return { content: [{ type: 'text', text: compact(configs.map(c => ({
    providerId: c.providerId,
    milestoneId: c.milestoneId,
    enabled: c.enabled,
    lastSyncAt: c.lastSyncAt,
    lastSyncStatus: c.lastSyncStatus,
    ...(c.lastSyncError ? { lastSyncError: c.lastSyncError } : {}),
    remoteUrl: c.state?.boardUrl ?? c.state?.listUrl ?? null,
  }))) }] };
}

function isProviderId(value: string): value is syncStore.SyncProviderId {
  return value === 'trello' || value === 'clickup';
}

export async function syncPush(projectId: string, providerId: string, milestoneId?: string): Promise<McpToolResult> {
  if (!isProviderId(providerId)) return fail(`Unknown provider "${providerId}" — use trello or clickup`);
  const result = await syncEngine.pushAll(projectId, providerId, milestoneId);
  if (!result.success) return fail(result.message);
  return ok({ pushed: result.pushed, milestoneId: result.milestoneId, remoteUrl: result.remoteUrl });
}

export async function syncPull(projectId: string, providerId: string, milestoneId?: string): Promise<McpToolResult> {
  if (!isProviderId(providerId)) return fail(`Unknown provider "${providerId}" — use trello or clickup`);
  const result = await syncEngine.pullAll(projectId, providerId, milestoneId);
  if (!result.success) return fail(result.message);
  return ok({ pulled: result.pulled, created: result.created, updated: result.updated, milestoneId: result.milestoneId });
}

// ── Agent Loop Tools ────────────────────────────────────
// These tools encode the typical "what do I work on → start → progress → done"
// loop so any CLI agent can drive task state in a few atomic calls.

const PRIORITY_RANK: Record<Task['priority'], number> = { urgent: 0, high: 1, medium: 2, low: 3 };

export async function nextTask(projectId?: string, milestoneId?: string): Promise<McpToolResult> {
  const tasks = projectId
    ? await taskStore.getTasks(projectId, milestoneId)
    : await taskStore.getAllTasks();
  const ready = tasks
    .filter(t => t.status === 'in_progress' || t.status === 'todo')
    .sort((a, b) => {
      // in_progress first, then todo; then by priority; then by order
      if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
      const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
      if (p !== 0) return p;
      return a.order - b.order;
    });
  if (ready.length === 0) {
    return { content: [{ type: 'text', text: compact({ ok: true, task: null, message: 'No ready tasks' }) }] };
  }
  const t = ready[0];
  return {
    content: [{
      type: 'text',
      text: compact({
        ok: true,
        task: {
          id: t.id,
          projectId: t.projectId,
          ...(t.milestoneId ? { milestoneId: t.milestoneId } : {}),
          title: t.title,
          description: t.description,
          prompt: t.prompt,
          status: t.status,
          priority: t.priority,
        },
      }),
    }],
  };
}

export async function startTask(projectId: string, taskId: string): Promise<McpToolResult> {
  const existing = await taskStore.getTask(projectId, taskId);
  if (!existing) {
    return { content: [{ type: 'text', text: `Task "${taskId}" not found` }], isError: true };
  }
  const updated = await taskStore.updateTask(projectId, taskId, { status: 'in_progress' });
  if (!updated) {
    return { content: [{ type: 'text', text: `Failed to start task "${taskId}"` }], isError: true };
  }
  afterTaskMutation(projectId);
  return {
    content: [{
      type: 'text',
      text: compact({
        ok: true,
        task: {
          id: updated.id,
          projectId: updated.projectId,
          title: updated.title,
          description: updated.description,
          prompt: updated.prompt,
          status: updated.status,
          priority: updated.priority,
        },
      }),
    }],
  };
}

function appendPromptSection(existing: string | undefined, header: string, body: string): string {
  const base = (existing || '').trimEnd();
  const section = `${header}\n${body.trim()}`;
  return base ? `${base}\n\n${section}` : section;
}

export async function logTaskProgress(projectId: string, taskId: string, note: string): Promise<McpToolResult> {
  const existing = await taskStore.getTask(projectId, taskId);
  if (!existing) {
    return { content: [{ type: 'text', text: `Task "${taskId}" not found` }], isError: true };
  }
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const nextPrompt = appendPromptSection(existing.prompt, `— Note ${ts}`, note);
  const updated = await taskStore.updateTask(projectId, taskId, { prompt: nextPrompt });
  if (!updated) {
    return { content: [{ type: 'text', text: `Failed to log progress for "${taskId}"` }], isError: true };
  }
  afterTaskMutation(projectId);
  return { content: [{ type: 'text', text: compact({ ok: true, id: updated.id, promptLength: nextPrompt.length }) }] };
}

export async function completeTask(projectId: string, taskId: string, summary?: string): Promise<McpToolResult> {
  const existing = await taskStore.getTask(projectId, taskId);
  if (!existing) {
    return { content: [{ type: 'text', text: `Task "${taskId}" not found` }], isError: true };
  }
  const nextPrompt = summary
    ? appendPromptSection(existing.prompt, '— Summary', summary)
    : existing.prompt;
  const updated = await taskStore.updateTask(projectId, taskId, {
    status: 'done',
    ...(summary ? { prompt: nextPrompt } : {}),
  });
  if (!updated) {
    return { content: [{ type: 'text', text: `Failed to complete task "${taskId}"` }], isError: true };
  }
  afterTaskMutation(projectId);
  return { content: [{ type: 'text', text: compact({ ok: true, id: updated.id, title: updated.title, status: updated.status, doneAt: updated.doneAt }) }] };
}

export async function searchTasks(query: string, projectId?: string, status?: string): Promise<McpToolResult> {
  const all = projectId ? await taskStore.getTasks(projectId) : await taskStore.getAllTasks();
  const q = query.toLowerCase();
  const matched = all.filter(t =>
    (!status || t.status === status) && (
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (t.prompt && t.prompt.toLowerCase().includes(q))
    )
  );
  // Return slim matches — use get_task for full details
  return { content: [{ type: 'text', text: compact(matched.map(slimTask)) }] };
}

// ── Tool Registry (for MCP protocol) ────────────────────

const PROJECT_ID = { type: 'string', description: 'The project ID' } as const;
const TASK_ID = { type: 'string', description: 'The task ID' } as const;
const MILESTONE_ID = { type: 'string', description: 'Milestone ID. Use "default" for the virtual "General" milestone.' } as const;
const STATUS = { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'done'] } as const;
const PRIORITY = { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] } as const;
const PROVIDER_ID = { type: 'string', enum: ['trello', 'clickup'], description: 'Sync provider' } as const;

const readOnly = { readOnlyHint: true } as const;
const destructive = { destructiveHint: true } as const;

export const MCP_TOOLS = [
  {
    name: 'list_projects',
    description: 'List all projects (slim: id, name, path, techStack, gitBranch, favorite)',
    inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
    annotations: readOnly,
  },
  {
    name: 'get_project',
    description: 'Get full details of a project including git counters',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: PROJECT_ID },
      required: ['projectId'],
    },
    annotations: readOnly,
  },
  {
    name: 'update_project',
    description: 'Update project metadata: display name, favorite flag, or external link.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        name: { type: 'string', description: 'Display name' },
        favorite: { type: 'boolean' },
        externalLink: { type: 'string', description: 'URL shown on the project card' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_milestones',
    description: 'List a project\'s milestones with per-status task counts. The virtual "General" milestone (id "default") is always first. Call this before creating tasks so they land in the right milestone.',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: PROJECT_ID },
      required: ['projectId'],
    },
    annotations: readOnly,
  },
  {
    name: 'create_milestone',
    description: 'Create a milestone. Each milestone syncs to its own Trello board / ClickUp list.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        name: { type: 'string', description: 'Milestone name' },
        description: { type: 'string' },
      },
      required: ['projectId', 'name'],
    },
  },
  {
    name: 'update_milestone',
    description: 'Rename a milestone, change its description, or close it (status "closed"). The "General" milestone cannot be edited.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        milestoneId: MILESTONE_ID,
        name: { type: 'string' },
        description: { type: 'string' },
        status: { type: 'string', enum: ['active', 'closed'] },
      },
      required: ['projectId', 'milestoneId'],
    },
  },
  {
    name: 'delete_milestone',
    description: 'Delete a milestone. Its tasks are moved to "General", not deleted. The "General" milestone cannot be deleted.',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: PROJECT_ID, milestoneId: MILESTONE_ID },
      required: ['projectId', 'milestoneId'],
    },
    annotations: destructive,
  },
  {
    name: 'list_tasks',
    description: 'List tasks for a project (slim: id, number, title, status, priority). Use get_task for description/prompt.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        status: { ...STATUS, description: 'Filter by status' },
        milestoneId: MILESTONE_ID,
      },
      required: ['projectId'],
    },
    annotations: readOnly,
  },
  {
    name: 'get_all_tasks',
    description: 'List all tasks across all projects (slim: id, number, projectId, title, status, priority). Use get_task for full details.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { ...STATUS, description: 'Filter by status' },
      },
      required: [] as string[],
    },
    annotations: readOnly,
  },
  {
    name: 'get_task',
    description: 'Get full task details: description, prompt (technical notes), subtasks and the status timestamps (inboxAt/inProgressAt/doneAt).',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: PROJECT_ID, taskId: TASK_ID },
      required: ['projectId', 'taskId'],
    },
    annotations: readOnly,
  },
  {
    name: 'create_task',
    description: 'Create a new task. "description" is what to do (user-facing); "prompt" holds the technical analysis. To create several at once, prefer create_tasks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'What needs to be done, from the user/product point of view' },
        priority: PRIORITY,
        status: STATUS,
        prompt: { type: 'string', description: 'Technical details and implementation notes' },
        milestoneId: MILESTONE_ID,
      },
      required: ['projectId', 'title'],
    },
  },
  {
    name: 'create_tasks',
    description: 'Create many tasks in one atomic write. Much cheaper than repeated create_task calls and triggers a single sync push.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        milestoneId: { ...MILESTONE_ID, description: 'Default milestone for every task that does not set its own' },
        tasks: {
          type: 'array',
          description: 'Tasks to create',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: PRIORITY,
              status: STATUS,
              prompt: { type: 'string' },
              milestoneId: MILESTONE_ID,
            },
            required: ['title'],
          },
        },
      },
      required: ['projectId', 'tasks'],
    },
  },
  {
    name: 'update_task',
    description: 'Update a task: status, title, description, priority, prompt, or move it to another milestone.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        taskId: TASK_ID,
        title: { type: 'string' },
        description: { type: 'string' },
        priority: PRIORITY,
        status: STATUS,
        prompt: { type: 'string' },
        milestoneId: { ...MILESTONE_ID, description: 'Move the task to this milestone. "default" moves it to General.' },
      },
      required: ['projectId', 'taskId'],
    },
  },
  {
    name: 'bulk_update_tasks',
    description: 'Apply the same status, priority and/or milestone to many tasks in one atomic write. Use for column-level actions like "move everything in backlog to todo".',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Task IDs to update' },
        status: STATUS,
        priority: PRIORITY,
        milestoneId: MILESTONE_ID,
      },
      required: ['projectId', 'taskIds'],
    },
  },
  {
    name: 'bulk_delete_tasks',
    description: 'Delete many tasks in one atomic write.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Task IDs to delete' },
      },
      required: ['projectId', 'taskIds'],
    },
    annotations: destructive,
  },
  {
    name: 'reorder_tasks',
    description: 'Set the kanban order of tasks. Pass task IDs in the desired order; tasks left out keep their relative order at the end.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        taskIds: { type: 'array', items: { type: 'string' }, description: 'Task IDs in the desired order' },
      },
      required: ['projectId', 'taskIds'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: PROJECT_ID, taskId: TASK_ID },
      required: ['projectId', 'taskId'],
    },
    annotations: destructive,
  },
  {
    name: 'get_git_status',
    description: 'Get compact git status: branch, ahead/behind, changed files',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: PROJECT_ID },
      required: ['projectId'],
    },
    annotations: readOnly,
  },
  {
    name: 'get_git_log',
    description: 'Get recent commits (default 10, compact: hash, message, date, author)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        limit: { type: 'number', description: 'Max commits to return (default 10)' },
      },
      required: ['projectId'],
    },
    annotations: readOnly,
  },
  {
    name: 'get_git_diff',
    description: 'Get the working-tree diff for a project, optionally for a single file or for staged changes only.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: PROJECT_ID,
        file: { type: 'string', description: 'Limit the diff to this path' },
        staged: { type: 'boolean', description: 'Diff the staging area instead of the working tree' },
      },
      required: ['projectId'],
    },
    annotations: readOnly,
  },
  {
    name: 'next_task',
    description: 'Return the highest-priority ready task (in_progress or todo, ranked by status → priority → order). Ideal first call for any agent loop. Returns full task with description and prompt.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Optional: restrict to a single project' },
        milestoneId: { type: 'string', description: 'Optional: restrict to a milestone (requires projectId)' },
      },
      required: [] as string[],
    },
  },
  {
    name: 'start_task',
    description: 'Move a task to in_progress and return its full content (title, description, prompt). Use this as step 1 when an agent begins work — replaces update_task for this common case.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        taskId: { type: 'string', description: 'The task ID' },
      },
      required: ['projectId', 'taskId'],
    },
  },
  {
    name: 'log_task_progress',
    description: 'Append a timestamped note to the task prompt without changing status. Use during long work to keep a running log (files touched, decisions made, blockers).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        taskId: { type: 'string', description: 'The task ID' },
        note: { type: 'string', description: 'Progress note to append' },
      },
      required: ['projectId', 'taskId', 'note'],
    },
  },
  {
    name: 'complete_task',
    description: 'Move a task to done and optionally append an implementation summary to the prompt. Use this as the final call when the agent finishes work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        taskId: { type: 'string', description: 'The task ID' },
        summary: { type: 'string', description: 'Optional summary of what was implemented' },
      },
      required: ['projectId', 'taskId'],
    },
  },
  {
    name: 'search_tasks',
    description: 'Search tasks by keyword across title, description and prompt (returns slim results, use get_task for details)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        projectId: { ...PROJECT_ID, description: 'Optional: restrict to a single project' },
        status: { ...STATUS, description: 'Optional: restrict to one status' },
      },
      required: ['query'],
    },
    annotations: readOnly,
  },
  {
    name: 'list_sync_integrations',
    description: 'List the Trello/ClickUp integrations configured for a project — one per milestone — with their last sync status and remote board URL.',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: PROJECT_ID },
      required: ['projectId'],
    },
    annotations: readOnly,
  },
  {
    name: 'sync_push',
    description: 'Push a milestone\'s tasks to its remote board now. Task mutations already schedule a push automatically; use this only to force an immediate sync.',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: PROJECT_ID, providerId: PROVIDER_ID, milestoneId: MILESTONE_ID },
      required: ['projectId', 'providerId'],
    },
  },
  {
    name: 'sync_pull',
    description: 'Pull remote changes (cards moved or edited on Trello/ClickUp) into the local tasks of one milestone.',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: PROJECT_ID, providerId: PROVIDER_ID, milestoneId: MILESTONE_ID },
      required: ['projectId', 'providerId'],
    },
  },
];

// ── Tool Dispatcher ─────────────────────────────────────

export async function handleToolCall(name: string, args: Record<string, any>): Promise<McpToolResult> {
  switch (name) {
    case 'list_projects':
      return listProjects();
    case 'get_project':
      return getProject(args.projectId);
    case 'update_project':
      return updateProject(args.projectId, args);
    case 'list_milestones':
      return listMilestones(args.projectId);
    case 'create_milestone':
      return createMilestone(args.projectId, args.name, args.description);
    case 'update_milestone':
      return updateMilestone(args.projectId, args.milestoneId, args);
    case 'delete_milestone':
      return deleteMilestone(args.projectId, args.milestoneId);
    case 'list_tasks':
      return listTasks(args.projectId, args.status, args.milestoneId);
    case 'get_all_tasks':
      return getAllTasks(args.status);
    case 'get_task':
      return getTask(args.projectId, args.taskId);
    case 'create_task':
      return createTask(args.projectId, { title: args.title, description: args.description, priority: args.priority, status: args.status, prompt: args.prompt, milestoneId: args.milestoneId });
    case 'create_tasks':
      return createTasks(args.projectId, args.tasks, args.milestoneId);
    case 'update_task':
      return updateTask(args.projectId, args.taskId, args);
    case 'bulk_update_tasks':
      return bulkUpdateTasks(args.projectId, args.taskIds, args);
    case 'bulk_delete_tasks':
      return bulkDeleteTasks(args.projectId, args.taskIds);
    case 'reorder_tasks':
      return reorderTasks(args.projectId, args.taskIds);
    case 'delete_task':
      return deleteTask(args.projectId, args.taskId);
    case 'get_git_status':
      return getGitStatus(args.projectId);
    case 'get_git_log':
      return getGitLog(args.projectId, args.limit);
    case 'get_git_diff':
      return getGitDiff(args.projectId, args.file, args.staged);
    case 'next_task':
      return nextTask(args.projectId, args.milestoneId);
    case 'start_task':
      return startTask(args.projectId, args.taskId);
    case 'log_task_progress':
      return logTaskProgress(args.projectId, args.taskId, args.note);
    case 'complete_task':
      return completeTask(args.projectId, args.taskId, args.summary);
    case 'search_tasks':
      return searchTasks(args.query, args.projectId, args.status);
    case 'list_sync_integrations':
      return listSyncIntegrations(args.projectId);
    case 'sync_push':
      return syncPush(args.projectId, args.providerId, args.milestoneId);
    case 'sync_pull':
      return syncPull(args.projectId, args.providerId, args.milestoneId);
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}
