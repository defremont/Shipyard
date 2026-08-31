import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import type { TaskComment } from '@/hooks/useTasks'

const COLLAPSED_COUNT = 5

export function TaskComments({ comments }: { comments: TaskComment[] }) {
  const [expanded, setExpanded] = useState(false)

  if (comments.length === 0) return null

  const hidden = comments.length - COLLAPSED_COUNT
  const visible = expanded || hidden <= 0 ? comments : comments.slice(-COLLAPSED_COUNT)

  return (
    <div className="space-y-2">
      {!expanded && hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Show all {comments.length} comments
        </button>
      )}
      {visible.map(comment => (
        <div key={comment.id} className="rounded-md border bg-muted/20 px-2.5 py-2">
          <div className="flex items-baseline gap-2 text-[10px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{comment.author || 'Trello'}</span>
            <span>{formatDistanceToNow(new Date(comment.date), { addSuffix: true })}</span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-xs text-foreground/90">{comment.text}</p>
        </div>
      ))}
    </div>
  )
}
