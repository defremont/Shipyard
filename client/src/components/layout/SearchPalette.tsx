import { useEffect, type ReactNode, type KeyboardEvent as ReactKeyboardEvent, type Ref } from 'react'
import { Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

/*
 * The frame both search palettes share: Ctrl+K (projects, tasks, files,
 * commands) and Ctrl+Shift+F (file contents). Same position, header, row
 * height, key hints and footer, so moving between them reads as one tool.
 */

export const TOGGLE_SEARCH_EVENT = 'shipyard:toggle-search'
export const TOGGLE_CONTENT_SEARCH_EVENT = 'shipyard:toggle-file-search'

/** Opens Ctrl+Shift+F, optionally with a query already typed. */
export function openContentSearch(query?: string) {
  window.dispatchEvent(new CustomEvent(TOGGLE_CONTENT_SEARCH_EVENT, { detail: { open: true, query } }))
}

/**
 * Wires a palette's shortcut and its menu event, and closes it when the other
 * palette opens — two overlays stacked would fight over the keyboard.
 * `match` reads `event.code`, so a non-US layout or Caps Lock doesn't matter.
 * The key is taken in the capture phase: the editor (CodeMirror) would
 * otherwise see Ctrl+Shift+F first and open its own search bar.
 */
export function usePaletteToggle(
  ownEvent: string,
  otherEvent: string,
  match: (e: KeyboardEvent) => boolean,
  onToggle: (detail?: { open?: boolean; query?: string }) => void,
  onClose: () => void,
) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!match(e)) return
      e.preventDefault()
      e.stopPropagation()
      window.dispatchEvent(new CustomEvent(ownEvent))
    }
    const toggle = (e: Event) => onToggle((e as CustomEvent).detail)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener(ownEvent, toggle)
    window.addEventListener(otherEvent, onClose)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener(ownEvent, toggle)
      window.removeEventListener(otherEvent, onClose)
    }
  }, [ownEvent, otherEvent, match, onToggle, onClose])
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn(
      'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-muted px-1 font-mono text-[10px] font-medium text-muted-foreground',
      className,
    )}>
      {children}
    </kbd>
  )
}

export function PaletteShell({ onClose, onKeyDown, wide, label, children }: {
  onClose: () => void
  onKeyDown: (e: ReactKeyboardEvent) => void
  /** Content search shows code lines and wants the room. */
  wide?: boolean
  label: string
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50" onKeyDown={onKeyDown} role="dialog" aria-modal="true" aria-label={label}>
      <div className="anim-fade fixed inset-0 bg-black/60" onClick={onClose} />
      <div className={cn('fixed left-1/2 top-[10%] w-full -translate-x-1/2 px-4', wide ? 'max-w-3xl' : 'max-w-2xl')}>
        <div className="anim-rise flex max-h-[78vh] flex-col overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-2xl">
          {children}
        </div>
      </div>
    </div>
  )
}

export function PaletteInput({ inputRef, value, onChange, placeholder, busy, children }: {
  inputRef: Ref<HTMLInputElement>
  value: string
  onChange: (value: string) => void
  placeholder: string
  busy?: boolean
  /** Option toggles, right of the field. */
  children?: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-4">
      {busy
        ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
        : <Search className="h-4 w-4 shrink-0 text-muted-foreground" />}
      <input
        ref={inputRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
        autoComplete="off"
        spellCheck={false}
        autoFocus
        aria-label={placeholder}
      />
      {children}
    </div>
  )
}

/** A VS Code-style option button: icon or glyph, lit when on, shortcut in the tooltip. */
export function OptionToggle({ active, onClick, title, shortcut, children }: {
  active: boolean
  onClick: () => void
  title: string
  shortcut?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={e => e.preventDefault()} // keep the focus in the field
      aria-pressed={active}
      title={shortcut ? `${title} (${shortcut})` : title}
      className={cn(
        'flex h-7 min-w-7 shrink-0 items-center justify-center rounded border px-1 text-xs transition-colors',
        active
          ? 'border-primary/40 bg-accent text-foreground'
          : 'border-transparent text-muted-foreground/70 hover:bg-accent/50 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/** One line under the field: what was searched and what came back. */
export function PaletteStatus({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b px-4 py-1.5 text-[11px] text-muted-foreground">
      {children}
    </div>
  )
}

export function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pb-1 pt-2.5 text-[11px] font-medium text-muted-foreground">
      {label}
      {count !== undefined && <span className="tabular-nums text-muted-foreground/60">{count}</span>}
    </div>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-muted-foreground">{children}</div>
}

export function PaletteFooter({ hints, children }: { hints: Array<[string, string]>; children?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
      {hints.map(([keys, label]) => (
        <span key={keys} className="flex items-center gap-1.5">
          <Kbd>{keys}</Kbd>
          {label}
        </span>
      ))}
      {children && <span className="ml-auto flex items-center gap-1.5 truncate">{children}</span>}
    </div>
  )
}

/** Wraps every match of `matcher` in a mark. A bad pattern leaves the text plain. */
export function Highlight({ text, matcher }: { text: string; matcher: RegExp | null }) {
  if (!matcher) return <>{text}</>
  const parts: ReactNode[] = []
  let last = 0
  matcher.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = matcher.exec(text))) {
    if (m[0].length === 0) { matcher.lastIndex++; continue }
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<mark key={m.index} className="rounded-sm bg-warning/25 px-px text-foreground">{m[0]}</mark>)
    last = m.index + m[0].length
    if (parts.length > 200) break
  }
  if (last === 0) return <>{text}</>
  parts.push(text.slice(last))
  return <>{parts}</>
}

/** Literal, case-insensitive matcher for the terms of a palette query. */
export function termsMatcher(query: string): RegExp | null {
  const terms = query.trim().split(/[\s/\\]+/).filter(t => t.length > 0 && !t.startsWith('#'))
  if (!terms.length) return null
  return new RegExp(terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
}
