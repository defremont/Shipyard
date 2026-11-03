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

  // What the last syncs delivered, for the "landed on task #N" toast.
  app.get<{ Querystring: { since?: string } }>('/api/inbox/deliveries', async request => ({
    deliveries: inbox.getDeliveries(request.query.since),
  }));

  // Review the inbox's demands from inside Shipyard (the token stays here).
  const relayed = (fn: () => Promise<unknown>) => async (_request: unknown, reply: any) => {
    try {
      return await fn();
    } catch (err: any) {
      return reply.status(502).send({ error: err.message });
    }
  };
  app.get<{ Querystring: { summary?: string } }>('/api/inbox/review', (request, reply) =>
    relayed(() => inbox.review.list(request.query.summary === '1'))(request, reply));
  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/inbox/review/:id', (request, reply) => {
    // Only the fields the review edits; nothing else goes through.
    const allowed = ['title', 'description', 'priority', 'effort', 'projectId', 'milestoneId', 'kind', 'targetTaskId'];
    const body = Object.fromEntries(Object.entries(request.body || {}).filter(([k]) => allowed.includes(k)));
    return relayed(() => inbox.review.update(request.params.id, body))(request, reply);
  });
  app.post<{ Params: { id: string } }>('/api/inbox/review/:id/approve', (request, reply) =>
    relayed(() => inbox.review.approve(request.params.id))(request, reply));
  app.post<{ Params: { id: string } }>('/api/inbox/review/:id/discard', (request, reply) =>
    relayed(() => inbox.review.discard(request.params.id))(request, reply));

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
