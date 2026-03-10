import { FastifyInstance } from 'fastify';
import { launchTerminal, openFolder, TerminalType } from '../services/terminalLauncher.js';
import { getProjects, updateProject } from '../services/projectDiscovery.js';

export async function terminalRoutes(app: FastifyInstance) {
  app.post<{ Body: { projectId: string; type: TerminalType } }>(
    '/api/terminals/launch',
    async (request, reply) => {
      const projects = await getProjects();
      const project = projects.find(p => p.id === request.body.projectId);
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      await launchTerminal(project.path, request.body.type, project.name);
      await updateProject(project.id, { lastOpenedAt: new Date().toISOString() });
      return { success: true };
    }
  );

  app.post<{ Body: { projectId: string } }>(
    '/api/terminals/folder',
    async (request, reply) => {
      const projects = await getProjects();
      const project = projects.find(p => p.id === request.body.projectId);
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      await openFolder(project.path);
      return { success: true };
    }
  );
}
