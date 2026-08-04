import { FastifyInstance } from 'fastify';
import * as claudeService from '../services/claudeService.js';
import * as aiBackend from '../services/aiBackend.js';
import * as claudeUsage from '../services/claudeUsage.js';
import { buildProjectContext, buildTaskContext } from '../services/claudeContextBuilder.js';
import * as taskStore from '../services/taskStore.js';
import { getProjects } from '../services/projectDiscovery.js';
import * as log from '../services/logService.js';

const EFFORTS = new Set([1, 2, 3, 5, 8]);
function parseEffort(value: unknown): 1 | 2 | 3 | 5 | 8 | undefined {
  const effort = Number(value);
  return EFFORTS.has(effort) ? effort as 1 | 2 | 3 | 5 | 8 : undefined;
}
async function getProjectPath(projectId: string): Promise<string | undefined> {
  const projects = await getProjects();
  return projects.find(p => p.id === projectId)?.path;
}

function parseJsonResponse(text: string): any {
  // 1. Try direct parse
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch {}

  // 2. Strip markdown fences and try again
  const fenceStripped = trimmed.replace(/^```(?:json)?\s*\n?/gim, '').replace(/\n?```\s*$/gim, '').trim();
  try { return JSON.parse(fenceStripped); } catch {}

  // 3. Extract JSON from between code fences
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // 4. Find first { or [ and match to last } or ] (greedy extraction)
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '{' || trimmed[i] === '[') {
      const closingChar = trimmed[i] === '{' ? '}' : ']';
      const lastClose = trimmed.lastIndexOf(closingChar);
      if (lastClose > i) {
        try { return JSON.parse(trimmed.substring(i, lastClose + 1)); } catch {}
      }
    }
  }

  // 5. Try fixing common JSON issues (trailing commas, single quotes)
  const jsonCandidate = extractBracketedContent(trimmed);
  if (jsonCandidate) {
    const fixed = jsonCandidate
      .replace(/,\s*([}\]])/g, '$1')       // trailing commas
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":'); // unquoted keys
    try { return JSON.parse(fixed); } catch {}
  }

  const snippet = trimmed.length > 200 ? trimmed.substring(0, 200) + '...' : trimmed;
  throw new Error(`Could not parse JSON from AI response. Response starts with: ${snippet}`);
}

/** Extract the outermost { ... } or [ ... ] from text using bracket depth counting */
function extractBracketedContent(text: string): string | null {
  let start = -1;
  let openChar = '';
  let closeChar = '';
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (start === -1) {
      if (ch === '{' || ch === '[') {
        start = i;
        openChar = ch;
        closeChar = ch === '{' ? '}' : ']';
        depth = 1;
      }
      continue;
    }
    // Skip characters inside strings
    if (ch === '"') {
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') i++; // skip escaped chars
        i++;
      }
      continue;
    }
    if (ch === openChar) depth++;
    else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.substring(start, i + 1);
      }
    }
  }
  return null;
}

export async function claudeRoutes(app: FastifyInstance) {
  // Get Claude status (never exposes the API key)
  app.get('/api/claude/status', async () => {
    const status = await aiBackend.getBackendStatus();
    return {
      configured: status.apiConfigured,
      cliAvailable: status.cliAvailable || status.oauthAvailable,
      oauthAvailable: status.oauthAvailable,
      activeBackend: status.activeBackend,
      model: status.model,
      maxTokens: status.maxTokens,
    };
  });

  // Subscription usage (5h + weekly windows). Always 200: an unavailable meter
  // is a normal state (no OAuth token, endpoint changed), not a request error.
  app.get('/api/claude/usage', async () => {
    return claudeUsage.getUsage();
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

    // CLI-first via the unified backend: OAuth stream → CLI subprocess → API key
    let handle: aiBackend.StreamHandle;
    try {
      const cwd = projectId ? await getProjectPath(projectId) : undefined;
      handle = await aiBackend.streamText(systemPrompt, messages, { cwd });
    } catch (err: any) {
      const status = err instanceof aiBackend.NoAiAvailableError ? 503 : 500;
      return reply.status(status).send({ error: err.message });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    try {
      for await (const chunk of handle.stream) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'text', text: chunk })}\n\n`);
      }
      reply.raw.write(`data: ${JSON.stringify({ type: 'done', source: handle.source })}\n\n`);
    } catch (err: any) {
      log.error('claude', `Chat stream failed (${handle.source})`, err.message, projectId);
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: err.message || 'Stream failed' })}\n\n`);
    }

    reply.raw.end();
  });

  // Analyze task — CLI-first (uses Max subscription), configured API key fallback
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
      ? `Improve this task:\nTitle: ${title}\nDescription: ${existingDescription}\n\nReturn improved title, description, technical prompt, and Fibonacci effort.`
      : `Analyze this task:\nTitle: ${title}\n\nReturn improved title, description, technical prompt, and Fibonacci effort.`;

    const systemInstructions = `You are a developer improving task descriptions. Project context: ${context}\n\nRespond ONLY with JSON: { "title": "concise action-oriented title", "description": "what needs to be done", "prompt": "technical details, files, approach", "effort": 1|2|3|5|8, "effortConfidence": "low"|"medium"|"high" }. Effort measures implementation size, not urgency: 1=trivial, 2=small, 3=medium, 5=large/cross-layer, 8=very large or highly uncertain.\nNo markdown fences. Keep it concise.`;

    try {
      const result = await aiBackend.generateText(systemInstructions, userMessage, { maxTokens: 1024 });
      try {
        const parsed = parseJsonResponse(result.text);
        return { title: parsed.title || title, description: parsed.description || '', prompt: parsed.prompt || '', effort: parseEffort(parsed.effort), effortConfidence: ['low', 'medium', 'high'].includes(parsed.effortConfidence) ? parsed.effortConfidence : 'medium' };
      } catch {
        log.warn('claude', 'Analyze task response was not valid JSON', undefined, projectId);
        return { title, description: result.text.trim(), prompt: '' };
      }
    } catch (err: any) {
      if (err.status === 429) return reply.status(429).send({ error: 'Rate limit reached. Please wait a moment and try again.' });
      const status = err instanceof aiBackend.NoAiAvailableError ? 503 : 500;
      log.error('claude', 'Analyze task failed', err.message, projectId);
      return reply.status(status).send({ error: err.message });
    }
  });

  // Suggest effort for tasks that do not have it yet. Timestamps and measured
  // durations are intentionally excluded to avoid hindsight leakage.
  app.post<{
    Body: { projectId: string; taskIds?: string[] }
  }>('/api/claude/classify-task-effort', async (request, reply) => {
    const { projectId, taskIds } = request.body;
    const requested = taskIds ? new Set(taskIds) : null;
    const tasks = (await taskStore.getTasks(projectId)).filter(task =>
      task.effort === undefined && (!requested || requested.has(task.id))
    );
    if (tasks.length === 0) return { suggestions: [] };

    const systemInstructions = `You classify software task implementation size using Fibonacci effort points.
Return ONLY a JSON array with objects: {"taskId":"...","effort":1|2|3|5|8,"confidence":"low"|"medium"|"high","rationale":"short reason"}.
Rubric: 1=trivial/localized; 2=small, usually one layer; 3=medium, several files or tests; 5=large/cross-layer/migration; 8=very large, broad, or highly uncertain and probably should be split.
Effort measures implementation size and uncertainty, NEVER urgency or business priority. Classify only from the supplied scope. Do not infer from status, timestamps, or elapsed duration.`;

    try {
      const suggestions: any[] = [];
      for (let offset = 0; offset < tasks.length; offset += 30) {
        const chunk = tasks.slice(offset, offset + 30).map(task => ({
          taskId: task.id,
          title: task.title,
          description: (task.description || '').slice(0, 800),
          technicalDetails: (task.prompt || '').slice(0, 1200),
          subtasks: task.subtasks?.map(item => item.title).slice(0, 20),
        }));
        const result = await aiBackend.generateText(systemInstructions, JSON.stringify(chunk), { maxTokens: 4096, timeout: 60_000 });
        const parsed = parseJsonResponse(result.text);
        if (Array.isArray(parsed)) suggestions.push(...parsed);
      }
      const byId = new Map(tasks.map(task => [task.id, task]));
      return {
        suggestions: suggestions.flatMap(item => {
          const task = byId.get(String(item.taskId));
          const effort = parseEffort(item.effort);
          if (!task || !effort) return [];
          const confidence = ['low', 'medium', 'high'].includes(item.confidence) ? item.confidence : 'medium';
          return [{ taskId: task.id, title: task.title, effort, confidence, rationale: String(item.rationale || '').slice(0, 240) }];
        }),
      };
    } catch (err: any) {
      if (err.status === 429) return reply.status(429).send({ error: 'Rate limit reached. Please wait a moment and try again.' });
      const status = err instanceof aiBackend.NoAiAvailableError ? 503 : 500;
      log.error('claude', 'Effort classification failed', err.message, projectId);
      return reply.status(status).send({ error: err.message });
    }
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
- effort: Fibonacci point 1, 2, 3, 5, or 8 based on implementation size, never urgency

Respond ONLY with valid JSON array, no markdown fences. Example:
[{"title":"...","description":"...","prompt":"...","priority":"medium","effort":3,"status":"todo"}]`;

    try {
      const result = await aiBackend.generateText(systemInstructions, rawText, { maxTokens: 4096, timeout: 60_000 });
      const parsed = parseJsonResponse(result.text);
      return { tasks: Array.isArray(parsed) ? parsed : [] };
    } catch (err: any) {
      if (err.status === 429) return reply.status(429).send({ error: 'Rate limit reached. Please wait a moment and try again.' });
      const status = err instanceof aiBackend.NoAiAvailableError ? 503 : 500;
      log.error('claude', 'Bulk organize failed', err.message, projectId);
      return reply.status(status).send({ error: err.message });
    }
  });

  // Manage tasks — smart AI tool: create, update, deduplicate, organize
  app.post<{
    Body: {
      projectId: string;
      rawText: string;
      existingTasks: Array<{ id: string; title: string; description: string; status: string; priority: string; effort?: 1 | 2 | 3 | 5 | 8 }>;
    }
  }>('/api/claude/manage-tasks', async (request, reply) => {
    const { projectId, rawText, existingTasks } = request.body;
    if (!rawText?.trim()) {
      return reply.status(400).send({ error: 'No text provided' });
    }

    const context = await buildProjectContext(projectId);

    const taskList = existingTasks.map(t =>
      `  - [${t.id}] "${t.title}" (${t.status}, ${t.priority}, effort ${t.effort ?? 'unclassified'})${t.description ? ` — ${t.description.substring(0, 100)}` : ''}`
    ).join('\n');

    const systemInstructions = `You are a task management AI assistant for a software development project. ${context}

EXISTING TASKS IN THIS PROJECT:
${taskList || '(no tasks yet)'}

The user will paste text that could be:
- New task descriptions, notes, or requirements in any format
- Instructions to modify existing tasks (e.g. "mark all tasks about login as done")
- A mix of both

Analyze the text and determine the appropriate actions:

ACTION TYPES:
1. "create" — new task to add. Include: title, description, prompt, priority (urgent/high/medium/low), effort (1/2/3/5/8), status (todo/in_progress/done)
2. "update" — modify an existing task. Include: taskId (from existing list), changes object with fields to update, reason
3. "skip" — detected duplicate or already existing task. Include: title, existingTaskId, reason

RULES:
- Compare new items against existing tasks by title/meaning similarity. If a very similar task exists, use "skip" or "update" instead of "create"
- For "mark as done" type instructions, find matching existing tasks and use "update" with status change
- Set appropriate priorities based on urgency words (ASAP, critical, urgent → urgent/high)
- ALWAYS assign effort using Fibonacci points: 1 trivial, 2 small, 3 medium, 5 large/cross-layer, 8 very large or uncertain. Effort is size, not priority.
- Generate clear descriptions (user-facing) and technical prompts (implementation details) for new tasks
- Be smart about interpreting intent — the text may be informal notes, client emails, meeting notes, etc.

Respond ONLY with valid JSON (no markdown fences):
{
  "actions": [
    { "type": "create", "task": { "title": "...", "description": "...", "prompt": "...", "priority": "medium", "effort": 3, "status": "todo" } },
    { "type": "update", "taskId": "abc123", "changes": { "status": "done" }, "reason": "User requested to mark as done" },
    { "type": "skip", "title": "...", "existingTaskId": "xyz", "reason": "Duplicate of existing task" }
  ],
  "summary": "Brief summary of what was done"
}`;

    try {
      const result = await aiBackend.generateText(systemInstructions, rawText, { maxTokens: 4096, timeout: 60_000 });
      const parsed = parseJsonResponse(result.text);
      return {
        actions: Array.isArray(parsed.actions) ? parsed.actions : [],
        summary: parsed.summary || '',
      };
    } catch (err: any) {
      if (err.status === 429) return reply.status(429).send({ error: 'Rate limit reached. Please wait a moment and try again.' });
      const status = err instanceof aiBackend.NoAiAvailableError ? 503 : 500;
      log.error('claude', 'Manage tasks failed', err.message, projectId);
      return reply.status(status).send({ error: err.message });
    }
  });

}
