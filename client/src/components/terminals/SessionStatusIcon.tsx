import { CheckCircle2, Circle, MessageCircleQuestion } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SessionStatus } from '@/hooks/useTerminalTabs'

/**
 * The single mark for what a session is doing. Used on the session tab, on the
 * project tab and next to the task that started the session, so the same state
 * always looks the same.
 */
export function SessionStatusIcon({ status, className }: { status: SessionStatus; className?: string }) {
  const size = cn('h-3 w-3 shrink-0', className)
  switch (status) {
    case 'question':
      return <MessageCircleQuestion className={cn(size, 'text-warning')} aria-label="Waiting for an answer" />
    case 'finished':
      return <CheckCircle2 className={cn(size, 'text-success')} aria-label="Finished" />
    case 'busy':
      return (
        <span className={cn(size, 'flex items-center justify-center')} aria-label="Working">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
        </span>
      )
    case 'idle':
      return <Circle className={cn(size, 'scale-[0.6] text-muted-foreground/50')} aria-label="Idle" />
    case 'exited':
      return <Circle className={cn(size, 'scale-[0.6] text-muted-foreground/25')} aria-label="Exited" />
    default:
      return null
  }
}
