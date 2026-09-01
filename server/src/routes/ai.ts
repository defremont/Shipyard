import { FastifyInstance } from 'fastify';
import * as aiBackend from '../services/aiBackend.js';
import * as claudeService from '../services/claudeService.js';
import * as openaiService from '../services/openaiService.js';
import * as geminiService from '../services/geminiService.js';
import {
  CHAT_MODELS,
  deleteProviderConfig,
  getProviderConfig,
  isAiProvider,
  saveProviderConfig,
  setPreferredProvider,
  type AiProvider,
} from '../services/aiConfigStore.js';

const KEEP = '__keep__';

function testKey(provider: AiProvider, apiKey: string) {
  if (provider === 'claude') return claudeService.testApiKey(apiKey);
  if (provider === 'openai') return openaiService.testApiKey(apiKey);
  return geminiService.testApiKey(apiKey);
}

export async function aiRoutes(app: FastifyInstance) {
  // Status of every provider — CLI detection plus whether a key is stored.
  // Never exposes a key.
  app.get('/api/ai/status', async () => aiBackend.getBackendStatus());

  // Provider used first by every AI feature
  app.post<{ Body: { provider: string } }>('/api/ai/preferred', async (request, reply) => {
    const { provider } = request.body;
    if (!isAiProvider(provider)) {
      return reply.status(400).send({ error: `Unknown provider: ${provider}` });
    }
    await setPreferredProvider(provider);
    return { ok: true };
  });

  // Save one provider's API key. `__keep__` updates model/maxTokens only.
  app.post<{
    Params: { provider: string };
    Body: { apiKey: string; model?: string; maxTokens?: number };
  }>('/api/ai/config/:provider', async (request, reply) => {
    const { provider } = request.params;
    if (!isAiProvider(provider)) {
      return reply.status(400).send({ error: `Unknown provider: ${provider}` });
    }
    const { apiKey, model, maxTokens } = request.body;

    if (apiKey === KEEP) {
      const existing = await getProviderConfig(provider);
      if (!existing) return reply.status(400).send({ error: 'No existing key to keep' });
      await saveProviderConfig(provider, {
        apiKey: existing.apiKey,
        model: model || existing.model,
        maxTokens: maxTokens || existing.maxTokens,
      });
      return { ok: true };
    }

    if (!apiKey?.trim()) return reply.status(400).send({ error: 'API key is required' });
    await saveProviderConfig(provider, {
      apiKey: apiKey.trim(),
      model: model || CHAT_MODELS[provider],
      maxTokens: maxTokens || 4096,
    });
    return { ok: true };
  });

  app.delete<{ Params: { provider: string } }>('/api/ai/config/:provider', async (request, reply) => {
    const { provider } = request.params;
    if (!isAiProvider(provider)) {
      return reply.status(400).send({ error: `Unknown provider: ${provider}` });
    }
    await deleteProviderConfig(provider);
    return { ok: true };
  });

  // Round-trip a key against the provider before saving it
  app.post<{
    Params: { provider: string };
    Body: { apiKey: string };
  }>('/api/ai/config/:provider/test', async (request, reply) => {
    const { provider } = request.params;
    if (!isAiProvider(provider)) {
      return reply.status(400).send({ error: `Unknown provider: ${provider}` });
    }
    return testKey(provider, request.body.apiKey);
  });
}
