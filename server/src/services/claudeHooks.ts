import { mkdir, readdir, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { DATA_DIR } from './dataDir.js';

// ── Claude Code hooks ────────────────────────────────────────────────────
//
// Reading the screen to learn what the CLI is doing is guesswork: a dialog
// taller than the lines we read, or one drawn without numbered options, was
// taken for a run in flight. Claude Code can say it itself — a session started
// with `--settings <file>` posts its hook events to a URL. The file is written
// per session, with the session id in the URL, and nothing in the user's own
// `~/.claude` or in the project is touched.

const HOOK_DIR = join(DATA_DIR, 'claude-hooks');
const PORT = parseInt(process.env.SHIPYARD_PORT || '5420', 10);

// Only the moments that change what a tab shows. Tool calls in general are
// left out on purpose: every hook is a request the CLI waits for.
const QUESTION_TOOLS = 'AskUserQuestion|ExitPlanMode';

function hookSettings(sessionId: string) {
  const hook = { type: 'http', url: `http://127.0.0.1:${PORT}/api/terminal/hook/${sessionId}`, timeout: 3 };
  const always = [{ hooks: [hook] }];
  return {
    hooks: {
      UserPromptSubmit: always,
      PreToolUse: [{ matcher: QUESTION_TOOLS, hooks: [hook] }],
      PermissionRequest: always,
      Elicitation: always,
      Stop: always,
      StopFailure: always,
      SessionEnd: always,
    },
  };
}

let swept = false;

/** No session outlives the server, so whatever is in the folder at boot is stale. */
async function sweepOnce(): Promise<void> {
  if (swept) return;
  swept = true;
  try {
    for (const entry of await readdir(HOOK_DIR)) {
      await unlink(join(HOOK_DIR, entry)).catch(() => {});
    }
  } catch {}
}

/** Write the settings file for a session and return its path, or null on failure. */
export async function writeHookSettings(sessionId: string): Promise<string | null> {
  try {
    await mkdir(HOOK_DIR, { recursive: true });
    await sweepOnce();
    const path = join(HOOK_DIR, `${sessionId}.json`);
    await writeFile(path, JSON.stringify(hookSettings(sessionId)), 'utf-8');
    return path;
  } catch {
    return null;
  }
}

export function removeHookSettings(sessionId: string): void {
  void unlink(join(HOOK_DIR, `${sessionId}.json`)).catch(() => {});
}

/**
 * Did the run end by asking the user something? The final message is the only
 * place that says so: the CLI is back at an ordinary empty prompt either way.
 */
export function endsWithQuestion(message: unknown): boolean {
  if (typeof message !== 'string') return false;
  const lines = message
    .split('\n')
    .map(line => line.trim().replace(/[*_`"'”)\]\s]+$/, ''))
    .filter(Boolean)
    .slice(-3);
  return lines.some(line => /[?？]$/.test(line));
}
