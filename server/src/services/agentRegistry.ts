import { mkdir, writeFile, readdir, stat, unlink } from 'fs/promises';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { platform } from 'os';
import type { AgentDefinition } from '../types/index.js';
import { getSettings, saveSettings } from './settingsStore.js';
import { DATA_DIR } from './dataDir.js';

const execFileAsync = promisify(execFile);

const isWindows = platform() === 'win32';

export const DEFAULT_AGENT_ID = 'claude';

/**
 * CLIs Shipyard knows how to launch. None of them take the prompt as an
 * argument: the terminal types it into the running CLI instead, which keeps
 * the line breaks a multi-paragraph task prompt depends on.
 */
export const BUILTIN_AGENTS: AgentDefinition[] = [
  { id: 'claude', name: 'Claude Code', command: 'claude', args: '--dangerously-skip-permissions', builtin: true },
  { id: 'codex', name: 'Codex CLI', command: 'codex', args: '--full-auto', builtin: true },
  { id: 'aider', name: 'Aider', command: 'aider', args: '--yes-always', builtin: true },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', args: '--yolo', builtin: true },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: '', builtin: true },
  { id: 'cursor', name: 'Cursor CLI', command: 'cursor-agent', args: '--force', builtin: true },
];

const BUILTIN_IDS = new Set(BUILTIN_AGENTS.map(a => a.id));

export function getCustomAgents(): AgentDefinition[] {
  return (getSettings().customAgents || []).map(a => ({ ...a, builtin: false }));
}

export function listAgents(): AgentDefinition[] {
  return [...BUILTIN_AGENTS, ...getCustomAgents()];
}

/** The agent a task named, or the configured default, or Claude Code. */
export function resolveAgent(id?: string): AgentDefinition {
  const agents = listAgents();
  const wanted = id || getSettings().defaultAgent || DEFAULT_AGENT_ID;
  return agents.find(a => a.id === wanted)
    || agents.find(a => a.id === DEFAULT_AGENT_ID)
    || BUILTIN_AGENTS[0];
}

// PATH lookups, cached — the settings screen asks for all of them at once.
const pathCache = new Map<string, { found: boolean; checkedAt: number }>();
const PATH_CACHE_TTL = 60_000;

/**
 * Is the binary on PATH? A lookup, never an execution: these commands come
 * from the user, and running an unknown one just to see if it exists could
 * open a TUI or worse.
 */
async function isOnPath(command: string): Promise<boolean> {
  const hit = pathCache.get(command);
  const now = Date.now();
  if (hit && now - hit.checkedAt < PATH_CACHE_TTL) return hit.found;

  let found = false;
  try {
    const { stdout } = await execFileAsync(isWindows ? 'where' : 'which', [command], {
      timeout: 5000,
      windowsHide: true,
    });
    found = stdout.trim().length > 0;
  } catch {
    // Not installed, or not on PATH for this process.
  }
  pathCache.set(command, { found, checkedAt: now });
  return found;
}

/** Which agents have their binary installed, keyed by agent id. */
export async function agentAvailability(): Promise<Record<string, boolean>> {
  const agents = listAgents();
  const commands = [...new Set(agents.map(a => a.command))];
  const results = await Promise.all(commands.map(async c => [c, await isOnPath(c)] as const));
  const byCommand = new Map(results);
  const out: Record<string, boolean> = {};
  for (const agent of agents) out[agent.id] = byCommand.get(agent.command) ?? false;
  return out;
}

// ── Saving custom agents ─────────────────────────────────────────────────

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * Validate and persist the user's agent list. Throws on the first bad entry so
 * the settings screen can show what to fix instead of silently dropping it.
 */
export async function saveCustomAgents(input: unknown): Promise<AgentDefinition[]> {
  if (!Array.isArray(input)) throw new Error('customAgents must be a list');
  if (input.length > 50) throw new Error('Too many agents (max 50)');

  const seen = new Set<string>();
  const agents: AgentDefinition[] = input.map((raw: any) => {
    const id = String(raw?.id || '').trim().toLowerCase();
    const name = String(raw?.name || '').trim();
    const command = String(raw?.command || '').trim();
    const args = String(raw?.args ?? '').trim();

    if (!ID_RE.test(id)) throw new Error(`Invalid agent id "${id}" — use lowercase letters, digits and dashes`);
    if (BUILTIN_IDS.has(id)) throw new Error(`"${id}" is a built-in agent id`);
    if (seen.has(id)) throw new Error(`Duplicate agent id "${id}"`);
    if (!name) throw new Error(`Agent "${id}" needs a name`);
    if (!command) throw new Error(`Agent "${id}" needs a command`);
    seen.add(id);

    return { id, name, command, args, builtin: false };
  });

  await saveSettings({ ...getSettings(), customAgents: agents });
  return agents;
}

export async function saveDefaultAgent(id: string): Promise<string> {
  const agent = listAgents().find(a => a.id === id);
  if (!agent) throw new Error(`Unknown agent "${id}"`);
  await saveSettings({ ...getSettings(), defaultAgent: agent.id });
  return agent.id;
}

// ── Launch command ───────────────────────────────────────────────────────

const PROMPT_DIR = join(DATA_DIR, 'agent-prompts');
const PROMPT_TTL_MS = 24 * 60 * 60 * 1000;

/** Quote a value for the shell the integrated terminal runs (PowerShell or sh). */
function quote(value: string): string {
  return isWindows
    ? `'${value.replace(/'/g, "''")}'`
    : `'${value.replace(/'/g, `'\''`)}'`;
}

function quoteCommand(command: string): string {
  if (!/\s/.test(command)) return command;
  // A quoted string on its own is just a string in PowerShell — `&` runs it.
  return isWindows ? `& ${quote(command)}` : quote(command);
}

/** Collapse to one line: a command-line argument cannot carry line breaks. */
function singleLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}

async function writePromptFile(prompt: string): Promise<string> {
  await mkdir(PROMPT_DIR, { recursive: true });
  void prunePromptFiles();
  const path = join(PROMPT_DIR, `prompt-${Date.now()}-${randomUUID()}.md`);
  await writeFile(path, prompt, 'utf-8');
  return path;
}

/** Best-effort cleanup of prompt files the agent has long since read. */
async function prunePromptFiles(): Promise<void> {
  try {
    const entries = await readdir(PROMPT_DIR);
    const cutoff = Date.now() - PROMPT_TTL_MS;
    for (const entry of entries) {
      const path = join(PROMPT_DIR, entry);
      try {
        const s = await stat(path);
        if (s.mtimeMs < cutoff) await unlink(path);
      } catch {}
    }
  } catch {}
}

export interface AgentLaunch {
  /** Line to type at the shell prompt. */
  command: string;
  /** True when the prompt still has to be typed into the CLI afterwards. */
  injectsPrompt: boolean;
}

/**
 * Turn an agent definition into the shell line that starts it.
 *
 * An args template carrying {task} or {taskFile} receives the prompt on the
 * command line and runs one-shot; anything else launches the CLI bare and
 * leaves the prompt to the terminal's injection path.
 */
export async function buildAgentLaunch(
  agent: AgentDefinition,
  { cwd, prompt }: { cwd: string; prompt?: string },
): Promise<AgentLaunch> {
  let args = agent.args || '';
  const wantsTask = args.includes('{task}');
  const wantsFile = args.includes('{taskFile}');

  if (wantsFile) {
    const path = await writePromptFile(prompt || '');
    args = args.split('{taskFile}').join(quote(path));
  }
  if (wantsTask) {
    args = args.split('{task}').join(quote(singleLine(prompt || '')));
  }
  args = args.split('{cwd}').join(quote(cwd));

  const command = [quoteCommand(agent.command), args.trim()].filter(Boolean).join(' ');
  return { command, injectsPrompt: !wantsTask && !wantsFile };
}
