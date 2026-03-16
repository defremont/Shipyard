import { platform } from 'os';
import { nanoid } from 'nanoid';
import { readFile } from 'fs/promises';
import { join } from 'path';

const os = platform();

// Dynamic import of node-pty (optional dependency)
let nodePty: typeof import('node-pty') | null = null;

try {
  nodePty = await import('node-pty');
} catch {
  console.log('node-pty not available — integrated terminal disabled (native launchers still work)');
}

export interface TerminalSession {
  id: string;
  projectId: string;
  type: string; // 'shell' | 'dev' | 'claude' | 'ai-resolve'
  title: string;
  pty: import('node-pty').IPty;
  createdAt: string;
  taskId?: string;
}

const sessions = new Map<string, TerminalSession>();

export function isAvailable(): boolean {
  return nodePty !== null;
}

function getDefaultShell(): string {
  if (os === 'win32') {
    // PowerShell has PSReadLine (arrow-key history, autocomplete) and much
    // better ConPTY support than cmd.exe.  COMSPEC points to cmd.exe which
    // doesn't handle escape sequences well through ConPTY.
    return 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

async function detectDevCommand(projectPath: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf-8'));
    if (pkg.scripts?.dev) return 'pnpm dev';
    if (pkg.scripts?.start) return 'pnpm start';
    if (pkg.scripts?.serve) return 'pnpm serve';
  } catch {}
  return null;
}

export async function createSession(
  projectId: string,
  projectPath: string,
  type: string,
  cols: number,
  rows: number,
  projectName?: string,
  taskId?: string,
  prompt?: string,
): Promise<string | null> {
  if (!nodePty) return null;

  const id = nanoid(10);
  const shell = getDefaultShell();

  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    HISTSIZE: '10000',
    HISTFILESIZE: '20000',
    HISTCONTROL: 'ignoredups:erasedups',
  };

  // Build initial command based on type
  let shellArgs: string[] = [];
  let initialCommand: string | null = null;

  if (os === 'win32') {
    // Windows: PowerShell with -NoLogo for cleaner startup
    shellArgs = ['-NoLogo'];
    if (type === 'claude') {
      env['CLAUDECODE'] = '';
      initialCommand = 'claude';
    } else if (type === 'claude-yolo' || type === 'ai-resolve' || type === 'ai-manage') {
      env['CLAUDECODE'] = '';
      initialCommand = 'claude --dangerously-skip-permissions';
    } else if (type === 'dev') {
      initialCommand = await detectDevCommand(projectPath);
    }
  } else {
    // Linux/macOS: interactive login shell (enables readline + history)
    shellArgs = ['-il'];
    if (type === 'claude') {
      initialCommand = 'claude';
    } else if (type === 'claude-yolo' || type === 'ai-resolve' || type === 'ai-manage') {
      initialCommand = 'claude --dangerously-skip-permissions';
    } else if (type === 'dev') {
      initialCommand = await detectDevCommand(projectPath);
    }
  }

  const maxLen = 18;
  const shortName = projectName && projectName.length > maxLen
    ? projectName.slice(0, maxLen - 3) + '...'
    : projectName || projectId;
  const typeLabels: Record<string, string> = { claude: 'Claude', 'claude-yolo': 'Claude', dev: 'Dev', shell: 'Shell', 'ai-resolve': 'AI', 'ai-manage': 'AI Tasks' };
  const title = `[${shortName}] ${typeLabels[type] || 'Shell'}`;

  const spawnOptions: Record<string, any> = {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: projectPath,
    env,
    handleFlowControl: true,
  };

  // On Windows, explicitly use ConPTY for better interactive prompt support
  if (os === 'win32') {
    spawnOptions.useConpty = true;
  }

  const pty = nodePty.spawn(shell, shellArgs, spawnOptions);

  const session: TerminalSession = {
    id,
    projectId,
    type,
    title,
    pty,
    createdAt: new Date().toISOString(),
    ...(taskId ? { taskId } : {}),
  };

  sessions.set(id, session);

  // Send initial command after shell initializes
  // Use a longer delay on Windows (PowerShell startup is slower)
  if (initialCommand) {
    const delay = os === 'win32' ? 800 : 400;
    setTimeout(() => {
      pty.write(initialCommand + '\r');
    }, delay);
  }

  // For AI resolve/manage sessions: inject prompt when Claude CLI is ready
  if (prompt && (type === 'ai-resolve' || type === 'ai-manage' || type === 'claude-yolo')) {
    injectPromptWhenReady(id, prompt);
  }

  return id;
}

export function getSession(id: string): TerminalSession | null {
  return sessions.get(id) || null;
}

export function killSession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;

  try {
    session.pty.kill();
  } catch {}
  sessions.delete(id);
  return true;
}

export function listSessions(projectId?: string): Omit<TerminalSession, 'pty'>[] {
  const list: Omit<TerminalSession, 'pty'>[] = [];
  for (const session of sessions.values()) {
    if (!projectId || session.projectId === projectId) {
      const { pty, ...rest } = session;
      list.push(rest);
    }
  }
  return list;
}

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.pty.resize(cols, rows);
  } catch {}
  return true;
}

export function listAiSessions(): Omit<TerminalSession, 'pty'>[] {
  const list: Omit<TerminalSession, 'pty'>[] = [];
  for (const session of sessions.values()) {
    if (session.taskId) {
      const { pty, ...rest } = session;
      list.push(rest);
    }
  }
  return list;
}

export function writeToSession(id: string, data: string): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  try {
    session.pty.write(data);
  } catch { return false; }
  return true;
}

/**
 * Write large data to a PTY session in small chunks to avoid ConPTY buffer
 * overflow on Windows. Each chunk is written with a small delay. After all
 * chunks are delivered a final `\r` (Enter) is sent separately to ensure it
 * is not lost if the last data chunk was near the buffer boundary.
 */
export function writeChunked(
  id: string,
  data: string,
  { chunkSize = 256, chunkDelay = 20, sendEnter = true }: { chunkSize?: number; chunkDelay?: number; sendEnter?: boolean } = {},
): boolean {
  const session = sessions.get(id);
  if (!session) return false;

  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.substring(i, i + chunkSize));
  }

  let index = 0;
  function writeNext() {
    const s = sessions.get(id);
    if (!s) return; // session was killed
    if (index >= chunks.length) {
      if (sendEnter) {
        // Claude CLI needs time to process the bracketed paste before
        // accepting Enter. On Windows/ConPTY large pastes can take a
        // while to render, so we wait 500ms then send Enter.
        setTimeout(() => {
          const s2 = sessions.get(id);
          if (s2) {
            try { s2.pty.write('\r'); } catch {}
          }
        }, 500);
      }
      return;
    }
    try { s.pty.write(chunks[index]); } catch { return; }
    index++;
    if (index < chunks.length) {
      setTimeout(writeNext, chunkDelay);
    } else {
      writeNext(); // last chunk — proceed to Enter immediately
    }
  }

  writeNext();
  return true;
}

/**
 * Monitor PTY output and inject `prompt` once output has settled, meaning
 * Claude CLI has finished its startup banners and is waiting for input.
 *
 * Strategy: after a minimum wait, look for a period of "silence" (no new
 * output) which indicates the CLI is ready. Falls back to a maximum wait
 * to avoid hanging forever.
 */
export function injectPromptWhenReady(sessionId: string, prompt: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  let lastOutputTime = Date.now();
  const startTime = Date.now();
  const MAX_WAIT = 30_000;   // 30s max wait before giving up and sending anyway
  const SETTLE_TIME = 1_200; // 1.2s of silence = CLI is ready
  const MIN_WAIT = 3_000;    // Always wait at least 3s (shell + claude startup)

  // Listen for PTY output to track when it last produced data
  const disposable = session.pty.onData(() => {
    lastOutputTime = Date.now();
  });

  const checkInterval = setInterval(() => {
    // Session was killed while waiting
    if (!sessions.has(sessionId)) {
      cleanup();
      return;
    }

    const now = Date.now();
    const elapsed = now - startTime;

    // Give up after max wait — send anyway
    if (elapsed > MAX_WAIT) {
      cleanup();
      sendPrompt();
      return;
    }

    // Wait at least MIN_WAIT
    if (elapsed < MIN_WAIT) return;

    // Check if output has settled (no new output for SETTLE_TIME)
    if (now - lastOutputTime >= SETTLE_TIME) {
      cleanup();
      sendPrompt();
    }
  }, 200);

  function cleanup() {
    clearInterval(checkInterval);
    try { disposable.dispose(); } catch {}
  }

  function sendPrompt() {
    // Wrap in bracketed paste markers so Claude CLI treats the entire
    // prompt as a single paste event instead of interpreting each \n as Enter
    const pasteData = '\x1b[200~' + prompt + '\x1b[201~';
    writeChunked(sessionId, pasteData, { sendEnter: true });
  }
}

// Clean up all sessions on server shutdown
function cleanupAll() {
  for (const session of sessions.values()) {
    try { session.pty.kill(); } catch {}
  }
  sessions.clear();
}

process.on('exit', cleanupAll);
process.on('SIGINT', () => { cleanupAll(); process.exit(0); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(0); });
