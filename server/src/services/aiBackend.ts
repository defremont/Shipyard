import * as claudeCliService from './claudeCliService.js';
import * as claudeService from './claudeService.js';
import * as openaiService from './openaiService.js';
import * as geminiService from './geminiService.js';
import {
  AI_PROVIDERS,
  CHAT_MODELS,
  FAST_MODELS,
  PROVIDER_LABELS,
  getPreferredProvider,
  getProviderConfig,
  type AiProvider,
} from './aiConfigStore.js';

// Unified AI backend for all server-side AI features (commit messages, task
// analysis, bulk organize, manage tasks, chat).
//
// Three providers are supported — Claude, OpenAI and Gemini. The user picks a
// preferred one in Settings; the others are tried after it, so a feature keeps
// working when the preferred provider is missing or down.
//
// Inside every provider the order is CLI-first — the CLI runs on the user's
// subscription at no per-token cost, the configured API key is a paid fallback:
//   claude: OAuth token (~/.claude/.credentials.json) → `claude -p` → API key
//   openai: `codex exec`                                            → API key
//   gemini: `gemini -p`                                             → API key
//
// Every AI route should go through generateText()/streamText() so this
// behavior stays consistent across features.

export type { AiProvider };
export { AI_PROVIDERS, PROVIDER_LABELS };

/** Kept for callers that predate multi-provider support. */
export const FAST_MODEL = FAST_MODELS.claude;
export const CHAT_MODEL = CHAT_MODELS.claude;

export type AiSource = 'cli' | 'api';
export type ActiveBackend = 'cli-oauth' | 'cli' | 'api';

export class NoAiAvailableError extends Error {
  statusCode = 503;
  constructor() {
    super('No AI backend available. Install one of the AI CLIs (claude, codex, gemini) or configure an API key in Settings.');
    this.name = 'NoAiAvailableError';
  }
}

export interface GenerateOptions {
  model?: string;
  maxTokens?: number;
  timeout?: number;
  /** Working directory for the CLI subprocess fallback */
  cwd?: string;
  /** Force one provider instead of walking the preference chain */
  provider?: AiProvider;
}

export interface GenerateResult {
  text: string;
  source: AiSource;
  provider: AiProvider;
}

export interface ProviderStatus {
  provider: AiProvider;
  label: string;
  /** Command name the provider's CLI is detected under */
  cliCommand: string;
  cliAvailable: boolean;
  /** Claude only: a valid OAuth token means API calls run on the subscription */
  oauthAvailable: boolean;
  apiConfigured: boolean;
  model: string | null;
  maxTokens: number | null;
  /** Which backend this provider would use right now */
  activeBackend: ActiveBackend | null;
}

export interface BackendStatus {
  preferredProvider: AiProvider;
  /** Provider that would actually answer right now */
  activeProvider: AiProvider | null;
  activeBackend: ActiveBackend | null;
  providers: ProviderStatus[];
  // Flat Claude-shaped fields, kept so /api/claude/status stays compatible.
  cliAvailable: boolean;
  oauthAvailable: boolean;
  apiConfigured: boolean;
  model: string | null;
  maxTokens: number | null;
}

const CLI_COMMANDS: Record<AiProvider, string> = {
  claude: 'claude',
  openai: 'codex',
  gemini: 'gemini',
};

/** Preferred provider first, then the rest in declaration order. */
function providerChain(preferred: AiProvider): AiProvider[] {
  return [preferred, ...AI_PROVIDERS.filter(p => p !== preferred)];
}

async function providerStatus(provider: AiProvider): Promise<ProviderStatus> {
  const [cliAvailable, oauthToken, config] = await Promise.all([
    provider === 'claude' ? claudeCliService.getCliStatus()
      : provider === 'openai' ? openaiService.getCliStatus()
      : geminiService.getCliStatus(),
    provider === 'claude' ? claudeCliService.getOAuthToken() : Promise.resolve(null),
    getProviderConfig(provider),
  ]);
  const oauthAvailable = !!oauthToken;
  return {
    provider,
    label: PROVIDER_LABELS[provider],
    cliCommand: CLI_COMMANDS[provider],
    cliAvailable,
    oauthAvailable,
    apiConfigured: !!config,
    model: config?.model ?? null,
    maxTokens: config?.maxTokens ?? null,
    activeBackend: oauthAvailable ? 'cli-oauth' : cliAvailable ? 'cli' : config ? 'api' : null,
  };
}

export async function getBackendStatus(): Promise<BackendStatus> {
  const preferredProvider = await getPreferredProvider();
  const providers = await Promise.all(AI_PROVIDERS.map(providerStatus));
  const byId = new Map(providers.map(p => [p.provider, p]));
  const active = providerChain(preferredProvider)
    .map(p => byId.get(p)!)
    .find(p => p.activeBackend !== null) ?? null;
  const claude = byId.get('claude')!;

  return {
    preferredProvider,
    activeProvider: active?.provider ?? null,
    activeBackend: active?.activeBackend ?? null,
    providers,
    cliAvailable: claude.cliAvailable,
    oauthAvailable: claude.oauthAvailable,
    apiConfigured: claude.apiConfigured,
    model: claude.model,
    maxTokens: claude.maxTokens,
  };
}

/** Flatten a chat history into a single prompt for CLIs that take one shot. */
function flattenMessages(messages: Array<{ role: 'user' | 'assistant'; content: string }>): string {
  const parts: string[] = [];
  if (messages.length > 1) {
    parts.push('Previous conversation:');
    for (const msg of messages.slice(0, -1)) {
      parts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`);
    }
    parts.push('');
  }
  parts.push(`User: ${messages[messages.length - 1].content}`);
  return parts.join('\n');
}

/**
 * Walk one provider's backends in order. Returns null when the provider has
 * nothing usable; pushes the reason into `errors` when a backend was tried and
 * failed. A 429 is recorded in `rateLimit` and ends that provider's turn — the
 * next provider still gets a chance.
 */
async function tryProviderGenerate(
  provider: AiProvider,
  systemPrompt: string,
  userMessage: string,
  options: GenerateOptions | undefined,
  errors: string[],
  rateLimit: { err?: any },
): Promise<GenerateResult | null> {
  const timeout = options?.timeout ?? 30_000;

  if (provider === 'claude') {
    // 1. OAuth token → direct API call on the subscription
    if (await claudeCliService.getOAuthToken()) {
      try {
        const text = await claudeCliService.callApiWithOAuth(systemPrompt, userMessage, {
          model: options?.model ?? FAST_MODELS.claude,
          maxTokens: options?.maxTokens ?? 1024,
          timeout,
        });
        return { text, source: 'cli', provider };
      } catch (err: any) {
        if (err.status === 429) { rateLimit.err = err; return null; }
        errors.push(`claude oauth: ${err.message}`);
      }
    }

    // 2. CLI subprocess — works when the credentials file is absent (OS
    //    keychain storage) as long as `claude` is logged in
    if (await claudeCliService.getCliStatus()) {
      try {
        const text = await claudeCliService.runPrompt(`${systemPrompt}\n\n---\n\n${userMessage}`, {
          model: 'haiku',
          timeout: options?.timeout ?? 60_000,
          hardTimeout: (options?.timeout ?? 60_000) * 2,
          cwd: options?.cwd,
        });
        return { text: text.trim(), source: 'cli', provider };
      } catch (err: any) {
        errors.push(`claude cli: ${err.message}`);
      }
    }
  }

  if (provider === 'openai' && await openaiService.getCliStatus()) {
    try {
      const text = await openaiService.generateWithCli(systemPrompt, userMessage, {
        timeout: options?.timeout ?? 90_000,
        cwd: options?.cwd,
      });
      if (text) return { text, source: 'cli', provider };
      errors.push('codex cli: empty response');
    } catch (err: any) {
      errors.push(`codex cli: ${err.message}`);
    }
  }

  if (provider === 'gemini' && await geminiService.getCliStatus()) {
    try {
      const text = await geminiService.generateWithCli(systemPrompt, userMessage, {
        timeout: options?.timeout ?? 60_000,
        cwd: options?.cwd,
      });
      if (text) return { text, source: 'cli', provider };
      errors.push('gemini cli: empty response');
    } catch (err: any) {
      errors.push(`gemini cli: ${err.message}`);
    }
  }

  // Last resort for every provider: the configured API key (paid).
  const config = await getProviderConfig(provider);
  if (!config) return null;
  const model = options?.model ?? FAST_MODELS[provider];
  const maxTokens = options?.maxTokens ?? 1024;
  try {
    if (provider === 'claude') {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey: config.apiKey, timeout });
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return { text: text.trim(), source: 'api', provider };
    }
    const call = provider === 'openai' ? openaiService.callApi : geminiService.callApi;
    const text = await call(config.apiKey, systemPrompt, userMessage, { model, maxTokens, timeout });
    return { text, source: 'api', provider };
  } catch (err: any) {
    if (err.status === 429) { rateLimit.err = err; return null; }
    errors.push(`${provider} api: ${err.message}`);
    return null;
  }
}

/**
 * Generate a single text completion using the best available backend.
 * Throws NoAiAvailableError when no backend is usable. A rate limit is only
 * surfaced after every other provider has been tried.
 */
export async function generateText(
  systemPrompt: string,
  userMessage: string,
  options?: GenerateOptions,
): Promise<GenerateResult> {
  const errors: string[] = [];
  const rateLimit: { err?: any } = {};
  const chain = options?.provider ? [options.provider] : providerChain(await getPreferredProvider());

  for (const provider of chain) {
    const result = await tryProviderGenerate(provider, systemPrompt, userMessage, options, errors, rateLimit);
    if (result) return result;
  }

  if (rateLimit.err) throw rateLimit.err;
  if (errors.length > 0) throw new Error(`All AI backends failed — ${errors.join('; ')}`);
  throw new NoAiAvailableError();
}

export interface StreamHandle {
  stream: AsyncGenerator<string>;
  source: AiSource;
  provider: AiProvider;
}

/** First usable streaming backend for one provider, or null. */
async function tryProviderStream(
  provider: AiProvider,
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options?: GenerateOptions,
): Promise<StreamHandle | null> {
  if (provider === 'claude') {
    if (await claudeCliService.getOAuthToken()) {
      return {
        stream: claudeCliService.streamApiWithOAuth(systemPrompt, messages, {
          model: options?.model ?? CHAT_MODELS.claude,
          maxTokens: options?.maxTokens ?? 4096,
          timeout: options?.timeout ?? 60_000,
        }),
        source: 'cli',
        provider,
      };
    }
    if (await claudeCliService.getCliStatus()) {
      return {
        stream: claudeCliService.streamPrompt(`${systemPrompt}\n\n${flattenMessages(messages)}`, {
          model: 'sonnet',
          timeout: options?.timeout ?? 300_000,
          cwd: options?.cwd,
        }),
        source: 'cli',
        provider,
      };
    }
  }

  if (provider === 'openai' && await openaiService.getCliStatus()) {
    return {
      stream: openaiService.streamWithCli(systemPrompt, flattenMessages(messages), {
        timeout: options?.timeout ?? 300_000,
        cwd: options?.cwd,
      }),
      source: 'cli',
      provider,
    };
  }

  if (provider === 'gemini' && await geminiService.getCliStatus()) {
    return {
      stream: geminiService.streamWithCli(systemPrompt, flattenMessages(messages), {
        timeout: options?.timeout ?? 300_000,
        cwd: options?.cwd,
      }),
      source: 'cli',
      provider,
    };
  }

  const config = await getProviderConfig(provider);
  if (!config) return null;
  const model = options?.model ?? config.model ?? CHAT_MODELS[provider];
  const maxTokens = options?.maxTokens ?? config.maxTokens ?? 4096;

  if (provider === 'claude') {
    return { stream: claudeService.streamChat(config, messages as any, systemPrompt), source: 'api', provider };
  }
  const stream = provider === 'openai'
    ? openaiService.streamApi(config.apiKey, systemPrompt, messages, { model, maxTokens, timeout: options?.timeout })
    : geminiService.streamApi(config.apiKey, systemPrompt, messages, { model, maxTokens, timeout: options?.timeout });
  return { stream, source: 'api', provider };
}

/**
 * Stream a chat completion using the best available backend.
 * Same provider order as generateText(); every backend supports streaming,
 * though the Codex CLI can only deliver its answer in one piece.
 */
export async function streamText(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  options?: GenerateOptions,
): Promise<StreamHandle> {
  const chain = options?.provider ? [options.provider] : providerChain(await getPreferredProvider());
  for (const provider of chain) {
    const handle = await tryProviderStream(provider, systemPrompt, messages, options);
    if (handle) return handle;
  }
  throw new NoAiAvailableError();
}
