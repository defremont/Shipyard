import { simpleGit, SimpleGit, StatusResult, LogResult } from 'simple-git';
import path from 'path';
import { promises as fsp } from 'fs';

function getGit(projectPath: string): SimpleGit {
  return simpleGit(projectPath, {
    config: ['core.quotepath=false'],
  });
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

export async function getDiff(projectPath: string, file?: string): Promise<string> {
  const git = getGit(projectPath);
  if (file) {
    return git.diff([file]);
  }
  return git.diff();
}

export async function getStagedDiff(projectPath: string): Promise<string> {
  const git = getGit(projectPath);
  return git.diff(['--cached']);
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

