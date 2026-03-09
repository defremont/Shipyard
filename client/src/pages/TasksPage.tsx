import { useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Loader, CheckCircle2, AlertTriangle, ArrowUp, ArrowDown, Minus, Circle, Clock, Search } from 'lucide-react'
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
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Header } from '@/components/layout/Header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { useAllTasks, useUpdateTask, useDeleteTask, useImportAllTasks, type Task } from '@/hooks/useTasks'
import { useProjects, type Project } from '@/hooks/useProjects'
import { buildTaskPrompt } from '@/lib/promptBuilder'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { GripVertical, Trash2, Copy, Check, Download, Upload } from 'lucide-react'

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

const COLUMN_KEYS = new Set(columns.map(c => c.key))

type Priority = Task['priority']
const priorities: { key: Priority; icon: React.ElementType; color: string; label: string }[] = [
  { key: 'urgent', icon: AlertTriangle, color: 'text-red-500 border-red-500/50 bg-red-500/10', label: 'Urgent' },
  { key: 'high', icon: ArrowUp, color: 'text-orange-500 border-orange-500/50 bg-orange-500/10', label: 'High' },
  { key: 'medium', icon: Minus, color: 'text-blue-500 border-blue-500/50 bg-blue-500/10', label: 'Medium' },
  { key: 'low', icon: ArrowDown, color: 'text-muted-foreground border-muted-foreground/50 bg-muted', label: 'Low' },
]

const priorityConfig = {
  urgent: { icon: AlertTriangle, color: 'text-red-500' },
  high: { icon: ArrowUp, color: 'text-orange-500' },
  medium: { icon: Minus, color: 'text-blue-500' },
  low: { icon: ArrowDown, color: 'text-red-500' },
}

function GlobalTaskCard({ task, project, tasksDir, onStatusToggle, onDelete }: {
  task: Task
  project?: Project
  tasksDir?: string
  onStatusToggle: (task: Task) => void
  onDelete: (task: Task) => void
}) {
  const pri = priorityConfig[task.priority]
  const PriIcon = pri.icon
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleCopy = () => {
    const prompt = buildTaskPrompt(task, project?.name, project?.path, tasksDir)
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
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => setDeleteOpen(true)} title="Delete">
            <Trash2 className="h-3 w-3" />
          </Button>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete task?</AlertDialogTitle>
              <AlertDialogDescription>
                "{task.title}" will be permanently deleted. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete(task)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}

function DroppableColumn({ col, children, count, taskIds }: { col: ColumnConfig; children: React.ReactNode; count: number; taskIds: string[] }) {
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
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </div>
    </div>
  )
}

function SortableGlobalTask({ task, project, tasksDir, onStatusToggle, onDelete }: {
  task: Task
  project?: Project
  tasksDir?: string
  onStatusToggle: (task: Task) => void
  onDelete: (task: Task) => void
}) {
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
      className={cn('flex items-start gap-1', isDragging && 'opacity-30')}
      {...attributes}
    >
      <button className="mt-3 cursor-grab active:cursor-grabbing text-muted-foreground/40 shrink-0" {...listeners}>
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <GlobalTaskCard task={task} project={project} tasksDir={tasksDir} onStatusToggle={onStatusToggle} onDelete={onDelete} />
      </div>
    </div>
  )
}

export function TasksPage() {
  const { data: tasks } = useAllTasks()
  const { data: projects } = useProjects()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity })
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const importAllTasks = useImportAllTasks()
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [search, setSearch] = useState('')
  const [priorityFilters, setPriorityFilters] = useState<Set<Priority>>(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>()
    for (const p of projects || []) m.set(p.id, p)
    return m
  }, [projects])

  const togglePriority = useCallback((p: Priority) => {
    setPriorityFilters(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }, [])

  const filteredTasks = useMemo(() => {
    if (!tasks) return []
    let filtered = tasks
    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        projectMap.get(t.projectId)?.name.toLowerCase().includes(q)
      )
    }
    if (priorityFilters.size > 0) {
      filtered = filtered.filter(t => priorityFilters.has(t.priority))
    }
    return filtered
  }, [tasks, search, priorityFilters, projectMap])

  const grouped = useMemo(() => {
    const result: Record<string, Task[]> = { inbox: [], in_progress: [], done: [] }

    for (const task of filteredTasks) {
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
  }, [filteredTasks])

  const findColumnForTask = useCallback((taskId: string): string | undefined => {
    for (const [key, colTasks] of Object.entries(grouped)) {
      if (colTasks.some(t => t.id === taskId)) return key
    }
    return undefined
  }, [grouped])

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

    // Dropped on another task — check if cross-column move
    const overCol = findColumnForTask(over.id as string)
    if (!overCol) return

    const targetCol = columns.find(c => c.key === overCol)
    if (targetCol && !targetCol.statuses.includes(task.status)) {
      updateTask.mutate({ projectId: task.projectId, taskId: task.id, status: targetCol.dropStatus })
    }
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

  const hasFilters = search.trim() || priorityFilters.size > 0

  return (
    <>
      <Header title="All Tasks" />
      <div className="flex-1 overflow-hidden p-6">
        {/* Filters */}
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-1.5">
            {priorities.map(p => {
              const Icon = p.icon
              const active = priorityFilters.has(p.key)
              return (
                <button
                  key={p.key}
                  onClick={() => togglePriority(p.key)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium transition-colors',
                    active ? p.color : 'border-transparent text-muted-foreground hover:bg-accent'
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {p.label}
                </button>
              )
            })}
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setSearch(''); setPriorityFilters(new Set()) }}>
              Clear
            </Button>
          )}
          <div className="flex-1" />
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
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="grid grid-cols-3 gap-4 h-full">
            {columns.map(col => {
              const colTasks = grouped[col.key] || []
              const taskIds = colTasks.map(t => t.id)
              return (
                <DroppableColumn key={col.key} col={col} count={colTasks.length} taskIds={taskIds}>
                  {colTasks.length > 0 ? (
                    colTasks.map(task => (
                      <SortableGlobalTask
                        key={task.id}
                        task={task}
                        project={projectMap.get(task.projectId)}
                        tasksDir={settings?.tasksDir}
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
                  tasksDir={settings?.tasksDir}
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
