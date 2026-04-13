import { getProjects } from './projectDiscovery.js';
import * as taskStore from './taskStore.js';
import * as gitService from './gitService.js';
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

// Slim task: only fields needed to identify and triage
function slimTask(t: Task) {
  return {
    id: t.id,
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
  if (!task) {
    return { content: [{ type: 'text', text: `Task "${taskId}" not found` }], isError: true };
  }
  // Full task details (this is the tool for getting description/prompt)
  const { id, title, description, priority, status, prompt, milestoneId, createdAt, updatedAt } = task;
  return { content: [{ type: 'text', text: compact({ id, projectId, ...(milestoneId ? { milestoneId } : {}), title, description, priority, status, prompt, createdAt, updatedAt }) }] };
}

export async function createTask(projectId: string, data: {
  title: string;
  description?: string;
  priority?: string;
  status?: string;
  prompt?: string;
  milestoneId?: string;
}): Promise<McpToolResult> {
  const task = await taskStore.createTask(projectId, {
    title: data.title,
    description: data.description || '',
    priority: (data.priority as Task['priority']) || 'medium',
    status: (data.status as Task['status']) || 'todo',
    prompt: data.prompt,
    milestoneId: data.milestoneId,
  });
  // Mutation response: just confirmation
  return { content: [{ type: 'text', text: compact({ ok: true, id: task.id, title: task.title, status: task.status }) }] };
}

export async function updateTask(projectId: string, taskId: string, data: {
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  prompt?: string;
}): Promise<McpToolResult> {
  const updates: any = {};
  if (data.title !== undefined) updates.title = data.title;
  if (data.description !== undefined) updates.description = data.description;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.status !== undefined) updates.status = data.status;
  if (data.prompt !== undefined) updates.prompt = data.prompt;

  const task = await taskStore.updateTask(projectId, taskId, updates);
  if (!task) {
    return { content: [{ type: 'text', text: `Task "${taskId}" not found` }], isError: true };
  }
  // Mutation response: just confirmation
  return { content: [{ type: 'text', text: compact({ ok: true, id: task.id, title: task.title, status: task.status, priority: task.priority }) }] };
}

export async function deleteTask(projectId: string, taskId: string): Promise<McpToolResult> {
  const ok = await taskStore.deleteTask(projectId, taskId);
  if (!ok) {
    return { content: [{ type: 'text', text: `Task "${taskId}" not found` }], isError: true };
  }
  return { content: [{ type: 'text', text: compact({ ok: true, deleted: taskId }) }] };
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

export async function listMilestones(projectId: string): Promise<McpToolResult> {
  const milestones = await taskStore.getMilestones(projectId);
  return { content: [{ type: 'text', text: compact(milestones.map(m => ({ id: m.id, name: m.name, status: m.status }))) }] };
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
  return { content: [{ type: 'text', text: compact({ ok: true, id: updated.id, title: updated.title, status: updated.status }) }] };
}

export async function searchTasks(query: string): Promise<McpToolResult> {
  const all = await taskStore.getAllTasks();
  const q = query.toLowerCase();
  const matched = all.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.description.toLowerCase().includes(q) ||
    (t.prompt && t.prompt.toLowerCase().includes(q))
  );
  // Return slim matches — use get_task for full details
  return { content: [{ type: 'text', text: compact(matched.map(slimTask)) }] };
}

// ── Tool Registry (for MCP protocol) ────────────────────

export const MCP_TOOLS = [
  {
    name: 'list_projects',
    description: 'List all projects (slim: id, name, path, techStack, gitBranch, favorite)',
    inputSchema: { type: 'object' as const, properties: {}, required: [] as string[] },
  },
  {
    name: 'get_project',
    description: 'Get full details of a project including git counters',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: { type: 'string', description: 'The project ID' } },
      required: ['projectId'],
    },
  },
  {
    name: 'list_milestones',
    description: 'List milestones for a project (id, name, status). Default "General" is always included.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks for a project (slim: id, title, status, priority). Use get_task for description/prompt.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        status: { type: 'string', description: 'Filter by status', enum: ['backlog', 'todo', 'in_progress', 'done'] },
        milestoneId: { type: 'string', description: 'Filter by milestone ID (default = General)' },
      },
      required: ['projectId'],
    },
  },
  {
    name: 'get_all_tasks',
    description: 'List all tasks across all projects (slim: id, projectId, title, status, priority). Use get_task for full details.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Filter by status', enum: ['backlog', 'todo', 'in_progress', 'done'] },
      },
      required: [] as string[],
    },
  },
  {
    name: 'get_task',
    description: 'Get full task details including description and prompt (technical notes)',
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
    name: 'create_task',
    description: 'Create a new task in a project',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'What needs to be done' },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'done'] },
        prompt: { type: 'string', description: 'Technical details and implementation notes' },
        milestoneId: { type: 'string', description: 'Milestone ID to assign the task to' },
      },
      required: ['projectId', 'title'],
    },
  },
  {
    name: 'update_task',
    description: 'Update a task (status, title, description, priority, prompt)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        taskId: { type: 'string', description: 'The task ID' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['urgent', 'high', 'medium', 'low'] },
        status: { type: 'string', enum: ['backlog', 'todo', 'in_progress', 'done'] },
        prompt: { type: 'string' },
      },
      required: ['projectId', 'taskId'],
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task',
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
    name: 'get_git_status',
    description: 'Get compact git status: branch, ahead/behind, changed files',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: { type: 'string', description: 'The project ID' } },
      required: ['projectId'],
    },
  },
  {
    name: 'get_git_log',
    description: 'Get recent commits (default 10, compact: hash, message, date, author)',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        limit: { type: 'number', description: 'Max commits to return (default 10)' },
      },
      required: ['projectId'],
    },
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
    description: 'Search tasks by keyword (returns slim results, use get_task for details)',
    inputSchema: {
      type: 'object' as const,
      properties: { query: { type: 'string', description: 'Search query' } },
      required: ['query'],
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
    case 'list_milestones':
      return listMilestones(args.projectId);
    case 'list_tasks':
      return listTasks(args.projectId, args.status, args.milestoneId);
    case 'get_all_tasks':
      return getAllTasks(args.status);
    case 'get_task':
      return getTask(args.projectId, args.taskId);
    case 'create_task':
      return createTask(args.projectId, { title: args.title, description: args.description, priority: args.priority, status: args.status, prompt: args.prompt, milestoneId: args.milestoneId });
    case 'update_task':
      return updateTask(args.projectId, args.taskId, args);
    case 'delete_task':
      return deleteTask(args.projectId, args.taskId);
    case 'get_git_status':
      return getGitStatus(args.projectId);
    case 'get_git_log':
      return getGitLog(args.projectId, args.limit);
    case 'next_task':
      return nextTask(args.projectId, args.milestoneId);
    case 'start_task':
      return startTask(args.projectId, args.taskId);
    case 'log_task_progress':
      return logTaskProgress(args.projectId, args.taskId, args.note);
    case 'complete_task':
      return completeTask(args.projectId, args.taskId, args.summary);
    case 'search_tasks':
      return searchTasks(args.query);
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}
