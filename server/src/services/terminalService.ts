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
  /** True while prompt injection is in progress — resize is deferred */
  injecting?: boolean;
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
      env['CLAUDECODE'] = '';
      initialCommand = 'claude';
    } else if (type === 'claude-yolo' || type === 'ai-resolve' || type === 'ai-manage') {
      env['CLAUDECODE'] = '';
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
  clearQueue(id);
  pendingResizes.delete(id);
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

// Pending resizes to apply after injection completes
const pendingResizes = new Map<string, { cols: number; rows: number }>();

export function resizeSession(id: string, cols: number, rows: number): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  // Defer resize during prompt injection — ConPTY on Windows can lose data
  // when resize and write happen concurrently
  if (session.injecting) {
    pendingResizes.set(id, { cols, rows });
    return true;
  }
  try {
    session.pty.resize(cols, rows);
  } catch {}
  return true;
}

function applyPendingResize(id: string): void {
  const pending = pendingResizes.get(id);
  if (!pending) return;
  pendingResizes.delete(id);
  const session = sessions.get(id);
  if (!session) return;
  try { session.pty.resize(pending.cols, pending.rows); } catch {}
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

// ── PTY write queue ───────────────────────────────────────────────────────
//
// Every byte destined for a PTY goes through a per-session FIFO. Two reasons:
//
// 1. ConPTY on Windows silently drops input when a single write exceeds its
//    buffer, so large payloads (clipboard pastes, injected prompts) must be
//    split and paced.
// 2. Without a queue, a paced write and a plain keystroke write can interleave
//    mid-sequence — the keystroke lands between two chunks of a paste and
//    corrupts it. The FIFO guarantees bytes reach the PTY in submission order.

interface QueuedChunk {
  data: string;
  /** Pause before writing the NEXT chunk (ms). */
  delayAfter: number;
  /** Called once this chunk has been written. */
  onWritten?: () => void;
}

interface WriteQueue {
  chunks: QueuedChunk[];
  draining: boolean;
  timer?: NodeJS.Timeout;
}

const writeQueues = new Map<string, WriteQueue>();

const CHUNK_SIZE = 512;
const CHUNK_DELAY = 6;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Split `data` into chunks of at most `size` UTF-16 code units without ever
 * cutting through:
 *
 *   - a surrogate pair (would emit a lone surrogate → mojibake at the PTY), or
 *   - an ANSI escape sequence (a split `\x1b[201~` end-of-paste marker leaves
 *     Claude CLI stuck in bracketed-paste mode and swallows the prompt).
 *
 * When a single escape sequence is longer than `size` the chunk is allowed to
 * grow past `size` rather than break the sequence — correctness beats the
 * buffer-size heuristic.
 */
export function safeChunks(data: string, size = CHUNK_SIZE): string[] {
  if (data.length <= size) return data.length ? [data] : [];

  const chunks: string[] = [];
  let start = 0;

  while (start < data.length) {
    let end = Math.min(start + size, data.length);

    if (end < data.length) {
      // Never leave a high surrogate as the last code unit of a chunk.
      if (isHighSurrogate(data.charCodeAt(end - 1))) end--;

      // Find an escape sequence that straddles the boundary and pull `end`
      // back to its start, so it travels whole in the next chunk.
      const escStart = data.lastIndexOf('\x1b', end - 1);
      if (escStart >= start) {
        const seqEnd = escapeSequenceEnd(data, escStart);
        if (seqEnd > end) {
          // The sequence continues past the boundary.
          end = escStart > start ? escStart : Math.min(seqEnd, data.length);
        }
      }
    }

    chunks.push(data.slice(start, end));
    start = end;
  }

  return chunks;
}

/**
 * Index just past the end of the escape sequence starting at `i`, or
 * `data.length` when the sequence is still incomplete in this buffer.
 */
function escapeSequenceEnd(data: string, i: number): number {
  const introducer = data[i + 1];
  if (introducer === undefined) return data.length;

  // CSI (`\x1b[`) and the paste markers: parameters, then a final byte 0x40–0x7E.
  if (introducer === '[') {
    for (let j = i + 2; j < data.length; j++) {
      const c = data.charCodeAt(j);
      if (c >= 0x40 && c <= 0x7e) return j + 1;
    }
    return data.length;
  }

  // OSC (`\x1b]`) runs until BEL or ST (`\x1b\\`).
  if (introducer === ']') {
    for (let j = i + 2; j < data.length; j++) {
      if (data[j] === '\x07') return j + 1;
      if (data[j] === '\x1b' && data[j + 1] === '\\') return j + 2;
    }
    return data.length;
  }

  // Everything else (`\x1bP`, `\x1bO…`, two-byte escapes) — assume two chars.
  return i + 2;
}

function enqueueChunks(id: string, chunks: QueuedChunk[]): boolean {
  if (!sessions.has(id)) return false;
  if (chunks.length === 0) return true;

  let queue = writeQueues.get(id);
  if (!queue) {
    queue = { chunks: [], draining: false };
    writeQueues.set(id, queue);
  }
  queue.chunks.push(...chunks);
  if (!queue.draining) drainQueue(id);
  return true;
}

function drainQueue(id: string): void {
  const queue = writeQueues.get(id);
  if (!queue) return;

  const session = sessions.get(id);
  if (!session) {
    writeQueues.delete(id);
    return;
  }

  const chunk = queue.chunks.shift();
  if (!chunk) {
    queue.draining = false;
    writeQueues.delete(id);
    return;
  }

  queue.draining = true;
  try {
    session.pty.write(chunk.data);
  } catch {
    writeQueues.delete(id);
    return;
  }
  chunk.onWritten?.();

  if (queue.chunks.length === 0) {
    queue.draining = false;
    writeQueues.delete(id);
    return;
  }
  queue.timer = setTimeout(() => drainQueue(id), chunk.delayAfter);
}

function clearQueue(id: string): void {
  const queue = writeQueues.get(id);
  if (!queue) return;
  if (queue.timer) clearTimeout(queue.timer);
  writeQueues.delete(id);
}

/** Write data verbatim, preserving order against any in-flight paced write. */
export function writeToSession(id: string, data: string): boolean {
  if (!sessions.has(id)) return false;
  // Short input (keystrokes) still goes through the queue so it can never
  // land in the middle of a paste that is currently being drained.
  return enqueueChunks(id, safeChunks(data).map(data => ({ data, delayAfter: CHUNK_DELAY })));
}

/**
 * Write a large payload to a PTY, paced to survive ConPTY's input buffer.
 * `sendEnter` submits a trailing `\r` after the payload has fully landed —
 * Claude CLI needs a beat to render a big bracketed paste before it will
 * accept the Enter that submits it.
 */
export function writeChunked(
  id: string,
  data: string,
  {
    chunkSize = CHUNK_SIZE,
    chunkDelay = CHUNK_DELAY,
    sendEnter = true,
    onDone,
  }: { chunkSize?: number; chunkDelay?: number; sendEnter?: boolean; onDone?: () => void } = {},
): boolean {
  if (!sessions.has(id)) return false;

  const parts = safeChunks(data, chunkSize);
  const chunks: QueuedChunk[] = parts.map(part => ({ data: part, delayAfter: chunkDelay }));

  if (sendEnter) {
    // Give the CLI time to finish rendering the paste before Enter arrives.
    if (chunks.length > 0) chunks[chunks.length - 1].delayAfter = 500;
    chunks.push({ data: '\r', delayAfter: chunkDelay, onWritten: onDone });
  } else if (chunks.length > 0) {
    chunks[chunks.length - 1].onWritten = onDone;
  }

  return enqueueChunks(id, chunks);
}

/**
 * Monitor PTY output and inject `prompt` once Claude CLI is ready.
 *
 * Uses a two-phase strategy:
 * 1. **Ready detection** — watches accumulated output for Claude CLI's prompt
 *    indicator (e.g. the `>` or `❯` prompt after the startup banner).  Falls
 *    back to silence-based detection (no output for SETTLE_TIME) and a hard
 *    MAX_WAIT ceiling.
 * 2. **Post-injection verification** — after injecting, monitors whether
 *    Claude CLI produces new output (= started processing).  If no output
 *    appears within VERIFY_TIMEOUT, the prompt is re-sent (up to MAX_RETRIES).
 *
 * During injection the session is flagged (`session.injecting = true`) so that
 * resize operations are deferred — ConPTY on Windows can lose data when resize
 * and write happen concurrently.
 */
export function injectPromptWhenReady(sessionId: string, prompt: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  let lastOutputTime = Date.now();
  let accumulatedOutput = '';
  const startTime = Date.now();
  const MAX_WAIT = 30_000;   // 30s max wait before giving up and sending anyway
  const SETTLE_TIME = 1_200; // 1.2s of silence = CLI is ready
  const MIN_WAIT = 3_000;    // Always wait at least 3s (shell + claude startup)

  // Regex to detect Claude CLI's idle prompt at the end of output.
  // Matches lines ending with `> ` or `❯ ` (with optional ANSI escapes).
  const PROMPT_RE = /(?:^|\n)\s*(?:\x1b\[[0-9;]*m)*[>❯]\s*(?:\x1b\[[0-9;]*m)*\s*$/;

  // Listen for PTY output to track when it last produced data
  const disposable = session.pty.onData((data: string) => {
    lastOutputTime = Date.now();
    accumulatedOutput += data;
    // Cap accumulated buffer to avoid unbounded memory
    if (accumulatedOutput.length > 32_000) {
      accumulatedOutput = accumulatedOutput.slice(-16_000);
    }
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
      doInject();
      return;
    }

    // Wait at least MIN_WAIT
    if (elapsed < MIN_WAIT) return;

    // Prefer content-based detection: Claude CLI prints a prompt character
    // when ready for input.
    if (PROMPT_RE.test(accumulatedOutput)) {
      cleanup();
      doInject();
      return;
    }

    // Fallback: silence-based detection (no new output for SETTLE_TIME)
    if (now - lastOutputTime >= SETTLE_TIME) {
      cleanup();
      doInject();
    }
  }, 200);

  function cleanup() {
    clearInterval(checkInterval);
    try { disposable.dispose(); } catch {}
  }

  function doInject() {
    const s = sessions.get(sessionId);
    if (!s) return;
    s.injecting = true;
    sendPromptWithRetry(sessionId, prompt, 0, () => {
      const s2 = sessions.get(sessionId);
      if (s2) s2.injecting = false;
      applyPendingResize(sessionId);
    });
  }
}

const MAX_RETRIES = 2;
const VERIFY_TIMEOUT = 5_000; // 5s to detect CLI activity after injection

function sendPromptWithRetry(
  sessionId: string,
  prompt: string,
  attempt: number,
  onDone: () => void,
): void {
  const session = sessions.get(sessionId);
  if (!session) { onDone(); return; }

  // Wrap in bracketed paste markers so Claude CLI treats the entire
  // prompt as a single paste event instead of interpreting each \n as Enter
  const pasteData = '\x1b[200~' + prompt + '\x1b[201~';

  // The queue tells us exactly when the trailing Enter reached the PTY, so we
  // no longer have to guess the write duration from the payload size.
  writeChunked(sessionId, pasteData, {
    sendEnter: true,
    onDone: () => {
      if (!sessions.has(sessionId)) { onDone(); return; }

      let gotOutput = false;
      const verifyDisposable = session.pty.onData(() => { gotOutput = true; });

      setTimeout(() => {
        try { verifyDisposable.dispose(); } catch {}

        if (gotOutput || attempt >= MAX_RETRIES) {
          // Success (or exhausted retries) — we're done
          onDone();
        } else {
          // No output detected — CLI may not have received the prompt. Retry.
          sendPromptWithRetry(sessionId, prompt, attempt + 1, onDone);
        }
      }, VERIFY_TIMEOUT);
    },
  });
}

// Clean up all sessions on server shutdown
function cleanupAll() {
  for (const id of sessions.keys()) clearQueue(id);
  for (const session of sessions.values()) {
    try { session.pty.kill(); } catch {}
  }
  sessions.clear();
}

process.on('exit', cleanupAll);
process.on('SIGINT', () => { cleanupAll(); process.exit(0); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(0); });
