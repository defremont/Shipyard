import { FastifyInstance } from 'fastify';
import * as deployStore from '../services/deployStore.js';
import * as deployService from '../services/deployService.js';
import * as railway from '../services/railwayService.js';
import * as log from '../services/logService.js';

export async function deployRoutes(app: FastifyInstance) {
  // Is a provider connected? The token itself never leaves the server.
  app.get('/api/deploy/providers', async () => {
    const token = await deployStore.getToken('railway');
    return { providers: { railway: { connected: !!token } } };
  });

  app.post<{ Body: { token?: string } }>(
    '/api/deploy/providers/railway',
    async (request, reply) => {
      const token = request.body?.token?.trim();
      if (!token) return reply.status(400).send({ error: 'Token is required' });
      try {
        const account = await railway.connect(token);
        deployService.invalidate();
        return { connected: true, account };
      } catch (err: any) {
        log.warn('server', 'Railway token rejected', err.message);
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  app.delete('/api/deploy/providers/railway', async () => {
    await deployStore.clearToken('railway');
    deployService.invalidate();
    return { connected: false };
  });

  // Projects the token can see, so the user picks from a list instead of
  // copying ids out of the Railway dashboard.
  app.get('/api/deploy/railway/projects', async (_request, reply) => {
    try {
      return { projects: await railway.listProjects() };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // Every linked project in one call — the dashboard draws a dot per card and
  // must not open one request per card.
  app.get('/api/deploy/status', async () => {
    const links = await deployStore.listLinks();
    const ids = Object.keys(links);
    const results = await Promise.all(ids.map(id => deployService.getStatus(id)));
    const statuses: Record<string, deployService.DeployStatus> = {};
    ids.forEach((id, index) => { statuses[id] = results[index]; });
    return { statuses };
  });

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/deploy',
    async (request) => {
      return deployService.getStatus(request.params.projectId);
    }
  );

  app.put<{
    Params: { projectId: string };
    Body: {
      projectId?: string;
      projectName?: string;
      environmentId?: string;
      environmentName?: string;
      serviceId?: string;
      serviceName?: string;
    };
  }>(
    '/api/projects/:projectId/deploy',
    async (request, reply) => {
      const body = request.body || {};
      if (!body.projectId) return reply.status(400).send({ error: 'Railway project is required' });

      const link = await deployStore.setLink(request.params.projectId, {
        provider: 'railway',
        projectId: body.projectId,
        ...(body.projectName ? { projectName: body.projectName } : {}),
        ...(body.environmentId ? { environmentId: body.environmentId } : {}),
        ...(body.environmentName ? { environmentName: body.environmentName } : {}),
        ...(body.serviceId ? { serviceId: body.serviceId } : {}),
        ...(body.serviceName ? { serviceName: body.serviceName } : {}),
      });
      deployService.invalidate(request.params.projectId);
      log.info('server', 'Deploy link saved', link.projectName || link.projectId, request.params.projectId);
      return { link, status: await deployService.getStatus(request.params.projectId) };
    }
  );

  app.delete<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/deploy',
    async (request) => {
      await deployStore.clearLink(request.params.projectId);
      deployService.invalidate(request.params.projectId);
      return { linked: false };
    }
  );
}
