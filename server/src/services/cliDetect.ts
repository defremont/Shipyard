import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';

const execFileAsync = promisify(execFile);
const isWindows = process.platform === 'win32';
const CACHE_TTL = 60_000;

export interface CliInfo {
  available: boolean;
  /** Executable to spawn. */
  command: string;
  /** Arguments that must precede the caller's own (npm shim → its JS entry). */
  prefixArgs: string[];
}

const cache = new Map<string, { info: CliInfo; checkedAt: number }>();

/**
 * npm installs CLIs on Windows as a `.cmd` shim, and since the 2024 spawn
 * hardening Node refuses to run one without a shell. Going through a shell
 * would then mangle multi-line prompts, so read the shim and call the JS entry
 * it points at directly — `node <entry>` takes its arguments verbatim.
 */
function resolveWindowsShim(shimPath: string): CliInfo | null {
  try {
    const shim = readFileSync(shimPath, 'utf-8');
    const match = shim.match(/"%_prog%"\s+"%dp0%\\(.+?\.js)"/i);
    if (!match) return null;
    return { available: true, command: process.execPath, prefixArgs: [join(dirname(shimPath), match[1])] };
  } catch {
    return null;
  }
}

async function resolve(bin: string): Promise<CliInfo | null> {
  try {
    const { stdout } = await execFileAsync(isWindows ? 'where' : 'which', [bin], {
      timeout: 5000,
      windowsHide: true,
    });
    const paths = stdout.trim().split(/\r?\n/).map(p => p.trim()).filter(Boolean);
    if (paths.length === 0) return null;
    if (!isWindows) return { available: true, command: paths[0], prefixArgs: [] };

    const exe = paths.find(p => /\.exe$/i.test(p));
    if (exe) return { available: true, command: exe, prefixArgs: [] };

    for (const shim of paths.filter(p => /\.(cmd|bat)$/i.test(p))) {
      const resolved = resolveWindowsShim(shim);
      if (resolved) return resolved;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Probe a CLI once a minute and remember how to launch it.
 * Falls back to the bare command name so a CLI that `where`/`which` cannot see
 * — but the OS can — still works.
 */
export async function detectCli(bin: string, versionArgs: string[] = ['--version']): Promise<CliInfo> {
  const hit = cache.get(bin);
  const now = Date.now();
  if (hit && now - hit.checkedAt < CACHE_TTL) return hit.info;

  const unavailable: CliInfo = { available: false, command: bin, prefixArgs: [] };
  const candidate = (await resolve(bin)) ?? { available: true, command: bin, prefixArgs: [] };

  let info = unavailable;
  try {
    await execFileAsync(candidate.command, [...candidate.prefixArgs, ...versionArgs], {
      timeout: 15_000,
      windowsHide: true,
    });
    info = candidate;
  } catch {
    // Not installed, not on PATH for this process, or the probe timed out.
  }

  cache.set(bin, { info, checkedAt: now });
  return info;
}
