import { resolve, dirname } from 'path';
import { promises as fsp, appendFileSync, mkdirSync } from 'fs';
import { DATA_DIR } from './dataDir.js';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'server' | 'git' | 'claude' | 'sync' | 'terminal' | 'mcp' | 'tasks' | 'files' | 'reports';

export interface LogEntry {
  id: number;
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: string;
  projectId?: string;
}

const MAX_ENTRIES = 1000;
const LOG_FILE = resolve(DATA_DIR, 'server.log');

let entries: LogEntry[] = [];
let nextId = 1;

// Buffered file persistence. Every task mutation logs at least once, so a
// syscall per entry (plus a redundant mkdir) turns a bulk action into hundreds
// of tiny writes. Entries are batched and flushed on the next tick.
const FLUSH_DELAY_MS = 200;
const MAX_BUFFERED = 64;

let pendingLines: string[] = [];
let flushTimer: NodeJS.Timeout | undefined;
let logDirReady: Promise<unknown> | undefined;

async function flushToFile(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (pendingLines.length === 0) return;

  const payload = pendingLines.join('');
  pendingLines = [];
  try {
    logDirReady ??= fsp.mkdir(dirname(LOG_FILE), { recursive: true });
    await logDirReady;
    await fsp.appendFile(LOG_FILE, payload, 'utf-8');
  } catch {
    // Can't log the logging failure — just drop it
  }
}

/** Queue a JSON line for the log file (fire-and-forget). */
function appendToFile(entry: LogEntry): void {
  pendingLines.push(JSON.stringify(entry) + '\n');
  if (pendingLines.length >= MAX_BUFFERED) {
    void flushToFile();
    return;
  }
  flushTimer ??= setTimeout(() => { void flushToFile(); }, FLUSH_DELAY_MS);
}

// Don't lose the tail of the log when the server stops. Must be synchronous —
// 'exit' handlers can't await.
process.on('exit', () => {
  if (pendingLines.length === 0) return;
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, pendingLines.join(''), 'utf-8');
  } catch { /* best effort */ }
});

/** Load persisted entries on startup (last MAX_ENTRIES lines). */
export async function initLogs(): Promise<void> {
  try {
    const raw = await fsp.readFile(LOG_FILE, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const loaded: LogEntry[] = [];
    for (const line of lines) {
      try {
        loaded.push(JSON.parse(line));
      } catch { /* skip corrupt lines */ }
    }
    // Keep only the last MAX_ENTRIES
    entries = loaded.slice(-MAX_ENTRIES);
    nextId = entries.length > 0 ? Math.max(...entries.map(e => e.id)) + 1 : 1;
  } catch {
    // File doesn't exist yet — start fresh
    entries = [];
    nextId = 1;
  }
}

function addEntry(level: LogLevel, category: LogCategory, message: string, details?: string, projectId?: string): LogEntry {
  const entry: LogEntry = {
    id: nextId++,
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    ...(details ? { details } : {}),
    ...(projectId ? { projectId } : {}),
  };
  entries.push(entry);
  // Trim ring buffer
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
  // Fire-and-forget file persistence
  appendToFile(entry);
  return entry;
}

export function info(category: LogCategory, message: string, details?: string, projectId?: string): LogEntry {
  return addEntry('info', category, message, details, projectId);
}

export function warn(category: LogCategory, message: string, details?: string, projectId?: string): LogEntry {
  return addEntry('warn', category, message, details, projectId);
}

export function error(category: LogCategory, message: string, details?: string, projectId?: string): LogEntry {
  return addEntry('error', category, message, details, projectId);
}

export interface LogQuery {
  level?: LogLevel;
  category?: LogCategory;
  projectId?: string;
  since?: string; // ISO timestamp
  limit?: number;
}

export function getLogs(query?: LogQuery): LogEntry[] {
  let result = entries;

  if (query?.level) {
    result = result.filter(e => e.level === query.level);
  }
  if (query?.category) {
    result = result.filter(e => e.category === query.category);
  }
  if (query?.projectId) {
    result = result.filter(e => e.projectId === query.projectId);
  }
  if (query?.since) {
    result = result.filter(e => e.timestamp >= query.since!);
  }

  // Return newest first
  result = [...result].reverse();

  if (query?.limit && query.limit > 0) {
    result = result.slice(0, query.limit);
  }

  return result;
}

export function getStats(): { total: number; errors: number; warnings: number; byCategory: Record<string, number> } {
  const byCategory: Record<string, number> = {};
  let errors = 0;
  let warnings = 0;
  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    if (e.level === 'error') errors++;
    if (e.level === 'warn') warnings++;
  }
  return { total: entries.length, errors, warnings, byCategory };
}

export async function clearLogs(): Promise<void> {
  entries = [];
  nextId = 1;
  // Drop anything still buffered, or it would be appended back after the
  // truncate and resurrect the logs the user just cleared.
  pendingLines = [];
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  try {
    await fsp.writeFile(LOG_FILE, '', 'utf-8');
  } catch { /* ignore */ }
}
