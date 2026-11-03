import { FastifyInstance } from 'fastify';
import {
  isAvailable,
  createSession,
  getSession,
  killSession,
  renameSession,
  listSessions,
  listAiSessions,
  writeToSession,
  resizeSession,
  handleClaudeHook,
  onSessionEvent,
  terminalModePreamble,
  getPreviews,
} from '../services/terminalService.js';
import { getProjects, updateProject } from '../services/projectDiscovery.js';
import { findOpenConversation, forgetConversation, listConversations } from '../services/claudeConversations.js';
import * as taskStore from '../services/taskStore.js';
import * as worktreeService from '../services/worktreeService.js';
import { triggerAutoSync } from '../services/sync/syncEngine.js';
import * as log from '../services/logService.js';
import { mkdir, readdir, stat, unlink, writeFile } from 'fs/promises';
import { isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { openFolder, revealInFolder } from '../services/terminalLauncher.js';

/** Files the system would run, not show: these are only revealed in their folder. */
const RUNNABLE_EXT = /\.(?:exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|url|msi|msp|scr|cpl|jar|reg|pif|appref-ms|sh|app|command)$/i;
import { searchFileNames } from '../services/fileSearch.js';
import { IGNORE_NAMES, isVisibleDotfile } from './files.js';
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

  // The last lines each session settled on — the grid of agents.
  app.get('/api/terminal/previews', async () => ({ previews: getPreviews() }));

  // A path the terminal printed and the user clicked: a file of a known project
  // opens in the editor (the client does it with the answer), anything else
  // with the system's default app. Relative paths are read from the session's
  // working directory. Opening a path is no more than the session itself can do.
  app.post<{ Params: { sessionId: string }; Body: { path?: string; system?: boolean } }>(
    '/api/terminal/sessions/:sessionId/open-path',
    async (request, reply) => {
      const session = getSession(request.params.sessionId);
      if (!session) return reply.status(404).send({ error: 'Session not found' });
      let raw = String(request.body?.path || '').trim();
      if (!raw) return reply.status(400).send({ error: 'path is required' });
      if (raw.startsWith('file:')) {
        try { raw = fileURLToPath(raw); } catch { return reply.status(400).send({ error: 'bad file URL' }); }
      }
      // ~ is the user's home, as in the shell that printed it.
      if (raw === '~' || raw.startsWith('~/') || raw.startsWith('~\\')) raw = join(process.env.USERPROFILE || process.env.HOME || '', raw.slice(1));
      const full = isAbsolute(raw) ? resolve(raw) : resolve(session.cwd, raw);
      // A network path is never touched: even a stat makes Windows try SMB and
      // hand the account's NTLM hash to whoever runs that server.
      if (/^[\\/]{2}/.test(full)) return reply.status(400).send({ error: 'Network paths are not opened' });
      let isDirectory: boolean;
      try {
        isDirectory = (await stat(full)).isDirectory();
      } catch {
        // "TaskRail.tsx:121" names a file, not where it is: look it up in the
        // session's project by exact name.
        if (!/[\\/]/.test(raw)) {
          const project = (await getProjects()).find(p => p.id === session.projectId);
          const hits = project
            ? (await searchFileNames([project], raw, { limit: 10, filter: { ignore: IGNORE_NAMES, isVisibleDotfile } }))
                .filter(r => r.type === 'file' && r.name.toLowerCase() === raw.toLowerCase())
            : [];
          if (hits[0]) return { opened: 'editor', projectId: hits[0].projectId, path: hits[0].path, ...(hits.length > 1 ? { ambiguous: hits.length } : {}) };
        }
        return reply.status(404).send({ error: `Not found: ${full}` });
      }
      // Ctrl/Cmd+click asks for the system's app (VS Code, the PDF reader) even inside a project.
      if (!isDirectory && !request.body?.system) {
        const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
        // The deepest project that holds the file wins (a client folder holds a dozen repos).
        const projects = (await getProjects())
          .filter(p => p.path)
          .sort((a, b) => b.path.length - a.path.length);
        for (const p of projects) {
          const rel = relative(p.path, full);
          if (rel && !rel.startsWith('..') && !isAbsolute(rel) && same(resolve(p.path, rel), full)) {
            return { opened: 'editor', projectId: p.id, path: rel.split('\\').join('/') };
          }
        }
      }
      // Opening runs whatever the file is: a printed "setup.exe" — or an OSC 8
      // link whose visible text says README — would start a program on one
      // click. Anything that can execute is only shown in its folder.
      if (!isDirectory && RUNNABLE_EXT.test(full)) {
        await revealInFolder(full);
        return { opened: 'revealed', path: full };
      }
      await openFolder(full);
      return { opened: 'system', path: full };
    }
  );

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

  // Claude Code reporting on itself: each session started here posts its hook
  // events to this URL (see claudeHooks). Answered at once and with an empty
  // body — the CLI waits for the reply, and anything in it would be read as
  // a decision about the tool call.
  app.post<{ Params: { sessionId: string }; Body: unknown }>(
    '/api/terminal/hook/:sessionId',
    // A plan waiting for approval travels whole in the event.
    { bodyLimit: 8 * 1024 * 1024 },
    async (request) => {
      handleClaudeHook(request.params.sessionId, request.body);
      return {};
    }
  );

  // SSE: what every session is doing. One stream for the whole app, open for
  // as long as the page is — a terminal's own socket only exists while that
  // terminal is on screen, and a timer in a minimised window is throttled to
  // one tick a minute, which is too late for "the agent is asking".
  app.get('/api/terminal/events', (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: unknown) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);

    // Whoever connects (or reconnects) starts from the truth, not from
    // whatever it remembered.
    send({ type: 'snapshot', sessions: listSessions() });
    const unsubscribe = onSessionEvent(send);
    const keepAlive = setInterval(() => reply.raw.write(': keepalive\n\n'), 25_000);

    request.raw.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // REST: Claude Code conversations to pick up again — the ones left open on a
  // tab when Shipyard closed, then the newest of each project. Without
  // projectId it covers every project, for the Dashboard.
  app.get<{ Querystring: { projectId?: string; limit?: string } }>(
    '/api/terminal/conversations',
    async (request) => {
      const { projectId } = request.query;
      // The project's "Resume" picker asks for more than the empty-state list.
      const wanted = Math.min(Math.max(Number(request.query.limit) || 0, 0), 40);
      const projects = (await getProjects()).filter(p => !projectId || p.id === projectId);
      const liveIds = new Set(listSessions().map(s => s.claudeSessionId).filter((id): id is string => !!id));
      const conversations = await listConversations({
        projects,
        liveIds,
        perProject: projectId ? wanted || 5 : 2,
        limit: projectId ? wanted || 5 : 8,
      });
      return { conversations };
    }
  );

  // REST: Create a new terminal session
  app.post<{ Body: { projectId: string; type?: string; cols?: number; rows?: number; taskId?: string; prompt?: string; agent?: string; resume?: string; resumeTitle?: string } }>(
    '/api/terminal/sessions',
    async (request, reply) => {
      if (!isAvailable()) {
        return reply.status(503).send({ error: 'Integrated terminal not available (node-pty not installed)' });
      }

      const { projectId, type = 'shell', cols = 80, rows = 24, taskId, prompt, agent, resume, resumeTitle } = request.body;
      const projects = await getProjects();
      const project = projects.find(p => p.id === projectId);
      if (!project) return reply.status(404).send({ error: 'Project not found' });

      // A session tied to a task runs in that task's worktree when the
      // worktree-per-task setting is on — that is what lets two agents work
      // on the same repo at once. Anything else runs in the project folder.
      let cwd = project.path;
      // The tab is named after the task, so the title survives a refresh
      // without the client having to carry it around.
      let taskLabel: { title?: string; number?: number } | undefined;
      let startTask = false;
      if (taskId) {
        const task = await taskStore.getTask(projectId, taskId);
        if (task) {
          // Picking a conversation back up is not starting the task again.
          startTask = !resume && task.status !== 'in_progress';
          taskLabel = { title: task.title, number: task.number };
          const worktree = await worktreeService.ensureTaskWorktree(project, task);
          cwd = worktree.path;
        }
      }

      // Claude Code only finds a conversation from the folder it ran in.
      if (resume && !taskId) cwd = (await findOpenConversation(resume))?.cwd || cwd;

      const sessionId = await createSession(
        projectId, project.path, type, cols, rows, project.name, taskId, prompt, agent, cwd, taskLabel,
        resume ? { id: resume, title: resumeTitle } : undefined,
      );
      if (!sessionId) {
        log.error('terminal', 'Failed to create terminal session', `type=${type}`, projectId);
        return reply.status(500).send({ error: 'Failed to create terminal session' });
      }

      await updateProject(project.id, { lastOpenedAt: new Date().toISOString() });

      // An agent was just handed this task: it is in progress, whichever
      // button started it. Leaving that to the agent meant the board only
      // moved if the agent remembered to say so.
      if (taskId && startTask) {
        await taskStore.updateTask(projectId, taskId, { status: 'in_progress' });
        triggerAutoSync(projectId);
      }

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
        projectName: session?.projectName,
        typeLabel: session?.typeLabel,
        taskTitle: session?.taskTitle,
        taskNumber: session?.taskNumber,
        summary: session?.summary,
        state: session?.state,
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

  // REST: Rename a tab by hand (empty title hands it back to the automatic one)
  app.patch<{ Params: { sessionId: string }; Body: { title?: string | null } }>(
    '/api/terminal/sessions/:sessionId',
    async (request, reply) => {
      const ok = renameSession(request.params.sessionId, request.body?.title);
      if (!ok) return reply.status(404).send({ error: 'Session not found' });
      const session = getSession(request.params.sessionId);
      return { success: true, customTitle: session?.customTitle ?? null };
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
      // Closed by the user: its conversation is no longer one left open.
      const conversationId = getSession(sessionId)?.claudeSessionId;
      if (conversationId) await forgetConversation(conversationId);
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
        // The session itself is closed by the service, which also tells the
        // event stream — the exit has to be heard with no socket open too.
        activeConnections.delete(sessionId);
      });

      const cleanup = () => {
        if (flushTimer) clearTimeout(flushTimer);
        onData.dispose();
        onExit.dispose();
      };

      // Track this as the active connection
      activeConnections.set(sessionId, { socket, cleanup });

      // A terminal created after the program set its modes starts without
      // them — see terminalModePreamble.
      const modes = terminalModePreamble(sessionId);
      if (modes) socket.send(JSON.stringify({ type: 'output', data: modes }));

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
