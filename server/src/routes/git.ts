import { FastifyInstance } from 'fastify';
import * as gitService from '../services/gitService.js';
import { getProjects } from '../services/projectDiscovery.js';

async function getProjectPath(projectId: string): Promise<string | null> {
  const projects = await getProjects();
  const project = projects.find(p => p.id === projectId);
  return project?.path || null;
}

export async function gitRoutes(app: FastifyInstance) {
  // Track last fetch time per project to avoid fetching too often
  const lastFetch = new Map<string, number>();

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/status',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        // Fetch at most once per 60s to keep ahead/behind accurate
        const now = Date.now();
        const last = lastFetch.get(path) || 0;
        if (now - last > 60_000) {
          lastFetch.set(path, now);
          await gitService.fetch(path);
        }

        const status = await gitService.getStatus(path);
        return status;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get<{ Params: { projectId: string }; Querystring: { file?: string; staged?: string } }>(
    '/api/projects/:projectId/git/diff',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const staged = request.query.staged === 'true';
        const diff = await gitService.getDiff(path, request.query.file, staged);
        return { diff };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { file: string } }>(
    '/api/projects/:projectId/git/stage',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.stageFile(path, request.body.file);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/stage-all',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.stageAll(path);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { file: string } }>(
    '/api/projects/:projectId/git/unstage',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.unstageFile(path, request.body.file);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/unstage-all',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.unstageAll(path);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { message: string } }>(
    '/api/projects/:projectId/git/commit',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const hash = await gitService.commit(path, request.body.message);
        return { commit: hash };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/push',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        await gitService.push(path);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/pull',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        await gitService.pull(path);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/log',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const log = await gitService.getLog(path);
        return log;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/branches',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const branches = await gitService.getBranches(path);
        return branches;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { file: string; type: 'staged' | 'unstaged' | 'untracked' } }>(
    '/api/projects/:projectId/git/discard',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });
      try {
        await gitService.discardFile(path, request.body.file, request.body.type);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { section: 'staged' | 'unstaged' } }>(
    '/api/projects/:projectId/git/discard-all',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });
      try {
        await gitService.discardAll(path, request.body.section);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/main-commit',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const commit = await gitService.getMainBranchLastCommit(path);
        return { commit };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );
}
