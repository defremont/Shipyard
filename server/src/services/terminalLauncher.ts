import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { platform } from 'os';

export type TerminalType = 'claude' | 'claude-yolo' | 'dev' | 'shell';

const os = platform();

const typeLabel: Record<TerminalType, string> = {
  claude: 'Claude',
  'claude-yolo': 'Claude',
  dev: 'Dev',
  shell: 'Shell',
};

function buildTitle(projectName: string, type: TerminalType): string {
  const label = typeLabel[type];
  const maxLen = 18;
  const short = projectName.length > maxLen
    ? projectName.slice(0, maxLen - 3) + '...'
    : projectName;
  return `[${short}] ${label}`;
}

async function detectDevCommand(projectPath: string): Promise<string | null> {
  try {
    const pkg = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf-8'));
    if (pkg.scripts?.dev) return 'pnpm dev';
    if (pkg.scripts?.start) return 'pnpm start';
    if (pkg.scripts?.serve) return 'pnpm serve';
  } catch {}
  return null;
}

function spawnDetached(cmd: string, args: string[], useShell = false) {
  spawn(cmd, args, {
    detached: true,
    stdio: 'ignore',
    shell: useShell,
  }).unref();
}

// Linux: gnome-terminal with --title
function launchLinuxTerminal(projectPath: string, title: string, command?: string) {
  const args = ['--title', title, '--working-directory', projectPath];
  if (command) {
    args.push('--', 'bash', '-c', `${command}; exec bash`);
  }
  spawnDetached('gnome-terminal', args);
}

// macOS: osascript to open Terminal.app with title and command
function launchMacTerminal(projectPath: string, title: string, command?: string) {
  const escapedTitle = title.replace(/"/g, '\\"');
  const escapedPath = projectPath.replace(/"/g, '\\"');
  const cdCmd = `cd "${escapedPath}"`;
  const titleCmd = `printf '\\\\e]0;${escapedTitle}\\\\a'`;
  const fullCmd = command
    ? `${cdCmd} && ${titleCmd} && ${command}`
    : `${cdCmd} && ${titleCmd}`;

  const script = `tell application "Terminal"
  activate
  do script "${fullCmd.replace(/"/g, '\\"')}"
end tell`;

  spawnDetached('osascript', ['-e', script]);
}

// Windows: wt.exe with --title
function launchWindowsTerminal(projectPath: string, title: string, command?: string) {
  const args: string[] = ['-w', '0', 'nt', '-d', projectPath, '--title', title];
  if (command) {
    args.push('cmd.exe', '/k', command);
  }
  spawnDetached('wt.exe', args);
}

export async function launchTerminal(projectPath: string, type: TerminalType, projectName?: string): Promise<void> {
  const title = projectName ? buildTitle(projectName, type) : typeLabel[type];

  let command: string | undefined;
  switch (type) {
    case 'claude':
      command = 'claude';
      break;
    case 'claude-yolo':
      command = 'claude --dangerously-skip-permissions';
      break;
    case 'dev':
      command = (await detectDevCommand(projectPath)) || undefined;
      break;
    case 'shell':
      command = undefined;
      break;
  }

  if (os === 'linux') {
    launchLinuxTerminal(projectPath, title, command);
  } else if (os === 'darwin') {
    launchMacTerminal(projectPath, title, command);
  } else {
    // Windows: prefix claude commands with env clear
    if (type === 'claude') command = 'set CLAUDECODE= && claude';
    else if (type === 'claude-yolo') command = 'set CLAUDECODE= && claude --dangerously-skip-permissions';
    launchWindowsTerminal(projectPath, title, command);
  }
}

export async function openFolder(projectPath: string): Promise<void> {
  if (os === 'linux') {
    spawnDetached('xdg-open', [projectPath]);
  } else if (os === 'darwin') {
    spawnDetached('open', [projectPath]);
  } else {
    spawnDetached('explorer.exe', [projectPath]);
  }
}
