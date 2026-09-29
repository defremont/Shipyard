import { FastifyInstance } from 'fastify';
import * as inbox from '../services/inboxService.js';

export async function inboxRoutes(app: FastifyInstance) {
  // The token never comes back to the client.
  app.get('/api/inbox', async () => inbox.getStatus());

  app.put<{ Body: { url?: string; token?: string } }>('/api/inbox', async (request, reply) => {
    const url = request.body?.url?.trim();
    const token = request.body?.token?.trim();
    if (!url || !token) return reply.status(400).send({ error: 'URL and token are required' });
    try {
      await inbox.configure(url, token);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
    try {
      // Saving is also the test: a wrong URL or token fails right here and
      // is not kept, so the card never says "connected" over a bad token.
      const result = await inbox.syncNow();
      return { ...(await inbox.getStatus()), created: result.created };
    } catch (err: any) {
      await inbox.disconnect();
      return reply.status(400).send({ error: err.message });
    }
  });

  app.delete('/api/inbox', async () => {
    await inbox.disconnect();
    return inbox.getStatus();
  });

  app.post('/api/inbox/sync', async (_request, reply) => {
    try {
      const result = await inbox.syncNow();
      return { ...(await inbox.getStatus()), created: result.created };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
