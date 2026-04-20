import { FastifyInstance } from 'fastify';
import * as log from '../services/logService.js';
import * as store from '../services/syncStore.js';
import type { SyncProviderId } from '../services/syncStore.js';
import * as engine from '../services/sync/syncEngine.js';
import * as trello from '../services/sync/trelloSync.js';
import * as clickup from '../services/sync/clickupSync.js';

function parseProviderId(value: string): SyncProviderId | null {
  return value === 'trello' || value === 'clickup' ? value : null;
}

export async function syncRoutes(app: FastifyInstance) {
  // ── Legacy: Google Sheets proxy (stateless) ─────────────────────────
  // Keep unchanged — the Sheets integration still uses a client-held URL.
  app.post<{
    Body: { url: string; method: 'GET' | 'POST'; payload?: unknown; action?: string };
  }>('/api/sync/proxy', async (request, reply) => {
    const { url, method, payload, action } = request.body;

    if (!url || !url.startsWith('https://script.google.com/macros/s/')) {
      return reply.status(400).send({ error: 'Only Google Apps Script URLs are allowed' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      let fetchUrl = url;
      const fetchOptions: RequestInit = { signal: controller.signal, redirect: 'follow' };

      if (method === 'GET') {
        const queryAction = action || 'read';
        fetchUrl = url + (url.includes('?') ? '&' : '?') + 'action=' + queryAction;
        fetchOptions.method = 'GET';
      } else {
        fetchOptions.method = 'POST';
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        fetchOptions.body = JSON.stringify(payload || {});
      }

      const res = await fetch(fetchUrl, fetchOptions);
      if (!res.ok) return reply.status(502).send({ error: `Apps Script returned status ${res.status}` });

      const text = await res.text();
      try {
        const data = JSON.parse(text);
        return { data };
      } catch {
        return reply.status(502).send({ error: 'Invalid JSON response from Apps Script' });
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        log.warn('sync', 'Apps Script request timed out (15s)');
        return reply.status(504).send({ error: 'Request to Apps Script timed out (15s)' });
      }
      const detail = err.cause?.message || err.cause?.code || '';
      const fullMsg = detail ? `${err.message} (${detail})` : (err.message || 'Failed to reach Apps Script');
      log.error('sync', 'Apps Script proxy failed', fullMsg);
      return reply.status(502).send({ error: fullMsg });
    } finally {
      clearTimeout(timeout);
    }
  });

  app.post<{ Body: { url: string } }>('/api/sync/test', async (request, reply) => {
    const { url } = request.body;
    if (!url || !url.startsWith('https://script.google.com/macros/s/')) {
      return reply.status(400).send({ error: 'Only Google Apps Script URLs are allowed' });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const pingUrl = url + (url.includes('?') ? '&' : '?') + 'action=ping';
      const res = await fetch(pingUrl, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok) return reply.status(502).send({ ok: false, error: `Status ${res.status}` });
      const text = await res.text();
      try { return { ok: true, data: JSON.parse(text) }; }
      catch { return { ok: true, data: { raw: text } }; }
    } catch (err: any) {
      if (err.name === 'AbortError') return reply.status(504).send({ ok: false, error: 'Timeout (10s)' });
      const detail = err.cause?.message || err.cause?.code || '';
      const fullMsg = detail ? `${err.message} (${detail})` : (err.message || 'Connection failed');
      return reply.status(502).send({ ok: false, error: fullMsg });
    } finally {
      clearTimeout(timeout);
    }
  });

  // ── New stateful integrations (Trello, ClickUp) ─────────────────────

  // List all configured integrations (all projects, sanitized).
  app.get('/api/sync/integrations', async () => {
    const configs = await store.listConfigs();
    return { integrations: configs.map(store.sanitize) };
  });

  // Per-project list.
  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/sync',
    async (request) => {
      const configs = await store.listConfigs(request.params.projectId);
      return { integrations: configs.map(store.sanitize) };
    },
  );

  // Save credentials + settings for one provider (merges with existing).
  app.post<{
    Params: { projectId: string; providerId: string };
    Body: {
      settings?: Record<string, any>;
      enabled?: boolean;
      autoSync?: boolean;
    };
  }>('/api/projects/:projectId/sync/:providerId', async (request, reply) => {
    const providerId = parseProviderId(request.params.providerId);
    if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });

    const { settings, enabled, autoSync } = request.body || {};
    const saved = await store.saveConfig({
      projectId: request.params.projectId,
      providerId,
      settings,
      enabled,
      autoSync,
    });
    log.info('sync', `Saved ${providerId} config`, undefined, request.params.projectId);
    return { integration: store.sanitize(saved) };
  });

  // Disconnect (delete config).
  app.delete<{ Params: { projectId: string; providerId: string } }>(
    '/api/projects/:projectId/sync/:providerId',
    async (request, reply) => {
      const providerId = parseProviderId(request.params.providerId);
      if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
      const deleted = await store.deleteConfig(request.params.projectId, providerId);
      return { deleted };
    },
  );

  // Test connection. Accepts either stored credentials or overrides (used
  // by the onboarding dialog before saving).
  app.post<{
    Params: { projectId: string; providerId: string };
    Body: { overrides?: Record<string, any> };
  }>('/api/projects/:projectId/sync/:providerId/test', async (request, reply) => {
    const providerId = parseProviderId(request.params.providerId);
    if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
    const result = await engine.testConnection(request.params.projectId, providerId, request.body?.overrides);
    return result;
  });

  // Push all local tasks to the remote board/list.
  app.post<{ Params: { projectId: string; providerId: string } }>(
    '/api/projects/:projectId/sync/:providerId/push',
    async (request, reply) => {
      const providerId = parseProviderId(request.params.providerId);
      if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
      const result = await engine.pushAll(request.params.projectId, providerId);
      return result;
    },
  );

  // Pull + merge from the remote side.
  app.post<{ Params: { projectId: string; providerId: string } }>(
    '/api/projects/:projectId/sync/:providerId/pull',
    async (request, reply) => {
      const providerId = parseProviderId(request.params.providerId);
      if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
      const result = await engine.pullAll(request.params.projectId, providerId);
      return result;
    },
  );

  // Bidirectional (pull then push).
  app.post<{ Params: { projectId: string; providerId: string } }>(
    '/api/projects/:projectId/sync/:providerId/merge',
    async (request, reply) => {
      const providerId = parseProviderId(request.params.providerId);
      if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
      const result = await engine.mergeBoth(request.params.projectId, providerId);
      return result;
    },
  );

  // ── Discovery (ClickUp) ─────────────────────────────────────────────
  // Returns workspaces/spaces so the onboarding UI can render dropdowns
  // instead of asking the user to hunt a numeric id in URLs.
  app.post<{
    Params: { projectId: string };
    Body: { token?: string; teamId?: string };
  }>('/api/projects/:projectId/sync/clickup/discover', async (request, reply) => {
    const { token: overrideToken, teamId } = request.body || {};

    let config = await store.getConfig(request.params.projectId, 'clickup');
    if (overrideToken) {
      config = {
        providerId: 'clickup',
        projectId: request.params.projectId,
        enabled: true,
        autoSync: false,
        settings: { ...(config?.settings ?? {}), token: overrideToken },
        state: config?.state ?? {},
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    if (!config) return reply.status(400).send({ error: 'Token required' });

    try {
      const teams = await clickup.listTeams(config);
      if (!teamId) return { teams };
      const spaces = await clickup.listSpaces(config, teamId);
      return { teams, spaces };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message ?? 'Discovery failed' });
    }
  });

  // ── Trello: authorize URL helper ────────────────────────────────────
  // The API key has to be created on trello.com/power-ups/admin by the user;
  // once we have it, we hand back the exact URL they should open to copy
  // the personal token (scope read,write,account, expiration never).
  app.post<{
    Params: { projectId: string };
    Body: { apiKey?: string };
  }>('/api/projects/:projectId/sync/trello/authorize-url', async (request, reply) => {
    const stored = await store.getConfig(request.params.projectId, 'trello');
    const apiKey = request.body?.apiKey || stored?.settings.apiKey;
    if (!apiKey) return reply.status(400).send({ error: 'Trello API key required' });
    return { url: trello.buildAuthorizeUrl(apiKey) };
  });
}
