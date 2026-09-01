import { simpleGit, SimpleGit, StatusResult, LogResult } from 'simple-git';
import path from 'path';
import { promises as fsp } from 'fs';

// Cache SimpleGit instances per resolved path so that all operations on the
// same repo go through one instance's internal task queue. This serializes git
// commands and prevents concurrent index access that can cause incomplete
// status results on Windows (index.lock conflicts).
const gitInstances = new Map<string, SimpleGit>();

function getGit(projectPath: string): SimpleGit {
  const key = path.resolve(projectPath);
  let instance = gitInstances.get(key);
  if (!instance) {
    instance = simpleGit(projectPath, {
      config: ['core.quotepath=false'],
    });
    gitInstances.set(key, instance);
  }
  return instance;
}

export async function fetch(projectPath: string): Promise<void> {
  const git = getGit(projectPath);
  try {
    await git.fetch();
  } catch {
    // ignore fetch errors (no remote, no network, etc)
  }
}

export async function getStatus(projectPath: string): Promise<StatusResult> {
  const git = getGit(projectPath);
  return git.status();
}

export async function getRemotes(projectPath: string) {
  const git = getGit(projectPath);
  return git.getRemotes(true);
}

export async function getDiff(projectPath: string, file?: string, staged = false): Promise<string> {
  const git = getGit(projectPath);
  const args = staged ? ['--cached'] : [];
  if (file) args.push(file);
  return git.diff(args);
}

export async function getFileAtRef(projectPath: string, file: string, ref = 'HEAD'): Promise<string> {
  const git = getGit(projectPath);
  return git.show([`${ref}:${file}`]);
}

export async function stageFile(projectPath: string, file: string): Promise<void> {
  const git = getGit(projectPath);
  await git.add(file);
}

export async function stageAll(projectPath: string): Promise<void> {
  const git = getGit(projectPath);
  await git.add('-A');
}

export async function unstageFile(projectPath: string, file: string): Promise<void> {
  const git = getGit(projectPath);
  await git.reset(['HEAD', '--', file]);
}

export async function unstageAll(projectPath: string): Promise<void> {
  const git = getGit(projectPath);
  await git.reset(['HEAD']);
}

export async function commit(projectPath: string, message: string): Promise<string> {
  const git = getGit(projectPath);
  const result = await git.commit(message);
  return result.commit;
}

export async function push(projectPath: string): Promise<void> {
  const git = getGit(projectPath);
  await git.push();
}

export async function pull(projectPath: string): Promise<void> {
  const git = getGit(projectPath);
  await git.pull();
}

export async function getLog(projectPath: string, maxCount = 20): Promise<LogResult> {
  const git = getGit(projectPath);
  return git.log({ maxCount });
}

export async function getBranches(projectPath: string) {
  const git = getGit(projectPath);
  return git.branch();
}

export async function checkoutBranch(projectPath: string, branch: string): Promise<void> {
  const git = getGit(projectPath);
  await git.checkout(branch);
}

export async function discardFile(projectPath: string, file: string, type: 'staged' | 'unstaged' | 'untracked'): Promise<void> {
  const git = getGit(projectPath);
  if (type === 'staged') {
    try {
      await git.checkout(['HEAD', '--', file]);
    } catch {
      // New file not in HEAD — just unstage (leaves as untracked)
      await git.reset(['HEAD', '--', file]);
    }
  } else if (type === 'unstaged') {
    await git.checkout(['--', file]);
  } else {
    // untracked — delete the file or directory
    const fullPath = path.resolve(projectPath, file);
    if (!fullPath.startsWith(path.resolve(projectPath))) {
      throw new Error('Invalid path');
    }
    const stat = await fsp.stat(fullPath);
    if (stat.isDirectory()) {
      await fsp.rm(fullPath, { recursive: true });
    } else {
      await fsp.unlink(fullPath);
    }
  }
}

export async function discardAll(projectPath: string, section: 'staged' | 'unstaged'): Promise<void> {
  const git = getGit(projectPath);
  const status = await git.status();
  if (section === 'staged') {
    // Mirror discardFile logic for each staged file (handles new files not in HEAD)
    for (const file of status.staged) {
      try {
        await git.checkout(['HEAD', '--', file]);
      } catch {
        // New file not in HEAD — just unstage (leaves as untracked)
        try { await git.reset(['HEAD', '--', file]); } catch { /* ignore */ }
      }
    }
  } else {
    // Restore all tracked modified/deleted files
    try { await git.checkout(['--', '.']); } catch { /* nothing to restore */ }
    // Delete untracked files (mirrors discardFile for type='untracked')
    for (const file of status.not_added) {
      const fullPath = path.resolve(projectPath, file);
      if (!fullPath.startsWith(path.resolve(projectPath))) continue;
      try {
        const stat = await fsp.stat(fullPath);
        if (stat.isDirectory()) {
          await fsp.rm(fullPath, { recursive: true });
        } else {
          await fsp.unlink(fullPath);
        }
      } catch { /* ignore */ }
    }
  }
}

export async function undoLastCommit(projectPath: string): Promise<void> {
  const git = getGit(projectPath);
  // Check there's at least one commit
  try {
    await git.raw(['rev-parse', 'HEAD']);
  } catch {
    throw new Error('No commits to undo');
  }
  await git.reset(['--soft', 'HEAD~1']);
}

export async function getCommitDiff(projectPath: string, hash: string): Promise<{ files: { file: string; status: string; additions: number; deletions: number }[]; diff: string }> {
  const git = getGit(projectPath);
  // Get list of changed files with stats
  const nameStatus = await git.raw(['diff-tree', '--no-commit-id', '-r', '--name-status', hash]);
  const numstat = await git.raw(['diff-tree', '--no-commit-id', '-r', '--numstat', hash]);
  const diff = await git.raw(['diff-tree', '-p', '--no-commit-id', '-r', hash]);

  const statusLines = nameStatus.trim().split('\n').filter(Boolean);
  const statLines = numstat.trim().split('\n').filter(Boolean);

  const files = statusLines.map((line, i) => {
    const [status, ...fileParts] = line.split('\t');
    const file = fileParts.join('\t'); // handle renames with tab
    const statParts = statLines[i]?.split('\t') || [];
    const additions = parseInt(statParts[0]) || 0;
    const deletions = parseInt(statParts[1]) || 0;
    const statusMap: Record<string, string> = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C' };
    return { file, status: statusMap[status.charAt(0)] || status.charAt(0), additions, deletions };
  });

  return { files, diff };
}

export async function getMainBranchLastCommit(projectPath: string): Promise<{ hash: string; message: string; date: string; author_name: string; isMerged: boolean } | null> {
  const git = getGit(projectPath);
  try {
    const branches = await git.branch();
    const mainRef = branches.all.find(b => b === 'main')
      || branches.all.find(b => b === 'master')
      || branches.all.find(b => b === 'remotes/origin/main')
      || branches.all.find(b => b === 'remotes/origin/master');
    if (!mainRef) return null;
    const raw = await git.raw(['log', mainRef, '-1', '--format=%H%n%s%n%aI%n%an']);
    if (!raw.trim()) return null;
    const [hash, message, date, author_name] = raw.trim().split('\n');

    // Check if main's last commit is already in the current branch
    let isMerged = false;
    try {
      await git.raw(['merge-base', '--is-ancestor', hash, 'HEAD']);
      isMerged = true;
    } catch {
      // exit code 1 = not ancestor, meaning main commit is NOT in current branch
    }

    return { hash, message, date, author_name, isMerged };
  } catch {
    return null;
  }
}


export interface TaskCommitFile {
  file: string;
  additions: number;
  deletions: number;
  binary?: boolean;
}

export interface TaskCommit {
  hash: string;
  message: string;
  date: string;
  author_name: string;
  files: TaskCommitFile[];
  additions: number;
  deletions: number;
}

const REC = '\x1e'; // record separator — one per commit
const UNIT = '\x1f'; // unit separator — between header fields

/**
 * Commits whose date falls inside a window, each with the files it touched.
 * One `git log --numstat` call covers the whole range; the per-commit diff is
 * fetched on demand by getCommitDiff when the user expands a commit.
 */
export async function getCommitsSince(projectPath: string, since: string, until?: string): Promise<TaskCommit[]> {
  const git = getGit(projectPath);
  const args = [
    'log',
    `--since=${since}`,
    '--numstat',
    `--format=${REC}%H${UNIT}%s${UNIT}%aI${UNIT}%an`,
  ];
  if (until) args.push(`--until=${until}`);

  let raw: string;
  try {
    raw = await git.raw(args);
  } catch {
    // No commits yet, or not a repo — nothing to review
    return [];
  }

  const commits: TaskCommit[] = [];
  for (const record of raw.split(REC)) {
    if (!record.trim()) continue;
    const [header, ...rest] = record.split('\n');
    const [hash, message, date, author_name] = header.split(UNIT);
    if (!hash) continue;

    const files: TaskCommitFile[] = [];
    let additions = 0;
    let deletions = 0;
    for (const line of rest) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      if (parts.length < 3) continue;
      const [addRaw, delRaw, ...fileParts] = parts;
      const file = fileParts.join('\t');
      // Binary files report "-" instead of a line count
      const binary = addRaw === '-' || delRaw === '-';
      const a = binary ? 0 : parseInt(addRaw, 10) || 0;
      const d = binary ? 0 : parseInt(delRaw, 10) || 0;
      additions += a;
      deletions += d;
      files.push({ file, additions: a, deletions: d, ...(binary ? { binary: true } : {}) });
    }

    commits.push({ hash, message: message || '', date: date || '', author_name: author_name || '', files, additions, deletions });
  }

  return commits;
}
