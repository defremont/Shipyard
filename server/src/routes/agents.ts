import { FastifyInstance } from 'fastify';
import { listAgents, agentAvailability, saveCustomAgents, saveDefaultAgent, DEFAULT_AGENT_ID } from '../services/agentRegistry.js';
import { getSettings } from '../services/settingsStore.js';

export async function agentRoutes(app: FastifyInstance) {
  // Built-in and custom agents, plus whether each binary is on PATH
  app.get('/api/agents', async () => {
    const [agents, available] = await Promise.all([listAgents(), agentAvailability()]);
    return {
      agents: agents.map(a => ({ ...a, available: available[a.id] ?? false })),
      defaultAgent: getSettings().defaultAgent || DEFAULT_AGENT_ID,
    };
  });

  app.put<{ Body: { agents?: unknown; defaultAgent?: string } }>(
    '/api/agents',
    async (request, reply) => {
      try {
        if (request.body?.agents !== undefined) await saveCustomAgents(request.body.agents);
        if (request.body?.defaultAgent) await saveDefaultAgent(request.body.defaultAgent);
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
      const available = await agentAvailability();
      return {
        agents: listAgents().map(a => ({ ...a, available: available[a.id] ?? false })),
        defaultAgent: getSettings().defaultAgent || DEFAULT_AGENT_ID,
      };
    }
  );
}
