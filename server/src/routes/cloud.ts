import { FastifyInstance, FastifyReply } from 'fastify';
import * as cloud from '../services/cloud/cloudSync.js';

interface Credentials {
  serverUrl?: string;
  email: string;
  password: string;
  deviceName?: string;
}

function fail(reply: FastifyReply, err: unknown) {
  const status = cloud.isCloudError(err) && err.status >= 400 && err.status < 500 ? err.status : 502;
  return reply.code(status).send({ error: (err as Error)?.message || String(err) });
}

/** Shipyard Cloud: account and sync state for this machine. */
export async function cloudRoutes(app: FastifyInstance) {
  app.get('/api/cloud/status', async () => cloud.getStatus());

  app.post<{ Body: Credentials }>('/api/cloud/signup', async (request, reply) => {
    const { email, password } = request.body ?? ({} as Credentials);
    if (!email || !password || password.length < 8) {
      return reply.code(400).send({ error: 'Email and a password of at least 8 characters are required' });
    }
    try {
      await cloud.signup(request.body);
      return cloud.getStatus();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Body: Credentials }>('/api/cloud/login', async (request, reply) => {
    const { email, password } = request.body ?? ({} as Credentials);
    if (!email || !password) return reply.code(400).send({ error: 'Email and password are required' });
    try {
      await cloud.login(request.body);
      return cloud.getStatus();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/cloud/logout', async () => {
    await cloud.logout();
    return cloud.getStatus();
  });

  app.post('/api/cloud/sync', async () => {
    await cloud.syncNow();
    return cloud.getStatus();
  });
}
