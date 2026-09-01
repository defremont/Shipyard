import { FastifyInstance } from 'fastify';
import * as taskStore from '../services/taskStore.js';
import { getProjects } from '../services/projectDiscovery.js';
import { buildAiResolvePrompt } from '../services/aiResolvePrompt.js';
import { buildAiManagePrompt } from '../services/aiManagePrompt.js';
import * as log from '../services/logService.js';
import { triggerAutoSync } from '../services/sync/syncEngine.js';
import { buildTaskForecast } from '../services/taskForecast.js';
import * as worktreeService from '../services/worktreeService.js';

let forecastHistoryCache: { tasks: Awaited<ReturnType<typeof taskStore.getAllTasks>>; expiresAt: number } | null = null;

const EFFORT_POINTS = new Set([1, 2, 3, 5, 8]);
function validEffort(value: unknown): value is 1 | 2 | 3 | 5 | 8 {
  return typeof value === 'number' && EFFORT_POINTS.has(value);
}
/** The client may send a subtask still being typed; keep only well-formed entries. */
function sanitizeSubtasks(input: unknown): { subtasks: { id: string; title: string; done: boolean }[] } | null {
  if (!Array.isArray(input)) return null;
  const subtasks = input
    .filter((s): s is { id?: string; title: string; done?: boolean } => !!s && typeof s.title === 'string' && s.title.trim().length > 0)
    .map(s => ({
      id: typeof s.id === 'string' && s.id ? s.id : Math.random().toString(36).slice(2, 12),
      title: s.title.trim(),
      done: s.done === true,
    }));
  return subtasks.length > 0 ? { subtasks } : null;
}

async function getForecastHistory() {
  const now = Date.now();
  if (forecastHistoryCache && forecastHistoryCache.expiresAt > now) return forecastHistoryCache.tasks;
  const tasks = await taskStore.getAllTasks();
  forecastHistoryCache = { tasks, expiresAt: now + 60_000 };
  return tasks;
}

function afterTaskMutation(projectId: string) {
  forecastHistoryCache = null;
  triggerAutoSync(projectId);
}

export async function taskRoutes(app: FastifyInstance) {
  // All tasks across all projects
  app.get('/api/tasks/all', async () => {
    const tasks = await taskStore.getAllTasks();
    // This reads every project's task file and is polled app-wide, so the
    // Trello comment bodies stay out of it — the lists only ever draw a count,
    // and the task dialog reads the full copy from the project's own query.
    return {
      tasks: tasks.map(({ comments, attachments, ...task }) => ({
        ...task,
        ...(comments?.length ? { commentCount: comments.length } : {}),
        ...(attachments?.length ? { attachmentCount: attachments.length } : {}),
      })),
    };
  });

  // ── Milestone CRUD ──────────────────────────────
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/milestones',
    async (request) => {
      const milestones = await taskStore.getMilestones(request.params.projectId);
      return { milestones };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { name: string; description?: string } }>(
    '/api/projects/:projectId/milestones',
    async (request) => {
      const milestone = await taskStore.createMilestone(request.params.projectId, {
        name: request.body.name,
        description: request.body.description,
      });
      return milestone;
    }
  );

  app.put<{ Params: { projectId: string; milestoneId: string }; Body: { name?: string; description?: string; status?: string } }>(
    '/api/projects/:projectId/milestones/:milestoneId',
    async (request, reply) => {
      const milestone = await taskStore.updateMilestone(
        request.params.projectId,
        request.params.milestoneId,
        request.body as any,
      );
      if (!milestone) return reply.status(404).send({ error: 'Milestone not found' });
      return milestone;
    }
  );

  app.delete<{ Params: { projectId: string; milestoneId: string } }>(
    '/api/projects/:projectId/milestones/:milestoneId',
    async (request, reply) => {
      const deleted = await taskStore.deleteMilestone(request.params.projectId, request.params.milestoneId);
      if (!deleted) return reply.status(404).send({ error: 'Milestone not found' });
      return { success: true };
    }
  );

  // ── Tasks ───────────────────────────────────────

  app.get<{ Params: { projectId: string }; Querystring: { milestone?: string } }>(
    '/api/projects/:projectId/tasks',
    async (request) => {
      const tasks = await taskStore.getTasks(request.params.projectId, request.query.milestone);
      return { tasks };
    }
  );

  // Computed on demand: every status transition automatically improves the model.
  app.get<{ Params: { projectId: string }; Querystring: { milestone?: string } }>(
    '/api/projects/:projectId/tasks/forecast',
    async (request) => {
      const [projectTasks, historyTasks] = await Promise.all([
        taskStore.getTasks(request.params.projectId),
        getForecastHistory(),
      ]);
      const milestone = request.query.milestone;
      const scopedTasks = !milestone
        ? projectTasks
        : milestone === 'default'
          ? projectTasks.filter(task => !task.milestoneId || task.milestoneId === 'default')
          : projectTasks.filter(task => task.milestoneId === milestone);
      return buildTaskForecast(historyTasks, request.params.projectId, scopedTasks);
    }
  );

  app.post<{
    Params: { projectId: string };
    Body: { assignments: Array<{ taskId: string; effort: number; confidence?: 'low' | 'medium' | 'high' }> };
  }>('/api/projects/:projectId/tasks/effort/apply', async (request, reply) => {
    const assignments = request.body?.assignments || [];
    if (assignments.some(item => !validEffort(item.effort))) {
      return reply.status(400).send({ error: 'Every effort must be one of 1, 2, 3, 5, 8' });
    }
    const sanitized = assignments.map(item => ({
      taskId: item.taskId,
      effort: item.effort as 1 | 2 | 3 | 5 | 8,
      confidence: ['low', 'medium', 'high'].includes(String(item.confidence)) ? item.confidence : undefined,
    }));
    const result = await taskStore.applyEffortAssignments(request.params.projectId, sanitized);
    afterTaskMutation(request.params.projectId);
    return result;
  });
  app.post<{ Params: { projectId: string }; Body: { title: string; description?: string; priority?: string; effort?: number; effortSource?: 'claude' | 'manual'; effortConfidence?: 'low' | 'medium' | 'high'; status?: string; prompt?: string; milestoneId?: string; subtasks?: { id?: string; title: string; done?: boolean }[] } }>(
    '/api/projects/:projectId/tasks',
    async (request, reply) => {
      try {
        if (request.body.effort !== undefined && !validEffort(request.body.effort)) {
          return reply.status(400).send({ error: 'effort must be one of 1, 2, 3, 5, 8' });
        }
        const task = await taskStore.createTask(request.params.projectId, {
          title: request.body.title,
          description: request.body.description || '',
          priority: (request.body.priority as any) || 'medium',
          ...(validEffort(request.body.effort) ? { effort: request.body.effort, effortSource: request.body.effortSource || 'manual', effortConfidence: request.body.effortConfidence } : {}),
          status: (request.body.status as any) || 'todo',
          prompt: request.body.prompt,
          milestoneId: request.body.milestoneId,
          ...(sanitizeSubtasks(request.body.subtasks) ?? {}),
        });
        log.info('tasks', `Task created: ${task.title}`, undefined, request.params.projectId);
        afterTaskMutation(request.params.projectId);
        return task;
      } catch (err: any) {
        log.error('tasks', 'Failed to create task', err.message, request.params.projectId);
        throw err;
      }
    }
  );

  app.put<{ Params: { projectId: string; taskId: string }; Body: Partial<{ title: string; description: string; priority: string; effort: number | null; effortSource: 'claude' | 'manual' | 'backfill' | null; effortConfidence: 'low' | 'medium' | 'high' | null; status: string; prompt: string; order: number }> }>(
    '/api/projects/:projectId/tasks/:taskId',
    async (request, reply) => {
      if (request.body.effort !== undefined && request.body.effort !== null && !validEffort(request.body.effort)) {
        return reply.status(400).send({ error: 'effort must be one of 1, 2, 3, 5, 8' });
      }
      const updates = { ...request.body } as any;
      if (validEffort(request.body.effort) && !request.body.effortSource) updates.effortSource = 'manual';
      const task = await taskStore.updateTask(request.params.projectId, request.params.taskId, updates);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      if (request.body.status) {
        log.info('tasks', `Task "${task.title}" → ${request.body.status}`, undefined, request.params.projectId);
      }
      afterTaskMutation(request.params.projectId);
      return task;
    }
  );

  // Append a dated note to the prompt, optionally moving the task at the same
  // time. Backs the Review tab's "Needs changes" action; same shape the MCP
  // log_task_progress tool writes.
  app.post<{ Params: { projectId: string; taskId: string }; Body: { note: string; status?: string } }>(
    '/api/projects/:projectId/tasks/:taskId/note',
    async (request, reply) => {
      const note = (request.body?.note || '').trim();
      if (!note) return reply.status(400).send({ error: 'note is required' });

      const existing = await taskStore.getTask(request.params.projectId, request.params.taskId);
      if (!existing) return reply.status(404).send({ error: 'Task not found' });

      const ts = new Date().toISOString().replace('T', ' ').slice(0, 16);
      const updates: Record<string, any> = {
        prompt: taskStore.appendPromptSection(existing.prompt, `— Note ${ts}`, note),
      };
      if (request.body.status) updates.status = request.body.status;

      const task = await taskStore.updateTask(request.params.projectId, request.params.taskId, updates);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      log.info('tasks', `Note added to "${task.title}"`, undefined, request.params.projectId);
      afterTaskMutation(request.params.projectId);
      return task;
    }
  );

  app.delete<{ Params: { projectId: string; taskId: string } }>(
    '/api/projects/:projectId/tasks/:taskId',
    async (request, reply) => {
      // Read before deleting: afterwards nothing points at the worktree and
      // the folder would linger until the orphan sweep.
      const existing = await taskStore.getTask(request.params.projectId, request.params.taskId);
      const deleted = await taskStore.deleteTask(request.params.projectId, request.params.taskId);
      if (!deleted) return reply.status(404).send({ error: 'Task not found' });
      if (existing?.worktreePath) {
        await worktreeService.removeTaskWorktree(existing, { clearTask: false });
      }
      log.info('tasks', `Task deleted: ${request.params.taskId}`, undefined, request.params.projectId);
      afterTaskMutation(request.params.projectId);
      return { success: true };
    }
  );

  // Bulk update — single atomic write for column-level "move all" actions.
  app.post<{ Params: { projectId: string }; Body: { taskIds: string[]; data: Record<string, any> } }>(
    '/api/projects/:projectId/tasks/bulk-update',
    async (request, reply) => {
      const { taskIds, data } = request.body || ({} as any);
      if (data?.effort !== undefined && data.effort !== null && !validEffort(data.effort)) {
        return reply.status(400).send({ error: 'effort must be one of 1, 2, 3, 5, 8' });
      }
      const result = await taskStore.bulkUpdateTasks(request.params.projectId, taskIds || [], data || {});
      log.info('tasks', `Bulk updated ${result.updated} tasks`, JSON.stringify(data), request.params.projectId);
      afterTaskMutation(request.params.projectId);
      return result;
    }
  );

  // Bulk delete — single atomic write for column-level "delete all" actions.
  app.post<{ Params: { projectId: string }; Body: { taskIds: string[] } }>(
    '/api/projects/:projectId/tasks/bulk-delete',
    async (request) => {
      const taskIds = request.body?.taskIds || [];
      const wanted = new Set(taskIds);
      const doomed = (await taskStore.getTasks(request.params.projectId))
        .filter(t => wanted.has(t.id) && t.worktreePath);
      const result = await taskStore.bulkDeleteTasks(request.params.projectId, taskIds);
      for (const task of doomed) await worktreeService.removeTaskWorktree(task, { clearTask: false });
      log.info('tasks', `Bulk deleted ${result.deleted} tasks`, undefined, request.params.projectId);
      afterTaskMutation(request.params.projectId);
      return result;
    }
  );

  // Import tasks into a project
  app.post<{ Params: { projectId: string }; Body: { tasks: any[] } }>(
    '/api/projects/:projectId/tasks/import',
    async (request) => {
      try {
        const count = await taskStore.importTasks(request.params.projectId, request.body.tasks);
        log.info('tasks', `Imported ${count} tasks`, undefined, request.params.projectId);
        afterTaskMutation(request.params.projectId);
        return { imported: count };
      } catch (err: any) {
        log.error('tasks', 'Task import failed', err.message, request.params.projectId);
        throw err;
      }
    }
  );

  // Import tasks across multiple projects (tasks must have projectId)
  app.post<{ Body: { tasks: any[] } }>(
    '/api/tasks/import',
    async (request) => {
      const byProject = new Map<string, any[]>();
      for (const t of request.body.tasks) {
        if (!t.projectId) continue;
        const list = byProject.get(t.projectId) || [];
        list.push(t);
        byProject.set(t.projectId, list);
      }
      let total = 0;
      for (const [pid, tasks] of byProject) {
        total += await taskStore.importTasks(pid, tasks);
        afterTaskMutation(pid);
      }
      return { imported: total };
    }
  );

  // Apply CSV diff changes (batch update/create/remove)
  app.post<{
    Params: { projectId: string };
    Body: { update: Array<{ id: string; [key: string]: any }>; create: Array<{ [key: string]: any }>; remove: string[] }
  }>(
    '/api/projects/:projectId/tasks/csv-apply',
    async (request) => {
      try {
        const result = await taskStore.applyCsvChanges(request.params.projectId, request.body);
        const { update, create, remove } = request.body;
        log.info('tasks', `CSV apply: ${update?.length || 0} updated, ${create?.length || 0} created, ${remove?.length || 0} removed`, undefined, request.params.projectId);
        afterTaskMutation(request.params.projectId);
        return result;
      } catch (err: any) {
        log.error('tasks', 'CSV apply failed', err.message, request.params.projectId);
        throw err;
      }
    }
  );

  // Replace all tasks (used by Google Sheets sync pull)
  app.post<{ Params: { projectId: string }; Body: { tasks: any[]; milestoneId?: string } }>(
    '/api/projects/:projectId/tasks/replace',
    async (request) => {
      const tasks = await taskStore.replaceTasks(request.params.projectId, request.body.tasks, request.body.milestoneId);
      afterTaskMutation(request.params.projectId);
      return { tasks };
    }
  );

  // Build AI resolution prompt for a task
  app.post<{ Params: { projectId: string; taskId: string }; Body: { feedback?: string } }>(
    '/api/projects/:projectId/tasks/:taskId/ai-resolve',
    async (request, reply) => {
      const { projectId, taskId } = request.params;
      const task = await taskStore.getTask(projectId, taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      const projects = await getProjects();
      const project = projects.find(p => p.id === projectId);
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      // Optional per-run user feedback — trimmed and capped so a stray paste
      // cannot blow up the prompt.
      const rawFeedback = typeof request.body?.feedback === 'string' ? request.body.feedback.trim() : '';
      const feedback = rawFeedback ? rawFeedback.slice(0, 4000) : undefined;

      // Create the worktree here so the prompt can name the directory the
      // agent will land in. Creating it again when the terminal opens is a
      // no-op, so the two paths agree.
      const worktree = await worktreeService.ensureTaskWorktree(project, task);

      const port = (request.server.addresses()?.[0] as any)?.port || 5420;
      const prompt = buildAiResolvePrompt(
        { ...task, worktreeBranch: worktree.branch ?? task.worktreeBranch },
        project,
        port,
        feedback,
        worktree.path,
      );
      return { prompt, cwd: worktree.path };
    }
  );

  // Build AI manage prompt for CLI-based task management
  app.post<{ Params: { projectId: string }; Body: { rawText: string } }>(
    '/api/projects/:projectId/ai-manage-prompt',
    async (request, reply) => {
      const { projectId } = request.params;
      const { rawText } = request.body;
      if (!rawText?.trim()) {
        return reply.status(400).send({ error: 'No text provided' });
      }

      const projects = await getProjects();
      const project = projects.find(p => p.id === projectId);
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      const tasks = await taskStore.getTasks(projectId);
      const port = (request.server.addresses()?.[0] as any)?.port || 5420;
      const prompt = buildAiManagePrompt(rawText, project, tasks, port);
      return { prompt };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { taskIds: string[] } }>(
    '/api/projects/:projectId/tasks/reorder',
    async (request) => {
      const tasks = await taskStore.reorderTasks(request.params.projectId, request.body.taskIds);
      afterTaskMutation(request.params.projectId);
      return { tasks };
    }
  );
}
