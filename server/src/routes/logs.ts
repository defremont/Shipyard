import { FastifyInstance } from 'fastify';
import * as logService from '../services/logService.js';

export async function logRoutes(app: FastifyInstance) {
  // GET /api/logs — Fetch logs with optional filters
  app.get<{
    Querystring: {
      level?: string;
      category?: string;
      projectId?: string;
      since?: string;
      limit?: string;
    };
  }>('/api/logs', async (request) => {
    const { level, category, projectId, since, limit } = request.query;
    const logs = logService.getLogs({
      level: level as logService.LogLevel | undefined,
      category: category as logService.LogCategory | undefined,
      projectId,
      since,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return { logs };
  });

  // GET /api/logs/stats — Summary counts
  app.get('/api/logs/stats', async () => {
    return logService.getStats();
  });

  // DELETE /api/logs — Clear all logs
  app.delete('/api/logs', async () => {
    await logService.clearLogs();
    return { ok: true };
  });
}
