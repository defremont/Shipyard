import { FastifyInstance } from 'fastify';
import * as taskStore from '../services/taskStore.js';
import { getProjects } from '../services/projectDiscovery.js';
import { buildAiResolvePrompt } from '../services/aiResolvePrompt.js';
import { buildAiManagePrompt } from '../services/aiManagePrompt.js';

export async function taskRoutes(app: FastifyInstance) {
  // All tasks across all projects
  app.get('/api/tasks/all', async () => {
    const tasks = await taskStore.getAllTasks();
    return { tasks };
  });

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/tasks',
    async (request) => {
      const tasks = await taskStore.getTasks(request.params.projectId);
      return { tasks };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { title: string; description?: string; priority?: string; status?: string; prompt?: string } }>(
    '/api/projects/:projectId/tasks',
    async (request) => {
      const task = await taskStore.createTask(request.params.projectId, {
        title: request.body.title,
        description: request.body.description || '',
        priority: (request.body.priority as any) || 'medium',
        status: (request.body.status as any) || 'todo',
        prompt: request.body.prompt,
      });
      return task;
    }
  );

  app.put<{ Params: { projectId: string; taskId: string }; Body: Partial<{ title: string; description: string; priority: string; status: string; prompt: string; order: number }> }>(
    '/api/projects/:projectId/tasks/:taskId',
    async (request, reply) => {
      const task = await taskStore.updateTask(request.params.projectId, request.params.taskId, request.body as any);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      return task;
    }
  );

  app.delete<{ Params: { projectId: string; taskId: string } }>(
    '/api/projects/:projectId/tasks/:taskId',
    async (request, reply) => {
      const deleted = await taskStore.deleteTask(request.params.projectId, request.params.taskId);
      if (!deleted) return reply.status(404).send({ error: 'Task not found' });
      return { success: true };
    }
  );

  // Import tasks into a project
  app.post<{ Params: { projectId: string }; Body: { tasks: any[] } }>(
    '/api/projects/:projectId/tasks/import',
    async (request) => {
      const count = await taskStore.importTasks(request.params.projectId, request.body.tasks);
      return { imported: count };
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
      const result = await taskStore.applyCsvChanges(request.params.projectId, request.body);
      return result;
    }
  );

  // Replace all tasks (used by Google Sheets sync pull)
  app.post<{ Params: { projectId: string }; Body: { tasks: any[] } }>(
    '/api/projects/:projectId/tasks/replace',
    async (request) => {
      const tasks = await taskStore.replaceTasks(request.params.projectId, request.body.tasks);
      return { tasks };
    }
  );

  // Build AI resolution prompt for a task
  app.post<{ Params: { projectId: string; taskId: string } }>(
    '/api/projects/:projectId/tasks/:taskId/ai-resolve',
    async (request, reply) => {
      const { projectId, taskId } = request.params;
      const task = await taskStore.getTask(projectId, taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });

      const projects = await getProjects();
      const project = projects.find(p => p.id === projectId);
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      const port = (request.server.addresses()?.[0] as any)?.port || 5420;
      const prompt = buildAiResolvePrompt(task, project, port);
      return { prompt };
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
      return { tasks };
    }
  );
}
