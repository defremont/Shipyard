import { FastifyInstance } from 'fastify';
import * as worktreeService from '../services/worktreeService.js';
import * as taskStore from '../services/taskStore.js';
import * as log from '../services/logService.js';

export async function worktreeRoutes(app: FastifyInstance) {
  // Config plus every worktree Shipyard currently tracks
  app.get('/api/worktrees', async () => {
    const [config, worktrees] = await Promise.all([
      worktreeService.getConfig(),
      worktreeService.listWorktrees(),
    ]);
    return {
      ...config,
      defaultBasePath: worktreeService.DEFAULT_WORKTREE_DIR,
      ttlDays: worktreeService.WORKTREE_TTL_DAYS,
      worktrees,
    };
  });

  app.put<{ Body: { enabled?: boolean; basePath?: string | null } }>(
    '/api/worktrees',
    async (request, reply) => {
      try {
        const config = await worktreeService.saveConfig(request.body || {});
        log.info('git', `Worktree per task ${config.enabled ? 'enabled' : 'disabled'}`, config.basePath);
        return { ...config, defaultBasePath: worktreeService.DEFAULT_WORKTREE_DIR, ttlDays: worktreeService.WORKTREE_TTL_DAYS };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Manual sweep. Without `all` it only removes what the scheduled pass would.
  app.post<{ Body: { all?: boolean } }>(
    '/api/worktrees/clean',
    async (request) => {
      const result = await worktreeService.cleanupWorktrees({ all: !!request.body?.all });
      return result;
    }
  );

  app.delete<{ Params: { projectId: string; taskId: string } }>(
    '/api/projects/:projectId/tasks/:taskId/worktree',
    async (request, reply) => {
      const { projectId, taskId } = request.params;
      const task = await taskStore.getTask(projectId, taskId);
      if (!task) return reply.status(404).send({ error: 'Task not found' });
      if (!task.worktreePath) return reply.status(404).send({ error: 'Task has no worktree' });

      const removed = await worktreeService.removeTaskWorktree(task);
      if (!removed) return reply.status(500).send({ error: 'Failed to remove worktree' });
      return { success: true };
    }
  );
}
