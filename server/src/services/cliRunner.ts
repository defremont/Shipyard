import { spawn } from 'child_process';

// Shared subprocess plumbing for the AI CLIs (claude, codex, gemini).
// Every one of them is long-running and chatty, so the timeout is
// activity-based: it resets on each chunk of output and only fires when the
// process goes quiet.

export interface RunCliOptions {
  /** Written to stdin and closed. When absent, stdin is closed immediately so
   *  the CLI never blocks waiting for input that will not arrive. */
  input?: string;
  /** Milliseconds of silence before the process is killed. */
  timeout?: number;
  /** Absolute deadline, regardless of activity. */
  hardTimeout?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Label used in timeout/exit messages. */
  label?: string;
}

/** Run a CLI to completion and return its trimmed stdout. */
export function runCli(bin: string, args: string[], options?: RunCliOptions): Promise<string> {
  const label = options?.label ?? bin;
  const hasInput = options?.input !== undefined;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

    const proc = spawn(bin, args, {
      env: options?.env ?? process.env,
      cwd: options?.cwd,
      stdio: [hasInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timeout = options?.timeout ?? 60_000;

    let timer: NodeJS.Timeout;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        proc.kill();
        const detail = stderr.trim() ? ` stderr: ${stderr.trim().slice(0, 200)}` : '';
        settle(() => reject(new Error(`${label} timed out (no output for ${Math.round(timeout / 1000)}s)${detail}`)));
      }, timeout);
    };
    resetTimer();

    let hardTimer: NodeJS.Timeout | undefined;
    if (options?.hardTimeout) {
      hardTimer = setTimeout(() => {
        proc.kill();
        const detail = stderr.trim() ? ` stderr: ${stderr.trim().slice(0, 200)}` : '';
        settle(() => reject(new Error(`${label} exceeded hard timeout (${Math.round(options.hardTimeout! / 1000)}s)${detail}`)));
      }, options.hardTimeout);
    }

    const cleanup = () => { clearTimeout(timer); if (hardTimer) clearTimeout(hardTimer); };

    proc.stdout!.on('data', (data: Buffer) => { stdout += data.toString(); resetTimer(); });
    proc.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); resetTimer(); });
    proc.on('close', (code) => {
      cleanup();
      if (code === 0) settle(() => resolve(stdout.trim()));
      else settle(() => reject(new Error(stderr.trim() || `${label} exited with code ${code}`)));
    });
    proc.on('error', (err) => { cleanup(); settle(() => reject(err)); });

    // Single end(data) call — write()+end() loses data on Windows pipes.
    if (hasInput && proc.stdin) proc.stdin.end(options!.input);
  });
}

/** Run a CLI and yield stdout fragments as they arrive. */
export async function* streamCli(bin: string, args: string[], options?: RunCliOptions): AsyncGenerator<string> {
  const label = options?.label ?? bin;
  const hasInput = options?.input !== undefined;

  const proc = spawn(bin, args, {
    env: options?.env ?? process.env,
    cwd: options?.cwd,
    stdio: [hasInput ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  if (hasInput && proc.stdin) proc.stdin.end(options!.input);

  const activityTimeout = options?.timeout ?? 120_000;
  let timedOut = false;
  let timer: NodeJS.Timeout = null as unknown as NodeJS.Timeout;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; proc.kill(); }, activityTimeout);
  };
  resetTimer();

  let stderr = '';
  proc.stderr!.on('data', (data: Buffer) => { stderr += data.toString(); resetTimer(); });

  try {
    for await (const chunk of proc.stdout!) {
      resetTimer();
      yield (chunk as Buffer).toString();
    }
  } finally {
    clearTimeout(timer);
  }

  if (timedOut) {
    throw new Error(`${label} timed out (no output for ${Math.round(activityTimeout / 1000)}s)`);
  }

  const code = await new Promise<number | null>((resolve) => {
    if (proc.exitCode !== null) resolve(proc.exitCode);
    else proc.on('close', resolve);
  });

  if (code !== 0) throw new Error(stderr.trim() || `${label} exited with code ${code}`);
}
