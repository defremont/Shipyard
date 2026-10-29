import { CircleCheck, SearchCode, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Task } from '@/hooks/useTasks'
import { getTaskOutcome } from '@/lib/taskOutcome'

/**
 * The first thing a done task shows: why it happened (bugs and problems) and
 * what was done. It sits above the description so the answer is read before
 * the question. A done task with nothing recorded says so, with a way to fix
 * it, instead of hiding the gap.
 */
export function TaskOutcomeCard({ task, onEdit }: { task: Task; onEdit?: () => void }) {
  const outcome = getTaskOutcome(task)
  const hasOutcome = !!(outcome.rootCause || outcome.resolution)
  if (!hasOutcome && task.status !== 'done') return null

  if (!hasOutcome) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed px-3 py-2.5">
        <p className="flex-1 text-xs text-muted-foreground">
          No resolution recorded — why it happened and what was done.
        </p>
        {onEdit && (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
            Add
          </Button>
        )}
      </div>
    )
  }

  return (
    <section aria-label="Resolution" className="rounded-lg border bg-muted/40 divide-y">
      {outcome.rootCause && (
        <div className="px-3.5 py-3">
          <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-warning">
            <SearchCode className="h-3.5 w-3.5" />
            Why it happened
          </h4>
          <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap">{outcome.rootCause}</p>
        </div>
      )}
      {outcome.resolution && (
        <div className="px-3.5 py-3">
          <h4 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-success">
            <CircleCheck className="h-3.5 w-3.5" />
            What was done
            {outcome.legacy && (
              <span className="ml-1 normal-case tracking-normal font-normal text-muted-foreground/70">
                · from the task notes
              </span>
            )}
          </h4>
          <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-wrap">{outcome.resolution}</p>
        </div>
      )}
    </section>
  )
}
