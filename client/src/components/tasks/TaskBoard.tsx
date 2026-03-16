import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { Plus, Inbox, Loader, CheckCircle2, FileSpreadsheet, Copy, ArrowUpDown, Import, LayoutGrid, List, Sparkles, ChevronDown, CheckCheck, Eye, EyeOff } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  useDroppable,
  pointerWithin,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TaskItem } from './TaskItem'
import { TaskEditor } from './TaskEditor'
import { TaskViewer } from './TaskViewer'
import { TaskListView } from './TaskListView'
import { CsvReviewDialog } from './CsvReviewDialog'
import { BulkImportDialog } from './BulkImportDialog'
import { SheetSyncPanel } from './SheetSyncPanel'
import { SyncPanelExports } from '@/components/sync/SyncPanel'
import { useTasks, useUpdateTask, useReorderTasks, useCreateTask, type Task } from '@/hooks/useTasks'
import { useTerminalStatus } from '@/hooks/useTerminal'
import { tasksToCSV, parseCSV, diffTasks, type CsvDiff } from '@/lib/csv'
import { buildColumnPrompt } from '@/lib/promptBuilder'
import { useAutoSync } from '@/hooks/useSheetSync'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const INITIAL_VISIBLE = 15
const LOAD_MORE_COUNT = 15

type SortOption = 'priority' | 'newest' | 'oldest' | 'updated'
const SORT_OPTIONS: { key: SortOption; label: string }[] = [
  { key: 'priority', label: 'Priority' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'updated', label: 'Recently updated' },
]

function sortTasks(tasks: Task[], sort: SortOption): Task[] {
  const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
  return [...tasks].sort((a, b) => {
    switch (sort) {
      case 'priority': {
        const pd = priorityOrder[a.priority] - priorityOrder[b.priority]
        return pd !== 0 ? pd : a.order - b.order
      }
      case 'newest':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      case 'oldest':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      case 'updated':
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      default:
        return a.order - b.order
    }
  })
}

function InlineTaskInput({ projectId, status, onClose }: { projectId: string; status: Task['status']; onClose: () => void }) {
  const [value, setValue] = useState('')
  const createTask = useCreateTask()
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = () => {
    if (!value.trim()) return
    createTask.mutate(
      { projectId, title: value.trim(), description: '', priority: 'medium', status },
      {
        onSuccess: () => {
          toast.success(`Task created: ${value.trim()}`)
          setValue('')
          inputRef.current?.focus()
        },
      }
    )
  }

  return (
    <input
      ref={inputRef}
      autoFocus
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter' && value.trim()) handleSubmit()
        if (e.key === 'Escape') onClose()
      }}
      onBlur={() => { if (!value.trim()) onClose() }}
      placeholder="Task title... (Enter to add, Esc to cancel)"
      className="w-full text-xs bg-background border rounded px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
    />
  )
}

interface TaskBoardProps {
  projectId: string
  projectName: string
  projectPath?: string
}

interface ColumnConfig {
  key: string
  label: string
  icon: React.ElementType
  statuses: Task['status'][]
  dropStatus: Task['status']
  color: string
}

const columns: ColumnConfig[] = [
  {
    key: 'inbox',
    label: 'Inbox',
    icon: Inbox,
    statuses: ['backlog', 'todo'],
    dropStatus: 'todo',
    color: 'text-blue-500',
  },
  {
    key: 'in_progress',
    label: 'In Progress',
    icon: Loader,
    statuses: ['in_progress'],
    dropStatus: 'in_progress',
    color: 'text-yellow-500',
  },
  {
    key: 'done',
    label: 'Done',
    icon: CheckCircle2,
    statuses: ['done'],
    dropStatus: 'done',
    color: 'text-green-500',
  },
]

const COLUMN_KEYS = new Set(columns.map(c => c.key))

// Custom collision detection: prioritize sortable items over column containers
const itemsFirstCollision: CollisionDetection = (args) => {
  // First try pointerWithin to find containers the pointer is inside
  const pointerCollisions = pointerWithin(args)

  if (pointerCollisions.length > 0) {
    // Filter to only sortable items (not column containers)
    const itemCollisions = pointerCollisions.filter(c => !COLUMN_KEYS.has(c.id as string))
    if (itemCollisions.length > 0) {
      // Among items, pick the closest center
      const itemIds = new Set(itemCollisions.map(c => c.id))
      const itemContainers = args.droppableContainers.filter(c => itemIds.has(c.id))
      return closestCenter({ ...args, droppableContainers: itemContainers })
    }
    // No items found — return the column container
    return pointerCollisions.filter(c => COLUMN_KEYS.has(c.id as string))
  }

  // Fallback: closestCenter across everything
  return closestCenter(args)
}

function DroppableColumn({ col, children, count, taskIds, onCopy, projectId, onAddingChange, isAdding, hiddenCount, onShowMore }: {
  col: ColumnConfig; children: React.ReactNode; count: number; taskIds: string[]
  onCopy?: () => void; projectId?: string; onAddingChange?: (adding: boolean) => void; isAdding?: boolean
  hiddenCount?: number; onShowMore?: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key })
  const Icon = col.icon

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-lg border bg-muted/30 min-h-[200px] transition-colors',
        isOver && 'border-primary/50 bg-primary/5'
      )}
    >
      <div className="flex items-center gap-2 p-3 border-b">
        <Icon className={cn('h-4 w-4', col.color)} />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {col.label}
        </h3>
        <span className="text-xs text-muted-foreground">({count})</span>
        {onCopy && count > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={onCopy} className="ml-auto text-muted-foreground/40 hover:text-foreground transition-colors">
                <Copy className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {col.key === 'inbox' ? 'Copy inbox tasks as prompt — organize and detail' :
               col.key === 'in_progress' ? 'Copy in-progress tasks as prompt — resolve them' :
               'Copy done tasks as prompt — verify completion'}
            </TooltipContent>
          </Tooltip>
        )}
        {projectId && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => onAddingChange?.(!isAdding)}
                className={cn(
                  'text-muted-foreground/40 hover:text-foreground transition-colors',
                  !onCopy || count === 0 ? 'ml-auto' : ''
                )}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Quick add task</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex-1 p-2 space-y-2">
        {isAdding && projectId && (
          <InlineTaskInput
            projectId={projectId}
            status={col.dropStatus}
            onClose={() => onAddingChange?.(false)}
          />
        )}
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
        {hiddenCount != null && hiddenCount > 0 && onShowMore && (
          <button
            onClick={onShowMore}
            className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
          >
            <ChevronDown className="h-3 w-3" />
            Show {hiddenCount} more
          </button>
        )}
      </div>
    </div>
  )
}

function SortableTaskItem({ task, projectName, projectPath, onEdit, onView, onAiResolve }: { task: Task; projectName?: string; projectPath?: string; onEdit: (task: Task) => void; onView: (task: Task) => void; onAiResolve?: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && 'opacity-30')}
      {...attributes}
    >
      <TaskItem
        task={task}
        projectName={projectName}
        projectPath={projectPath}
        onEdit={onEdit}
        onView={onView}
        onAiResolve={onAiResolve}
        dragListeners={listeners as unknown as Record<string, Function>}
      />
    </div>
  )
}

export function TaskBoard({ projectId, projectName, projectPath }: TaskBoardProps) {
  const { data: tasks, isLoading } = useTasks(projectId)
  const { isSyncing } = useAutoSync(projectId)
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity })
  const { data: terminalStatus } = useTerminalStatus()
  const updateTask = useUpdateTask()
  const reorderTasks = useReorderTasks()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewingTask, setViewingTask] = useState<Task | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [csvReviewOpen, setCsvReviewOpen] = useState(false)
  const [csvDiff, setCsvDiff] = useState<CsvDiff | null>(null)
  const [sortBy, setSortBy] = useState<SortOption>(() =>
    (localStorage.getItem(`shipyard:sort:${projectId}`) as SortOption) || 'updated'
  )
  const [addingInColumn, setAddingInColumn] = useState<string | null>(null)
  const [bulkImportOpen, setBulkImportOpen] = useState(false)
  const [doneReadAt, setDoneReadAt] = useState<string | null>(() =>
    localStorage.getItem(`shipyard:done-read:${projectId}`)
  )
  const [showReadDone, setShowReadDone] = useState(false)
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>(() =>
    (localStorage.getItem('shipyard:view:' + projectId) as 'kanban' | 'list') || 'kanban'
  )
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({
    inbox: INITIAL_VISIBLE,
    in_progress: INITIAL_VISIBLE,
    done: INITIAL_VISIBLE,
  })

  // Reset visible counts when project changes
  useEffect(() => {
    setVisibleCounts({ inbox: INITIAL_VISIBLE, in_progress: INITIAL_VISIBLE, done: INITIAL_VISIBLE })
  }, [projectId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const handleView = useCallback((task: Task) => {
    setViewingTask(task)
    setViewerOpen(true)
  }, [])

  const handleEdit = useCallback((task: Task) => {
    setEditingTask(task)
    setEditorOpen(true)
  }, [])

  const handleNew = () => {
    setEditingTask(null)
    setEditorOpen(true)
  }

  const handleAiResolve = useCallback(async (task: Task) => {
    if (!terminalStatus?.available) {
      toast.error('Integrated terminal required for AI resolution')
      return
    }
    try {
      const { prompt } = await api.getAiResolvePrompt(projectId, task.id)
      window.dispatchEvent(new CustomEvent('shipyard:open-terminal', {
        detail: { projectId, type: 'ai-resolve', taskId: task.id, taskNumber: task.number, prompt }
      }))
      toast.success('AI resolution started')
    } catch (err: any) {
      toast.error(err.message || 'Failed to start AI resolution')
    }
  }, [projectId, terminalStatus])

  const handleCsvExport = () => {
    if (!tasks?.length) { toast.info('No tasks to export'); return }
    const csv = tasksToCSV(tasks)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tasks-${projectId}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${tasks.length} tasks as CSV`)
  }

  const handleCsvImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const rows = parseCSV(text)
        if (rows.length === 0) { toast.error('No valid rows found in CSV'); return }
        const diff = diffTasks(tasks || [], rows)
        setCsvDiff(diff)
        setCsvReviewOpen(true)
      } catch { toast.error('Failed to read CSV file') }
    }
    input.click()
  }

  const grouped = useMemo(() => {
    const result: Record<string, Task[]> = { inbox: [], in_progress: [], done: [] }
    if (!tasks) return result

    for (const task of tasks) {
      if (task.status === 'done') result.done.push(task)
      else if (task.status === 'in_progress') result.in_progress.push(task)
      else result.inbox.push(task)
    }

    for (const key of Object.keys(result)) {
      result[key] = sortTasks(result[key], sortBy)
    }

    return result
  }, [tasks, sortBy])

  // Split done tasks into unread and read based on doneReadAt timestamp
  const { unreadDone, readDone } = useMemo(() => {
    const allDone = grouped.done || []
    if (!doneReadAt) return { unreadDone: allDone, readDone: [] as Task[] }
    const cutoff = new Date(doneReadAt).getTime()
    const unread: Task[] = []
    const read: Task[] = []
    for (const task of allDone) {
      const doneTime = task.doneAt ? new Date(task.doneAt).getTime() : 0
      if (doneTime <= cutoff) read.push(task)
      else unread.push(task)
    }
    return { unreadDone: unread, readDone: read }
  }, [grouped.done, doneReadAt])

  const handleMarkAllRead = useCallback(() => {
    const now = new Date().toISOString()
    localStorage.setItem(`shipyard:done-read:${projectId}`, now)
    setDoneReadAt(now)
    setShowReadDone(false)
    toast.success(`Marked ${unreadDone.length} tasks as read`)
  }, [projectId, unreadDone.length])

  const findColumnForTask = useCallback((taskId: string): string | undefined => {
    for (const [key, colTasks] of Object.entries(grouped)) {
      if (colTasks.some(t => t.id === taskId)) return key
    }
    return undefined
  }, [grouped])

  const handleShowMore = useCallback((colKey: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [colKey]: (prev[colKey] || INITIAL_VISIBLE) + LOAD_MORE_COUNT,
    }))
  }, [])

  const handleCopyColumn = useCallback((colKey: string) => {
    if (!projectPath || !projectName) return
    const colTasks = grouped[colKey] || []
    const prompt = buildColumnPrompt(colKey as 'inbox' | 'in_progress' | 'done', colTasks, projectName, projectPath, projectId, settings?.tasksDir || '')
    if (!prompt) { toast.info('No tasks in this column'); return }
    navigator.clipboard.writeText(prompt)
    toast.success('Copied to clipboard')
  }, [grouped, projectName, projectPath, projectId, settings?.tasksDir])

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTask(event.active.data.current?.task || null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)
    if (!over || active.id === over.id) return

    const task = active.data.current?.task as Task
    if (!task) return

    // Dropped on a column directly (empty column)
    if (COLUMN_KEYS.has(over.id as string)) {
      const targetColumn = columns.find(c => c.key === over.id)!
      if (!targetColumn.statuses.includes(task.status)) {
        updateTask.mutate({ projectId: task.projectId, taskId: task.id, status: targetColumn.dropStatus })
      }
      return
    }

    // Dropped on another task
    const activeCol = findColumnForTask(active.id as string)
    const overCol = findColumnForTask(over.id as string)

    if (!activeCol || !overCol) return

    if (activeCol === overCol) {
      // Same column — reorder
      const colTasks = grouped[activeCol]
      const oldIndex = colTasks.findIndex(t => t.id === active.id)
      const newIndex = colTasks.findIndex(t => t.id === over.id)
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const reordered = arrayMove(colTasks, oldIndex, newIndex)
        // Build full task order: reordered column + other columns unchanged
        const allIds: string[] = []
        for (const col of columns) {
          if (col.key === activeCol) {
            allIds.push(...reordered.map(t => t.id))
          } else {
            allIds.push(...(grouped[col.key] || []).map(t => t.id))
          }
        }
        reorderTasks.mutate({ projectId, taskIds: allIds })
      }
    } else {
      // Different column — move status
      const targetCol = columns.find(c => c.key === overCol)
      if (targetCol && !targetCol.statuses.includes(task.status)) {
        updateTask.mutate({ projectId: task.projectId, taskId: task.id, status: targetCol.dropStatus })
      }
    }
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground p-4">Loading tasks...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-1.5">
          Tasks ({tasks?.length || 0})
          {isSyncing && <Loader className="h-3 w-3 animate-spin text-muted-foreground" />}
        </h2>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleCsvExport}>
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export as CSV spreadsheet (for sharing with clients or team)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={handleCsvImport}>
                <FileSpreadsheet className="h-3.5 w-3.5" />
                Import CSV
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import CSV with diff review — compare and merge changes</TooltipContent>
          </Tooltip>
          <div className="w-px h-4 bg-border mx-0.5" />
          <SyncPanelExports projectId={projectId} tasks={tasks || []} />
          <div className="w-px h-4 bg-border mx-0.5" />
          <SheetSyncPanel projectId={projectId} tasks={tasks || []} />
          <div className="w-px h-4 bg-border mx-0.5" />
          <div className="flex items-center border rounded-md">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setViewMode('kanban'); localStorage.setItem('shipyard:view:' + projectId, 'kanban') }}
                  className={cn('p-1.5 rounded-l-md transition-colors', viewMode === 'kanban' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Kanban view</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setViewMode('list'); localStorage.setItem('shipyard:view:' + projectId, 'list') }}
                  className={cn('p-1.5 rounded-r-md transition-colors', viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>List view</TooltipContent>
            </Tooltip>
          </div>
          <div className="w-px h-4 bg-border mx-0.5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <select
                value={sortBy}
                onChange={e => {
                  const v = e.target.value as SortOption
                  setSortBy(v)
                  localStorage.setItem(`shipyard:sort:${projectId}`, v)
                }}
                className="h-7 text-xs bg-background border rounded px-1.5 cursor-pointer outline-none"
              >
                {SORT_OPTIONS.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </TooltipTrigger>
            <TooltipContent>Sort tasks within columns</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => setBulkImportOpen(true)}>
                <Import className="h-3.5 w-3.5" />
                Import
              </Button>
            </TooltipTrigger>
            <TooltipContent>Paste text or list — AI organizes into tasks</TooltipContent>
          </Tooltip>
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleNew}>
            <Plus className="h-3.5 w-3.5" />
            New Task
          </Button>
        </div>
      </div>

      {viewMode === 'kanban' ? (
        <DndContext
          sensors={sensors}
          collisionDetection={itemsFirstCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-3 gap-3">
            {columns.map(col => {
              const isDoneCol = col.key === 'done'
              const colTasks = grouped[col.key] || []
              // For done column: show unread tasks, optionally show read tasks
              const visibleUnread = isDoneCol ? unreadDone : colTasks
              const limit = visibleCounts[col.key] || INITIAL_VISIBLE
              const visibleTasks = isDoneCol ? visibleUnread : colTasks.slice(0, limit)
              const hiddenCount = isDoneCol ? 0 : colTasks.length - visibleTasks.length
              // Include read done task IDs in SortableContext so DnD works when expanded
              const allVisibleTasks = isDoneCol && showReadDone
                ? [...visibleTasks, ...readDone]
                : visibleTasks
              const taskIds = allVisibleTasks.map(t => t.id)
              return (
                <DroppableColumn
                  key={col.key} col={col} count={colTasks.length} taskIds={taskIds}
                  onCopy={() => handleCopyColumn(col.key)}
                  projectId={projectId}
                  isAdding={addingInColumn === col.key}
                  onAddingChange={(adding) => setAddingInColumn(adding ? col.key : null)}
                  hiddenCount={hiddenCount}
                  onShowMore={() => handleShowMore(col.key)}
                  headerExtra={isDoneCol && unreadDone.length > 0 ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleMarkAllRead}
                          className="text-muted-foreground/40 hover:text-green-500 transition-colors"
                        >
                          <CheckCheck className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Mark all as read</TooltipContent>
                    </Tooltip>
                  ) : undefined}
                >
                  {allVisibleTasks.length > 0 ? (
                    <>
                      {visibleTasks.map(task => (
                        <SortableTaskItem
                          key={task.id}
                          task={task}
                          projectName={projectName}
                          projectPath={projectPath}
                          onEdit={handleEdit}
                          onView={handleView}
                          onAiResolve={terminalStatus?.available ? handleAiResolve : undefined}
                        />
                      ))}
                      {isDoneCol && readDone.length > 0 && (
                        <button
                          onClick={() => setShowReadDone(!showReadDone)}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30 rounded transition-colors"
                        >
                          {showReadDone ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          {showReadDone ? 'Hide' : 'Show'} {readDone.length} read
                        </button>
                      )}
                      {isDoneCol && showReadDone && readDone.map(task => (
                        <div key={task.id} className="opacity-40">
                          <SortableTaskItem
                            task={task}
                            projectName={projectName}
                            projectPath={projectPath}
                            onEdit={handleEdit}
                            onView={handleView}
                            onAiResolve={terminalStatus?.available ? handleAiResolve : undefined}
                          />
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      {isDoneCol && readDone.length > 0 ? (
                        <button
                          onClick={() => setShowReadDone(!showReadDone)}
                          className="w-full flex items-center justify-center gap-1.5 py-6 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent/30 rounded transition-colors"
                        >
                          {showReadDone ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                          {showReadDone ? 'Hide' : 'Show'} {readDone.length} read
                        </button>
                      ) : (
                        <div className="text-xs text-muted-foreground/50 py-6 text-center">
                          Drop tasks here
                        </div>
                      )}
                      {isDoneCol && showReadDone && readDone.map(task => (
                        <div key={task.id} className="opacity-40">
                          <SortableTaskItem
                            task={task}
                            projectName={projectName}
                            projectPath={projectPath}
                            onEdit={handleEdit}
                            onView={handleView}
                            onAiResolve={terminalStatus?.available ? handleAiResolve : undefined}
                          />
                        </div>
                      ))}
                    </>
                  )}
                </DroppableColumn>
              )
            })}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeTask && (
              <div className="opacity-90 rotate-2">
                <TaskItem task={activeTask} onEdit={() => {}} />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      ) : (
        <TaskListView
          tasks={tasks || []}
          projectName={projectName}
          projectPath={projectPath}
          onEdit={handleEdit}
          onView={handleView}
        />
      )}

      <TaskViewer
        task={viewingTask}
        projectName={projectName}
        projectPath={projectPath}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        onEdit={handleEdit}
      />

      <TaskEditor
        projectId={projectId}
        task={editingTask}
        open={editorOpen}
        onOpenChange={setEditorOpen}
      />

      <BulkImportDialog
        projectId={projectId}
        open={bulkImportOpen}
        onOpenChange={setBulkImportOpen}
      />

      {csvDiff && (
        <CsvReviewDialog
          open={csvReviewOpen}
          onOpenChange={setCsvReviewOpen}
          diff={csvDiff}
          projectId={projectId}
        />
      )}
    </div>
  )
}
