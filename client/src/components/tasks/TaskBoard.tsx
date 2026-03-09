import { useState, useCallback, useMemo } from 'react'
import { Plus, Inbox, Loader, CheckCircle2, Download, Upload, FileSpreadsheet } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  useDroppable,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TaskItem } from './TaskItem'
import { TaskEditor } from './TaskEditor'
import { TaskViewer } from './TaskViewer'
import { CsvReviewDialog } from './CsvReviewDialog'
import { useTasks, useUpdateTask, useReorderTasks, useImportTasks, type Task } from '@/hooks/useTasks'
import { tasksToCSV, parseCSV, diffTasks, type CsvDiff } from '@/lib/csv'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

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

function DroppableColumn({ col, children, count, taskIds }: { col: ColumnConfig; children: React.ReactNode; count: number; taskIds: string[] }) {
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
      </div>
      <div className="flex-1 p-2 space-y-2">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </div>
    </div>
  )
}

function SortableTaskItem({ task, projectName, projectPath, onEdit, onView }: { task: Task; projectName?: string; projectPath?: string; onEdit: (task: Task) => void; onView: (task: Task) => void }) {
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
        dragListeners={listeners as unknown as Record<string, Function>}
      />
    </div>
  )
}

export function TaskBoard({ projectId, projectName, projectPath }: TaskBoardProps) {
  const { data: tasks, isLoading } = useTasks(projectId)
  const updateTask = useUpdateTask()
  const reorderTasks = useReorderTasks()
  const importTasks = useImportTasks()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewingTask, setViewingTask] = useState<Task | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [csvReviewOpen, setCsvReviewOpen] = useState(false)
  const [csvDiff, setCsvDiff] = useState<CsvDiff | null>(null)

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

  const handleExport = () => {
    if (!tasks?.length) { toast.info('No tasks to export'); return }
    const data = { exportedAt: new Date().toISOString(), source: 'devdash', projectId, tasks }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tasks-${projectId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        const list = Array.isArray(data) ? data : data.tasks
        if (!Array.isArray(list)) { toast.error('Invalid format: expected { tasks: [...] }'); return }
        importTasks.mutate({ projectId, tasks: list }, {
          onSuccess: (res: any) => toast.success(`Imported ${res.imported} tasks`),
          onError: () => toast.error('Failed to import tasks'),
        })
      } catch { toast.error('Failed to read file') }
    }
    input.click()
  }

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

    const priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 }
    for (const key of Object.keys(result)) {
      result[key].sort((a, b) => {
        const pd = priorityOrder[a.priority] - priorityOrder[b.priority]
        if (pd !== 0) return pd
        return a.order - b.order
      })
    }

    return result
  }, [tasks])

  const findColumnForTask = useCallback((taskId: string): string | undefined => {
    for (const [key, colTasks] of Object.entries(grouped)) {
      if (colTasks.some(t => t.id === taskId)) return key
    }
    return undefined
  }, [grouped])

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
        <h2 className="text-sm font-semibold">Tasks ({tasks?.length || 0})</h2>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport}>
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Export tasks as JSON (for backup or transfer to another machine)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleImport}>
                <Upload className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Import tasks from a JSON file</TooltipContent>
          </Tooltip>
          <div className="w-px h-4 bg-border mx-0.5" />
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
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleNew}>
            <Plus className="h-3.5 w-3.5" />
            New Task
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-3 gap-3">
          {columns.map(col => {
            const colTasks = grouped[col.key] || []
            const taskIds = colTasks.map(t => t.id)
            return (
              <DroppableColumn key={col.key} col={col} count={colTasks.length} taskIds={taskIds}>
                {colTasks.length > 0 ? (
                  colTasks.map(task => (
                    <SortableTaskItem
                      key={task.id}
                      task={task}
                      projectName={projectName}
                      projectPath={projectPath}
                      onEdit={handleEdit}
                      onView={handleView}
                    />
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground/50 py-6 text-center">
                    Drop tasks here
                  </div>
                )}
              </DroppableColumn>
            )
          })}
        </div>

        <DragOverlay>
          {activeTask && (
            <div className="opacity-90 rotate-2">
              <TaskItem task={activeTask} onEdit={() => {}} />
            </div>
          )}
        </DragOverlay>
      </DndContext>

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
