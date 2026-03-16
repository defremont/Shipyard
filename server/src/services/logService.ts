import { resolve, dirname } from 'path';
import { promises as fsp } from 'fs';
import { DATA_DIR } from './dataDir.js';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogCategory = 'server' | 'git' | 'claude' | 'sync' | 'terminal' | 'mcp' | 'tasks' | 'files';

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

/** Append a single JSON line to the log file (fire-and-forget). */
async function appendToFile(entry: LogEntry): Promise<void> {
  try {
    await fsp.mkdir(dirname(LOG_FILE), { recursive: true });
    await fsp.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // Can't log the logging failure — just drop it
  }
}

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
  try {
    await fsp.writeFile(LOG_FILE, '', 'utf-8');
  } catch { /* ignore */ }
}
