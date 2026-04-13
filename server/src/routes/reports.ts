import { FastifyInstance } from 'fastify';
import { buildReport, type BuildReportOptions } from '../services/reportBuilder.js';
import * as log from '../services/logService.js';

export async function reportRoutes(app: FastifyInstance) {
  // Build structured report data
  app.get<{
    Params: { projectId: string };
    Querystring: {
      milestone?: string;
      from?: string;
      to?: string;
      includeCommits?: string;
      status?: string;
    };
  }>('/api/projects/:projectId/reports/data', async (request, reply) => {
    try {
      const { milestone, from, to, includeCommits, status } = request.query;
      const opts: BuildReportOptions = {
        projectId: request.params.projectId,
        milestoneId: milestone,
        from,
        to,
        includeCommits: includeCommits === 'true' || includeCommits === '1',
        statusFilter: status ? (status.split(',') as any) : undefined,
      };
      const data = await buildReport(opts);
      return data;
    } catch (err: any) {
      log.error('reports', 'Failed to build report', err.message, request.params.projectId);
      return reply.status(500).send({ error: err.message || 'Failed to build report' });
    }
  });
}
