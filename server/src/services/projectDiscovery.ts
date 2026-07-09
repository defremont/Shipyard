import { readdir, readFile, stat, access, writeFile, mkdir } from 'fs/promises';
import { join, basename, resolve } from 'path';
import type { Project, ProjectsCache } from '../types/index.js';
import { getSettings, saveSettings } from './settingsStore.js';
import { DATA_DIR } from './dataDir.js';
import * as gitService from './gitService.js';

const CACHE_FILE = join(DATA_DIR, 'projects.json');

const PROJECT_MARKERS = ['package.json', '.git', 'CLAUDE.md', 'Cargo.toml', 'go.mod', 'requirements.txt', 'pyproject.toml'];
const IGNORE_DIRS = new Set(['node_modules', '.git', '.cache', '.vscode', 'dist', 'build', '.next', '__pycache__']);

let projectsCache: Project[] = [];
let cachedLastScannedAt: string = new Date().toISOString();

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function collectDepsFromPackageJson(pkgPath: string): Promise<string[]> {
  try {
    const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    return Object.keys(allDeps || {});
  } catch {
    return [];
  }
}

async function detectTechStack(projectPath: string): Promise<string[]> {
  const stack = new Set<string>();
  const pkgPath = join(projectPath, 'package.json');

  // Collect deps from root package.json
  let depNames: string[] = [];
  if (await fileExists(pkgPath)) {
    depNames = await collectDepsFromPackageJson(pkgPath);

    // For monorepos/workspaces, also scan workspace package.json files
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
      if (pkg.workspaces || pkg.private) {
        // Check common workspace subdirectories
        const subdirs = ['client', 'server', 'app', 'web', 'api', 'packages', 'apps'];
        for (const sub of subdirs) {
          const subPkg = join(projectPath, sub, 'package.json');
          if (await fileExists(subPkg)) {
            const subDeps = await collectDepsFromPackageJson(subPkg);
            depNames = [...depNames, ...subDeps];
          }
        }
        // Also check pnpm-workspace.yaml packages
        const workspaceYaml = join(projectPath, 'pnpm-workspace.yaml');
        if (await fileExists(workspaceYaml)) {
          const content = await readFile(workspaceYaml, 'utf-8');
          const packageDirs = content.match(/- ['"]?([^'"\n]+?)\/?\*?['"]?$/gm);
          if (packageDirs) {
            for (const line of packageDirs) {
              const dir = line.replace(/^-\s*['"]?/, '').replace(/\/?\*?['"]?$/, '');
              if (dir && !subdirs.includes(dir)) {
                // Check direct directory (non-glob)
                const dirPkg = join(projectPath, dir, 'package.json');
                if (await fileExists(dirPkg)) {
                  const dirDeps = await collectDepsFromPackageJson(dirPkg);
                  depNames = [...depNames, ...dirDeps];
                }
              }
            }
          }
        }
      }
    } catch {}
  }

  if (depNames.length > 0) {
    if (depNames.some(d => d === 'react' || d === 'react-dom')) stack.add('react');
    if (depNames.some(d => d === 'next')) stack.add('next');
    if (depNames.some(d => d === 'vue')) stack.add('vue');
    if (depNames.some(d => d === 'svelte')) stack.add('svelte');
    if (depNames.some(d => d === 'vite' || d === '@vitejs/plugin-react' || d === '@vitejs/plugin-react-swc')) stack.add('vite');
    if (depNames.some(d => d === 'tailwindcss')) stack.add('tailwind');
    if (depNames.some(d => d === 'typescript' || d === 'tsx')) stack.add('typescript');
    if (depNames.some(d => d === 'express')) stack.add('express');
    if (depNames.some(d => d === 'fastify')) stack.add('fastify');
    if (depNames.some(d => d === 'prisma' || d === '@prisma/client')) stack.add('prisma');
    if (depNames.some(d => d === 'electron')) stack.add('electron');
    if (depNames.some(d => d === 'three')) stack.add('three.js');
  }

  if (await fileExists(join(projectPath, 'Cargo.toml'))) stack.add('rust');
  if (await fileExists(join(projectPath, 'go.mod'))) stack.add('go');
  if (await fileExists(join(projectPath, 'requirements.txt')) || await fileExists(join(projectPath, 'pyproject.toml'))) stack.add('python');

  return [...stack];
}

async function detectSubRepos(projectPath: string): Promise<string[]> {
  const subRepos: string[] = [];
  try {
    const entries = await readdir(projectPath);
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
      const fullPath = join(projectPath, entry);
      if (!(await isDirectory(fullPath))) continue;
      if (await fileExists(join(fullPath, '.git'))) {
        subRepos.push(entry);
      }
    }
  } catch {}
  return subRepos;
}

// Remote URL and sub-repo layout change only when the user reconfigures the
// repo, but the git status poll runs every 15s. Caching them turns each poll
// from 4 git subprocesses + a directory scan into 2 subprocesses per project.
// A full refreshProjects() clears both.
const remoteUrlCache = new Map<string, string | undefined>();
const subReposCache = new Map<string, string[]>();

function clearGitCaches(): void {
  remoteUrlCache.clear();
  subReposCache.clear();
}

async function getRemoteUrl(projectPath: string): Promise<string | undefined> {
  if (remoteUrlCache.has(projectPath)) return remoteUrlCache.get(projectPath);
  let gitRemoteUrl: string | undefined;
  try {
    const remotes = await gitService.getRemotes(projectPath);
    const origin = remotes.find(r => r.name === 'origin');
    if (origin?.refs?.push) {
      gitRemoteUrl = origin.refs.push
        .replace(/\.git$/, '')
        .replace(/^git@([^:]+):/, 'https://$1/')
        .replace(/^ssh:\/\/git@([^/]+)\//, 'https://$1/');
    }
  } catch {}
  remoteUrlCache.set(projectPath, gitRemoteUrl);
  return gitRemoteUrl;
}

async function getSubRepos(projectPath: string): Promise<string[]> {
  const cached = subReposCache.get(projectPath);
  if (cached) return cached;
  const subRepos = await detectSubRepos(projectPath);
  subReposCache.set(projectPath, subRepos);
  return subRepos;
}

async function detectGitInfo(projectPath: string): Promise<{
  isGitRepo: boolean; gitBranch?: string; gitDirty?: boolean;
  gitAhead?: number; gitBehind?: number;
  gitStaged?: number; gitUnstaged?: number; gitUntracked?: number;
  lastCommitDate?: string; lastCommitMessage?: string; gitRemoteUrl?: string;
  subRepos?: string[];
}> {
  const gitDir = join(projectPath, '.git');
  if (!(await fileExists(gitDir))) {
    // Check for sub-repos (subdirectories with their own .git)
    const subRepos = await getSubRepos(projectPath);
    if (subRepos.length > 0) {
      return { isGitRepo: false, subRepos };
    }
    return { isGitRepo: false };
  }

  try {
    // Go through gitService so every command on this repo shares one
    // SimpleGit instance — and therefore one task queue, which is what keeps
    // concurrent reads from tripping over index.lock on Windows.
    // `status.current` already carries the branch name, so a separate
    // git.branch() call would be a wasted subprocess.
    const [status, log, gitRemoteUrl, subRepos] = await Promise.all([
      gitService.getStatus(projectPath),
      gitService.getLog(projectPath, 1).catch(() => null),
      getRemoteUrl(projectPath),
      getSubRepos(projectPath),
    ]);

    return {
      isGitRepo: true,
      gitBranch: status.current ?? undefined,
      gitDirty: !status.isClean(),
      gitAhead: status.ahead || 0,
      gitBehind: status.behind || 0,
      gitStaged: status.staged.length,
      gitUnstaged: status.modified.length + status.deleted.length,
      gitUntracked: status.not_added.length,
      lastCommitDate: log?.latest?.date,
      lastCommitMessage: log?.latest?.message,
      gitRemoteUrl,
      ...(subRepos.length > 0 ? { subRepos } : {}),
    };
  } catch {
    return { isGitRepo: true };
  }
}

async function isProject(dirPath: string): Promise<boolean> {
  for (const marker of PROJECT_MARKERS) {
    if (await fileExists(join(dirPath, marker))) return true;
  }
  return false;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Build a Project object from a path
async function buildProject(projectPath: string): Promise<Project> {
  const name = basename(projectPath);
  const parentName = basename(resolve(projectPath, '..'));
  const gitInfo = await detectGitInfo(projectPath);
  const techStack = await detectTechStack(projectPath);
  const existing = projectsCache.find(p => p.path === projectPath);

  return {
    id: slugify(name),
    name: existing?.name || name,
    path: projectPath,
    category: parentName,
    ...gitInfo,
    techStack,
    favorite: existing?.favorite || false,
    lastOpenedAt: existing?.lastOpenedAt,
    externalLink: existing?.externalLink,
    notes: existing?.notes,
    links: existing?.links,
  };
}

// Deduplicate by path, and make ids unique
function deduplicateProjects(projects: Project[]): Project[] {
  const byPath = new Map<string, Project>();
  for (const p of projects) {
    if (!byPath.has(p.path)) {
      byPath.set(p.path, p);
    }
  }
  // Make ids unique
  const idCount = new Map<string, number>();
  const result: Project[] = [];
  for (const p of byPath.values()) {
    const count = idCount.get(p.id) || 0;
    if (count > 0) {
      p.id = `${p.id}-${count}`;
    }
    idCount.set(p.id, count + 1);
    result.push(p);
  }
  return result;
}

// Load projects from the user's selected paths
async function loadSelectedProjects(): Promise<Project[]> {
  const settings = getSettings();
  const projects: Project[] = [];

  for (const projectPath of settings.selectedProjects) {
    if (await isDirectory(projectPath)) {
      projects.push(await buildProject(projectPath));
    }
  }

  return deduplicateProjects(projects);
}

// Scan a directory to discover projects (for the "add projects" UI)
// Scans recursively up to 3 levels deep
export async function scanDirectory(dir: string, maxDepth = 3): Promise<{ path: string; name: string; techStack: string[]; isGitRepo: boolean }[]> {
  const found: { path: string; name: string; techStack: string[]; isGitRepo: boolean }[] = [];

  async function scan(currentDir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    try {
      const entries = await readdir(currentDir);

      for (const entry of entries) {
        if (IGNORE_DIRS.has(entry) || entry.startsWith('.')) continue;
        const fullPath = join(currentDir, entry);

        if (!(await isDirectory(fullPath))) continue;

        if (await isProject(fullPath)) {
          const techStack = await detectTechStack(fullPath);
          const gitDir = join(fullPath, '.git');
          found.push({
            path: fullPath,
            name: entry,
            techStack,
            isGitRepo: await fileExists(gitDir),
          });
        } else {
          await scan(fullPath, depth + 1);
        }
      }
    } catch {}
  }

  await scan(dir, 1);
  return found;
}

// Add project paths to the selected list
export async function addProjects(paths: string[]): Promise<Project[]> {
  const settings = getSettings();
  const newPaths = paths.filter(p => !settings.selectedProjects.includes(p));
  if (newPaths.length > 0) {
    settings.selectedProjects = [...settings.selectedProjects, ...newPaths];
    await saveSettings(settings);
  }
  return refreshProjects();
}

// Remove a project path from the selected list
export async function removeProject(projectPath: string): Promise<Project[]> {
  const settings = getSettings();
  settings.selectedProjects = settings.selectedProjects.filter(p => p !== projectPath);
  await saveSettings(settings);
  return refreshProjects();
}

async function loadCache(): Promise<Project[]> {
  try {
    const data = await readFile(CACHE_FILE, 'utf-8');
    const cache: ProjectsCache = JSON.parse(data);
    if (cache.lastScannedAt) {
      cachedLastScannedAt = cache.lastScannedAt;
    }
    return cache.projects;
  } catch {
    return [];
  }
}

async function saveCache(projects: Project[], updateTimestamp = false): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const cache: ProjectsCache = {
    projects,
    lastScannedAt: updateTimestamp ? new Date().toISOString() : cachedLastScannedAt,
  };
  if (updateTimestamp) {
    cachedLastScannedAt = cache.lastScannedAt;
  }
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

export async function getProjects(): Promise<Project[]> {
  return projectsCache;
}

/** Lightweight refresh: only updates git status, skips tech stack detection */
export async function refreshGitStatus(): Promise<Project[]> {
  const updated = await Promise.all(
    projectsCache.map(async (p) => {
      // Also re-check non-git projects: detectGitInfo is cheap for them (one
      // .git existence check + shallow sub-repo scan), and it's what picks up
      // a `git init` done after the project was added.
      try {
        const gitInfo = await detectGitInfo(p.path);
        return { ...p, ...gitInfo };
      } catch {
        return p;
      }
    })
  );
  projectsCache = updated;
  // Don't save to disk on every git refresh — too frequent
  return updated;
}

export async function refreshProjects(): Promise<Project[]> {
  clearGitCaches();
  const projects = await loadSelectedProjects();
  projectsCache = projects;
  await saveCache(projects, true);
  return projects;
}

export async function updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'favorite' | 'lastOpenedAt' | 'externalLink'>>): Promise<Project | null> {
  const idx = projectsCache.findIndex(p => p.id === id);
  if (idx === -1) return null;
  projectsCache[idx] = { ...projectsCache[idx], ...updates };
  await saveCache(projectsCache);
  return projectsCache[idx];
}

export async function initProjectDiscovery(): Promise<void> {
  // Load cache for instant response
  projectsCache = await loadCache();

  // Full refresh on startup (detects tech stack, git, etc.)
  refreshProjects().then(() => {
    console.log(`Loaded ${projectsCache.length} projects`);
  });

  // Lightweight git refresh every 15s (only updates git status fields).
  // The guard keeps ticks from stacking when a slow repo makes one poll
  // outlast the interval.
  let refreshing = false;
  setInterval(() => {
    if (refreshing) return;
    refreshing = true;
    refreshGitStatus()
      .catch(() => {})
      .finally(() => { refreshing = false; });
  }, 15000);
}
