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

function pickMilestoneId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export async function syncRoutes(app: FastifyInstance) {
  // ── Legacy: Google Sheets proxy (stateless) ─────────────────────────
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
      try { return { data: JSON.parse(text) }; }
      catch { return reply.status(502).send({ error: 'Invalid JSON response from Apps Script' }); }
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

  // ── Provider (global) endpoints ─────────────────────────────────────

  app.get('/api/sync/providers', async () => {
    const status = await store.listProviderStatus();
    return { providers: status };
  });

  app.post<{
    Params: { providerId: string };
    Body: { settings: Record<string, any> };
  }>('/api/sync/providers/:providerId', async (request, reply) => {
    const providerId = parseProviderId(request.params.providerId);
    if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
    const { settings } = request.body || {};
    if (!settings) return reply.status(400).send({ error: 'Missing settings' });

    // Strip empties so we don't overwrite existing secrets with blanks.
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(settings)) {
      if (v === undefined) continue;
      if (typeof v === 'string' && v.length === 0) continue;
      cleaned[k] = v;
    }
    await store.saveProviderCredentials(providerId, cleaned);
    log.info('sync', `Saved ${providerId} global credentials`);
    const statuses = await store.listProviderStatus();
    return { provider: statuses.find(p => p.providerId === providerId) };
  });

  app.delete<{ Params: { providerId: string } }>(
    '/api/sync/providers/:providerId',
    async (request, reply) => {
      const providerId = parseProviderId(request.params.providerId);
      if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
      const deleted = await store.deleteProviderCredentials(providerId);
      return { deleted };
    },
  );

  app.post<{
    Params: { providerId: string };
    Body: { overrides?: Record<string, any> };
  }>('/api/sync/providers/:providerId/test', async (request, reply) => {
    const providerId = parseProviderId(request.params.providerId);
    if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
    // We don't have a project here — use a synthetic id for the override path.
    const result = await engine.testConnection('__global__', providerId, undefined, request.body?.overrides);
    return result;
  });

  // ── Per-project / per-milestone endpoints ───────────────────────────
  //
  // Every config-touching endpoint accepts an optional `milestoneId` (body or
  // query depending on method). When omitted it defaults to 'default' which
  // represents the General milestone — matches Google Sheets sync semantics
  // and keeps backward compatibility for callers that only have one milestone.

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/sync',
    async (request) => {
      const configs = await store.listProjectConfigs(request.params.projectId);
      return { integrations: configs.map(store.sanitizeProject) };
    },
  );

  app.get('/api/sync/integrations', async () => {
    const configs = await store.listProjectConfigs();
    return { integrations: configs.map(store.sanitizeProject) };
  });

  app.post<{
    Params: { projectId: string; providerId: string };
    Body: {
      milestoneId?: string;
      settings?: Record<string, any>;
      enabled?: boolean;
      autoSync?: boolean;
    };
  }>('/api/projects/:projectId/sync/:providerId', async (request, reply) => {
    const providerId = parseProviderId(request.params.providerId);
    if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
    const milestoneId = pickMilestoneId(request.body?.milestoneId);

    // If enabling, global creds are required — fail early with a clear error.
    if (request.body?.enabled) {
      const creds = await store.getProviderCredentials(providerId);
      if (!creds) {
        return reply.status(400).send({
          error: `Connect your ${providerId} account first (Settings → Integrations).`,
        });
      }
    }

    const saved = await store.saveProjectConfig({
      projectId: request.params.projectId,
      providerId,
      milestoneId,
      settings: request.body?.settings,
      enabled: request.body?.enabled,
      autoSync: request.body?.autoSync,
    });
    log.info(
      'sync',
      `Saved ${providerId} project config (milestone ${saved.milestoneId})`,
      undefined,
      request.params.projectId,
    );
    return { integration: store.sanitizeProject(saved) };
  });

  app.delete<{
    Params: { projectId: string; providerId: string };
    Querystring: { milestoneId?: string };
  }>(
    '/api/projects/:projectId/sync/:providerId',
    async (request, reply) => {
      const providerId = parseProviderId(request.params.providerId);
      if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
      const milestoneId = pickMilestoneId(request.query.milestoneId);
      const deleted = await store.deleteProjectConfig(request.params.projectId, providerId, milestoneId);
      return { deleted };
    },
  );

  app.post<{
    Params: { projectId: string; providerId: string };
    Body: { milestoneId?: string; overrides?: Record<string, any> };
  }>('/api/projects/:projectId/sync/:providerId/test', async (request, reply) => {
    const providerId = parseProviderId(request.params.providerId);
    if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
    const milestoneId = pickMilestoneId(request.body?.milestoneId);
    const result = await engine.testConnection(
      request.params.projectId,
      providerId,
      milestoneId,
      request.body?.overrides,
    );
    return result;
  });

  app.post<{
    Params: { projectId: string; providerId: string };
    Body: { milestoneId?: string };
  }>(
    '/api/projects/:projectId/sync/:providerId/push',
    async (request, reply) => {
      const providerId = parseProviderId(request.params.providerId);
      if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
      const milestoneId = pickMilestoneId(request.body?.milestoneId);
      return engine.pushAll(request.params.projectId, providerId, milestoneId);
    },
  );

  app.post<{
    Params: { projectId: string; providerId: string };
    Body: { milestoneId?: string };
  }>(
    '/api/projects/:projectId/sync/:providerId/pull',
    async (request, reply) => {
      const providerId = parseProviderId(request.params.providerId);
      if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
      const milestoneId = pickMilestoneId(request.body?.milestoneId);
      return engine.pullAll(request.params.projectId, providerId, milestoneId);
    },
  );

  app.post<{
    Params: { projectId: string; providerId: string };
    Body: { milestoneId?: string };
  }>(
    '/api/projects/:projectId/sync/:providerId/merge',
    async (request, reply) => {
      const providerId = parseProviderId(request.params.providerId);
      if (!providerId) return reply.status(400).send({ error: 'Unknown provider' });
      const milestoneId = pickMilestoneId(request.body?.milestoneId);
      return engine.mergeBoth(request.params.projectId, providerId, milestoneId);
    },
  );

  // ── Discovery helpers ───────────────────────────────────────────────

  app.post<{
    Body: { token?: string; teamId?: string };
  }>('/api/sync/clickup/discover', async (request, reply) => {
    const { token: overrideToken, teamId } = request.body || {};

    const creds = await store.getProviderCredentials('clickup');
    const token = overrideToken || creds?.settings.token;
    if (!token) return reply.status(400).send({ error: 'Token required' });

    const effective = {
      providerId: 'clickup' as const,
      projectId: '__global__',
      milestoneId: 'default',
      settings: { token },
      state: {},
      enabled: true,
      autoSync: false,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
    };

    try {
      const teams = await clickup.listTeams(effective);
      if (!teamId) return { teams };
      const spaces = await clickup.listSpaces(effective, teamId);
      return { teams, spaces };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message ?? 'Discovery failed' });
    }
  });

  app.post<{ Body: { apiKey?: string } }>(
    '/api/sync/trello/authorize-url',
    async (request, reply) => {
      const creds = await store.getProviderCredentials('trello');
      const apiKey = request.body?.apiKey || creds?.settings.apiKey;
      if (!apiKey) return reply.status(400).send({ error: 'Trello API key required' });
      return { url: trello.buildAuthorizeUrl(apiKey) };
    },
  );

  // ── Link-to-existing: list remote boards/lists + attach a project ───

  app.get('/api/sync/trello/boards', async (_request, reply) => {
    const creds = await store.getProviderCredentials('trello');
    if (!creds) return reply.status(400).send({ error: 'Trello not connected' });
    const effective = {
      providerId: 'trello' as const,
      projectId: '__global__',
      milestoneId: 'default',
      settings: creds.settings,
      state: {},
      enabled: true,
      autoSync: false,
      lastSyncAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
    };
    try {
      const boards = await trello.listBoards(effective);
      return { boards };
    } catch (err: any) {
      return reply.status(400).send({ error: err?.message ?? 'Failed to list boards' });
    }
  });

  app.get<{ Querystring: { spaceId?: string } }>(
    '/api/sync/clickup/lists',
    async (request, reply) => {
      const spaceId = request.query.spaceId;
      if (!spaceId) return reply.status(400).send({ error: 'spaceId required' });
      const creds = await store.getProviderCredentials('clickup');
      if (!creds) return reply.status(400).send({ error: 'ClickUp not connected' });
      const effective = {
        providerId: 'clickup' as const,
        projectId: '__global__',
        milestoneId: 'default',
        settings: creds.settings,
        state: {},
        enabled: true,
        autoSync: false,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
      };
      try {
        const lists = await clickup.listLists(effective, spaceId);
        return { lists };
      } catch (err: any) {
        return reply.status(400).send({ error: err?.message ?? 'Failed to list lists' });
      }
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: { boardId?: string; milestoneId?: string };
  }>(
    '/api/projects/:projectId/sync/trello/link',
    async (request, reply) => {
      const boardId = request.body?.boardId;
      if (!boardId) return reply.status(400).send({ error: 'boardId required' });
      const milestoneId = pickMilestoneId(request.body?.milestoneId);
      const result = await engine.linkTrelloBoard(request.params.projectId, boardId, milestoneId);
      if (!result.success) return reply.status(400).send({ error: result.message });
      log.info(
        'sync',
        `Linked trello board ${boardId} (milestone ${result.milestoneId})`,
        undefined,
        request.params.projectId,
      );
      return result;
    },
  );

  app.post<{
    Params: { projectId: string };
    Body: { spaceId?: string; listId?: string; milestoneId?: string };
  }>(
    '/api/projects/:projectId/sync/clickup/link',
    async (request, reply) => {
      const { spaceId, listId } = request.body || {};
      if (!spaceId || !listId) return reply.status(400).send({ error: 'spaceId and listId required' });
      const milestoneId = pickMilestoneId(request.body?.milestoneId);
      const result = await engine.linkClickupList(request.params.projectId, spaceId, listId, milestoneId);
      if (!result.success) return reply.status(400).send({ error: result.message });
      log.info(
        'sync',
        `Linked clickup list ${listId} (space ${spaceId}, milestone ${result.milestoneId})`,
        undefined,
        request.params.projectId,
      );
      return result;
    },
  );
}
