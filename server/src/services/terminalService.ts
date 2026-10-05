import { platform } from 'os';
import { nanoid } from 'nanoid';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { resolveAgent, buildAgentLaunch, quote, DEFAULT_AGENT_ID } from './agentRegistry.js';
import { aiTitlesEnabled, cleanTerminalOutput, summarizeTerminal } from './terminalSummary.js';
import { endsWithQuestion, removeHookSettings, writeHookSettings } from './claudeHooks.js';
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
  /** Why the session is `awaiting-input`: a dialog on screen, or a run that
   *  ended on a question in plain prose. A dialog is only left by answering
   *  it; moving the selection around is not an answer. */
  asking?: 'dialog' | 'prose';
  /** The Claude CLI has shown itself in this terminal. */
  claude?: boolean;
  /** The CLI in this terminal reports through hooks (see handleClaudeHook). */
  hooked?: boolean;
  /** When a hook last said the CLI stopped — see readTitles. */
  hookAt?: number;
  /** The CLI has just quit: until then its last frames are not read as a CLI. */
  goneUntil?: number;
  /** The terminal title shows the resting glyph: no run in flight. */
  resting?: boolean;
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
  /** What the tab is about when no task names it: the topic Claude Code puts
   *  in the terminal title, or an AI-written label for a plain shell */
  summary?: string;
  /** Claude Code is naming this terminal itself — the AI summary stands down */
  titled?: boolean;
  /** Prompt injection is still under way: the screen is not classified yet */
  watchHold?: boolean;
}

const sessions = new Map<string, TerminalSession>();

// ── Session events ─────────────────────────────────────────────────────
//
// What every session is doing, for whoever wants to know. One stream for all
// of them: a terminal's own socket only exists while that terminal is on
// screen, and the moment a flag matters is when it is not.

export type SessionEvent =
  | { type: 'state'; sessionId: string; state: TerminalState | null }
  | { type: 'label'; sessionId: string; summary: string | null }
  | { type: 'exit'; sessionId: string; code: number };

const sessionListeners = new Set<(event: SessionEvent) => void>();

export function onSessionEvent(listener: (event: SessionEvent) => void): () => void {
  sessionListeners.add(listener);
  return () => { sessionListeners.delete(listener); };
}

function emitSessionEvent(event: SessionEvent): void {
  for (const listener of sessionListeners) {
    try { listener(event); } catch {}
  }
}

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

// How long a CLI started with its prompt gets to boot before the screen is judged.
const LAUNCH_HOLD_MS = 10_000;

/** `--settings` for a Claude session, so it reports its state through hooks. */
async function hookArgs(sessionId: string): Promise<string> {
  const path = await writeHookSettings(sessionId);
  return path ? `--settings ${quote(path)}` : '';
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

  // Claude Code is the one CLI that reports its own state (see claudeHooks).
  let runsClaude = false;

  if (type === 'dev') {
    initialCommand = await detectDevCommand(workdir);
  } else if (type === 'claude' && !agentId) {
    // Plain Claude tab from the project menu — permissions prompt intact.
    env['CLAUDECODE'] = '';
    initialCommand = ['claude', await hookArgs(id)].filter(Boolean).join(' ');
    runsClaude = true;
  } else if (AGENT_SESSION_TYPES.has(type)) {
    agent = resolveAgent(agentId);
    runsClaude = agent.id === DEFAULT_AGENT_ID;
    if (runsClaude) env['CLAUDECODE'] = '';
    const extraArgs = runsClaude ? await hookArgs(id) : '';
    const launch = await buildAgentLaunch(agent, { cwd: workdir, prompt, extraArgs });
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
    // Another agent's CLI says nothing we can read, so its tab claims nothing:
    // a state set here would never change and the tab would spin forever.
    ...(runsClaude ? { state: 'busy' as TerminalState, claude: true } : {}),
  };

  sessions.set(id, session);

  // The process can die while no terminal is mounted to hear it (the board is
  // in front), so the session is closed from here, not from the socket.
  pty.onExit(({ exitCode }) => {
    if (!sessions.has(id)) return;
    // Let the socket, if there is one, flush the last output first.
    setImmediate(() => {
      killSession(id);
      emitSessionEvent({ type: 'exit', sessionId: id, code: exitCode });
    });
  });

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
    // The watcher is attached from the start so it sees the title the CLI
    // writes as soon as the prompt lands; it only starts judging the screen
    // once the injection is over.
    startOutputWatcher(id, { hold: true });
    injectPromptWhenReady(id, prompt, () => releaseOutputWatcher(id));
  } else if (prompt && runsClaude) {
    // The prompt went in on the command line and the CLI submits it itself.
    // Its UserPromptSubmit hook ends the hold; the timer covers a CLI that
    // never gets that far (a "trust this folder?" dialog, no hooks).
    startOutputWatcher(id, { hold: true });
    setTimeout(() => {
      const current = sessions.get(id);
      if (!current?.watchHold) return;
      current.watchHold = false;
      if (!current.hooked) current.working = true;
    }, LAUNCH_HOLD_MS);
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
  removeHookSettings(id);
  return true;
}

type SessionInfo = Omit<TerminalSession, 'pty'>;

export function listSessions(projectId?: string): SessionInfo[] {
  const list: SessionInfo[] = [];
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

export function listAiSessions(): SessionInfo[] {
  const list: SessionInfo[] = [];
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

// Claude is not only where it was launched from: people open a shell and type
// `claude` in it. So the screen decides, not the session type — these are the
// marks the CLI leaves on it (the status line, the hint bar, its own banner).
const CLAUDE_SCREEN_RE = /bypass permissions|\? for shortcuts|esc to interrupt|Claude Code v\d|shift\+tab to cycle/i;

// A permission dialog or a choice list — the CLI is blocked on a decision, not
// merely idle. The footer counts as much as the options: it is the last line
// of every dialog, so it is still in view when a long list has pushed the
// selected option out of the lines we read, and some dialogs ("Yes, I trust
// this folder") have no numbers at all.
const DECISION_RE = /Do you want|❯\s*\d[.)]|\(y\/n\)|Enter to (?:confirm|select)|Esc to cancel/i;

// The empty input box, as it survives cleanTerminalOutput: a line that is a
// prompt character and nothing else, or the greyed-out suggestion the CLI
// shows in an empty box. Anchoring on the end of the raw output cannot work —
// a TUI redraw ends in cursor moves, never in the prompt.
//
// The rule drawn above the box is as wide as the terminal, so the terminal
// wraps it without a line break and the prompt arrives glued to its end
// ("────────❯ Try …"). The leading run of rule characters allows for that;
// without it a freshly opened CLI was never seen as idle.
const IDLE_PROMPT_RE = /^[│|─━\s]*[>❯]\s*(?:│\s*)?(?:Try\s*".*)?$/;

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

function setSessionState(id: string, state: TerminalState | null, asking?: 'dialog' | 'prose'): void {
  const session = sessions.get(id);
  if (!session) return;
  session.asking = state === 'awaiting-input' ? asking ?? session.asking : undefined;
  if ((session.state ?? null) === state) return;
  if (state) session.state = state;
  else delete session.state;
  emitSessionEvent({ type: 'state', sessionId: id, state });
}

function setSessionSummary(id: string, summary: string): void {
  const session = sessions.get(id);
  if (!session || session.summary === summary) return;
  session.summary = summary;
  emitSessionEvent({ type: 'label', sessionId: id, summary });
}

// How long after a hook said the CLI stopped a spinner in the title is still
// taken for the frame drawn just before it. The hook comes over HTTP and the
// title through the PTY, so the two can arrive in either order.
const HOOK_TITLE_GRACE_MS = 1_500;
const CLI_EXIT_GRACE_MS = 5_000;

/**
 * Claude Code reporting on itself (see claudeHooks). These are facts, where
 * the screen watcher below only infers — so they set the state outright, and
 * the watcher is left to cover what no hook announces: an interrupted run and
 * a CLI someone started by hand.
 */
export function handleClaudeHook(id: string, event: any): boolean {
  const session = sessions.get(id);
  if (!session) return false;
  session.claude = true;
  session.hooked = true;

  switch (event?.hook_event_name) {
    case 'UserPromptSubmit':
      session.watchHold = false;
      session.working = true;
      setSessionState(id, 'busy');
      break;
    case 'PreToolUse':
    case 'PermissionRequest':
    case 'Elicitation':
      session.hookAt = Date.now();
      setSessionState(id, 'awaiting-input', 'dialog');
      break;
    case 'StopFailure':
      // The run died on an API error. It is over all the same.
      session.hookAt = Date.now();
      session.working = false;
      setSessionState(id, 'finished');
      break;
    case 'Stop':
      session.hookAt = Date.now();
      session.working = false;
      if (endsWithQuestion(event.last_assistant_message)) setSessionState(id, 'awaiting-input', 'prose');
      else setSessionState(id, 'finished');
      break;
    case 'SessionEnd':
      // `/clear` ends a session and starts the next in the same process.
      if (event.reason === 'clear') break;
      markCliGone(id);
      break;
  }
  return true;
}

/** The CLI quit: the terminal is a plain shell again, with nothing to report. */
function markCliGone(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.claude = false;
  session.hooked = false;
  session.titled = false;
  session.working = false;
  // What it draws on the way out still carries its marks.
  session.goneUntil = Date.now() + CLI_EXIT_GRACE_MS;
  setSessionState(id, null);
}

// ── What Claude Code says about itself ─────────────────────────────────
//
// The CLI keeps the terminal title up to date (OSC 0): a glyph and then either
// its own name or the topic of the conversation — "✳ Claude Code" at rest,
// "◐ Nomes das abas do terminal" while it works. That is a better source than
// anything read off the screen: it arrives a second after the first prompt, in
// the user's language, costs no AI call, and the glyph says whether a run is
// in flight.

const OSC_TITLE_RE = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const CLAUDE_TITLE_NAME = 'Claude Code';
const TITLE_REST_GLYPH = '✳';
const TITLE_MAX_LENGTH = 60;

/** Split a title into its leading glyph and the text after it. */
function parseTitle(title: string): { glyph: string; text: string } | null {
  const match = title.trim().match(/^([^\p{L}\p{N}\s])\s+(.+)$/u);
  return match ? { glyph: match[1], text: match[2].trim() } : null;
}

// A question asked in plain prose leaves the CLI at an ordinary empty prompt,
// with nothing a dialog regex could catch. The only trace is the text above
// the box, so that is where to look.
const RULE_LINE_RE = /^[─━│┃╭╮╰╯|\-_=\s]+$/;
const QUESTION_LINES = 6;

function asksSomething(screen: string[]): boolean {
  let promptAt = -1;
  for (let i = screen.length - 1; i >= 0; i--) {
    if (IDLE_PROMPT_RE.test(screen[i])) { promptAt = i; break; }
  }
  const above = (promptAt === -1 ? screen : screen.slice(0, promptAt))
    .filter(line => !RULE_LINE_RE.test(line))
    .slice(-QUESTION_LINES);
  return above.some(line => /[?？]$/.test(line));
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
 *
 * `awaiting-input` and `finished` are sticky: only the user answering (real
 * input) or a new run takes them away. Output alone does not — a TUI repaints
 * while it sits idle, and treating that as "busy again" dropped the flag
 * before anyone had seen it.
 */
const watchers = new Map<string, { timer: NodeJS.Timeout; dispose: () => void }>();

const WATCH_BUSY_CHECK = 2_000;
const DECISION_FRAME_LINES = 4;
const RUNNING_TAIL_LINES = 6;

function stopOutputWatcher(id: string): void {
  const watcher = watchers.get(id);
  if (!watcher) return;
  watchers.delete(id);
  clearInterval(watcher.timer);
  try { watcher.dispose(); } catch {}
}

/** The injected prompt has landed: from here on the screen is judged. */
function releaseOutputWatcher(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.watchHold = false;
  session.working = true;
  setSessionState(id, 'busy');
}

function startOutputWatcher(sessionId: string, options?: { hold?: boolean }): void {
  const session = sessions.get(sessionId);
  if (!session || session.watching) return;
  session.watching = true;
  if (options?.hold) session.watchHold = true;

  let tail = '';
  let titleCarry = '';
  let lastOutputTime = Date.now();
  let lastBusyCheck = 0;
  let sawOutput = false;

  /** The CLI has just shown itself. Typing `claude` and pressing Enter counts
   *  as input, but booting is not work, so the first prompt it draws must not
   *  be announced as a finished run. */
  const markClaude = () => {
    const current = sessions.get(sessionId);
    if (!current || current.claude) return;
    current.claude = true;
    if (!current.watchHold) current.working = false;
    // A shell someone typed `claude` into has no state yet.
    if (!current.state) setSessionState(sessionId, 'busy');
  };

  const readTitles = (data: string) => {
    // A title can be cut by a chunk boundary, so the unfinished part waits
    // for the next chunk.
    const text = titleCarry + data;
    const open = text.lastIndexOf('\x1b]');
    titleCarry = open !== -1 && !/\x07|\x1b\\/.test(text.slice(open + 2)) ? text.slice(open, open + 512) : '';

    for (const match of text.matchAll(OSC_TITLE_RE)) {
      const current = sessions.get(sessionId);
      if (!current) return;
      // The CLI hands the title back empty when it quits. That is the only
      // word on an exit no hook reports — one before the session began, like
      // turning down the "trust this folder?" dialog.
      if (!match[1].trim() && current.claude && !current.watchHold) {
        markCliGone(sessionId);
        continue;
      }
      const title = parseTitle(match[1]);
      if (!title) continue;
      // Only a terminal that has introduced itself as Claude Code is trusted
      // from then on — any program may put a symbol in front of its title.
      if (title.text === CLAUDE_TITLE_NAME) current.titled = true;
      if (!current.titled) continue;
      markClaude();

      if (title.text !== CLAUDE_TITLE_NAME) {
        const label = title.text.length > TITLE_MAX_LENGTH
          ? title.text.slice(0, TITLE_MAX_LENGTH - 1) + '…'
          : title.text;
        setSessionSummary(sessionId, label);
      }
      // Any glyph but the resting one is the spinner: a run is in flight. The
      // CLI rests the title while a dialog is up and when a run ends, so a
      // spinner after either means work resumed — unless it is the frame
      // drawn just before the hook that reported the stop.
      current.resting = title.glyph === TITLE_REST_GLYPH;
      const staleFrame = Date.now() - (current.hookAt ?? 0) < HOOK_TITLE_GRACE_MS;
      if (!current.resting && !current.watchHold && !staleFrame) {
        current.working = true;
        setSessionState(sessionId, 'busy');
      }
    }
  };

  const disposable = session.pty.onData((data: string) => {
    lastOutputTime = Date.now();
    sawOutput = true;
    tail += data;
    if (tail.length > 8_000) tail = tail.slice(-4_000);
    if (titleCarry || data.includes('\x1b]')) readTitles(data);
  });

  const timer = setInterval(() => {
    const current = sessions.get(sessionId);
    if (!current) {
      stopOutputWatcher(sessionId);
      return;
    }
    if (!sawOutput) return;
    // During the wait for prompt injection the CLI shows an idle prompt that
    // would read as a false 'idle'.
    if (current.watchHold) return;

    const now = Date.now();
    if (now - lastOutputTime < WATCH_SETTLE_TIME) {
      // Output that never settles is a run in flight (the spinner redraws ten
      // times a second), so it has to be recognised without waiting for a
      // pause that will not come.
      if (current.claude && !current.hooked && current.state !== 'busy' && now - lastBusyCheck >= WATCH_BUSY_CHECK) {
        lastBusyCheck = now;
        if (lastLines(cleanTerminalOutput(tail)).slice(-RUNNING_TAIL_LINES).some(line => RUNNING_RE.test(line))) {
          current.working = true;
          setSessionState(sessionId, 'busy');
        }
      }
      return;
    }

    // Output has settled — decide what the CLI is showing, then start a fresh
    // buffer. Keeping the old text would let one answered permission dialog
    // re-flag the tab on every later pause.
    const clean = cleanTerminalOutput(tail);
    tail = '';
    sawOutput = false;

    // Once the CLI has shown itself, the session is a Claude session until it
    // dies — a later frame that draws only the spinner still belongs to it.
    if (!current.claude && (now < (current.goneUntil ?? 0) || !looksLikeClaude(clean))) return;
    markClaude();

    // Read the screen as it stands, not the whole buffer: one settled chunk
    // holds every frame drawn since the last one, so an "esc to interrupt"
    // from a run that has already ended would answer for the run that has.
    const screen = lastLines(clean);

    // One settled chunk holds every frame drawn since the last one — a short
    // run fits in it whole, "esc to interrupt" and the final prompt alike. So
    // what counts is which mark was drawn last, not which marks are present.
    const lastIndex = (test: (line: string) => boolean) => {
      for (let i = screen.length - 1; i >= 0; i--) if (test(screen[i])) return i;
      return -1;
    };
    const decisionAt = lastIndex(line => DECISION_RE.test(line));
    const runningAt = lastIndex(line => RUNNING_RE.test(line));
    const idleAt = lastIndex(line => IDLE_PROMPT_RE.test(line));

    // A dialog redraws the input area around itself, so a prompt a few lines
    // after it belongs to the same frame, not to a later one.
    // A session that reports through hooks has already said how its run
    // ended, so there a dialog is only read off the screen while the tab
    // still says "busy": one no hook announced, or the next question of a
    // dialog that asks several.
    const mayAsk = !current.hooked || current.state === 'busy';
    if (mayAsk && decisionAt !== -1 && decisionAt > runningAt && idleAt <= decisionAt + DECISION_FRAME_LINES) {
      current.working = false;
      setSessionState(sessionId, 'awaiting-input', 'dialog');
      return;
    }
    // The title is the better witness of "no run in flight": the screen may
    // not show an empty prompt at all — a run interrupted with Esc puts the
    // prompt that was sent back in the box — and a chunk can end on a stale
    // "esc to interrupt".
    const titleRests = !!current.titled && !!current.resting;
    if (current.hooked) {
      // Hooks announce every ending but an interrupted run, which leaves the
      // tab on "busy" with the CLI at rest.
      const atRest = current.titled ? titleRests : idleAt !== -1;
      if (atRest && current.state === 'busy') {
        current.working = false;
        setSessionState(sessionId, 'idle');
      }
      return;
    }
    if (!titleRests && runningAt > idleAt) {
      current.working = true;
      setSessionState(sessionId, 'busy');
      return;
    }
    if (idleAt === -1 && !titleRests) return;

    // Back at an empty prompt: a run just ended, or the CLI was never given
    // anything to do. Only the first is worth telling the user about, and it
    // is announced once — the next one needs new work behind it. A run that
    // ended on a question is waiting for an answer, not merely done.
    if (current.working) {
      current.working = false;
      if (asksSomething(screen)) setSessionState(sessionId, 'awaiting-input', 'prose');
      else setSessionState(sessionId, 'finished');
    } else if (current.state === 'busy' || !current.state) {
      // Never downgrade a flag that is still waiting to be seen: an idle
      // repaint of the same screen is not news.
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
    // Claude Code names its own terminal (see readTitles); asking the AI on
    // top of that only produced labels like "Claude Code session started".
    if (running || current.customTitle || current.titled || !aiTitlesEnabled()) return;

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
        if (live && !live.customTitle && !live.titled) setSessionSummary(sessionId, label);
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
 * The user answered — back to busy. Only what submits counts: a line sent
 * with Enter, or, in a dialog, the keys that pick an option (a digit) or
 * dismiss it (Esc). Typing a draft or moving the selection with the arrows
 * leaves the CLI exactly as blocked as it was, and flipping the tab to "busy"
 * on every keystroke made the question flag blink off and on again.
 */
function noteSessionInput(id: string, data?: string): void {
  const session = sessions.get(id);
  if (!session?.state) return;
  // xterm answers the CLI's own queries (focus in/out, cursor position,
  // device attributes, mouse reports) on the input channel. Nobody typed
  // those, and counting them as an answer cleared the flag unseen.
  if (data !== undefined && isTerminalReport(data)) return;
  const submitted = data === undefined || /[\r\n]/.test(data);
  const dialogKey = session.asking === 'dialog' && (data === '\x1b' || /^\d$/.test(data ?? ''));
  if (!submitted && !dialogKey) return;
  // A CLI that reports through hooks says so itself when a prompt goes in,
  // and an Enter that was no prompt (a slash command) is not work. Only the
  // answer to a dialog has no hook of its own.
  if (session.hooked && session.asking !== 'dialog') return;
  session.working = true;
  if (session.state !== 'busy') setSessionState(id, 'busy');
}

const TERMINAL_REPORT_RE = /\x1b\[[IO]|\x1b\[[?>]?[\d;]*[Rcn]|\x1b\[<[\d;]+[Mm]|\x1b\[M[\s\S]{3}|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1bP[^\x1b]*\x1b\\/g;

function isTerminalReport(data: string): boolean {
  return data.includes('\x1b') && data.replace(TERMINAL_REPORT_RE, '') === '';
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
