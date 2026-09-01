import { detectCli } from './cliDetect.js';
import { runCli } from './cliRunner.js';
import { iterateSseJson, httpError } from './sseStream.js';

// OpenAI backend: the Codex CLI first (it runs on the user's ChatGPT plan),
// then a configured API key.

const CLI_BIN = 'codex';
const API_URL = 'https://api.openai.com/v1/chat/completions';

export async function getCliStatus(): Promise<boolean> {
  return (await detectCli(CLI_BIN)).available;
}

/** Models that only accept `max_completion_tokens` and reject `temperature`. */
function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/.test(model);
}

// ── Codex CLI ────────────────────────────────────────────────────────────

/**
 * `codex exec --json` emits one JSON object per line. The shape has changed
 * across releases, so accept every variant we have seen and fall back to the
 * raw stdout when none of them match.
 */
function parseCodexJsonl(raw: string): string {
  const deltas: string[] = [];
  let message = '';
  let sawJson = false;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: any;
    try { event = JSON.parse(trimmed); } catch { continue; }
    sawJson = true;

    // Current: { type: 'item.completed', item: { type: 'agent_message', text } }
    if (event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
      message = event.item.text;
      continue;
    }
    // Older: { msg: { type: 'agent_message' | 'agent_message_delta', ... } }
    const msg = event.msg ?? event;
    if (msg?.type === 'agent_message_delta' && typeof msg.delta === 'string') {
      deltas.push(msg.delta);
    } else if (msg?.type === 'agent_message' && typeof msg.message === 'string') {
      message = msg.message;
    }
  }

  if (message.trim()) return message.trim();
  if (deltas.length > 0) return deltas.join('').trim();
  if (sawJson) return '';
  return raw.trim();
}

async function runCodex(prompt: string, options?: { timeout?: number; cwd?: string; model?: string }): Promise<string> {
  const { command, prefixArgs } = await detectCli(CLI_BIN);
  // The prompt goes on stdin (`-`), so it never has to survive argument quoting.
  const base = [...prefixArgs, 'exec', '--json'];
  if (options?.model) base.push('--model', options.model);

  const run = (args: string[]) => runCli(command, args, {
    input: prompt,
    timeout: options?.timeout ?? 90_000,
    hardTimeout: (options?.timeout ?? 90_000) * 2,
    cwd: options?.cwd,
    label: 'Codex CLI',
  });

  try {
    // Codex refuses to run outside a git repo unless told to skip the check.
    return parseCodexJsonl(await run([...base, '--skip-git-repo-check', '-']));
  } catch (err: any) {
    // Older builds do not know that flag; retry without it rather than giving up.
    if (!/unexpected argument|unrecognized|unknown (option|flag)/i.test(err.message || '')) throw err;
    return parseCodexJsonl(await run([...base, '-']));
  }
}

// ── OpenAI API ───────────────────────────────────────────────────────────

function buildBody(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    stream,
  };
  if (isReasoningModel(model)) body.max_completion_tokens = maxTokens;
  else body.max_tokens = maxTokens;
  return body;
}

export async function callApi(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: { model?: string; maxTokens?: number; timeout?: number },
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeout ?? 30_000);
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildBody(
        options?.model ?? 'gpt-4.1-mini',
        systemPrompt,
        [{ role: 'user', content: userMessage }],
        options?.maxTokens ?? 1024,
        false,
      )),
      signal: controller.signal,
    });
    if (!response.ok) throw await httpError(response, 'OpenAI');
    const data = await response.json() as any;
    return String(data.choices?.[0]?.message?.content ?? '').trim();
  } finally {
    clearTimeout(timer);
  }
}

export async function* streamApi(
  apiKey: string,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options?: { model?: string; maxTokens?: number; timeout?: number },
): AsyncGenerator<string> {
  const controller = new AbortController();
  const timeout = options?.timeout ?? 60_000;
  let timer = setTimeout(() => controller.abort(), timeout);
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeout);
  };

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(buildBody(
        options?.model ?? 'gpt-4.1',
        systemPrompt,
        messages,
        options?.maxTokens ?? 4096,
        true,
      )),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw await httpError(response, 'OpenAI');

    for await (const event of iterateSseJson(response.body as any, resetTimer)) {
      const delta = event.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) yield delta;
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function testApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await callApi(apiKey, 'Reply with OK.', 'Hi', { maxTokens: 16, timeout: 20_000 });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Invalid API key' };
  }
}

// ── Unified entry points used by aiBackend ───────────────────────────────

export async function generateWithCli(
  systemPrompt: string,
  userMessage: string,
  options?: { timeout?: number; cwd?: string },
): Promise<string> {
  return runCodex(`${systemPrompt}\n\n---\n\n${userMessage}`, options);
}

/**
 * Codex has no usable token-by-token mode here — `--json` is line-buffered and
 * the plain output is decorated with session banners. Run it to completion and
 * emit the answer as one chunk.
 */
export async function* streamWithCli(
  systemPrompt: string,
  prompt: string,
  options?: { timeout?: number; cwd?: string },
): AsyncGenerator<string> {
  yield await runCodex(`${systemPrompt}\n\n${prompt}`, { ...options, timeout: options?.timeout ?? 300_000 });
}
