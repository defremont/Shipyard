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
} from '../services/terminalService.js';
import { getProjects, updateProject } from '../services/projectDiscovery.js';
import * as log from '../services/logService.js';

// Track active WebSocket connections per session to prevent duplicate listeners
const activeConnections = new Map<string, { socket: any; cleanup: () => void }>();

export async function terminalWsRoutes(app: FastifyInstance) {
  // REST: Check if integrated terminal is available
  app.get('/api/terminal/status', async () => {
    return { available: isAvailable() };
  });

  // REST: List active sessions
  app.get<{ Querystring: { projectId?: string } }>(
    '/api/terminal/sessions',
    async (request) => {
      return { sessions: listSessions(request.query.projectId) };
    }
  );

  // REST: Create a new terminal session
  app.post<{ Body: { projectId: string; type?: string; cols?: number; rows?: number; taskId?: string; prompt?: string } }>(
    '/api/terminal/sessions',
    async (request, reply) => {
      if (!isAvailable()) {
        return reply.status(503).send({ error: 'Integrated terminal not available (node-pty not installed)' });
      }

      const { projectId, type = 'shell', cols = 80, rows = 24, taskId, prompt } = request.body;
      const projects = await getProjects();
      const project = projects.find(p => p.id === projectId);
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      const sessionId = await createSession(projectId, project.path, type, cols, rows, project.name, taskId, prompt);
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

      // Register PTY listeners for this connection
      const onData = session.pty.onData((data: string) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'output', data }));
        }
      });

      const onExit = session.pty.onExit(({ exitCode }) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'exit', code: exitCode }));
        }
        activeConnections.delete(sessionId);
        killSession(sessionId);
      });

      const cleanup = () => {
        onData.dispose();
        onExit.dispose();
      };

      // Track this as the active connection
      activeConnections.set(sessionId, { socket, cleanup });

      // Handle messages from WebSocket client
      socket.on('message', (raw: Buffer | string) => {
        try {
          const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
          switch (msg.type) {
            case 'input':
              session.pty.write(msg.data);
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
