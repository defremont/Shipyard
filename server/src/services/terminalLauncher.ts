import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';

export type TerminalType = 'claude' | 'claude-yolo' | 'dev' | 'shell';

async function detectDevCommand(projectPath: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf-8'));
    if (pkg.scripts?.dev) return 'pnpm dev';
    if (pkg.scripts?.start) return 'pnpm start';
    if (pkg.scripts?.serve) return 'pnpm serve';
  } catch {}
  return null;
}

export async function launchTerminal(projectPath: string, type: TerminalType): Promise<void> {
  const args: string[] = ['-w', '0', 'nt', '-d', projectPath];

  switch (type) {
    case 'claude':
      args.push('--title', 'Claude Code', 'cmd.exe', '/k', 'set CLAUDECODE= && claude');
      break;
    case 'claude-yolo':
      args.push('--title', 'Claude Code', 'cmd.exe', '/k', 'set CLAUDECODE= && claude --dangerously-skip-permissions');
      break;
    case 'dev': {
      const devCmd = await detectDevCommand(projectPath);
      if (devCmd) {
        args.push('--title', 'Dev Server', 'cmd.exe', '/k', devCmd);
      } else {
        args.push('--title', 'Dev Server');
      }
      break;
    }
    case 'shell':
      args.push('--title', 'Shell');
      break;
  }

  spawn('wt.exe', args, {
    detached: true,
    stdio: 'ignore',
    shell: false,
  }).unref();
}

export async function launchVSCode(projectPath: string): Promise<void> {
  spawn('code', [projectPath], {
    detached: true,
    stdio: 'ignore',
    shell: true,
  }).unref();
}

export async function openFolder(projectPath: string): Promise<void> {
  spawn('explorer.exe', [projectPath], {
    detached: true,
    stdio: 'ignore',
    shell: false,
  }).unref();
}
