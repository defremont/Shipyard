import { FastifyInstance } from 'fastify';
import * as claudeService from '../services/claudeService.js';
import * as claudeCliService from '../services/claudeCliService.js';
import { buildProjectContext, buildTaskContext } from '../services/claudeContextBuilder.js';
import * as taskStore from '../services/taskStore.js';
import { getProjects } from '../services/projectDiscovery.js';

// Helper: try CLI first, fallback to API. Returns null if neither available.
async function getAiBackend(): Promise<'cli' | 'api' | null> {
  const cliOk = await claudeCliService.getCliStatus();
  if (cliOk) return 'cli';
  const config = await claudeService.loadClaudeConfig();
  if (config) return 'api';
  return null;
}

async function getProjectPath(projectId: string): Promise<string | undefined> {
  const projects = await getProjects();
  return projects.find(p => p.id === projectId)?.path;
}

function parseJsonResponse(text: string): any {
  // Strip markdown fences if present
  const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

export async function claudeRoutes(app: FastifyInstance) {
  // Get Claude status (never exposes the API key)
  app.get('/api/claude/status', async () => {
    const config = await claudeService.loadClaudeConfig();
    const cliAvailable = await claudeCliService.getCliStatus();
    return {
      configured: !!config,
      cliAvailable,
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

  // Streaming chat via SSE — CLI-first, API fallback
  app.post<{
    Body: { projectId?: string; messages: Array<{ role: 'user' | 'assistant'; content: string }>; systemContext?: string }
  }>('/api/claude/chat', async (request, reply) => {
    const { projectId, messages, systemContext } = request.body;

    let systemPrompt = 'You are a helpful AI assistant integrated into Shipyard, a local development dashboard. You help with project management, task analysis, and development questions. Be concise and actionable.';

    if (projectId) {
      const context = await buildProjectContext(projectId);
      systemPrompt += `\n\nProject Context:\n${context}`;
    }

    if (systemContext) {
      systemPrompt += `\n\n${systemContext}`;
    }

    const config = await claudeService.loadClaudeConfig();
    const cliOk = await claudeCliService.getCliStatus();

    // If API is configured, use streaming
    if (config) {
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
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', source: 'api' })}\n\n`);
      } catch (err: any) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Stream failed' })}\n\n`);
      }

      reply.raw.end();
      return;
    }

    // CLI fallback — single-turn, non-streaming
    if (cliOk) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      try {
        // Build conversation context for CLI (single-turn)
        const conversationParts: string[] = [];
        if (messages.length > 1) {
          conversationParts.push('Previous conversation:');
          for (const msg of messages.slice(0, -1)) {
            conversationParts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
          }
          conversationParts.push('');
        }
        const lastMsg = messages[messages.length - 1];
        conversationParts.push(`User: ${lastMsg.content}`);

        const fullPrompt = `${systemPrompt}\n\n${conversationParts.join('\n')}`;
        const cwd = projectId ? await getProjectPath(projectId) : undefined;
        const result = await claudeCliService.runPrompt(fullPrompt, {
          model: 'sonnet',
          maxTurns: 1,
          timeout: 120000,
          cwd,
        });

        reply.raw.write(`data: ${JSON.stringify({ type: 'text', text: result })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ type: 'done', source: 'cli' })}\n\n`);
      } catch (err: any) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'CLI failed' })}\n\n`);
      }

      reply.raw.end();
      return;
    }

    return reply.status(400).send({ error: 'No AI available. Install Claude CLI or configure API key.' });
  });

  // Analyze task — CLI-first, API fallback
  app.post<{
    Body: { projectId: string; taskId?: string; title: string }
  }>('/api/claude/analyze-task', async (request, reply) => {
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

    const userMessage = existingDescription
      ? `Analyze this task and improve/generate the fields:\n\nTitle: ${title}\nCurrent description: ${existingDescription}\n\nGenerate an improved description (user-facing, what needs to be done) and a detailed technical prompt (implementation details, files, solutions).`
      : `Analyze this task and generate the fields:\n\nTitle: ${title}\n\nGenerate a description (user-facing, what needs to be done) and a detailed technical prompt (implementation details, possible approaches, relevant files).`;

    const systemInstructions = `You are a senior developer analyzing tasks for a project. ${context}\n\nRespond in JSON format: { "description": "...", "prompt": "..." }\n- description: Clear, user-facing explanation of what needs to be done\n- prompt: Technical analysis with implementation details, relevant files, possible solutions\n\nRespond ONLY with valid JSON, no markdown fences.`;

    // Try CLI first
    const cliOk = await claudeCliService.getCliStatus();
    if (cliOk) {
      try {
        const cwd = await getProjectPath(projectId);
        const result = await claudeCliService.runPrompt(
          `${systemInstructions}\n\n${userMessage}`,
          { model: 'sonnet', maxTurns: 1, timeout: 60000, cwd },
        );
        const parsed = parseJsonResponse(result);
        return { description: parsed.description || '', prompt: parsed.prompt || '' };
      } catch {
        // Fall through to API
      }
    }

    // Fallback to API
    const config = await claudeService.loadClaudeConfig();
    if (!config) {
      return reply.status(400).send({ error: 'No AI available. Install Claude CLI or configure API key.' });
    }
    return await claudeService.analyzeTask(config, context, title, existingDescription);
  });

  // Bulk organize tasks — CLI-first, API fallback
  app.post<{
    Body: { projectId: string; rawText: string }
  }>('/api/claude/bulk-organize', async (request, reply) => {
    const { projectId, rawText } = request.body;
    if (!rawText?.trim()) {
      return reply.status(400).send({ error: 'No text provided' });
    }

    const context = await buildProjectContext(projectId);

    const systemInstructions = `You are a senior developer organizing tasks for a project. ${context}

Parse the raw text below into structured tasks. The text may be a list (one per line), CSV, bullet points, or free-form notes.

For each task, generate:
- title: Clean, concise task title
- description: User-facing explanation of what needs to be done
- prompt: Technical analysis with implementation details, relevant files, possible approaches
- priority: "urgent", "high", "medium", or "low" (infer from context)
- status: "todo" (default), "in_progress", or "done" (if the text implies it's already resolved)

Respond ONLY with valid JSON array, no markdown fences. Example:
[{"title":"...","description":"...","prompt":"...","priority":"medium","status":"todo"}]`;

    // Try CLI first
    const cliOk = await claudeCliService.getCliStatus();
    if (cliOk) {
      try {
        const cwd = await getProjectPath(projectId);
        const result = await claudeCliService.runPrompt(systemInstructions, {
          input: rawText,
          model: 'sonnet',
          maxTurns: 1,
          timeout: 90000,
          cwd,
        });
        const parsed = parseJsonResponse(result);
        return { tasks: Array.isArray(parsed) ? parsed : [] };
      } catch {
        // Fall through to API
      }
    }

    // Fallback to API
    const config = await claudeService.loadClaudeConfig();
    if (!config) {
      return reply.status(400).send({ error: 'No AI available. Install Claude CLI or configure API key.' });
    }
    const tasks = await claudeService.bulkOrganizeTasks(config, context, rawText);
    return { tasks };
  });

  // Summarize project tasks — CLI-first, API fallback
  app.post<{
    Body: { projectId: string }
  }>('/api/claude/summarize', async (request, reply) => {
    const { projectId } = request.body;
    const tasks = await taskStore.getTasks(projectId);
    const projects = await getProjects();
    const project = projects.find(p => p.id === projectId);
    const projectName = project?.name || projectId;

    const taskList = tasks.map(t => `- [${t.status}] (${t.priority}) ${t.title}: ${t.description}`).join('\n');
    const prompt = `Summarize the current state of tasks for project "${projectName}". Be concise and actionable. Highlight priorities and blockers.\n\nTasks:\n${taskList}`;

    // Try CLI first
    const cliOk = await claudeCliService.getCliStatus();
    if (cliOk) {
      try {
        const result = await claudeCliService.runPrompt(prompt, {
          model: 'sonnet',
          maxTurns: 1,
          timeout: 60000,
          cwd: project?.path,
        });
        return { summary: result };
      } catch {
        // Fall through to API
      }
    }

    // Fallback to API
    const config = await claudeService.loadClaudeConfig();
    if (!config) {
      return reply.status(400).send({ error: 'No AI available. Install Claude CLI or configure API key.' });
    }

    const summary = await claudeService.summarizeTasks(
      config,
      projectName,
      tasks.map(t => ({ title: t.title, status: t.status, priority: t.priority, description: t.description })),
    );

    return { summary };
  });
}
