import { useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import type { Task } from '@/hooks/useTasks'
import { buildTaskHistory, type HistoryEntry, type HistoryKind } from '@/lib/taskHistory'
import { cn } from '@/lib/utils'

const LABELS: Record<HistoryKind, string> = {
  created: 'Created',
  inbox: 'Back to Inbox',
  started: 'Started',
  done: 'Done',
  note: 'Note',
  'follow-up': 'Client follow-up',
  attachment: 'Attachment from the client',
  comment: 'Comment on the board',
  edited: 'Edited',
}

function Entry({ entry, fresh }: { entry: HistoryEntry; fresh: boolean }) {
  const [open, setOpen] = useState(false)
  const long = !!entry.body && entry.body.length > 280
  const date = new Date(entry.at)
  return (
    <li className="relative pl-4">
      <span className={cn(
        'absolute -left-[4.5px] top-1.5 h-2 w-2 rounded-full ring-2 ring-background',
        entry.kind === 'follow-up' ? 'bg-primary' : entry.kind === 'done' ? 'bg-success' : entry.kind === 'started' ? 'bg-warning' : 'bg-muted-foreground/40',
      )} />
      <div className="flex items-baseline gap-2 text-xs">
        <span className={cn('font-medium', fresh && 'text-primary')}>{LABELS[entry.kind]}</span>
        <span className="text-muted-foreground/60" title={format(date, 'yyyy-MM-dd HH:mm')}>
          {formatDistanceToNow(date, { addSuffix: true })}
        </span>
      </div>
      {entry.title && <p className="mt-0.5 text-xs text-foreground/90">{entry.title}</p>}
      {entry.body && (
        <>
          <p className={cn('mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-muted-foreground', long && !open && 'line-clamp-4')}>
            {entry.body}
          </p>
          {long && (
            <button onClick={() => setOpen(v => !v)} className="mt-0.5 text-[11px] text-muted-foreground/70 hover:text-foreground">
              {open ? 'Show less' : 'Show more'}
            </button>
          )}
        </>
      )}
    </li>
  )
}

/**
 * The task's own timeline: what changed and when, newest first. Answers
 * "what is new on this task?" without reading the whole prompt.
 */
export function TaskHistory({ task, seenBefore }: { task: Task; seenBefore?: number }) {
  const entries = buildTaskHistory(task)
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
  }
  return (
    <ol className="ml-1.5 space-y-3 border-l border-border/60">
      {entries.map(e => (
        <Entry key={e.id} entry={e} fresh={seenBefore != null && e.at > seenBefore} />
      ))}
    </ol>
  )
}
