import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, History, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { shortAgo } from '@/lib/activityFeed'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { resumeConversation } from './ResumeConversations'
import { cn } from '@/lib/utils'

/**
 * The project's last Claude Code conversations, with the title Claude gave
 * each one and the last thing asked in it; a click resumes it in a new tab.
 * Replaces "open Claude, type /resume, hunt for the right line". Read only
 * while the popover is open.
 */
export function ResumePicker({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['terminal', 'conversations', projectId, 'picker'],
    queryFn: () => api.getClaudeConversations(projectId, 25).then(r => r.conversations),
    enabled: open,
    staleTime: 15_000,
  })
  const list = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return (data || []).filter(c => {
      if (!terms.length) return true
      const text = `${c.title || ''} ${c.lastPrompt || ''}`.toLowerCase()
      return terms.every(t => text.includes(t))
    })
  }, [data, query])
  const now = Date.now()

  return (
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery('') }}>
      <PopoverTrigger asChild>
        <button
          title="Resume an earlier Claude conversation of this project"
          className="flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <History className="h-3 w-3" />
          Resume
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[440px] p-0">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter by title or last prompt"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            onKeyDown={e => {
              if (e.key === 'Enter' && list[0]) { resumeConversation(list[0]); setOpen(false) }
            }}
          />
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {isLoading && <div className="px-3 py-3 text-xs text-muted-foreground">Reading conversations…</div>}
          {!isLoading && list.length === 0 && (
            <div className="px-3 py-3 text-xs text-muted-foreground">{query ? 'Nothing matches.' : 'No earlier conversation in this project.'}</div>
          )}
          {list.map(c => (
            <button
              key={c.id}
              onClick={() => { resumeConversation(c); setOpen(false) }}
              className="block w-full px-3 py-2 text-left transition-colors hover:bg-accent"
            >
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{c.title || 'Untitled conversation'}</span>
                {c.open && <span className="shrink-0 text-[10px] text-warning">open at close</span>}
                {c.yolo && <span className="shrink-0 text-[10px] text-muted-foreground/60">YOLO</span>}
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/60">{shortAgo(Date.parse(c.updatedAt), now)}</span>
              </div>
              {c.lastPrompt && (
                <div className={cn('mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground')}>
                  {/* A run's prompt opens with "# Task:" — the words after it are what tell runs apart. */}
                  {c.lastPrompt.replace(/^#+\s*(?:Task:\s*)?/i, '').replace(/\s+/g, ' ')}
                </div>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
