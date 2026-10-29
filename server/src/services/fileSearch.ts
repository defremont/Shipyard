import { spawn } from 'child_process';
import { readdir } from 'fs/promises';
import { join, extname } from 'path';
import type { Project } from '../types/index.js';

/**
 * The two search palettes (Ctrl+K file names, Ctrl+Shift+F contents) run on
 * every pause in typing, across every project. This module keeps them cheap:
 * file names come from an in-memory index per project, contents come from
 * `git grep` (it reads the index, honours .gitignore and skips binaries), and
 * both rank the open project and its client ahead of everything else.
 */

// ── Context ranking ─────────────────────────────────────

/**
 * 0 = the project the user has open, 1 = the same client (projects of one
 * client share a parent folder, which discovery stores as `category`),
 * 2 = everything else.
 */
export function projectRanks(projects: Project[], preferId?: string): Map<string, number> {
  const preferred = preferId ? projects.find(p => p.id === preferId) : undefined;
  const ranks = new Map<string, number>();
  for (const p of projects) {
    ranks.set(p.id, !preferred ? 2 : p.id === preferred.id ? 0 : p.category === preferred.category ? 1 : 2);
  }
  return ranks;
}

/** Stable sort by rank, so preferred projects are also searched first. */
export function orderByRank(projects: Project[], ranks: Map<string, number>): Project[] {
  return [...projects].sort((a, b) => (ranks.get(a.id) ?? 2) - (ranks.get(b.id) ?? 2));
}

const RANK_BOOST = [60, 30, 0];

// ── File name index ─────────────────────────────────────

interface IndexEntry {
  name: string;
  lower: string;      // name, lowercased
  path: string;       // relative to the project root, forward slashes
  lowerPath: string;
  type: 'file' | 'dir';
  depth: number;
}

interface ProjectIndex {
  builtAt: number;
  entries: IndexEntry[];
  building?: Promise<IndexEntry[]>;
}

const INDEX_TTL_MS = 60_000;
const INDEX_MAX_DEPTH = 6;
const INDEX_MAX_ENTRIES = 40_000;
const indexes = new Map<string, ProjectIndex>();

export interface WalkFilter {
  ignore: Set<string>;
  isVisibleDotfile: (name: string) => boolean;
}

async function buildIndex(root: string, filter: WalkFilter): Promise<IndexEntry[]> {
  const entries: IndexEntry[] = [];
  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > INDEX_MAX_DEPTH || entries.length >= INDEX_MAX_ENTRIES) return;
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
    const subdirs: Promise<void>[] = [];
    for (const item of items) {
      if (entries.length >= INDEX_MAX_ENTRIES) break;
      if (filter.ignore.has(item.name)) continue;
      if (item.name.startsWith('.') && !filter.isVisibleDotfile(item.name)) continue;
      const path = rel ? `${rel}/${item.name}` : item.name;
      const isDir = item.isDirectory();
      entries.push({
        name: item.name,
        lower: item.name.toLowerCase(),
        path,
        lowerPath: path.toLowerCase(),
        type: isDir ? 'dir' : 'file',
        depth,
      });
      if (isDir) subdirs.push(walk(join(dir, item.name), path, depth + 1));
    }
    await Promise.all(subdirs);
  }
  await walk(root, '', 0);
  return entries;
}

/**
 * Stale-while-revalidate: an index past its TTL still answers right away and
 * rebuilds behind the scenes. Only the very first search of a project waits.
 */
async function getIndex(project: Project, filter: WalkFilter): Promise<IndexEntry[]> {
  const cached = indexes.get(project.id);
  const fresh = cached && Date.now() - cached.builtAt < INDEX_TTL_MS;
  if (cached && fresh) return cached.entries;
  if (cached?.building) return cached.entries.length ? cached.entries : cached.building;

  const building = buildIndex(project.path, filter).then(entries => {
    indexes.set(project.id, { builtAt: Date.now(), entries });
    return entries;
  }).catch(() => {
    indexes.delete(project.id);
    return [] as IndexEntry[];
  });
  indexes.set(project.id, { builtAt: cached?.builtAt ?? 0, entries: cached?.entries ?? [], building });
  return cached?.entries.length ? cached.entries : building;
}

/** Called by the file routes after a create/rename/copy/delete. */
export function invalidateFileIndex(projectId: string): void {
  const cached = indexes.get(projectId);
  if (cached && !cached.building) cached.builtAt = 0;
}

export interface FileNameResult {
  name: string;
  path: string;
  projectId: string;
  projectName: string;
  type: 'file' | 'dir';
  extension?: string;
}

/** Higher is better; 0 means no match. */
function scoreEntry(entry: IndexEntry, query: string, terms: string[]): number {
  let score = 0;
  if (terms.length === 1) {
    const stem = entry.lower.replace(/\.[^.]+$/, '');
    if (entry.lower === query) score = 100;
    else if (stem === query) score = 95;
    else if (entry.lower.startsWith(query)) score = 80;
    else if (entry.lower.includes(query)) {
      const at = entry.lower.indexOf(query);
      // "useTasks" for "tasks": a match right after a separator or a camelCase
      // hump reads as a word, not a coincidence.
      const before = entry.name[at - 1];
      const wordStart = /[-_.\s]/.test(before) || (entry.name[at] !== entry.lower[at]);
      score = wordStart ? 65 : 50;
    } else if (entry.lowerPath.includes(query)) score = 20;
  } else {
    // "client tasks" or "routes/files": every term somewhere in the path, the
    // last one in the name.
    if (!terms.every(t => entry.lowerPath.includes(t))) return 0;
    score = entry.lower.includes(terms[terms.length - 1]) ? 60 : 25;
  }
  if (score === 0) return 0;
  if (entry.type === 'file') score += 3;
  return score - Math.min(entry.depth, 10);
}

export async function searchFileNames(
  projects: Project[],
  query: string,
  opts: { limit: number; preferId?: string; filter: WalkFilter },
): Promise<FileNameResult[]> {
  const q = query.trim().toLowerCase();
  const terms = q.split(/[\s/\\]+/).filter(Boolean);
  if (terms.length === 0) return [];
  const ranks = projectRanks(projects, opts.preferId);

  const scored: { score: number; result: FileNameResult }[] = [];
  await Promise.all(projects.map(async project => {
    const boost = RANK_BOOST[ranks.get(project.id) ?? 2];
    for (const entry of await getIndex(project, opts.filter)) {
      const s = scoreEntry(entry, q, terms);
      if (s === 0) continue;
      scored.push({
        score: s + boost,
        result: {
          name: entry.name,
          path: entry.path,
          projectId: project.id,
          projectName: project.name,
          type: entry.type,
          ...(entry.type === 'file' && extname(entry.name) ? { extension: extname(entry.name).toLowerCase() } : {}),
        },
      });
    }
  }));

  return scored
    .sort((a, b) => b.score - a.score || a.result.path.length - b.result.path.length)
    .slice(0, opts.limit)
    .map(s => s.result);
}

// ── Content search (git grep) ───────────────────────────

export interface ContentMatch { line: number; text: string; column: number }
export interface ContentResult {
  file: string;
  filePath: string;
  projectId: string;
  projectName: string;
  extension?: string;
  matches: ContentMatch[];
}

const MAX_CONTEXT_CHARS = 200;
const GREP_EXCLUDES = [
  ':(exclude)*.lock', ':(exclude)*.map', ':(exclude)*.min.js', ':(exclude)*.min.css',
  ':(exclude)*.svg', ':(exclude)pnpm-lock.yaml', ':(exclude)**/pnpm-lock.yaml',
  ':(exclude)package-lock.json', ':(exclude)**/package-lock.json',
];

export function snippet(line: string, column: number, queryLength: number): string {
  if (line.length <= MAX_CONTEXT_CHARS) return line.trimEnd();
  return line.substring(Math.max(0, column - 60), column + queryLength + 60).trimEnd();
}

/**
 * One repo, one `git grep`. Resolves null when git can't answer (not a repo,
 * git missing, a flag this git version lacks) so the caller can walk instead.
 */
function gitGrep(
  cwd: string,
  query: string,
  caseSensitive: boolean,
  maxFiles: number,
  maxPerFile: number,
): Promise<Map<string, ContentMatch[]> | null> {
  return new Promise(resolve => {
    const args = [
      '-c', 'core.quotepath=off', 'grep', '-n', '--column', '-I', '--no-color', '-z', '-F',
      '--untracked', '--max-count', String(maxPerFile),
      ...(caseSensitive ? [] : ['-i']),
      '-e', query, '--', '.', ...GREP_EXCLUDES,
    ];
    let child;
    try {
      child = spawn('git', args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    } catch {
      resolve(null);
      return;
    }
    const files = new Map<string, ContentMatch[]>();
    let buffer = '';
    let stopped = false;
    const needle = caseSensitive ? query : query.toLowerCase();

    const consume = (line: string) => {
      const parts = line.split('\0');
      if (parts.length < 4) return;
      const [file, lineNo, col] = parts;
      const text = parts.slice(3).join('\0');
      let list = files.get(file);
      if (!list) {
        if (files.size >= maxFiles) { stop(); return; }
        list = [];
        files.set(file, list);
      }
      // git reports a byte column; the editor wants a character index.
      const at = (caseSensitive ? text : text.toLowerCase()).indexOf(needle);
      const column = at >= 0 ? at : Math.max(0, Number(col) - 1);
      list.push({ line: Number(lineNo), text: snippet(text, column, query.length), column });
    };
    // Answer as soon as the cap is hit: on Windows the kill takes ~500ms to
    // surface as 'close', which is longer than the whole search.
    const stop = () => {
      if (stopped) return;
      stopped = true;
      child.kill();
      resolve(files);
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stopped) return;
      buffer += chunk;
      let nl: number;
      while (!stopped && (nl = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, nl).replace(/\r$/, ''));
        buffer = buffer.slice(nl + 1);
      }
    });
    child.stderr.resume();
    child.on('error', () => resolve(null));
    child.on('close', code => {
      if (stopped || code === 0 || code === 1) resolve(files);
      else resolve(null);
    });
  });
}

/**
 * Searches the project's own repo and each nested sub-repo (a parent repo
 * never descends into them). Null means the project isn't git-backed at the
 * root, or git failed — the caller falls back to walking the tree.
 */
export async function grepProject(
  project: Project,
  query: string,
  opts: { caseSensitive: boolean; maxFiles: number; maxPerFile: number },
): Promise<ContentResult[] | null> {
  if (!project.isGitRepo) return null;
  const roots = ['', ...(project.subRepos || [])];
  const perRoot = await Promise.all(roots.map(rel =>
    gitGrep(rel ? join(project.path, rel) : project.path, query, opts.caseSensitive, opts.maxFiles, opts.maxPerFile)
      .then(files => ({ rel, files })),
  ));
  if (!perRoot[0].files) return null;

  const results: ContentResult[] = [];
  for (const { rel, files } of perRoot) {
    if (!files) continue;
    for (const [file, matches] of files) {
      const filePath = rel ? `${rel.replace(/\\/g, '/')}/${file}` : file;
      const name = filePath.slice(filePath.lastIndexOf('/') + 1);
      results.push({
        file: name,
        filePath,
        projectId: project.id,
        projectName: project.name,
        ...(extname(name) ? { extension: extname(name).toLowerCase() } : {}),
        matches,
      });
    }
  }
  return results.slice(0, opts.maxFiles);
}

/** Runs `task` over `items` with at most `limit` in flight, in order. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i]);
    }
  }));
  return out;
}
