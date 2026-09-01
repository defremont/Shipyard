import Anthropic from '@anthropic-ai/sdk';
import type { ClaudeConfig, ChatMessage } from '../types/index.js';
import {
  CHAT_MODELS,
  deleteProviderConfig,
  getProviderConfig,
  saveProviderConfig,
} from './aiConfigStore.js';

// Anthropic-specific client code. Credentials live in aiConfigStore, which
// holds every provider's key in one encrypted file.

export async function loadClaudeConfig(): Promise<ClaudeConfig | null> {
  return getProviderConfig('claude');
}

export async function saveClaudeConfig(config: ClaudeConfig): Promise<void> {
  await saveProviderConfig('claude', config);
}

export async function deleteClaudeConfig(): Promise<void> {
  await deleteProviderConfig('claude');
}

export async function testApiKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const client = new Anthropic({ apiKey });
    await client.messages.create({
      model: CHAT_MODELS.claude,
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Invalid API key' };
  }
}

export async function* streamChat(
  config: ClaudeConfig,
  messages: ChatMessage[],
  systemPrompt: string,
): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: 120_000 });

  const stream = client.messages.stream({
    model: config.model,
    max_tokens: config.maxTokens,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

// Structured-output helpers (analyze, bulk organize, manage tasks) live in
// aiBackend.ts, which routes them through the provider chain.
