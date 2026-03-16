import { FastifyInstance } from 'fastify';
import * as log from '../services/logService.js';

export async function syncRoutes(app: FastifyInstance) {
  // Stateless proxy: receives Apps Script URL from client, fetches it, returns result
  app.post<{
    Body: { url: string; method: 'GET' | 'POST'; payload?: unknown; action?: string }
  }>('/api/sync/proxy', async (request, reply) => {
    const { url, method, payload, action } = request.body;

    if (!url || !url.startsWith('https://script.google.com/macros/s/')) {
      return reply.status(400).send({ error: 'Only Google Apps Script URLs are allowed' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      let fetchUrl = url;
      const fetchOptions: RequestInit = {
        signal: controller.signal,
        redirect: 'follow',
      };

      if (method === 'GET') {
        // Apps Script doGet — append action as query param (default: read)
        const queryAction = action || 'read';
        fetchUrl = url + (url.includes('?') ? '&' : '?') + 'action=' + queryAction;
        fetchOptions.method = 'GET';
      } else {
        fetchOptions.method = 'POST';
        fetchOptions.headers = { 'Content-Type': 'application/json' };
        fetchOptions.body = JSON.stringify(payload || {});
      }

      const res = await fetch(fetchUrl, fetchOptions);

      if (!res.ok) {
        return reply.status(502).send({ error: `Apps Script returned status ${res.status}` });
      }

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
      log.error('sync', 'Apps Script proxy failed', err.message);
      return reply.status(502).send({ error: err.message || 'Failed to reach Apps Script' });
    } finally {
      clearTimeout(timeout);
    }
  });

  // Test connection (ping)
  app.post<{
    Body: { url: string }
  }>('/api/sync/test', async (request, reply) => {
    const { url } = request.body;

    if (!url || !url.startsWith('https://script.google.com/macros/s/')) {
      return reply.status(400).send({ error: 'Only Google Apps Script URLs are allowed' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const pingUrl = url + (url.includes('?') ? '&' : '?') + 'action=ping';
      const res = await fetch(pingUrl, { signal: controller.signal, redirect: 'follow' });

      if (!res.ok) {
        return reply.status(502).send({ ok: false, error: `Status ${res.status}` });
      }

      const text = await res.text();
      try {
        const data = JSON.parse(text);
        return { ok: true, data };
      } catch {
        return { ok: true, data: { raw: text } };
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return reply.status(504).send({ ok: false, error: 'Timeout (10s)' });
      }
      return reply.status(502).send({ ok: false, error: err.message || 'Connection failed' });
    } finally {
      clearTimeout(timeout);
    }
  });
}
