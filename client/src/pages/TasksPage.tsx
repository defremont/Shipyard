import { useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Loader, CheckCircle2, AlertTriangle, ArrowUp, ArrowDown, Minus, Circle, Clock } from 'lucide-react'
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
import { Header } from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAllTasks, useUpdateTask, useDeleteTask, useImportAllTasks, type Task } from '@/hooks/useTasks'
import { useProjects, type Project } from '@/hooks/useProjects'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { GripVertical, Pencil, Trash2, Copy, Check, Download, Upload } from 'lucide-react'

interface ColumnConfig {
  key: string
  label: string
  icon: React.ElementType
  statuses: Task['status'][]
  dropStatus: Task['status']
  color: string
}

const columns: ColumnConfig[] = [
  { key: 'inbox', label: 'Inbox', icon: Inbox, statuses: ['backlog', 'todo'], dropStatus: 'todo', color: 'text-blue-500' },
  { key: 'in_progress', label: 'In Progress', icon: Loader, statuses: ['in_progress'], dropStatus: 'in_progress', color: 'text-yellow-500' },
  { key: 'done', label: 'Done', icon: CheckCircle2, statuses: ['done'], dropStatus: 'done', color: 'text-green-500' },
]

const priorityConfig = {
  urgent: { icon: AlertTriangle, color: 'text-red-500' },
  high: { icon: ArrowUp, color: 'text-orange-500' },
  medium: { icon: Minus, color: 'text-blue-500' },
  low: { icon: ArrowDown, color: 'text-red-500' },
}

function GlobalTaskCard({ task, project, onStatusToggle, onDelete }: {
  task: Task
  project?: Project
  onStatusToggle: (task: Task) => void
  onDelete: (task: Task) => void
}) {
  const pri = priorityConfig[task.priority]
  const PriIcon = pri.icon

  const handleCopy = () => {
    const prompt = task.promptTemplate ||
      `Task: ${task.title}\n${task.description ? `\nDescription: ${task.description}` : ''}${project ? `\nProject: ${project.name}` : ''}`
    navigator.clipboard.writeText(prompt)
    toast.success('Copied to clipboard')
  }

  return (
    <div className={cn(
      'group flex items-start gap-2 p-2.5 rounded-lg border bg-card transition-colors hover:border-primary/30',
      task.status === 'done' && 'opacity-60'
    )}>
      <button onClick={() => onStatusToggle(task)} className="mt-0.5 shrink-0">
        {task.status === 'done' ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <PriIcon className={cn('h-3 w-3 shrink-0', pri.color)} />
          <span className={cn('text-sm font-medium truncate', task.status === 'done' && 'line-through')}>
            {task.title}
          </span>
        </div>
        {task.description && (
          <p className="text-xs text-muted-foreground line-clamp-1 mb-1">{task.description}</p>
        )}
        <div className="flex items-center gap-2">
          {project && (
            <Link to={`/project/${project.id}`}>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 hover:bg-accent">
                {project.name}
              </Badge>
            </Link>
          )}
          {task.createdAt && !isNaN(new Date(task.createdAt).getTime()) && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
              <Clock className="h-2.5 w-2.5" />
              {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopy} title="Copy as prompt">
          <Copy className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => onDelete(task)} title="Delete">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

function DroppableColumn({ col, children, count }: { col: ColumnConfig; children: React.ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: col.key })
  const Icon = col.icon

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col rounded-lg border bg-muted/30 min-h-[400px] transition-colors',
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
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

function DraggableGlobalTask({ task, project, onStatusToggle, onDelete }: {
  task: Task
  project?: Project
  onStatusToggle: (task: Task) => void
  onDelete: (task: Task) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn('flex items-start gap-1', isDragging && 'opacity-30')}
      {...attributes}
    >
      <button className="mt-3 cursor-grab active:cursor-grabbing text-muted-foreground/40 shrink-0" {...listeners}>
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <GlobalTaskCard task={task} project={project} onStatusToggle={onStatusToggle} onDelete={onDelete} />
      </div>
    </div>
  )
}

export function TasksPage() {
  const { data: tasks } = useAllTasks()
  const { data: projects } = useProjects()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const importAllTasks = useImportAllTasks()
  const [activeTask, setActiveTask] = useState<Task | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>()
    for (const p of projects || []) m.set(p.id, p)
    return m
  }, [projects])

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

  const handleStatusToggle = useCallback((task: Task) => {
    const nextStatus = task.status === 'done' ? 'todo' :
                       task.status === 'todo' ? 'in_progress' :
                       task.status === 'in_progress' ? 'done' : 'todo'
    updateTask.mutate({ projectId: task.projectId, taskId: task.id, status: nextStatus })
  }, [updateTask])

  const handleDelete = useCallback((task: Task) => {
    deleteTask.mutate({ projectId: task.projectId, taskId: task.id })
  }, [deleteTask])

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

  const handleExportAll = () => {
    if (!tasks?.length) { toast.info('No tasks to export'); return }
    const data = { exportedAt: new Date().toISOString(), source: 'devdash', tasks }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tasks-all-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportAll = () => {
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
        const withProject = list.filter((t: any) => t.projectId)
        if (withProject.length === 0) { toast.error('No tasks with projectId found'); return }
        importAllTasks.mutate(withProject, {
          onSuccess: (res: any) => toast.success(`Imported ${res.imported} tasks`),
          onError: () => toast.error('Failed to import tasks'),
        })
      } catch { toast.error('Failed to read file') }
    }
    input.click()
  }

  return (
    <>
      <Header title="All Tasks" />
      <div className="flex-1 overflow-hidden p-6">
        <div className="flex items-center justify-end gap-1 mb-4">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleExportAll}>
            <Download className="h-3.5 w-3.5" />
            Export All
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleImportAll}>
            <Upload className="h-3.5 w-3.5" />
            Import
          </Button>
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-3 gap-4 h-full">
            {columns.map(col => {
              const colTasks = grouped[col.key] || []
              return (
                <DroppableColumn key={col.key} col={col} count={colTasks.length}>
                  {colTasks.length > 0 ? (
                    colTasks.map(task => (
                      <DraggableGlobalTask
                        key={task.id}
                        task={task}
                        project={projectMap.get(task.projectId)}
                        onStatusToggle={handleStatusToggle}
                        onDelete={handleDelete}
                      />
                    ))
                  ) : (
                    <div className="text-xs text-muted-foreground/50 py-8 text-center">
                      No tasks
                    </div>
                  )}
                </DroppableColumn>
              )
            })}
          </div>

          <DragOverlay>
            {activeTask && (
              <div className="opacity-90 rotate-2 max-w-sm">
                <GlobalTaskCard
                  task={activeTask}
                  project={projectMap.get(activeTask.projectId)}
                  onStatusToggle={() => {}}
                  onDelete={() => {}}
                />
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>
    </>
  )
}
