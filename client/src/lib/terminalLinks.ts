import type { IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm'

/**
 * File paths a program printed in the terminal, made clickable.
 *
 * xterm only knows http(s) links (WebLinksAddon) and OSC 8 hyperlinks. Claude
 * Code prints most file references as plain text — `C:\Code\x\file.ts`,
 * `src/lib/api.ts:42`, `TaskRail.tsx:121` — and those did nothing on click.
 */

export interface PathMatch {
  /** Offset in the logical line. */
  start: number
  end: number
  /** Path as printed, without the `:line:col` tail. */
  path: string
  line?: number
}

const EXT = '[A-Za-z0-9]{1,8}'
const SEG = "[\\w.@()+\\-\\[\\]~]+"
const PATTERNS: RegExp[] = [
  // file:///C:/x/y.ts
  /file:\/\/\/?[^\s"'<>`]+/g,
  // C:\x\y or C:/x/y (spaces are not followed — wrapped output would swallow the next word)
  new RegExp(`[A-Za-z]:[\\\\/](?:${SEG}[\\\\/])*${SEG}(?::\\d+(?::\\d+)?)?`, 'g'),
  // ./a/b.ts, ../a, ~/a, a/b/c.ts, /usr/x (at least one separator)
  new RegExp(`(?:~|\\.{1,2})?[\\\\/]?(?:${SEG}[\\\\/])+${SEG}(?::\\d+(?::\\d+)?)?`, 'g'),
  // name.ext:12 — a bare file name only when a line number makes it a reference
  new RegExp(`\\b${SEG}\\.${EXT}:\\d+(?::\\d+)?`, 'g'),
]

const TRAILING = /[.,;:)\]}'"`>]+$/

export function findPaths(text: string): PathMatch[] {
  const found: PathMatch[] = []
  // Web URLs are the web links addon's: mark them taken so "github.com/a/b" is not read as a path.
  const urls = [...text.matchAll(/\b(?!file:)[a-z][\w+.-]*:\/\/[^\s"'<>`]+/gi)].map(u => ({ start: u.index!, end: u.index! + u[0].length }))
  for (const re of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text))) {
      let raw = m[0]
      const start = m.index
      if (urls.some(u => start < u.end && start + raw.length > u.start)) continue
      raw = raw.replace(TRAILING, '')
      if (raw.length < 3) continue
      let path = raw
      let line: number | undefined
      const tail = /:(\d+)(?::\d+)?$/.exec(raw)
      if (tail && !raw.startsWith('file:')) {
        path = raw.slice(0, tail.index)
        line = Number(tail[1])
      }
      // A bare "a/b" without any dot or drive is too often prose ("and/or", "in/out").
      if (!/[.\\:]/.test(path) && !path.startsWith('/') && !path.startsWith('~') && path.split('/').length < 3) continue
      const end = start + raw.length
      // Earlier patterns win; skip anything inside a match already taken.
      if (found.some(f => start < f.end && end > f.start)) continue
      found.push({ start, end, path, line })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/**
 * The logical line around buffer row `y` (1-based): rows joined across soft
 * wraps, so a long Windows path broken by the terminal width still matches.
 */
function logicalLine(term: Terminal, y: number): { text: string; firstRow: number } | null {
  const buf = term.buffer.active
  let first = y - 1
  while (first > 0 && buf.getLine(first)?.isWrapped) first--
  let last = first
  while (buf.getLine(last + 1)?.isWrapped) last++
  let text = ''
  for (let row = first; row <= last; row++) {
    const line = buf.getLine(row)
    if (!line) break
    // Every row but the last keeps its full width so offsets map back to cells.
    text += line.translateToString(row === last)
  }
  return { text, firstRow: first }
}

function toRange(term: Terminal, firstRow: number, start: number, end: number): IBufferRange {
  const cols = term.cols
  return {
    start: { x: (start % cols) + 1, y: firstRow + Math.floor(start / cols) + 1 },
    end: { x: ((end - 1) % cols) + 1, y: firstRow + Math.floor((end - 1) / cols) + 1 },
  }
}

export function filePathLinkProvider(
  term: Terminal,
  onOpen: (match: PathMatch, event: MouseEvent) => void,
): ILinkProvider {
  return {
    provideLinks(y, callback) {
      const logical = logicalLine(term, y)
      if (!logical || !logical.text.trim()) return callback(undefined)
      const links: ILink[] = []
      for (const match of findPaths(logical.text)) {
        const range = toRange(term, logical.firstRow, match.start, match.end)
        if (range.start.y > y || range.end.y < y) continue
        links.push({
          range,
          text: logical.text.slice(match.start, match.end),
          decorations: { pointerCursor: true, underline: true },
          activate: (event) => onOpen(match, event),
        })
      }
      callback(links.length ? links : undefined)
    },
  }
}
