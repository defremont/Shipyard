import * as aiBackend from './aiBackend.js';
import { getSettings } from './settingsStore.js';
import * as log from './logService.js';

/**
 * Short labels for terminal tabs, written from the terminal's own output.
 *
 * A tab running a task is named after the task; a plain shell has nothing to
 * name it but what is on screen. This asks the AI backend (CLI first, so it
 * costs nothing per token) for a few words describing what the terminal is
 * doing — "pnpm dev on 5421", "build failed in comunic-web".
 *
 * It is deliberately stingy: one call at a time for the whole process, a
 * cooldown per session, and a session that fails twice is never asked again.
 */

const SYSTEM_PROMPT = [
  'You name terminal tabs in a developer dashboard.',
  'Given the tail of a terminal session, reply with a label of at most 5 words',
  'saying what the terminal is doing or what happened last.',
  'Name the command, the tool or the error — not the shell itself.',
  'If a coding agent (Claude Code) is on screen, name what it is working on, not the agent.',
  'Reply with the label only: no quotes, no trailing period, no explanation.',
  'If the output says nothing useful, reply exactly: NONE',
].join(' ');

const MAX_LABEL_LENGTH = 48;
const MAX_INPUT_CHARS = 1_500;

/** One AI call at a time across every terminal — these are a background nicety. */
let queue: Promise<unknown> = Promise.resolve();

export function aiTitlesEnabled(): boolean {
  return getSettings().terminalAiTitles !== false;
}

/**
 * Turn raw PTY bytes into something readable.
 *
 * ConPTY does not write a terminal the way a file is written: it moves the
 * cursor (`ESC[9;9H`) instead of emitting newlines, redraws a line by sending
 * a carriage return, and wraps everything in colour and mode sequences. Strip
 * those literally and `git status` collapses into one unreadable line, so the
 * cursor moves become the line breaks.
 */
export function cleanTerminalOutput(raw: string): string {
  return raw
    // OSC — window title and friends
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // Cursor positioning: a row move is a line break as far as reading goes
    .replace(/\x1b\[\d*(?:;\d*)?[Hf]/g, '\n')
    // A forward move is the gap between two words. Claude Code's TUI draws
    // every space that way, so dropping it glues the screen into one word.
    .replace(/\x1b\[(\d*)C/g, (_, n) => ' '.repeat(Math.min(parseInt(n || '1', 10) || 1, 200)))
    // Every other CSI sequence, then the two-byte escapes
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
    .split('\n')
    .map(line => {
      // A bare \r redraws the line — keep the last state. The \r of a CRLF
      // ending is not a redraw, so it goes first or the text is lost with it.
      const parts = line.replace(/\r+$/, '').split('\r');
      return parts[parts.length - 1];
    })
    .join('\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Ask for a tab label. Returns null when there is nothing worth showing; it
 * throws when no AI backend answers, which is what stops the caller retrying.
 */
export async function summarizeTerminal(output: string, cwd?: string): Promise<string | null> {
  const text = cleanTerminalOutput(output);
  if (text.length < 40) return null;

  const tail = text.length > MAX_INPUT_CHARS ? text.slice(-MAX_INPUT_CHARS) : text;

  const run = async (): Promise<string | null> => {
    const { text: raw } = await aiBackend.generateText(SYSTEM_PROMPT, tail, {
      maxTokens: 32,
      timeout: 20_000,
      ...(cwd ? { cwd } : {}),
    });

    const label = raw
      .trim()
      .split('\n')[0]
      .replace(/^["'`]|["'`]$/g, '')
      .replace(/[.。]$/, '')
      .trim();

    if (!label || /^none$/i.test(label)) return null;
    return label.length > MAX_LABEL_LENGTH ? label.slice(0, MAX_LABEL_LENGTH - 1) + '…' : label;
  };

  // Chain onto the shared queue so two busy shells never run two CLIs at once.
  const result = queue.then(run, run);
  queue = result.catch(() => {});

  try {
    return await result;
  } catch (err: any) {
    log.warn('terminal', 'Tab summary failed', err?.message || String(err));
    throw err;
  }
}
