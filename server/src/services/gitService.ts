import { simpleGit, SimpleGit, StatusResult, LogResult } from 'simple-git';

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

