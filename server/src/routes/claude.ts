import { FastifyInstance } from 'fastify';
import * as claudeService from '../services/claudeService.js';
import { buildProjectContext, buildTaskContext } from '../services/claudeContextBuilder.js';
import * as taskStore from '../services/taskStore.js';

export async function claudeRoutes(app: FastifyInstance) {
  // Get Claude status (never exposes the API key)
  app.get('/api/claude/status', async () => {
    const config = await claudeService.loadClaudeConfig();
    return {
      configured: !!config,
      model: config?.model || null,
      maxTokens: config?.maxTokens || null,
    };
  });

  // Save Claude config
  app.post<{
    Body: { apiKey: string; model?: string; maxTokens?: number }
  }>('/api/claude/config', async (request) => {
    const { apiKey, model, maxTokens } = request.body;

    // If apiKey is '__keep__', preserve the existing key (only update model/tokens)
    if (apiKey === '__keep__') {
      const existing = await claudeService.loadClaudeConfig();
      if (!existing) {
        return { ok: false, error: 'No existing key to keep' };
      }
      await claudeService.saveClaudeConfig({
        apiKey: existing.apiKey,
        model: model || existing.model,
        maxTokens: maxTokens || existing.maxTokens,
      });
    } else {
      await claudeService.saveClaudeConfig({
        apiKey,
        model: model || 'claude-sonnet-4-5-20250929',
        maxTokens: maxTokens || 4096,
      });
    }
    return { ok: true };
  });

  // Delete Claude config
  app.delete('/api/claude/config', async () => {
    await claudeService.deleteClaudeConfig();
    return { ok: true };
  });

  // Test API key
  app.post<{
    Body: { apiKey: string }
  }>('/api/claude/config/test', async (request) => {
    const result = await claudeService.testApiKey(request.body.apiKey);
    return result;
  });

  // Streaming chat via SSE
  app.post<{
    Body: { projectId?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; systemContext?: string }
  }>('/api/claude/chat', async (request, reply) => {
    const config = await claudeService.loadClaudeConfig();
    if (!config) {
      return reply.status(400).send({ error: 'Claude API key not configured' });
    }

    const { projectId, messages, systemContext } = request.body;

    let systemPrompt = 'You are a helpful AI assistant integrated into Shipyard, a local development dashboard. You help with project management, task analysis, and development questions. Be concise and actionable.';

    if (projectId) {
      const context = await buildProjectContext(projectId);
      systemPrompt += `\n\nProject Context:\n${context}`;
    }

    if (systemContext) {
      systemPrompt += `\n\n${systemContext}`;
    }

    // SSE streaming response
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const chunk of claudeService.streamChat(config, messages, systemPrompt)) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
      }
      reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    } catch (err: any) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Stream failed' })}\n\n`);
    }

    reply.raw.end();
  });

  // Analyze task - generate description and prompt
  app.post<{
    Body: { projectId: string; taskId?: string; title: string }
  }>('/api/claude/analyze-task', async (request, reply) => {
    const config = await claudeService.loadClaudeConfig();
    if (!config) {
      return reply.status(400).send({ error: 'Claude API key not configured' });
    }

    const { projectId, taskId, title } = request.body;

    let context: string;
    let existingDescription: string | undefined;

    if (taskId) {
      context = await buildTaskContext(projectId, taskId);
      const task = await taskStore.getTask(projectId, taskId);
      existingDescription = task?.description;
    } else {
      context = await buildProjectContext(projectId);
    }

    const result = await claudeService.analyzeTask(config, context, title, existingDescription);
    return result;
  });

  // Bulk organize tasks from raw text
  app.post<{
    Body: { projectId: string; rawText: string }
  }>('/api/claude/bulk-organize', async (request, reply) => {
    const config = await claudeService.loadClaudeConfig();
    if (!config) {
      return reply.status(400).send({ error: 'Claude API key not configured' });
    }

    const { projectId, rawText } = request.body;
    if (!rawText?.trim()) {
      return reply.status(400).send({ error: 'No text provided' });
    }

    const context = await buildProjectContext(projectId);
    const tasks = await claudeService.bulkOrganizeTasks(config, context, rawText);
    return { tasks };
  });

  // Summarize project tasks
  app.post<{
    Body: { projectId: string }
  }>('/api/claude/summarize', async (request, reply) => {
    const config = await claudeService.loadClaudeConfig();
    if (!config) {
      return reply.status(400).send({ error: 'Claude API key not configured' });
    }

    const tasks = await taskStore.getTasks(request.body.projectId);
    const { getProjects } = await import('../services/projectDiscovery.js');
    const projects = await getProjects();
    const project = projects.find(p => p.id === request.body.projectId);

    const summary = await claudeService.summarizeTasks(
      config,
      project?.name || request.body.projectId,
      tasks.map(t => ({ title: t.title, status: t.status, priority: t.priority, description: t.description })),
    );

    return { summary };
  });
}
