import * as claudeCliService from './claudeCliService.js';
import * as claudeService from './claudeService.js';

// Unified AI backend for all server-side AI features (commit messages, task
// analysis, bulk organize, manage tasks, chat).
//
// Priority order (CLI-first — the CLI uses the user's subscription at no
// per-token cost; the configured API key is a paid fallback):
//   1. Claude CLI OAuth token (~/.claude/.credentials.json) → direct API call
//   2. Claude CLI subprocess (`claude -p`)
//   3. Configured API key (Shipyard settings — never process.env.ANTHROPIC_API_KEY)
//
// Every AI route should go through generateText()/streamText() so the
// fallback behavior stays consistent across features.

export const FAST_MODEL = 'claude-haiku-4-5-20251001';
export const CHAT_MODEL = 'claude-sonnet-4-5-20250929';

export type AiSource = 'cli' | 'api';

export class NoAiAvailableError extends Error {
  statusCode = 503;
  constructor() {
    super('No AI backend available. Install the Claude CLI (recommended) or configure an API key in Settings.');
    this.name = 'NoAiAvailableError';
  }
}

export interface GenerateOptions {
  model?: string;
  maxTokens?: number;
  timeout?: number;
  /** Working directory for the CLI subprocess fallback */
  cwd?: string;
}

export interface GenerateResult {
  text: string;
  source: AiSource;
}

export interface BackendStatus {
  /** CLI binary detected on PATH */
  cliAvailable: boolean;
  /** Valid OAuth token from the CLI (subscription usage, no token cost) */
  oauthAvailable: boolean;
  /** API key configured in Shipyard settings */
  apiConfigured: boolean;
  /** Which backend generateText() would use right now */
  activeBackend: 'cli-oauth' | 'cli' | 'api' | null;
  model: string | null;
  maxTokens: number | null;
}

export async function getBackendStatus(): Promise<BackendStatus> {
  const [cliAvailable, oauthToken, config] = await Promise.all([
    claudeCliService.getCliStatus(),
    claudeCliService.getOAuthToken(),
    claudeService.loadClaudeConfig(),
  ]);
  const oauthAvailable = !!oauthToken;
  const activeBackend = oauthAvailable ? 'cli-oauth' : cliAvailable ? 'cli' : config ? 'api' : null;
  return {
    cliAvailable,
    oauthAvailable,
    apiConfigured: !!config,
    activeBackend,
    model: config?.model ?? null,
    maxTokens: config?.maxTokens ?? null,
  };
}

/**
 * Generate a single text completion using the best available backend.
 * Throws NoAiAvailableError when no backend is usable; rethrows 429s
 * immediately so callers can surface rate limits.
 */
export async function generateText(
  systemPrompt: string,
  userMessage: string,
  options?: GenerateOptions,
): Promise<GenerateResult> {
  const errors: string[] = [];

  // 1. OAuth token → direct API call on the subscription
  const oauthToken = await claudeCliService.getOAuthToken();
  if (oauthToken) {
    try {
      const text = await claudeCliService.callApiWithOAuth(systemPrompt, userMessage, {
        model: options?.model ?? FAST_MODEL,
        maxTokens: options?.maxTokens ?? 1024,
        timeout: options?.timeout ?? 30_000,
      });
      return { text, source: 'cli' };
    } catch (err: any) {
      if (err.status === 429) throw err; // rate limit — don't burn the fallback
      errors.push(`oauth: ${err.message}`);
    }
  }

  // 2. CLI subprocess — slower but works when the credentials file is absent
  //    (e.g. OS keychain storage) as long as `claude` is logged in
  if (await claudeCliService.getCliStatus()) {
    try {
      const text = await claudeCliService.runPrompt(
        `${systemPrompt}\n\n---\n\n${userMessage}`,
        {
          model: 'haiku',
          timeout: options?.timeout ?? 60_000,
          hardTimeout: (options?.timeout ?? 60_000) * 2,
          cwd: options?.cwd,
        },
      );
      return { text: text.trim(), source: 'cli' };
    } catch (err: any) {
      errors.push(`cli: ${err.message}`);
    }
  }

  // 3. Configured API key (paid fallback)
  const config = await claudeService.loadClaudeConfig();
  if (config) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: config.apiKey, timeout: options?.timeout ?? 30_000 });
    const response = await client.messages.create({
      model: options?.model ?? FAST_MODEL,
      max_tokens: options?.maxTokens ?? 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return { text: text.trim(), source: 'api' };
  }

  if (errors.length > 0) {
    throw new Error(`All AI backends failed — ${errors.join('; ')}`);
  }
  throw new NoAiAvailableError();
}

export interface StreamHandle {
  stream: AsyncGenerator<string>;
  source: AiSource;
}

/**
 * Stream a chat completion using the best available backend.
 * Same priority as generateText(); all three backends support streaming.
 */
export async function streamText(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options?: GenerateOptions,
): Promise<StreamHandle> {
  // 1. OAuth token → streaming API call on the subscription
  const oauthToken = await claudeCliService.getOAuthToken();
  if (oauthToken) {
    return {
      stream: claudeCliService.streamApiWithOAuth(systemPrompt, messages, {
        model: options?.model ?? CHAT_MODEL,
        maxTokens: options?.maxTokens ?? 4096,
        timeout: options?.timeout ?? 60_000,
      }),
      source: 'cli',
    };
  }

  // 2. CLI subprocess streaming (single-turn: conversation flattened into prompt)
  if (await claudeCliService.getCliStatus()) {
    const parts: string[] = [];
    if (messages.length > 1) {
      parts.push('Previous conversation:');
      for (const msg of messages.slice(0, -1)) {
        parts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
      }
      parts.push('');
    }
    parts.push(`User: ${messages[messages.length - 1].content}`);
    return {
      stream: claudeCliService.streamPrompt(`${systemPrompt}\n\n${parts.join('\n')}`, {
        model: 'sonnet',
        timeout: options?.timeout ?? 300_000,
        cwd: options?.cwd,
      }),
      source: 'cli',
    };
  }

  // 3. Configured API key
  const config = await claudeService.loadClaudeConfig();
  if (config) {
    return {
      stream: claudeService.streamChat(config, messages as any, systemPrompt),
      source: 'api',
    };
  }

  throw new NoAiAvailableError();
}
