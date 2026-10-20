import { homedir } from 'os';
import { join } from 'path';
import { open, readdir, readFile, stat } from 'fs/promises';
import { DATA_DIR } from './dataDir.js';
import { writeJsonAtomic } from './atomicJson.js';

// ── Claude Code conversations ─────────────────────────────────────────────
//
// After a reboot every terminal is gone, and getting back to work meant
// opening each project and typing /resume. Claude Code keeps each
// conversation in ~/.claude/projects/<cwd>/<sessionId>.jsonl, where <cwd> is
// the working directory with every non-alphanumeric character turned into '-'.
// The file carries what a "resume" row needs: the title the CLI gave the
// conversation (or the one the user set), the last prompt and the permission
// mode. So the recent list is read straight from there — no copy of our own.
//
// What we do keep is which conversations were on a tab when Shipyard went
// away: the hooks report each tab's session id (see handleClaudeHook), and an
// entry only leaves when the user closes that tab. A shutdown kills every PTY
// but never goes through the close route, so the list survives it.

const STORE_PATH = join(DATA_DIR, 'claude-conversations.json');
const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects');
// The title and the last prompt are rewritten often, so the tail has them.
const TAIL_BYTES = 256 * 1024;
const OPEN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface OpenConversation {
  id: string;
  projectId: string;
  cwd: string;
  /** The tab ran with --dangerously-skip-permissions */
  yolo: boolean;
  taskId?: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  projectId: string;
  title?: string;
  lastPrompt?: string;
  updatedAt: string;
  yolo: boolean;
  taskId?: string;
  /** It was on a tab when Shipyard last closed */
  open: boolean;
}

let openList: OpenConversation[] | null = null;
let saving: Promise<void> = Promise.resolve();

async function load(): Promise<OpenConversation[]> {
  if (openList) return openList;
  try {
    const raw = JSON.parse(await readFile(STORE_PATH, 'utf-8'));
    openList = Array.isArray(raw?.open) ? raw.open : [];
  } catch {
    openList = [];
  }
  return openList!;
}

function save(): void {
  const data = { open: openList || [] };
  saving = saving.then(() => writeJsonAtomic(STORE_PATH, data)).catch(() => {});
}

/** A tab is now holding this conversation. `replaces` is the id it held before. */
export async function trackConversation(entry: Omit<OpenConversation, 'updatedAt'>, replaces?: string): Promise<void> {
  const list = await load();
  openList = list.filter(c => c.id !== entry.id && c.id !== replaces);
  openList.push({ ...entry, updatedAt: new Date().toISOString() });
  save();
}

/** The user closed the tab: the conversation is no longer "left open". */
export async function forgetConversation(id: string): Promise<void> {
  const list = await load();
  if (!list.some(c => c.id === id)) return;
  openList = list.filter(c => c.id !== id);
  save();
}

export async function findOpenConversation(id: string): Promise<OpenConversation | undefined> {
  return (await load()).find(c => c.id === id);
}

export function transcriptDir(cwd: string): string {
  return join(CLAUDE_PROJECTS_DIR, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}

interface TranscriptInfo {
  title?: string;
  lastPrompt?: string;
  yolo: boolean;
  mtimeMs: number;
}

const infoCache = new Map<string, TranscriptInfo>();

async function readTail(path: string, size: number): Promise<string> {
  const handle = await open(path, 'r');
  try {
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    return buffer.toString('utf-8');
  } finally {
    await handle.close();
  }
}

async function readTranscript(path: string): Promise<TranscriptInfo | null> {
  let info;
  try { info = await stat(path); } catch { return null; }
  const cached = infoCache.get(path);
  if (cached && cached.mtimeMs === info.mtimeMs) return cached;

  let text: string;
  try { text = await readTail(path, info.size); } catch { return null; }

  let customTitle: string | undefined;
  let aiTitle: string | undefined;
  let lastPrompt: string | undefined;
  let mode: string | undefined;
  const lines = text.split('\n');
  // The first line of a tail read is usually cut in half; JSON.parse drops it.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith('{"type":"')) continue;
    if (customTitle === undefined && line.startsWith('{"type":"custom-title"')) customTitle = parseField(line, 'customTitle');
    else if (aiTitle === undefined && line.startsWith('{"type":"ai-title"')) aiTitle = parseField(line, 'aiTitle');
    else if (lastPrompt === undefined && line.startsWith('{"type":"last-prompt"')) lastPrompt = parseField(line, 'lastPrompt');
    else if (mode === undefined && line.startsWith('{"type":"permission-mode"')) mode = parseField(line, 'permissionMode');
    if (customTitle !== undefined && lastPrompt !== undefined && mode !== undefined) break;
  }

  const result: TranscriptInfo = {
    title: customTitle || aiTitle,
    lastPrompt,
    yolo: mode === 'bypassPermissions',
    mtimeMs: info.mtimeMs,
  };
  infoCache.set(path, result);
  return result;
}

function parseField(line: string, field: string): string | undefined {
  try {
    const value = JSON.parse(line)[field];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The newest conversations in one directory, newest first. */
async function recentIn(cwd: string, limit: number): Promise<{ id: string; path: string; mtimeMs: number }[]> {
  const dir = transcriptDir(cwd);
  let entries: string[];
  try { entries = await readdir(dir); } catch { return []; }
  const files = await Promise.all(entries
    .filter(name => name.endsWith('.jsonl'))
    .map(async name => {
      const path = join(dir, name);
      try { return { id: name.slice(0, -'.jsonl'.length), path, mtimeMs: (await stat(path)).mtimeMs }; } catch { return null; }
    }));
  return files
    .filter((f): f is { id: string; path: string; mtimeMs: number } => !!f)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);
}

/**
 * Conversations worth resuming: the ones left open on a tab first, then the
 * newest in each project's folder. `liveIds` are on a tab right now and are
 * left out — there is nothing to resume there.
 */
export async function listConversations(opts: {
  projects: { id: string; path: string }[];
  liveIds: Set<string>;
  perProject: number;
  limit: number;
}): Promise<Conversation[]> {
  const byId = new Map<string, Conversation>();
  const projectIds = new Set(opts.projects.map(p => p.id));
  const now = Date.now();

  const openEntries = (await load()).filter(c =>
    projectIds.has(c.projectId)
    && !opts.liveIds.has(c.id)
    && now - Date.parse(c.updatedAt) < OPEN_MAX_AGE_MS);
  for (const entry of openEntries) {
    const info = await readTranscript(join(transcriptDir(entry.cwd), `${entry.id}.jsonl`));
    // No transcript means the CLI never saved anything — nothing to resume.
    if (!info) continue;
    byId.set(entry.id, {
      id: entry.id,
      projectId: entry.projectId,
      title: info.title,
      lastPrompt: info.lastPrompt,
      updatedAt: new Date(info.mtimeMs).toISOString(),
      yolo: entry.yolo,
      ...(entry.taskId ? { taskId: entry.taskId } : {}),
      open: true,
    });
  }

  const recent: Conversation[] = [];
  await Promise.all(opts.projects.map(async project => {
    for (const file of await recentIn(project.path, opts.perProject + 2)) {
      if (byId.has(file.id) || opts.liveIds.has(file.id)) continue;
      const info = await readTranscript(file.path);
      // A conversation nobody typed into is not one to come back to.
      if (!info?.lastPrompt) continue;
      recent.push({
        id: file.id,
        projectId: project.id,
        title: info.title,
        lastPrompt: info.lastPrompt,
        updatedAt: new Date(info.mtimeMs).toISOString(),
        yolo: info.yolo,
        open: false,
      });
    }
  }));

  const perProject = new Map<string, number>();
  const trimmed = recent
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter(c => {
      const count = perProject.get(c.projectId) || 0;
      perProject.set(c.projectId, count + 1);
      return count < opts.perProject;
    });

  const opened = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...opened, ...trimmed].slice(0, Math.max(opts.limit, opened.length));
}
