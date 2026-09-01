import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { detectCli } from './cliDetect.js';
import { runCli, streamCli } from './cliRunner.js';

const CLI_BIN = 'claude';

export async function isCliAvailable(): Promise<boolean> {
  return (await detectCli(CLI_BIN)).available;
}

/** Cached availability check (detectCli re-probes at most once a minute). */
export async function getCliStatus(): Promise<boolean> {
  return (await detectCli(CLI_BIN)).available;
}

/**
 * Read the Claude CLI's OAuth token from ~/.claude/.credentials.json.
 * Returns the access token if valid, null otherwise.
 * This allows us to call the Anthropic API directly using the Max subscription
 * without spawning the CLI process (which has Windows stdout piping issues).
 */
let cachedOAuthToken: string | null = null;
let oauthTokenExpiry = 0;
let cachedPlan: OAuthPlan | null = null;

/** Subscription metadata carried alongside the token in .credentials.json */
export interface OAuthPlan {
  /** 'max' | 'pro' | 'free' | … — whatever the CLI last wrote */
  subscriptionType: string | null;
  /** e.g. 'default_claude_max_5x' */
  rateLimitTier: string | null;
}

export async function getOAuthToken(): Promise<string | null> {
  // Return cached token if still valid (with 5min buffer)
  if (cachedOAuthToken && Date.now() < oauthTokenExpiry - 5 * 60_000) {
    return cachedOAuthToken;
  }
  try {
    const credPath = join(homedir(), '.claude', '.credentials.json');
    const raw = await readFile(credPath, 'utf-8');
    const creds = JSON.parse(raw);
    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken || !oauth?.expiresAt) return null;
    if (Date.now() > new Date(oauth.expiresAt).getTime()) return null;
    cachedOAuthToken = oauth.accessToken;
    oauthTokenExpiry = new Date(oauth.expiresAt).getTime();
    cachedPlan = {
      subscriptionType: oauth.subscriptionType ?? null,
      rateLimitTier: oauth.rateLimitTier ?? null,
    };
    return cachedOAuthToken;
  } catch {
    return null;
  }
}

/**
 * Subscription plan from the credentials file. Populated as a side effect of
 * getOAuthToken() — call that first, or this returns null.
 */
export function getOAuthPlan(): OAuthPlan | null {
  return cachedPlan;
}

// OAuth access tokens are NOT API keys: they must be sent as a Bearer token
// with the oauth beta header. Sending them via x-api-key returns 401.
export function oauthHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'oauth-2025-04-20',
  };
}

/**
 * Call the Anthropic API directly using the CLI's OAuth token.
 * This is faster and more reliable than spawning the CLI process,
 * especially on Windows where the CLI has stdout buffering issues.
 */
export async function callApiWithOAuth(
  systemPrompt: string,
  userMessage: string,
  options?: { model?: string; maxTokens?: number; timeout?: number }
): Promise<string> {
  const token = await getOAuthToken();
  if (!token) throw new Error('No OAuth token available');

  const controller = new AbortController();
  const timeout = options?.timeout ?? 30_000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: oauthHeaders(token),
      body: JSON.stringify({
        model: options?.model ?? 'claude-haiku-4-5-20251001',
        max_tokens: options?.maxTokens ?? 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      // Preserve status code in error so callers can distinguish rate limits (429)
      const message = response.status === 429
        ? 'Rate limit reached on your Claude subscription. Wait a moment and try again.'
        : `API error ${response.status}: ${body.slice(0, 200)}`;
      const err = new Error(message);
      (err as any).status = response.status;
      throw err;
    }

    const data = await response.json() as any;
    const text = data.content?.[0]?.type === 'text' ? data.content[0].text : '';
    return text.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stream a response from the Anthropic API using the CLI's OAuth token.
 * Yields text fragments as they arrive (SSE `content_block_delta` events).
 * Lets chat use the Max subscription with real streaming instead of
 * spawning the CLI process.
 */
export async function* streamApiWithOAuth(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options?: { model?: string; maxTokens?: number; timeout?: number }
): AsyncGenerator<string> {
  const token = await getOAuthToken();
  if (!token) throw new Error('No OAuth token available');

  const controller = new AbortController();
  // Activity timeout: aborts if no bytes arrive for `timeout` ms
  const timeout = options?.timeout ?? 60_000;
  let timer = setTimeout(() => controller.abort(), timeout);
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), timeout);
  };

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: oauthHeaders(token),
      body: JSON.stringify({
        model: options?.model ?? 'claude-sonnet-4-5-20250929',
        max_tokens: options?.maxTokens ?? 4096,
        system: systemPrompt,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) {
      const body = await response.text().catch(() => '');
      const message = response.status === 429
        ? 'Rate limit reached on your Claude subscription. Wait a moment and try again.'
        : `API error ${response.status}: ${body.slice(0, 200)}`;
      const err = new Error(message);
      (err as any).status = response.status;
      throw err;
    }

    // Parse the SSE stream: lines of `data: {...}` separated by blank lines
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of response.body as any) {
      resetTimer();
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            yield event.delta.text as string;
          } else if (event.type === 'error') {
            throw new Error(event.error?.message || 'Stream error');
          }
        } catch (err) {
          if (err instanceof SyntaxError) continue; // partial/malformed line — skip
          throw err;
        }
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface RunPromptOptions {
  input?: string;
  model?: string;
  outputFormat?: 'text' | 'json';
  timeout?: number;
  /** Absolute deadline — kills the process after this many ms regardless of activity */
  hardTimeout?: number;
  cwd?: string;
  /** Skip hooks, LSP, CLAUDE.md discovery — faster for simple prompts */
  bare?: boolean;
}

/**
 * Build CLI args with prompt as positional argument (after all flags).
 * This avoids Windows stdin piping issues where spawn() fails to deliver
 * piped data to the child process, causing the CLI to hang waiting for input.
 */
function buildCliArgs(prompt: string, options?: RunPromptOptions): string[] {
  const args: string[] = ['-p'];
  if (options?.model) args.push('--model', options.model);
  if (options?.outputFormat) args.push('--output-format', options.outputFormat);
  if (options?.bare) args.push('--bare');
  args.push('--no-session-persistence');
  // Prompt as positional argument — must come after all flags
  args.push(prompt);
  return args;
}

function buildCliEnv(): NodeJS.ProcessEnv {
  // Remove ANTHROPIC_API_KEY to force subscription usage
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}


/**
 * Run a prompt and return the full response.
 *
 * The prompt is passed as a CLI positional argument. If `options.input` is
 * provided (e.g. a git diff), it is sent via stdin.
 */
export async function runPrompt(prompt: string, options?: RunPromptOptions): Promise<string> {
  const { command, prefixArgs } = await detectCli(CLI_BIN);
  return runCli(command, [...prefixArgs, ...buildCliArgs(prompt, options)], {
    input: options?.input,
    timeout: options?.timeout ?? 60_000,
    hardTimeout: options?.hardTimeout,
    cwd: options?.cwd,
    env: buildCliEnv(),
    label: 'Claude CLI',
  });
}

/**
 * Stream a prompt response chunk-by-chunk via async generator.
 * Each yield is a text fragment from stdout as it arrives.
 */
export async function* streamPrompt(prompt: string, options?: RunPromptOptions): AsyncGenerator<string> {
  const { command, prefixArgs } = await detectCli(CLI_BIN);
  yield* streamCli(command, [...prefixArgs, ...buildCliArgs(prompt, options)], {
    input: options?.input,
    timeout: options?.timeout ?? 120_000,
    cwd: options?.cwd,
    env: buildCliEnv(),
    label: 'Claude CLI',
  });
}
