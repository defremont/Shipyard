import { detectCli } from './cliDetect.js';
import { runCli, streamCli } from './cliRunner.js';
import { iterateSseJson, httpError } from './sseStream.js';

// Gemini backend: the Gemini CLI first (it runs on the user's Google account),
// then a configured API key.

const CLI_BIN = 'gemini';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export async function getCliStatus(): Promise<boolean> {
  return (await detectCli(CLI_BIN)).available;
}

// ── Gemini CLI ───────────────────────────────────────────────────────────

/** Status lines the CLI prints before the answer; they are not part of it. */
const NOISE_LINE = /^(Loaded cached credentials\.|Data collection is (dis|en)abled\.|Flushing log events.*)$/;

function stripNoise(text: string): string {
  return text
    .split(/\r?\n/)
    .filter(line => !NOISE_LINE.test(line.trim()))
    .join('\n')
    .trim();
}

function cliArgs(prompt: string, model?: string): string[] {
  const args: string[] = [];
  if (model) args.push('-m', model);
  args.push('-p', prompt);
  return args;
}

export async function generateWithCli(
  systemPrompt: string,
  userMessage: string,
  options?: { timeout?: number; cwd?: string; model?: string },
): Promise<string> {
  const { command, prefixArgs } = await detectCli(CLI_BIN);
  const args = [...prefixArgs, ...cliArgs(`${systemPrompt}\n\n---\n\n${userMessage}`, options?.model)];
  const raw = await runCli(command, args, {
    timeout: options?.timeout ?? 60_000,
    hardTimeout: (options?.timeout ?? 60_000) * 2,
    cwd: options?.cwd,
    label: 'Gemini CLI',
  });
  return stripNoise(raw);
}

/**
 * The CLI writes the answer to stdout as it goes, so this is a real stream.
 * Noise lines are dropped line-by-line; the tail is flushed at the end.
 */
export async function* streamWithCli(
  systemPrompt: string,
  prompt: string,
  options?: { timeout?: number; cwd?: string; model?: string },
): AsyncGenerator<string> {
  const { command, prefixArgs } = await detectCli(CLI_BIN);
  const args = [...prefixArgs, ...cliArgs(`${systemPrompt}\n\n${prompt}`, options?.model)];
  let buffer = '';
  for await (const chunk of streamCli(command, args, {
    timeout: options?.timeout ?? 300_000,
    cwd: options?.cwd,
    label: 'Gemini CLI',
  })) {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!NOISE_LINE.test(line.trim())) yield `${line}\n`;
    }
  }
  if (buffer && !NOISE_LINE.test(buffer.trim())) yield buffer;
}

// ── Gemini API ───────────────────────────────────────────────────────────

function buildBody(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  maxTokens: number,
): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messages.map(m => ({
      // Gemini calls the assistant turn "model".
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: maxTokens },
  };
}

function textFromCandidate(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p: any) => (typeof p.text === 'string' ? p.text : '')).join('');
}

export async function callApi(
  apiKey: string,
  systemPrompt: string,
  userMessage: string,
  options?: { model?: string; maxTokens?: number; timeout?: number },
): Promise<string> {
  const model = options?.model ?? 'gemini-2.5-flash';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeout ?? 30_000);
  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildBody(systemPrompt, [{ role: 'user', content: userMessage }], options?.maxTokens ?? 1024)),
      signal: controller.signal,
    });
    if (!response.ok) throw await httpError(response, 'Gemini');
    return textFromCandidate(await response.json()).trim();
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
  const model = options?.model ?? 'gemini-2.5-pro';
  const controller = new AbortController();
  const timeout = options?.timeout ?? 60_000;
  let timer = setTimeout(() => controller.abort(), timeout);
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeout);
  };

  try {
    const response = await fetch(`${API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(buildBody(systemPrompt, messages, options?.maxTokens ?? 4096)),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw await httpError(response, 'Gemini');

    for await (const event of iterateSseJson(response.body as any, resetTimer)) {
      const text = textFromCandidate(event);
      if (text) yield text;
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
