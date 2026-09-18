import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface TaskSearchBoxProps {
  value: string
  onChange: (value: string) => void
  /** Matches found, shown inside the input while filtering. */
  resultCount?: number
  className?: string
}

/**
 * Collapsed to a single icon until used — the board toolbar stays quiet. The
 * input never collapses while it has text, so an active filter is always
 * visible and nobody hides tasks by accident.
 */
export function TaskSearchBox({ value, onChange, resultCount, className }: TaskSearchBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const expanded = open || value.length > 0

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!expanded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setOpen(true)}
            aria-label="Search tasks"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors',
              className,
            )}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent>Search tasks</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder="Filter tasks…"
        aria-label="Filter tasks"
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          if (e.key !== 'Escape') return
          // Keep Esc from closing whatever dialog or menu sits above the board.
          e.stopPropagation()
          onChange('')
          setOpen(false)
        }}
        onBlur={() => { if (!value) setOpen(false) }}
        className="h-7 w-44 rounded-md border bg-background pl-7 pr-12 text-xs outline-none focus:ring-1 focus:ring-ring"
      />
      {value && (
        <>
          <span className="pointer-events-none absolute right-6 text-[10px] tabular-nums text-muted-foreground/60">
            {resultCount ?? 0}
          </span>
          <button
            onClick={() => { onChange(''); inputRef.current?.focus() }}
            aria-label="Clear search"
            className="absolute right-1.5 text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </>
      )}
    </div>
  )
}
