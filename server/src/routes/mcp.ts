import { FastifyInstance } from 'fastify';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { MCP_TOOLS, handleToolCall } from '../services/mcpServer.js';
import * as mcpAuth from '../services/mcpAuth.js';
import { DATA_DIR } from '../services/dataDir.js';
import * as log from '../services/logService.js';

const MCP_CONFIG_FILE = join(DATA_DIR, 'mcp-config.json');

interface McpConfig {
  enabled: boolean;
  requireAuth: boolean;
}

let mcpConfig: McpConfig = { enabled: false, requireAuth: true };

async function loadMcpConfig(): Promise<McpConfig> {
  try {
    const raw = await readFile(MCP_CONFIG_FILE, 'utf-8');
    mcpConfig = { enabled: false, requireAuth: true, ...JSON.parse(raw) };
  } catch {
    mcpConfig = { enabled: false, requireAuth: true };
  }
  return mcpConfig;
}

async function saveMcpConfig(config: McpConfig): Promise<void> {
  mcpConfig = config;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(MCP_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
}

// JSON-RPC helpers
function jsonRpcResponse(id: any, result: any) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id: any, code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export async function mcpRoutes(app: FastifyInstance) {
  // Load config on startup
  await loadMcpConfig();
  await mcpAuth.loadAuthData();

  // ── MCP Config API (for the dashboard UI) ─────────────

  app.get('/api/mcp/status', async () => {
    return {
      enabled: mcpConfig.enabled,
      requireAuth: mcpConfig.requireAuth,
      clients: mcpAuth.listClients().map(c => ({
        clientId: c.clientId,
        clientName: c.clientName,
        createdAt: c.createdAt,
      })),
    };
  });

  app.post<{
    Body: { enabled: boolean; requireAuth?: boolean }
  }>('/api/mcp/config', async (request) => {
    const { enabled, requireAuth } = request.body;
    await saveMcpConfig({
      enabled,
      requireAuth: requireAuth !== undefined ? requireAuth : mcpConfig.requireAuth,
    });
    return { ok: true, ...mcpConfig };
  });

  app.delete<{
    Params: { clientId: string }
  }>('/api/mcp/clients/:clientId', async (request) => {
    const ok = await mcpAuth.revokeClient(request.params.clientId);
    return { ok };
  });

  // ── OAuth 2.1 Endpoints ───────────────────────────────

  // Authorization Server Metadata (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', async (request) => {
    const host = request.headers.host || `localhost:${request.server.addresses()[0]?.port || 5420}`;
    const base = `http://${host}`;
    return {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: ['shipyard:read', 'shipyard:write'],
    };
  });

  // Dynamic Client Registration (RFC 7591)
  app.post<{
    Body: { client_name: string; redirect_uris: string[]; grant_types?: string[]; response_types?: string[]; token_endpoint_auth_method?: string }
  }>('/register', async (request, reply) => {
    if (!mcpConfig.enabled) {
      return reply.status(403).send({ error: 'MCP server is disabled' });
    }
    const { client_name, redirect_uris } = request.body;
    if (!client_name || !redirect_uris?.length) {
      return reply.status(400).send({ error: 'client_name and redirect_uris required' });
    }

    const client = await mcpAuth.registerClient(client_name, redirect_uris);
    log.info('mcp', `Client registered: ${client_name}`, client.clientId);
    return {
      client_id: client.clientId,
      client_secret: client.clientSecret,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: request.body.token_endpoint_auth_method || 'client_secret_post',
    };
  });

  // Authorization endpoint - GET shows consent page
  app.get<{
    Querystring: {
      response_type: string;
      client_id: string;
      redirect_uri: string;
      scope?: string;
      state?: string;
      code_challenge: string;
      code_challenge_method: string;
    }
  }>('/authorize', async (request, reply) => {
    if (!mcpConfig.enabled) {
      return reply.status(403).send('MCP server is disabled');
    }

    const { client_id, redirect_uri, scope, state, code_challenge, code_challenge_method } = request.query;
    const client = mcpAuth.getClient(client_id);

    if (!client) {
      return reply.status(400).send('Unknown client');
    }

    // Return a simple HTML consent page
    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8"><title>Shipyard - Authorize</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 24px; background: #0a0a0a; color: #e5e5e5; }
  h1 { font-size: 20px; margin-bottom: 8px; }
  .card { background: #1a1a1a; border: 1px solid #333; border-radius: 12px; padding: 24px; margin: 24px 0; }
  .client { font-weight: 600; color: #60a5fa; }
  .scope { background: #262626; padding: 4px 10px; border-radius: 6px; font-size: 13px; display: inline-block; margin: 4px 2px; }
  .actions { display: flex; gap: 12px; margin-top: 20px; }
  button { padding: 10px 24px; border-radius: 8px; border: none; cursor: pointer; font-size: 14px; font-weight: 500; }
  .approve { background: #2563eb; color: white; }
  .approve:hover { background: #1d4ed8; }
  .deny { background: #262626; color: #999; border: 1px solid #333; }
  .deny:hover { background: #333; }
  .perms { margin: 16px 0 0; padding: 0; list-style: none; }
  .perms li { padding: 6px 0; font-size: 13px; color: #aaa; }
  .perms li::before { content: "\\2713"; color: #4ade80; margin-right: 8px; }
</style>
</head><body>
<h1>Authorize Connection</h1>
<div class="card">
  <p><span class="client">${client.clientName}</span> wants to connect to your Shipyard dashboard.</p>
  <p style="font-size: 13px; color: #888;">Permissions requested:</p>
  <ul class="perms">
    <li>View projects, git status, history and diffs</li>
    <li>View, create, update, and delete tasks</li>
    <li>Create, rename and delete milestones</li>
    <li>Search across all tasks</li>
    <li>Sync tasks with Trello and ClickUp</li>
    <li>View Trello comments and attachments on your tasks</li>
  </ul>
  <div class="actions">
    <form method="POST" action="/authorize">
      <input type="hidden" name="client_id" value="${client_id}" />
      <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
      <input type="hidden" name="scope" value="${scope || 'shipyard:read shipyard:write'}" />
      <input type="hidden" name="state" value="${state || ''}" />
      <input type="hidden" name="code_challenge" value="${code_challenge}" />
      <input type="hidden" name="code_challenge_method" value="${code_challenge_method}" />
      <input type="hidden" name="approved" value="true" />
      <button type="submit" class="approve">Approve</button>
    </form>
    <form method="POST" action="/authorize">
      <input type="hidden" name="client_id" value="${client_id}" />
      <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
      <input type="hidden" name="state" value="${state || ''}" />
      <input type="hidden" name="approved" value="false" />
      <button type="submit" class="deny">Deny</button>
    </form>
  </div>
</div>
</body></html>`;

    reply.type('text/html').send(html);
  });

  // Authorization endpoint - POST processes consent
  app.post<{
    Body: {
      client_id: string;
      redirect_uri: string;
      scope?: string;
      state?: string;
      code_challenge?: string;
      code_challenge_method?: string;
      approved: string;
    }
  }>('/authorize', async (request, reply) => {
    // Parse form-encoded body
    const body = request.body;

    if (body.approved !== 'true') {
      const redirectUri = new URL(body.redirect_uri);
      redirectUri.searchParams.set('error', 'access_denied');
      if (body.state) redirectUri.searchParams.set('state', body.state);
      return reply.redirect(redirectUri.toString());
    }

    const code = await mcpAuth.createAuthCode(
      body.client_id,
      body.code_challenge || '',
      body.code_challenge_method || 'S256',
      body.redirect_uri,
      body.scope || 'shipyard:read shipyard:write',
    );

    const redirectUri = new URL(body.redirect_uri);
    redirectUri.searchParams.set('code', code);
    if (body.state) redirectUri.searchParams.set('state', body.state);
    return reply.redirect(redirectUri.toString());
  });

  // Token endpoint
  app.post<{
    Body: {
      grant_type: string;
      code?: string;
      code_verifier?: string;
      client_id: string;
      client_secret?: string;
      redirect_uri?: string;
      refresh_token?: string;
    }
  }>('/token', async (request, reply) => {
    const { grant_type, code, code_verifier, client_id, redirect_uri, refresh_token } = request.body;

    if (grant_type === 'authorization_code') {
      if (!code || !code_verifier || !redirect_uri) {
        return reply.status(400).send({ error: 'invalid_request' });
      }
      const tokens = await mcpAuth.exchangeCode(code, code_verifier, client_id, redirect_uri);
      if (!tokens) {
        return reply.status(400).send({ error: 'invalid_grant' });
      }
      return tokens;
    }

    if (grant_type === 'refresh_token') {
      if (!refresh_token) {
        return reply.status(400).send({ error: 'invalid_request' });
      }
      const tokens = await mcpAuth.refreshAccessToken(refresh_token, client_id);
      if (!tokens) {
        return reply.status(400).send({ error: 'invalid_grant' });
      }
      return tokens;
    }

    return reply.status(400).send({ error: 'unsupported_grant_type' });
  });

  // ── MCP JSON-RPC Endpoint (Streamable HTTP) ───────────

  // Auth middleware for MCP endpoint
  async function checkMcpAuth(request: any, reply: any): Promise<boolean> {
    if (!mcpConfig.enabled) {
      reply.status(403).send(jsonRpcError(null, -32000, 'MCP server is disabled'));
      return false;
    }
    if (mcpConfig.requireAuth) {
      const auth = await mcpAuth.validateBearerToken(request.headers.authorization);
      if (!auth.valid) {
        log.warn('mcp', 'Invalid bearer token rejected');
        reply.status(401).send({ error: 'invalid_token' });
        return false;
      }
    }
    return true;
  }

  // Handle JSON-RPC requests
  app.post('/mcp', async (request, reply) => {
    if (!await checkMcpAuth(request, reply)) return;

    const body = request.body as any;

    // Handle batch requests
    if (Array.isArray(body)) {
      const results = await Promise.all(body.map(handleJsonRpc));
      return results;
    }

    return handleJsonRpc(body);
  });

  // SSE endpoint for server-to-client notifications
  app.get('/mcp', async (request, reply) => {
    if (!await checkMcpAuth(request, reply)) return;

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial endpoint event
    reply.raw.write(`event: endpoint\ndata: /mcp\n\n`);

    // Keep alive
    const keepAlive = setInterval(() => {
      reply.raw.write(': keepalive\n\n');
    }, 30000);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
    });
  });

  // Session termination
  app.delete('/mcp', async (request, reply) => {
    return { ok: true };
  });
}

// ── JSON-RPC Handler ────────────────────────────────────

async function handleJsonRpc(msg: any) {
  if (!msg || msg.jsonrpc !== '2.0') {
    return jsonRpcError(null, -32600, 'Invalid Request');
  }

  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return jsonRpcResponse(id, {
        protocolVersion: '2025-03-26',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: { name: 'shipyard', version: '1.0.0' },
      });

    case 'notifications/initialized':
      // Client acknowledges initialization - no response needed for notifications
      return null;

    case 'ping':
      return jsonRpcResponse(id, {});

    case 'tools/list':
      return jsonRpcResponse(id, {
        tools: MCP_TOOLS,
      });

    case 'tools/call': {
      const { name, arguments: args } = params || {};
      if (!name) {
        return jsonRpcError(id, -32602, 'Missing tool name');
      }
      try {
        const result = await handleToolCall(name, args || {});
        log.info('mcp', `Tool call: ${name}`, args ? JSON.stringify(args).substring(0, 200) : undefined);
        return jsonRpcResponse(id, result);
      } catch (err: any) {
        log.error('mcp', `Tool call failed: ${name}`, err.message);
        return jsonRpcResponse(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }

    case 'resources/list':
      return jsonRpcResponse(id, {
        resources: [
          { uri: 'shipyard://projects', name: 'All Projects', mimeType: 'application/json' },
          { uri: 'shipyard://tasks/all', name: 'All Tasks', mimeType: 'application/json' },
        ],
      });

    case 'resources/read': {
      const uri = params?.uri;
      if (uri === 'shipyard://projects') {
        const { getProjects } = await import('../services/projectDiscovery.js');
        const projects = await getProjects();
        // Slim: only essential fields to save tokens
        const slim = projects.map(p => ({ id: p.id, name: p.name, path: p.path, techStack: p.techStack, gitBranch: p.gitBranch }));
        return jsonRpcResponse(id, {
          contents: [{ uri, text: JSON.stringify(slim), mimeType: 'application/json' }],
        });
      }
      if (uri === 'shipyard://tasks/all') {
        const tasks = await import('../services/taskStore.js');
        const all = await tasks.getAllTasks();
        // Slim: omit description/prompt (use get_task tool for full details)
        const slim = all.map(t => ({ id: t.id, projectId: t.projectId, title: t.title, status: t.status, priority: t.priority }));
        return jsonRpcResponse(id, {
          contents: [{ uri, text: JSON.stringify(slim), mimeType: 'application/json' }],
        });
      }
      return jsonRpcError(id, -32602, `Unknown resource: ${uri}`);
    }

    case 'resources/templates/list':
      return jsonRpcResponse(id, {
        resourceTemplates: [
          {
            uriTemplate: 'shipyard://projects/{projectId}/tasks',
            name: 'Project Tasks',
            mimeType: 'application/json',
          },
        ],
      });

    default:
      return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }
}

