import { spawn } from 'child_process';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import type { Project } from '../types/index.js';

/**
 * Folders no search enters by default: dependencies, build output, caches and
 * virtualenvs. Both palettes and the walk fallback use this list; content
 * search can opt back in with `includeIgnored`. The file tree has its own,
 * shorter list (IGNORE_NAMES in routes/files.ts).
 */
export const SEARCH_EXCLUDED_DIRS = new Set([
  '.git', 'node_modules', 'bower_components', 'jspm_packages', 'vendor',
  'dist', 'build', 'out', 'release', 'target', 'coverage', 'storybook-static',
  '.next', '.nuxt', '.output', '.svelte-kit', '.turbo', '.vercel', '.wrangler', '.expo',
  '.cache', '.parcel-cache', '__pycache__', '.pytest_cache', '.mypy_cache',
  '.venv', 'venv', '.gradle', '.idea', '.vs', 'Pods', 'DerivedData', '.terraform',
]);

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


// ── Content search ──────────────────────────────────────

export interface ContentMatch { line: number; text: string; column: number; length: number }
export interface ContentResult {
  file: string;
  filePath: string;
  projectId: string;
  projectName: string;
  extension?: string;
  matches: ContentMatch[];
}

export interface ContentQuery {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Also search SEARCH_EXCLUDED_DIRS (node_modules, dist...) and git-ignored files. */
  includeIgnored: boolean;
}

export interface ContentSearchResult {
  results: ContentResult[];
  totalMatches: number;
  /** A cap was hit: there is more than what came back. */
  truncated: boolean;
  /** The time budget ran out before every folder was searched. */
  timedOut: boolean;
  elapsedMs: number;
}

const MAX_CONTEXT_CHARS = 200;
const MAX_MATCHES_PER_FILE = 20;
const MAX_TOTAL_MATCHES = 500;
const WALK_MAX_DEPTH = 8;
const WALK_MAX_FILE_SIZE = 512 * 1024;
/** git processes and walks in flight at once, across every project. */
const ROOT_CONCURRENCY = 8;

/** Generated, minified and lock files: never worth reading, even with includeIgnored. */
const GREP_FILE_EXCLUDES = [
  '*.lock', '*.map', '*.min.js', '*.min.css', '*.svg',
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
].map(g => `:(exclude,glob)**/${g}`);

// Untracked folders a repo forgot to ignore (a node_modules with no
// .gitignore) still stay out.
const DIR_EXCLUDES = [...SEARCH_EXCLUDED_DIRS]
  .filter(d => d !== '.git')
  .map(d => `:(exclude,glob)**/${d}/**`);

// Even with includeIgnored: pnpm's virtual store holds every package a
// second time, and its links point back into the workspace — git follows
// them on Windows and one search took 266 s. The packages stay reachable
// through node_modules/<name>.
const PNPM_STORE_EXCLUDE = ':(exclude,glob)**/node_modules/.pnpm/**';

/** A search that hits this answers with what it has, marked truncated. */
const TIME_BUDGET_MS = 10_000;
const TIME_BUDGET_IGNORED_MS = 20_000;

const BINARY_EXT = new Set([
  '.lock', '.map', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.psd',
  '.pdf', '.zip', '.gz', '.tar', '.rar', '.7z',
  '.mp3', '.wav', '.mp4', '.avi', '.mov', '.mkv', '.webm',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.node',
  '.sqlite', '.db',
]);

/**
 * The matcher the walk and the column fix-up use; the client builds the same
 * one to highlight. Throws on an invalid regular expression (the route
 * answers 400).
 */
export function buildMatcher(q: Pick<ContentQuery, 'query' | 'caseSensitive' | 'wholeWord' | 'regex'>): RegExp {
  let source = q.regex ? q.query : q.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (q.wholeWord) source = `\\b(?:${source})\\b`;
  return new RegExp(source, q.caseSensitive ? 'g' : 'gi');
}

/** First non-empty match in the line, or null. */
function findInLine(matcher: RegExp, line: string): { column: number; length: number } | null {
  matcher.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = matcher.exec(line))) {
    if (m[0].length > 0) return { column: m.index, length: m[0].length };
    matcher.lastIndex++;
    if (matcher.lastIndex > line.length) break;
  }
  return null;
}

function snippet(line: string, column: number, length: number): string {
  if (line.length <= MAX_CONTEXT_CHARS) return line.trimEnd();
  return line.substring(Math.max(0, column - 60), column + length + 60).trimEnd();
}

/**
 * One repo, one `git grep`. Resolves null when git can't answer (not a repo,
 * git missing, a flag this git lacks, a pattern PCRE refuses) so the caller
 * can walk instead. An abort resolves with what was read so far.
 */
function gitGrep(
  cwd: string,
  q: ContentQuery,
  matcher: RegExp,
  maxFiles: number,
  signal: AbortSignal,
): Promise<Map<string, ContentMatch[]> | null> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(new Map()); return; }
    const args = [
      '-c', 'core.quotepath=off', 'grep', '-n', '--column', '-I', '--no-color', '-z',
      q.regex ? '-P' : '-F',
      ...(q.wholeWord ? ['-w'] : []),
      ...(q.caseSensitive ? [] : ['-i']),
      '--untracked', ...(q.includeIgnored ? ['--no-exclude-standard'] : []),
      '--max-count', String(MAX_MATCHES_PER_FILE),
      '-e', q.query, '--', '.', ...GREP_FILE_EXCLUDES, ...(q.includeIgnored ? [PNPM_STORE_EXCLUDE] : DIR_EXCLUDES),
    ];
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('git', args, { cwd, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    } catch {
      resolve(null);
      return;
    }
    const files = new Map<string, ContentMatch[]>();
    let buffer = '';
    let settled = false;

    const settle = (value: Map<string, ContentMatch[]> | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', stop);
      resolve(value);
    };
    // Answer as soon as the cap is hit: on Windows the kill takes ~500ms to
    // surface as 'close', which is longer than the whole search.
    function stop() {
      if (settled) return;
      child.kill();
      settle(files);
    }
    signal.addEventListener('abort', stop, { once: true });

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
      const hit = findInLine(matcher, text) ?? { column: Math.max(0, Number(col) - 1), length: 0 };
      list.push({ line: Number(lineNo), text: snippet(text, hit.column, hit.length), column: hit.column, length: hit.length });
    };

    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      if (settled) return;
      buffer += chunk;
      let nl: number;
      while (!settled && (nl = buffer.indexOf('\n')) >= 0) {
        consume(buffer.slice(0, nl).replace(/\r$/, ''));
        buffer = buffer.slice(nl + 1);
      }
    });
    child.stderr!.resume();
    child.on('error', () => settle(null));
    child.on('close', code => settle(code === 0 || code === 1 ? files : null));
  });
}

/**
 * For folders git can't answer: a client folder without a repo at the root,
 * or a repo whose git failed. Lists the tree first (in parallel), then reads
 * files 16 at a time and hands them back in path order. A folder with its own
 * `.git` found on the way (a repo two levels down, which discovery doesn't
 * list as a sub-repo) goes to `git grep` instead of being read file by file.
 */
async function walkGrep(
  root: string,
  skip: Set<string>,
  q: ContentQuery,
  matcher: RegExp,
  maxFiles: number,
  filter: WalkFilter,
  signal: AbortSignal,
): Promise<Map<string, ContentMatch[]>> {
  const ignore = q.includeIgnored ? new Set(['.git']) : filter.ignore;
  const paths: string[] = [];
  const nestedRepos: string[] = [];
  async function list(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > WALK_MAX_DEPTH || signal.aborted) return;
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); } catch { return; }
    if (depth > 0 && items.some(item => item.name === '.git')) {
      nestedRepos.push(rel);
      return;
    }
    const subdirs: Promise<void>[] = [];
    for (const item of items) {
      if (ignore.has(item.name)) continue;
      if (item.name.startsWith('.') && !filter.isVisibleDotfile(item.name)) continue;
      const path = rel ? `${rel}/${item.name}` : item.name;
      if (item.isDirectory()) {
        if (!skip.has(path)) subdirs.push(list(join(dir, item.name), path, depth + 1));
      } else if (item.isFile()) {
        const lower = item.name.toLowerCase();
        if (BINARY_EXT.has(extname(lower)) || lower.endsWith('.min.js') || lower.endsWith('.min.css')) continue;
        paths.push(path);
      }
    }
    await Promise.all(subdirs);
  }
  await list(root, '', 0);
  paths.sort();

  const found = new Map<string, ContentMatch[]>();
  await mapLimit(paths, 16, async path => {
    if (signal.aborted || found.size >= maxFiles) return;
    const full = join(root, path);
    try {
      const st = await stat(full);
      if (st.size === 0 || st.size > WALK_MAX_FILE_SIZE) return;
      const content = await readFile(full, 'utf8');
      if (content.slice(0, 8000).includes('\0')) return; // binary, like git -I
      const lines = content.split('\n');
      const matches: ContentMatch[] = [];
      for (let i = 0; i < lines.length && matches.length < MAX_MATCHES_PER_FILE; i++) {
        const line = lines[i].replace(/\r$/, '');
        const hit = findInLine(matcher, line);
        if (hit) matches.push({ line: i + 1, text: snippet(line, hit.column, hit.length), column: hit.column, length: hit.length });
      }
      if (matches.length && found.size < maxFiles) found.set(path, matches);
    } catch { /* unreadable: skip */ }
  });

  await mapLimit(nestedRepos, 4, async rel => {
    if (signal.aborted) return;
    const cwd = join(root, rel);
    // git failing here walks the repo; depth 0 keeps it from finding itself.
    const files = await gitGrep(cwd, q, matcher, maxFiles, signal)
      ?? await walkGrep(cwd, new Set(), q, matcher, maxFiles, filter, signal);
    for (const [file, matches] of files) found.set(`${rel}/${file}`, matches);
  });

  return new Map([...found].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(0, maxFiles));
}

interface SearchRoot {
  project: Project;
  /** Relative to the project, forward slashes; '' is the project folder. */
  rel: string;
  git: boolean;
  /** Folders a walk must not enter: the sub-repos, searched as their own roots. */
  skip: Set<string>;
}

function rootsOf(project: Project): SearchRoot[] {
  const subs = (project.subRepos || []).map(r => r.replace(/\\/g, '/').replace(/\/+$/, ''));
  return [
    { project, rel: '', git: project.isGitRepo, skip: new Set(subs) },
    ...subs.map(rel => ({ project, rel, git: true, skip: new Set<string>() })),
  ];
}

async function searchRoot(
  root: SearchRoot,
  q: ContentQuery,
  matcher: RegExp,
  maxFiles: number,
  filter: WalkFilter,
  signal: AbortSignal,
): Promise<ContentResult[]> {
  const cwd = root.rel ? join(root.project.path, root.rel) : root.project.path;
  let files = root.git ? await gitGrep(cwd, q, matcher, maxFiles, signal) : null;
  if (!files) files = signal.aborted ? new Map() : await walkGrep(cwd, root.skip, q, matcher, maxFiles, filter, signal);

  const out: ContentResult[] = [];
  for (const [file, matches] of files) {
    const filePath = root.rel ? `${root.rel}/${file}` : file;
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    out.push({
      file: name,
      filePath,
      projectId: root.project.id,
      projectName: root.project.name,
      ...(extname(name) ? { extension: extname(name).toLowerCase() } : {}),
      matches,
    });
  }
  return out;
}

/**
 * Each project splits into roots — its own folder and each sub-repo — and
 * each root is one `git grep` (a walk without git; a client folder is walked
 * only outside its sub-repos). Roots run ROOT_CONCURRENCY at a time in
 * context order, and once the roots that come first fill the page the rest
 * is cancelled.
 */
export async function searchContent(
  projects: Project[],
  q: ContentQuery,
  opts: { limit: number; preferId?: string; filter: WalkFilter; signal?: AbortSignal },
): Promise<ContentSearchResult> {
  const started = Date.now();
  const matcher = buildMatcher(q);
  const roots = orderByRank(projects, projectRanks(projects, opts.preferId)).flatMap(rootsOf);

  const internal = new AbortController();
  const abort = () => internal.abort();
  if (opts.signal?.aborted) internal.abort();
  opts.signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; internal.abort(); }, q.includeIgnored ? TIME_BUDGET_IGNORED_MS : TIME_BUDGET_MS);

  const done: (ContentResult[] | undefined)[] = new Array(roots.length);
  const prefixIsFull = () => {
    let files = 0, matches = 0;
    for (const list of done) {
      if (!list) return false;
      files += list.length;
      for (const r of list) matches += r.matches.length;
      if (files >= opts.limit || matches >= MAX_TOTAL_MATCHES) return true;
    }
    return false;
  };

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(ROOT_CONCURRENCY, roots.length) }, async () => {
    while (next < roots.length && !internal.signal.aborted) {
      const i = next++;
      done[i] = await searchRoot(roots[i], q, matcher, opts.limit, opts.filter, internal.signal);
      if (prefixIsFull()) internal.abort();
    }
  }));
  clearTimeout(timer);
  opts.signal?.removeEventListener('abort', abort);

  const results: ContentResult[] = [];
  let totalMatches = 0;
  let truncated = internal.signal.aborted;
  outer: for (const list of done) {
    if (!list) continue;
    for (const result of list) {
      if (results.length >= opts.limit || totalMatches >= MAX_TOTAL_MATCHES) { truncated = true; break outer; }
      results.push(result);
      totalMatches += result.matches.length;
    }
  }
  return { results, totalMatches, truncated, timedOut, elapsedMs: Date.now() - started };
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
