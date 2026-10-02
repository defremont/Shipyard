import { lazy, memo, Suspense, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Play, Plus, SquareTerminal } from 'lucide-react'
import { useTasks, type Task } from '@/hooks/useTasks'
import { useProjects } from '@/hooks/useProjects'
import { useActiveMilestone } from '@/hooks/useMilestones'
import { useAiResolve } from '@/hooks/useAiResolve'
import { useTerminalTabs, type TerminalTabInfo } from '@/hooks/useTerminalTabs'
import { SessionStatusIcon } from '@/components/terminals/SessionStatusIcon'
import { PRIORITY_CONFIG, priorityVisual } from '@/lib/taskVisuals'
import { cn } from '@/lib/utils'

// The viewer pulls in the review panel and the diff renderer; the rail is on
// screen next to every terminal and must not carry them until a task is opened.
const TaskViewer = lazy(() => import('./TaskViewer').then(m => ({ default: m.TaskViewer })))
const TaskEditor = lazy(() => import('./TaskEditor').then(m => ({ default: m.TaskEditor })))

type SectionKey = 'in_progress' | 'todo' | 'backlog' | 'done'

const SECTIONS: { key: SectionKey; label: string; openByDefault: boolean }[] = [
  { key: 'in_progress', label: 'In Progress', openByDefault: true },
  { key: 'todo', label: 'Inbox', openByDefault: true },
  { key: 'backlog', label: 'Backlog', openByDefault: false },
  { key: 'done', label: 'Done', openByDefault: false },
]

/** Done is a long tail; the rail shows the recent end of it. */
const DONE_LIMIT = 30

function byPriority(a: Task, b: Task): number {
  const diff = PRIORITY_CONFIG[a.priority].order - PRIORITY_CONFIG[b.priority].order
  return diff !== 0 ? diff : a.order - b.order
}

function byDoneAt(a: Task, b: Task): number {
  return (b.doneAt || b.updatedAt).localeCompare(a.doneAt || a.updatedAt)
}

const RailTask = memo(function RailTask({ task, session, onOpen, onRun }: {
  task: Task
  session?: TerminalTabInfo
  onOpen: (task: Task) => void
  onRun: (task: Task, skipDialog: boolean) => void
}) {
  const priority = priorityVisual(task.priority)
  const PriorityIcon = priority.icon
  const done = task.status === 'done'
  const live = session && session.status !== 'exited'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(task) }}
      title={live ? 'Open this task’s terminal' : task.title}
      className="group relative flex cursor-pointer items-start gap-2 rounded-md border border-transparent px-2 py-1.5 transition-colors hover:border-border hover:bg-accent/40"
    >
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {live
          ? <SessionStatusIcon status={session.status} />
          : <PriorityIcon className={cn('h-3 w-3', done ? 'text-muted-foreground/40' : priority.color)} />}
      </span>
      <span className={cn(
        'line-clamp-2 min-w-0 flex-1 text-xs leading-snug',
        done ? 'text-muted-foreground' : 'text-foreground/90'
      )}>
        {task.title}
      </span>
      <span className="mt-0.5 shrink-0 text-[10px] tabular-nums text-muted-foreground/60 transition-opacity group-hover:opacity-0">
        {task.number != null && `#${task.number}`}
        {task.effort ? ` · ${task.effort}p` : ''}
        {done && task.needsReview && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-primary align-middle" />}
      </span>
      {!done && (
        <button
          aria-label={live ? 'Open terminal' : 'Run with AI'}
          title={live ? 'Open terminal' : 'Run with AI (Shift+click skips the dialog)'}
          onClick={(e) => {
            e.stopPropagation()
            if (live) onOpen(task)
            else onRun(task, e.shiftKey)
          }}
          className="absolute right-1.5 top-1 flex h-5 items-center gap-1 rounded bg-foreground px-1.5 text-[10px] font-medium text-background opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
        >
          {live ? <SquareTerminal className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {live ? 'Open' : 'Run'}
        </button>
      )}
    </div>
  )
})

/**
 * The project's tasks as a narrow list beside the terminal and the editor.
 * The board is still there as a full view; this is the part of it that is
 * needed while agents run — what is in progress, what is next, and one click
 * to hand a task to an agent or to jump to the terminal already working on it.
 */
export function TaskRail({ projectId }: { projectId: string }) {
  const { data: projects } = useProjects()
  const project = projects?.find(p => p.id === projectId)
  const { milestoneId } = useActiveMilestone(projectId)
  const { data: tasks } = useTasks(projectId, milestoneId)
  const sessions = useTerminalTabs()
  const runAiResolve = useAiResolve()

  const [open, setOpen] = useState<Record<SectionKey, boolean>>(
    () => Object.fromEntries(SECTIONS.map(s => [s.key, s.openByDefault])) as Record<SectionKey, boolean>
  )
  const [viewing, setViewing] = useState<Task | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)

  const grouped = useMemo(() => {
    const result: Record<SectionKey, Task[]> = { in_progress: [], todo: [], backlog: [], done: [] }
    for (const task of tasks || []) result[task.status].push(task)
    result.in_progress.sort(byPriority)
    result.todo.sort(byPriority)
    result.backlog.sort(byPriority)
    result.done.sort(byDoneAt)
    return result
  }, [tasks])

  const sessionByTask = useMemo(() => {
    const map = new Map<string, TerminalTabInfo>()
    for (const session of sessions) {
      if (session.projectId === projectId && session.taskId) map.set(session.taskId, session)
    }
    return map
  }, [sessions, projectId])

  const handleOpen = (task: Task) => {
    const session = sessionByTask.get(task.id)
    if (session && session.status !== 'exited') {
      window.dispatchEvent(new CustomEvent('shipyard:focus-terminal', { detail: { sessionId: session.sessionId } }))
      return
    }
    setViewing(task)
  }

  const handleRun = (task: Task, skipDialog: boolean) => {
    if (skipDialog) runAiResolve(task)
    else window.dispatchEvent(new CustomEvent('shipyard:run-task-with-agent', { detail: task }))
  }

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r bg-card/30">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-xs font-medium">Tasks</span>
        <span className="text-[10px] tabular-nums text-muted-foreground/60">{tasks?.length ?? ''}</span>
        <button
          onClick={() => setCreating(true)}
          title="New task"
          aria-label="New task"
          className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="scrollbar-dark min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {SECTIONS.map(section => {
          const list = grouped[section.key]
          if (list.length === 0 && section.key !== 'in_progress' && section.key !== 'todo') return null
          const isOpen = open[section.key]
          const shown = section.key === 'done' ? list.slice(0, DONE_LIMIT) : list
          return (
            <div key={section.key} className="mb-1">
              <button
                onClick={() => setOpen(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                className="flex w-full items-center gap-1 px-1.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {section.label}
                <span className="font-normal tabular-nums text-muted-foreground/60">{list.length}</span>
              </button>
              {isOpen && shown.map(task => (
                <RailTask
                  key={task.id}
                  task={task}
                  session={sessionByTask.get(task.id)}
                  onOpen={handleOpen}
                  onRun={handleRun}
                />
              ))}
              {isOpen && list.length === 0 && (
                <div className="px-2 py-1 text-[11px] text-muted-foreground/50">Nothing here</div>
              )}
              {isOpen && shown.length < list.length && (
                <div className="px-2 py-1 text-[11px] text-muted-foreground/50">
                  {list.length - shown.length} older on the board
                </div>
              )}
            </div>
          )
        })}
      </div>

      {(viewing || editing || creating) && (
        <Suspense fallback={null}>
          {viewing && (
            <TaskViewer
              task={viewing}
              projectName={project?.name}
              projectPath={project?.path}
              open
              onOpenChange={(next) => { if (!next) setViewing(null) }}
              onEdit={(task) => { setViewing(null); setEditing(task) }}
            />
          )}
          {(editing || creating) && (
            <TaskEditor
              projectId={projectId}
              task={editing}
              milestoneId={milestoneId}
              open
              onOpenChange={(next) => { if (!next) { setEditing(null); setCreating(false) } }}
            />
          )}
        </Suspense>
      )}
    </aside>
  )
}
