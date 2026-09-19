import { platform } from 'os';
import { nanoid } from 'nanoid';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { resolveAgent, buildAgentLaunch, DEFAULT_AGENT_ID } from './agentRegistry.js';
import { aiTitlesEnabled, cleanTerminalOutput, summarizeTerminal } from './terminalSummary.js';
import type { AgentDefinition } from '../types/index.js';

const os = platform();

// Dynamic import of node-pty (optional dependency)
let nodePty: typeof import('node-pty') | null = null;

try {
  nodePty = await import('node-pty');
} catch {
  console.log('node-pty not available — integrated terminal disabled (native launchers still work)');
}

/**
 * What a Claude session is doing. `finished` is `idle` with a history: the CLI
 * was given work and has now come back to an empty prompt, which is the moment
 * worth flagging on a tab nobody is looking at.
 */
export type TerminalState = 'busy' | 'awaiting-input' | 'idle' | 'finished';

export interface TerminalSession {
  id: string;
  projectId: string;
  type: string; // 'shell' | 'dev' | 'claude' | 'ai-resolve'
  title: string;
  pty: import('node-pty').IPty;
  createdAt: string;
  taskId?: string;
  /** Which agent CLI this session is running (AgentDefinition.id) */
  agent?: string;
  /** Directory the shell runs in — the task worktree when it has one */
  cwd: string;
  /** True while prompt injection is in progress — resize is deferred */
  injecting?: boolean;
  /** Claude-type sessions only: what the CLI is doing right now */
  state?: TerminalState;
  /** The CLI was given something to do and has not come back to the prompt yet.
   *  Without it, the idle prompt a freshly opened CLI shows would read as
   *  "finished" before any work was asked of it. */
  working?: boolean;
  /** Set by the WS layer — called on every state transition */
  onStateChange?: (state: TerminalState) => void;
  /** True once the output watcher has been attached (never attach twice) */
  watching?: boolean;
  /** Project name, so the client can build the tab label itself */
  projectName?: string;
  /** What runs here: 'Shell', 'Dev', 'Claude Code'… */
  typeLabel?: string;
  /** Task this session was opened for — the tab is named after it */
  taskTitle?: string;
  taskNumber?: number;
  /** Name the user typed for this tab. Wins over every other label. */
  customTitle?: string;
  /** Short AI-written label for a plain shell, from its own output */
  summary?: string;
}

const sessions = new Map<string, TerminalSession>();

// Session types that run a coding agent, so the picked agent decides the
// command line. 'claude' is here too, but only when a session explicitly names
// an agent — the bare Claude tab keeps its own launch.
const AGENT_SESSION_TYPES = new Set(['claude', 'claude-yolo', 'ai-resolve', 'ai-manage']);

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
  agentId?: string,
  /** Overrides projectPath — a task running in its own worktree passes it. */
  cwd?: string,
  /** Task behind this session, so the tab can say what it is working on. */
  task?: { title?: string; number?: number },
): Promise<string | null> {
  if (!nodePty) return null;

  // Everything below (dev command lookup, agent launch, the shell itself)
  // works in this directory; projectPath only names the project.
  const workdir = cwd || projectPath;

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

  // Windows: PowerShell with -NoLogo for cleaner startup.
  // Linux/macOS: interactive login shell (enables readline + history).
  const shellArgs: string[] = os === 'win32' ? ['-NoLogo'] : ['-il'];

  // Build initial command based on type
  let initialCommand: string | null = null;
  let agent: AgentDefinition | null = null;
  // A one-shot agent takes the prompt on its command line, so there is
  // nothing left to type into it once it starts.
  let injectPrompt = false;

  if (type === 'dev') {
    initialCommand = await detectDevCommand(workdir);
  } else if (type === 'claude' && !agentId) {
    // Plain Claude tab from the project menu — permissions prompt intact.
    env['CLAUDECODE'] = '';
    initialCommand = 'claude';
  } else if (AGENT_SESSION_TYPES.has(type)) {
    agent = resolveAgent(agentId);
    if (agent.id === DEFAULT_AGENT_ID) env['CLAUDECODE'] = '';
    const launch = await buildAgentLaunch(agent, { cwd: workdir, prompt });
    initialCommand = launch.command;
    injectPrompt = launch.injectsPrompt;
  }

  const maxLen = 18;
  const shortName = projectName && projectName.length > maxLen
    ? projectName.slice(0, maxLen - 3) + '...'
    : projectName || projectId;
  const typeLabels: Record<string, string> = { claude: 'Claude', 'claude-yolo': 'Claude', dev: 'Dev', shell: 'Shell', 'ai-resolve': 'AI', 'ai-manage': 'AI Tasks' };
  // Name the agent in the tab whenever it isn't the default one — with several
  // CLIs in play, "AI" alone no longer says which is running.
  const typeLabel = agent && agent.id !== DEFAULT_AGENT_ID
    ? (type === 'ai-manage' ? `${agent.name} Tasks` : agent.name)
    : (typeLabels[type] || 'Shell');
  const title = `[${shortName}] ${typeLabel}`;

  const spawnOptions: Record<string, any> = {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: workdir,
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
    cwd: workdir,
    createdAt: new Date().toISOString(),
    projectName: projectName || projectId,
    typeLabel,
    ...(taskId ? { taskId } : {}),
    ...(task?.title ? { taskTitle: task.title } : {}),
    ...(task?.number ? { taskNumber: task.number } : {}),
    ...(agent ? { agent: agent.id } : {}),
    ...(CLAUDE_SESSION_TYPES.has(type) ? { state: 'busy' as TerminalState } : {}),
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

  // For AI resolve/manage sessions: inject prompt when Claude CLI is ready.
  // The output watcher only starts once injection is done — during the ready
  // wait the CLI shows an idle prompt that would read as a false 'idle'.
  //
  // Every other session is watched too: a shell becomes a Claude session as
  // soon as someone types `claude` in it, and the watcher stays silent until
  // the screen says so.
  if (prompt && injectPrompt) {
    injectPromptWhenReady(id, prompt, () => startOutputWatcher(id, { working: true }));
  } else {
    startOutputWatcher(id);
  }

  // A tab with no task behind it gets its name from what the terminal shows.
  if (!taskId && SUMMARY_SESSION_TYPES.has(type)) {
    startSummaryWatcher(id);
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
  stopOutputWatcher(id);
  stopSummaryWatcher(id);
  return true;
}

export function listSessions(projectId?: string): Omit<TerminalSession, 'pty' | 'onStateChange'>[] {
  const list: Omit<TerminalSession, 'pty' | 'onStateChange'>[] = [];
  for (const session of sessions.values()) {
    if (!projectId || session.projectId === projectId) {
      const { pty, onStateChange, ...rest } = session;
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

export function listAiSessions(): Omit<TerminalSession, 'pty' | 'onStateChange'>[] {
  const list: Omit<TerminalSession, 'pty' | 'onStateChange'>[] = [];
  for (const session of sessions.values()) {
    if (session.taskId) {
      const { pty, onStateChange, ...rest } = session;
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
  noteSessionInput(id, data);
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
// Regex to detect Claude CLI's idle prompt at the end of output.
// Matches lines ending with `> ` or `❯ ` (with optional ANSI escapes).
const PROMPT_RE = /(?:^|\n)\s*(?:\x1b\[[0-9;]*m)*[>❯]\s*(?:\x1b\[[0-9;]*m)*\s*$/;

export function injectPromptWhenReady(sessionId: string, prompt: string, onInjected?: () => void): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  let lastOutputTime = Date.now();
  let accumulatedOutput = '';
  const startTime = Date.now();
  const MAX_WAIT = 30_000;   // 30s max wait before giving up and sending anyway
  const SETTLE_TIME = 1_200; // 1.2s of silence = CLI is ready
  const MIN_WAIT = 3_000;    // Always wait at least 3s (shell + claude startup)

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
      onInjected?.();
    });
  }
}

// ── Awaiting-input detection ───────────────────────────────────────────
//
// Claude CLI stops and waits: a permission dialog, a numbered choice, or just
// an idle prompt once it has finished. Unless that tab happens to be visible,
// the user never notices. So we watch the output of every Claude session and
// tell the client when the CLI is waiting on a human.

const CLAUDE_SESSION_TYPES = new Set(['claude', 'claude-yolo', 'ai-resolve', 'ai-manage']);

// Claude is not only where it was launched from: people open a shell and type
// `claude` in it. So the screen decides, not the session type — these are the
// marks the CLI leaves on it (the status line, the hint bar, its own banner).
const CLAUDE_SCREEN_RE = /bypass permissions|\? for shortcuts|esc to interrupt|Claude Code v\d|shift\+tab to cycle/i;

// A permission dialog or a numbered choice list — the CLI is blocked on a
// decision, not merely idle.
const DECISION_RE = /Do you want|❯\s*\d[.)]|\(y\/n\)/i;

// The empty input box, as it survives cleanTerminalOutput: a line that is a
// prompt character and nothing else, or the greyed-out suggestion the CLI
// shows in an empty box. Anchoring on the end of the raw output cannot work —
// a TUI redraw ends in cursor moves, never in the prompt.
const IDLE_PROMPT_RE = /^[│|]?\s*[>❯]\s*(?:│\s*)?(?:Try\s*".*)?$/;

// How far back to read the screen. The box sits above the status line, the
// hint line and whatever warning the CLI decided to print today, so a short
// window loses it.
const IDLE_TAIL_LINES = 15;

// A run in flight. The CLI keeps an empty input box on screen while it works,
// so the box alone cannot mean "done" — this line is what says otherwise.
const RUNNING_RE = /esc to interrupt/i;

const WATCH_SETTLE_TIME = 1_200; // same silence window the injector trusts
const WATCH_TICK = 300;

/** Does this screen belong to a running Claude CLI? */
function looksLikeClaude(clean: string): boolean {
  return CLAUDE_SCREEN_RE.test(clean) || lastLines(clean).some(line => IDLE_PROMPT_RE.test(line));
}

function lastLines(clean: string): string[] {
  return clean
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-IDLE_TAIL_LINES);
}

function setSessionState(id: string, state: TerminalState): void {
  const session = sessions.get(id);
  if (!session || session.state === state) return;
  session.state = state;
  try { session.onStateChange?.(state); } catch {}
}

/**
 * Watch a session's output and say what Claude is doing in it: busy,
 * awaiting-input, idle, or finished. Strictly read-only — it never writes to
 * the PTY and never touches the write queue or the `injecting` flag, so it
 * cannot interleave with a paste.
 *
 * It runs on every session, because a shell becomes a Claude session the
 * moment someone types `claude` in it, and stays silent until the screen says
 * Claude is there.
 */
const watchers = new Map<string, { timer: NodeJS.Timeout; dispose: () => void }>();

function stopOutputWatcher(id: string): void {
  const watcher = watchers.get(id);
  if (!watcher) return;
  watchers.delete(id);
  clearInterval(watcher.timer);
  try { watcher.dispose(); } catch {}
}

function startOutputWatcher(sessionId: string, options?: { working?: boolean }): void {
  const session = sessions.get(sessionId);
  if (!session || session.watching) return;
  session.watching = true;
  // An injected prompt is work already under way; a bare CLI is not, and its
  // first idle prompt only means it finished booting.
  if (options?.working) session.working = true;

  let tail = '';
  let lastOutputTime = Date.now();
  let sawOutput = false;
  let sawClaude = false;

  const disposable = session.pty.onData((data: string) => {
    lastOutputTime = Date.now();
    sawOutput = true;
    tail += data;
    if (tail.length > 8_000) tail = tail.slice(-4_000);
    if (sawClaude) setSessionState(sessionId, 'busy');
  });

  const timer = setInterval(() => {
    if (!sessions.has(sessionId)) {
      stopOutputWatcher(sessionId);
      return;
    }
    if (!sawOutput) return;
    if (Date.now() - lastOutputTime < WATCH_SETTLE_TIME) return;

    // Output has settled — decide what the CLI is showing, then start a fresh
    // buffer. Keeping the old text would let one answered permission dialog
    // re-flag the tab on every later pause.
    const clean = cleanTerminalOutput(tail);
    tail = '';
    sawOutput = false;

    // Once the CLI has shown itself, the session is a Claude session until it
    // dies — a later frame that draws only the spinner still belongs to it.
    if (!sawClaude && !looksLikeClaude(clean)) return;
    if (!sawClaude) {
      // The CLI has just appeared on screen. Typing `claude` and pressing
      // Enter counts as input, but booting is not work, so the first prompt
      // it draws must not be announced as a finished run.
      sawClaude = true;
      const current = sessions.get(sessionId);
      if (current) current.working = false;
    }

    // Read the screen as it stands, not the whole buffer: one settled chunk
    // holds every frame drawn since the last one, so an "esc to interrupt"
    // from a run that has already ended would answer for the run that has.
    const screen = lastLines(clean);
    const text = screen.join('\n');

    if (DECISION_RE.test(text)) {
      setSessionState(sessionId, 'awaiting-input');
      return;
    }
    if (RUNNING_RE.test(text)) {
      setSessionState(sessionId, 'busy');
      return;
    }
    if (!screen.some(line => IDLE_PROMPT_RE.test(line))) return;

    // Back at an empty prompt: a run just ended, or the CLI was never given
    // anything to do. Only the first is worth telling the user about, and it
    // is announced once — the next one needs new work behind it.
    const current = sessions.get(sessionId);
    if (current?.working) {
      current.working = false;
      setSessionState(sessionId, 'finished');
    } else {
      setSessionState(sessionId, 'idle');
    }
  }, WATCH_TICK);

  watchers.set(sessionId, { timer, dispose: () => disposable.dispose() });
}

/**
 * Name a tab by hand. An empty title clears it, which hands the tab back to
 * the automatic label (task title, AI summary or the session type).
 */
export function renameSession(id: string, title: string | null | undefined): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  const clean = (title || '').trim().slice(0, 60);
  if (clean) session.customTitle = clean;
  else delete session.customTitle;
  return true;
}

// ── AI tab labels ──────────────────────────────────────────────────────
//
// A shell has no task to name it, so the tab is named after its own output.
// Every guard here exists to keep that from turning into a stream of AI calls:
// only after the output settles, at most once per session per interval, one
// call at a time process-wide (the queue lives in terminalSummary), and a
// session whose calls fail twice is dropped — there is no usable backend.

// Any tab with no task behind it, Claude's included: "Claude" as a label says
// no more than "Shell" did once three of them are open side by side.
const SUMMARY_SESSION_TYPES = new Set(['shell', 'dev', 'claude', 'claude-yolo']);
const SUMMARY_SETTLE_MS = 3_000;
const SUMMARY_MIN_INTERVAL_MS = 45_000;
const SUMMARY_MIN_CHARS = 120;
const SUMMARY_TICK = 1_500;
const SUMMARY_MAX_FAILURES = 2;

const summaryWatchers = new Map<string, { timer: NodeJS.Timeout; dispose: () => void }>();

function stopSummaryWatcher(id: string): void {
  const watcher = summaryWatchers.get(id);
  if (!watcher) return;
  summaryWatchers.delete(id);
  clearInterval(watcher.timer);
  try { watcher.dispose(); } catch {}
}

function startSummaryWatcher(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session || summaryWatchers.has(sessionId)) return;
  if (!aiTitlesEnabled()) return;

  let buffer = '';
  let lastOutputAt = 0;
  let lastAskedAt = 0;
  let freshChars = 0;
  let failures = 0;
  let running = false;

  const disposable = session.pty.onData((data: string) => {
    lastOutputAt = Date.now();
    freshChars += data.length;
    buffer += data;
    if (buffer.length > 12_000) buffer = buffer.slice(-8_000);
  });

  const timer = setInterval(() => {
    const current = sessions.get(sessionId);
    if (!current) {
      stopSummaryWatcher(sessionId);
      return;
    }
    // A hand-typed name is the user's, and the setting can be turned off
    // while sessions are open.
    if (running || current.customTitle || !aiTitlesEnabled()) return;

    const now = Date.now();
    if (freshChars < SUMMARY_MIN_CHARS) return;
    if (now - lastOutputAt < SUMMARY_SETTLE_MS) return;
    if (lastAskedAt && now - lastAskedAt < SUMMARY_MIN_INTERVAL_MS) return;

    running = true;
    freshChars = 0;
    const snapshot = buffer;

    summarizeTerminal(snapshot, current.cwd)
      .then(label => {
        failures = 0;
        if (!label) return;
        const live = sessions.get(sessionId);
        if (live && !live.customTitle) live.summary = label;
      })
      .catch(() => {
        failures += 1;
        if (failures >= SUMMARY_MAX_FAILURES) stopSummaryWatcher(sessionId);
      })
      .finally(() => {
        lastAskedAt = Date.now();
        running = false;
      });
  }, SUMMARY_TICK);

  summaryWatchers.set(sessionId, { timer, dispose: () => disposable.dispose() });
}

/**
 * Any keystroke or paste means the user answered — back to busy. A submitted
 * line (the Enter) is also what puts the CLI back to work, and only then is the
 * next idle prompt worth calling "finished".
 */
function noteSessionInput(id: string, data?: string): void {
  const session = sessions.get(id);
  if (!session?.state) return;
  if (data === undefined || /[\r\n]/.test(data)) session.working = true;
  if (session.state !== 'busy') setSessionState(id, 'busy');
}

export function setStateListener(id: string, listener: ((state: TerminalState) => void) | undefined): TerminalState | null {
  const session = sessions.get(id);
  if (!session) return null;
  session.onStateChange = listener;
  return session.state ?? null;
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
  for (const id of sessions.keys()) { clearQueue(id); stopOutputWatcher(id); }
  for (const session of sessions.values()) {
    try { session.pty.kill(); } catch {}
  }
  sessions.clear();
}

process.on('exit', cleanupAll);
process.on('SIGINT', () => { cleanupAll(); process.exit(0); });
process.on('SIGTERM', () => { cleanupAll(); process.exit(0); });
