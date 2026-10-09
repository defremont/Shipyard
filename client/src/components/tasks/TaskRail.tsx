import { lazy, memo, Suspense, useCallback, useMemo, useState } from 'react'
import { ArrowDownUp, Check, ChevronDown, ChevronRight, Play, Plus, SquareTerminal } from 'lucide-react'
import { useTasks, useUpdateTask, type Task } from '@/hooks/useTasks'
import { useProjects } from '@/hooks/useProjects'
import { useActiveMilestone, useMilestones } from '@/hooks/useMilestones'
import { useAiResolve } from '@/hooks/useAiResolve'
import { useTerminalTabs, type TerminalTabInfo } from '@/hooks/useTerminalTabs'
import { SessionStatusIcon } from '@/components/terminals/SessionStatusIcon'
import { PRIORITY_CONFIG, priorityVisual } from '@/lib/taskVisuals'
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

type SortKey = 'updated' | 'priority' | 'board'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'updated', label: 'Last updated' },
  { key: 'priority', label: 'Priority' },
  { key: 'board', label: 'Board order' },
]

const SORT_STORAGE_KEY = 'shipyard:task-rail-sort'

function readSort(): SortKey {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY)
    if (SORTS.some(s => s.key === saved)) return saved as SortKey
  } catch { /* storage unavailable */ }
  return 'updated'
}

function byPriority(a: Task, b: Task): number {
  const diff = PRIORITY_CONFIG[a.priority].order - PRIORITY_CONFIG[b.priority].order
  return diff !== 0 ? diff : a.order - b.order
}

function byUpdatedAt(a: Task, b: Task): number {
  return b.updatedAt.localeCompare(a.updatedAt)
}

function byBoardOrder(a: Task, b: Task): number {
  return a.order - b.order
}

const COMPARATORS: Record<SortKey, (a: Task, b: Task) => number> = {
  updated: byUpdatedAt,
  priority: byPriority,
  board: byBoardOrder,
}

function byDoneAt(a: Task, b: Task): number {
  return (b.doneAt || b.updatedAt).localeCompare(a.doneAt || a.updatedAt)
}

const RailTask = memo(function RailTask({ task, session, onOpen, onRun, onMove, onEdit }: {
  task: Task
  session?: TerminalTabInfo
  onOpen: (task: Task) => void
  onRun: (task: Task, skipDialog: boolean) => void
  onMove: (task: Task, status: SectionKey) => void
  onEdit: (task: Task) => void
}) {
  const priority = priorityVisual(task.priority)
  const PriorityIcon = priority.icon
  const done = task.status === 'done'
  const live = session && session.status !== 'exited'

  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(task) }}
      title={live ? 'Open this task\u2019s terminal' : task.title}
      className={cn(
        'group relative mb-1 flex cursor-pointer items-start gap-2 rounded-md border bg-card px-2 py-1.5 transition-colors hover:border-muted-foreground/30',
        // The task whose agent is waiting is the one thing in the list that
        // asks to be looked at.
        live && session.status === 'question' && 'border-warning/40'
      )}
    >
      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
        {live
          ? <SessionStatusIcon status={session.status} />
          : done
            ? <Check className="h-3 w-3 text-muted-foreground/50" />
            : <PriorityIcon className={cn('h-3 w-3', priority.color)} />}
      </span>
      <span className={cn(
        'line-clamp-2 min-w-0 flex-1 text-xs leading-snug',
        done ? 'text-muted-foreground' : 'text-foreground/90'
      )}>
        {task.title}
      </span>
      <span className="mt-0.5 shrink-0 whitespace-nowrap text-[10px] tabular-nums text-muted-foreground/60 transition-opacity group-hover:opacity-0">
        {task.number != null && `#${task.number}`}
        {task.effort ? ` · ${task.effort}p` : ''}
        {done && task.needsReview && <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-foreground/70 align-middle" />}
      </span>
      {!done && (
        <div className="absolute right-1.5 top-1.5 flex translate-x-1 items-center gap-1 opacity-0 transition-all duration-150 focus-within:translate-x-0 focus-within:opacity-100 group-hover:translate-x-0 group-hover:opacity-100">
          <button
            aria-label="Mark as done"
            title="Mark as done"
            onClick={(e) => { e.stopPropagation(); onMove(task, 'done') }}
            className="flex h-5 w-5 items-center justify-center rounded border bg-card text-muted-foreground transition-colors hover:text-foreground"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            aria-label={live ? 'Open terminal' : 'Run with AI'}
            title={live ? 'Open terminal' : 'Run with AI (Shift+click skips the dialog)'}
            onClick={(e) => {
              e.stopPropagation()
              if (live) onOpen(task)
              else onRun(task, e.shiftKey)
            }}
            className="flex h-5 items-center gap-1 rounded bg-primary px-1.5 text-[10px] font-medium text-primary-foreground"
          >
            {live ? <SquareTerminal className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {live ? 'Open' : 'Run'}
          </button>
        </div>
      )}
    </div>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-44">
      <ContextMenuLabel className="text-[11px] font-normal text-muted-foreground">Move to</ContextMenuLabel>
      {SECTIONS.filter(section => section.key !== task.status).map(section => (
        <ContextMenuItem key={section.key} onSelect={() => onMove(task, section.key)}>
          {section.label}
        </ContextMenuItem>
      ))}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onEdit(task)}>Edit task</ContextMenuItem>
    </ContextMenuContent>
    </ContextMenu>
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
  const { data: milestones } = useMilestones(projectId)
  const milestoneName = milestoneId === 'default'
    ? 'General'
    : milestones?.find(m => m.id === milestoneId)?.name || 'General'
  const sessions = useTerminalTabs()
  const runAiResolve = useAiResolve()
  const { mutate: mutateTask } = useUpdateTask()

  const [sort, setSort] = useState<SortKey>(readSort)
  const [open, setOpen] = useState<Record<SectionKey, boolean>>(
    () => Object.fromEntries(SECTIONS.map(s => [s.key, s.openByDefault])) as Record<SectionKey, boolean>
  )
  const [viewing, setViewing] = useState<Task | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState(false)

  const grouped = useMemo(() => {
    const result: Record<SectionKey, Task[]> = { in_progress: [], todo: [], backlog: [], done: [] }
    for (const task of tasks || []) result[task.status].push(task)
    const compare = COMPARATORS[sort]
    result.in_progress.sort(compare)
    result.todo.sort(compare)
    result.backlog.sort(compare)
    // Done is always newest first: the rail only shows the recent end of it.
    result.done.sort(byDoneAt)
    return result
  }, [tasks, sort])

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

  const handleMove = useCallback((task: Task, status: SectionKey) => {
    mutateTask({ projectId: task.projectId, taskId: task.id, status })
  }, [mutateTask])

  const handleSort = (next: string) => {
    setSort(next as SortKey)
    try { localStorage.setItem(SORT_STORAGE_KEY, next) } catch { /* storage unavailable */ }
  }

  return (
    <aside className="anim-slide flex w-[312px] shrink-0 flex-col border-r bg-background">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <span className="text-[13px] font-semibold">Tasks</span>
        <span className="truncate text-xs text-muted-foreground/70">{milestoneName}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Sort tasks"
              title={`Sorted by ${SORTS.find(s => s.key === sort)?.label.toLowerCase()}`}
              className="ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowDownUp className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={handleSort}>
              {SORTS.map(s => (
                <DropdownMenuRadioItem key={s.key} value={s.key}>{s.label}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          onClick={() => setCreating(true)}
          className="flex h-6 shrink-0 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-3 w-3" />
          New
        </button>
      </div>

      <div className="scrollbar-dark min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {SECTIONS.map(section => {
          const list = grouped[section.key]
          if (list.length === 0 && section.key !== 'in_progress' && section.key !== 'todo') return null
          const isOpen = open[section.key]
          const shown = section.key === 'done' ? list.slice(0, DONE_LIMIT) : list
          return (
            <div key={section.key}>
              <button
                onClick={() => setOpen(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                className="flex w-full items-center gap-1.5 px-1.5 pb-1 pt-2.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {section.label}
                <span className="tabular-nums text-muted-foreground/50">{list.length}</span>
              </button>
              {isOpen && shown.map(task => (
                <RailTask
                  key={task.id}
                  task={task}
                  session={sessionByTask.get(task.id)}
                  onOpen={handleOpen}
                  onRun={handleRun}
                  onMove={handleMove}
                  onEdit={setEditing}
                />
              ))}
              {isOpen && list.length === 0 && (
                <div className="px-2 py-1 text-[11px] text-muted-foreground/40">Nothing here</div>
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
