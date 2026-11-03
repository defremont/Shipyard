import { useEffect, useState } from 'react'
import { AiResolveDialog } from '@/components/tasks/AiResolveDialog'
import { useAiResolve } from '@/hooks/useAiResolve'
import type { Task } from '@/hooks/useTasks'

/**
 * Runs a task with an agent from anywhere in the app.
 *
 * The kanban owns its own dialog, but the command palette unmounts the moment
 * it dispatches, so the dialog has to live somewhere that is always mounted.
 * Fire `shipyard:run-task-with-agent` with the task in `detail` to open the
 * dialog (context, agent), or `shipyard:run-task` to run it straight away.
 */
export function AiResolveHost() {
  const [task, setTask] = useState<Task | null>(null)
  const runAiResolve = useAiResolve()

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Task>).detail
      if (detail) setTask(detail)
    }
    const direct = (e: Event) => {
      const detail = (e as CustomEvent<Task>).detail
      if (detail) runAiResolve(detail)
    }
    window.addEventListener('shipyard:run-task-with-agent', handler)
    window.addEventListener('shipyard:run-task', direct)
    return () => {
      window.removeEventListener('shipyard:run-task-with-agent', handler)
      window.removeEventListener('shipyard:run-task', direct)
    }
  }, [runAiResolve])

  return (
    <AiResolveDialog
      task={task}
      open={task !== null}
      onOpenChange={(open) => { if (!open) setTask(null) }}
      onRun={(feedback, agentId) => {
        const target = task
        setTask(null)
        if (target) runAiResolve(target, { feedback: feedback || undefined, agent: agentId || undefined })
      }}
    />
  )
}
