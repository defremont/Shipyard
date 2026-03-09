import { useState, useCallback, useMemo } from 'react'
import { Plus, Inbox, Loader, CheckCircle2, Download, Upload } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  useDroppable,
  useDraggable,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { Button } from '@/components/ui/button'
import { TaskItem } from './TaskItem'
import { TaskEditor } from './TaskEditor'
import { useTasks, useUpdateTask, useImportTasks, type Task } from '@/hooks/useTasks'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface TaskBoardProps {
  projectId: string
  projectName: string
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

function DroppableColumn({ col, children, count }: { col: ColumnConfig; children: React.ReactNode; count: number }) {
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
        {children}
      </div>
    </div>
  )
}

function DraggableTaskItem({ task, projectName, onEdit }: { task: Task; projectName?: string; onEdit: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(isDragging && 'opacity-30')}
      {...attributes}
    >
      <TaskItem
        task={task}
        projectName={projectName}
        onEdit={onEdit}
        dragListeners={listeners as unknown as Record<string, Function>}
      />
    </div>
  )
}

export function TaskBoard({ projectId, projectName }: TaskBoardProps) {
  const { data: tasks, isLoading } = useTasks(projectId)
  const updateTask = useUpdateTask()
  const importTasks = useImportTasks()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

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

  const handleDragStart = (event: DragStartEvent) => {
    setActiveTask(event.active.data.current?.task || null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    setActiveTask(null)
    if (!over) return

    const task = active.data.current?.task as Task
    if (!task) return

    const targetColumn = columns.find(c => c.key === over.id)
    if (!targetColumn) return

    if (targetColumn.statuses.includes(task.status)) return

    updateTask.mutate({
      projectId: task.projectId,
      taskId: task.id,
      status: targetColumn.dropStatus,
    })
  }

  if (isLoading) {
    return <div className="text-sm text-muted-foreground p-4">Loading tasks...</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tasks ({tasks?.length || 0})</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleExport} title="Export tasks">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleImport} title="Import tasks">
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" className="h-7 gap-1 text-xs" onClick={handleNew}>
            <Plus className="h-3.5 w-3.5" />
            New Task
          </Button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-3 gap-3">
          {columns.map(col => {
            const colTasks = grouped[col.key] || []
            return (
              <DroppableColumn key={col.key} col={col} count={colTasks.length}>
                {colTasks.length > 0 ? (
                  colTasks.map(task => (
                    <DraggableTaskItem
                      key={task.id}
                      task={task}
                      projectName={projectName}
                      onEdit={handleEdit}
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

      <TaskEditor
        projectId={projectId}
        task={editingTask}
        open={editorOpen}
        onOpenChange={setEditorOpen}
      />
    </div>
  )
}
