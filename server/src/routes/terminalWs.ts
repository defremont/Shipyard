import { FastifyInstance } from 'fastify';
import {
  isAvailable,
  createSession,
  getSession,
  killSession,
  listSessions,
  listAiSessions,
  writeToSession,
  resizeSession,
  setStateListener,
} from '../services/terminalService.js';
import { getProjects, updateProject } from '../services/projectDiscovery.js';
import * as taskStore from '../services/taskStore.js';
import * as worktreeService from '../services/worktreeService.js';
import * as log from '../services/logService.js';
import { mkdir, readdir, stat, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DATA_DIR } from '../services/dataDir.js';

// Track active WebSocket connections per session to prevent duplicate listeners
const activeConnections = new Map<string, { socket: any; cleanup: () => void }>();

// Output batching window. 8ms keeps input echo well under one frame at 60Hz
// while collapsing a TUI redraw burst into a single WebSocket frame.
const OUTPUT_FLUSH_MS = 8;
const OUTPUT_FLUSH_BYTES = 64 * 1024;
const CLIPBOARD_IMAGE_DIR = join(DATA_DIR, 'terminal-clipboard');
const MAX_CLIPBOARD_IMAGE_BYTES = 10 * 1024 * 1024;
const CLIPBOARD_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;
const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

async function pruneClipboardImages(): Promise<void> {
  try {
    const entries = await readdir(CLIPBOARD_IMAGE_DIR);
    const cutoff = Date.now() - CLIPBOARD_IMAGE_TTL_MS;
    await Promise.all(entries.map(async name => {
      const filePath = join(CLIPBOARD_IMAGE_DIR, name);
      try {
        if ((await stat(filePath)).mtimeMs < cutoff) await unlink(filePath);
      } catch {}
    }));
  } catch {}
}

export async function terminalWsRoutes(app: FastifyInstance) {
  // REST: Check if integrated terminal is available
  app.get('/api/terminal/status', async () => {
    return { available: isAvailable() };
  });

  // A PTY cannot transport an OS clipboard image. Persist it briefly so the
  // client can paste a local path that Claude CLI can read.
  app.post<{
    Params: { sessionId: string };
    Body: { mimeType: string; data: string };
  }>(
    '/api/terminal/sessions/:sessionId/clipboard-image',
    { bodyLimit: 14 * 1024 * 1024 },
    async (request, reply) => {
      const session = getSession(request.params.sessionId);
      if (!session) return reply.status(404).send({ error: 'Session not found' });

      const { mimeType, data } = request.body || {};
      const extension = IMAGE_EXTENSIONS[mimeType];
      if (!extension || typeof data !== 'string') {
        return reply.status(400).send({ error: 'Unsupported clipboard image' });
      }

      const image = Buffer.from(data, 'base64');
      if (!image.length || image.length > MAX_CLIPBOARD_IMAGE_BYTES) {
        return reply.status(413).send({ error: 'Clipboard image must be smaller than 10 MB' });
      }

      await mkdir(CLIPBOARD_IMAGE_DIR, { recursive: true });
      void pruneClipboardImages();
      const filePath = join(CLIPBOARD_IMAGE_DIR, `clipboard-${Date.now()}-${randomUUID()}.${extension}`);
      await writeFile(filePath, image);
      log.info('terminal', 'Clipboard image prepared for terminal', `${image.length} bytes`, session.projectId);
      return { path: filePath, expiresInMs: CLIPBOARD_IMAGE_TTL_MS };
    }
  );

  // REST: List active sessions
  app.get<{ Querystring: { projectId?: string } }>(
    '/api/terminal/sessions',
    async (request) => {
      return { sessions: listSessions(request.query.projectId) };
    }
  );

  // REST: Create a new terminal session
  app.post<{ Body: { projectId: string; type?: string; cols?: number; rows?: number; taskId?: string; prompt?: string; agent?: string } }>(
    '/api/terminal/sessions',
    async (request, reply) => {
      if (!isAvailable()) {
        return reply.status(503).send({ error: 'Integrated terminal not available (node-pty not installed)' });
      }

      const { projectId, type = 'shell', cols = 80, rows = 24, taskId, prompt, agent } = request.body;
      const projects = await getProjects();
      const project = projects.find(p => p.id === projectId);
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      // A session tied to a task runs in that task's worktree when the
      // worktree-per-task setting is on — that is what lets two agents work
      // on the same repo at once. Anything else runs in the project folder.
      let cwd = project.path;
      if (taskId) {
        const task = await taskStore.getTask(projectId, taskId);
        if (task) {
          const worktree = await worktreeService.ensureTaskWorktree(project, task);
          cwd = worktree.path;
        }
      }

      const sessionId = await createSession(projectId, project.path, type, cols, rows, project.name, taskId, prompt, agent, cwd);
      if (!sessionId) {
        log.error('terminal', 'Failed to create terminal session', `type=${type}`, projectId);
        return reply.status(500).send({ error: 'Failed to create terminal session' });
      }

      await updateProject(project.id, { lastOpenedAt: new Date().toISOString() });

      const session = getSession(sessionId);
      return {
        id: sessionId,
        projectId,
        type,
        title: session?.title || 'Terminal',
        createdAt: session?.createdAt,
        taskId: session?.taskId,
        agent: session?.agent,
        cwd: session?.cwd,
      };
    }
  );

  // REST: List active AI resolution sessions
  app.get('/api/terminal/ai-sessions', async () => {
    return { sessions: listAiSessions() };
  });

  // REST: Write data to a terminal session's PTY
  app.post<{ Params: { sessionId: string }; Body: { data: string } }>(
    '/api/terminal/sessions/:sessionId/write',
    async (request, reply) => {
      const { sessionId } = request.params;
      const { data } = request.body;
      if (!data) return reply.status(400).send({ error: 'No data provided' });
      const ok = writeToSession(sessionId, data);
      if (!ok) return reply.status(404).send({ error: 'Session not found' });
      return { success: true };
    }
  );

  // REST: Kill a session
  app.delete<{ Params: { sessionId: string } }>(
    '/api/terminal/sessions/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params;
      // Clean up active connection tracking
      const conn = activeConnections.get(sessionId);
      if (conn) {
        conn.cleanup();
        activeConnections.delete(sessionId);
      }
      const killed = killSession(sessionId);
      if (!killed) return reply.status(404).send({ error: 'Session not found' });
      return { success: true };
    }
  );

  // WebSocket: Connect to a terminal session
  app.get<{ Params: { sessionId: string } }>(
    '/ws/terminal/:sessionId',
    { websocket: true },
    (socket, request) => {
      const { sessionId } = request.params;
      const session = getSession(sessionId);
      if (!session) {
        socket.send(JSON.stringify({ type: 'error', data: 'Session not found' }));
        socket.close();
        return;
      }

      // Close any existing connection for this session (prevents duplicate onData listeners)
      const existing = activeConnections.get(sessionId);
      if (existing) {
        existing.cleanup();
        try { existing.socket.close(1000, 'Replaced by new connection'); } catch {}
      }

      // Coalesce PTY output. A TUI like Claude CLI emits hundreds of tiny
      // chunks per redraw; forwarding each as its own JSON frame costs a
      // stringify + parse + xterm write per chunk and visibly stutters the
      // terminal. Batching them into one frame per tick collapses that into a
      // single write while keeping latency below a rendered frame.
      let pending = '';
      let flushTimer: NodeJS.Timeout | undefined;

      const flush = () => {
        flushTimer = undefined;
        if (!pending) return;
        const data = pending;
        pending = '';
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'output', data }));
        }
      };

      const onData = session.pty.onData((data: string) => {
        if (socket.readyState !== 1) return;
        pending += data;
        // Flush immediately once a batch grows large, so a `cat bigfile`
        // streams instead of buffering into one giant frame.
        if (pending.length >= OUTPUT_FLUSH_BYTES) {
          if (flushTimer) clearTimeout(flushTimer);
          flush();
          return;
        }
        if (!flushTimer) flushTimer = setTimeout(flush, OUTPUT_FLUSH_MS);
      });

      const onExit = session.pty.onExit(({ exitCode }) => {
        if (flushTimer) clearTimeout(flushTimer);
        flush(); // don't lose the process's final output
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'exit', code: exitCode }));
        }
        activeConnections.delete(sessionId);
        killSession(sessionId);
      });

      // Tell the client when the Claude CLI is waiting on a human, so the tab
      // can show it even while another tab is in front.
      const currentState = setStateListener(sessionId, state => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'state', state }));
      });
      if (currentState && socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'state', state: currentState }));
      }

      const cleanup = () => {
        if (flushTimer) clearTimeout(flushTimer);
        onData.dispose();
        onExit.dispose();
        // A replaced connection's close handler runs after the new one has
        // already registered its listener — only drop the listener if it is
        // still ours, or a reconnect would silently lose state updates.
        if (activeConnections.get(sessionId)?.socket === socket) {
          setStateListener(sessionId, undefined);
        }
      };

      // Track this as the active connection
      activeConnections.set(sessionId, { socket, cleanup });

      // Handle messages from WebSocket client
      socket.on('message', (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
          switch (msg.type) {
            case 'input':
              // writeToSession splits oversized payloads (clipboard pastes) at
              // safe boundaries and serializes them against other writes, so
              // ConPTY never sees a buffer-busting write and a keystroke can't
              // land in the middle of a paste.
              writeToSession(sessionId, msg.data);
              break;
            case 'binary':
              // Binary data from TUI apps (mouse reports, etc.)
              session.pty.write(Buffer.from(msg.data, 'binary'));
              break;
            case 'resize':
              if (msg.cols && msg.rows) {
                resizeSession(sessionId, msg.cols, msg.rows);
              }
              break;
          }
        } catch {}
      });

      // Clean up on WebSocket close
      socket.on('close', () => {
        // Only clean up if this is still the active connection
        const current = activeConnections.get(sessionId);
        if (current && current.socket === socket) {
          current.cleanup();
          activeConnections.delete(sessionId);
        } else {
          // This was an old replaced connection, just dispose listeners
          cleanup();
        }
        // Don't kill the session on disconnect — allow reconnection
      });
    }
  );
}
