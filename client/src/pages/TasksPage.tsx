import { useState, useMemo, useCallback } from 'react'
import { Inbox, Loader, CheckCircle2, AlertTriangle, ArrowUp, ArrowDown, Minus, Search, ArrowUpDown, LayoutGrid, List, ChevronDown } from 'lucide-react'
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
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useAllTasks, useUpdateTask, useDeleteTask, type Task } from '@/hooks/useTasks'
import { useProjects, type Project } from '@/hooks/useProjects'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { TaskItem } from '@/components/tasks/TaskItem'
import { TaskEditor } from '@/components/tasks/TaskEditor'
import { TaskViewer } from '@/components/tasks/TaskViewer'
import { TaskListView } from '@/components/tasks/TaskListView'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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
const INITIAL_VISIBLE = 15
const LOAD_MORE_COUNT = 15

// Custom collision detection: prioritize sortable items over column containers
const itemsFirstCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args)
  if (pointerCollisions.length > 0) {
    const itemCollisions = pointerCollisions.filter(c => !COLUMN_KEYS.has(c.id as string))
    if (itemCollisions.length > 0) {
      const itemIds = new Set(itemCollisions.map(c => c.id))
      const itemContainers = args.droppableContainers.filter(c => itemIds.has(c.id))
      return closestCenter({ ...args, droppableContainers: itemContainers })
    }
    return pointerCollisions.filter(c => COLUMN_KEYS.has(c.id as string))
  }
  return closestCenter(args)
}

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

type Priority = Task['priority']
const priorities: { key: Priority; icon: React.ElementType; color: string; label: string }[] = [
  { key: 'urgent', icon: AlertTriangle, color: 'text-red-500 border-red-500/50 bg-red-500/10', label: 'Urgent' },
  { key: 'high', icon: ArrowUp, color: 'text-orange-500 border-orange-500/50 bg-orange-500/10', label: 'High' },
  { key: 'medium', icon: Minus, color: 'text-blue-500 border-blue-500/50 bg-blue-500/10', label: 'Medium' },
  { key: 'low', icon: ArrowDown, color: 'text-muted-foreground border-muted-foreground/50 bg-muted', label: 'Low' },
]

function DroppableColumn({ col, children, count, taskIds, hiddenCount, onShowMore }: {
  col: ColumnConfig; children: React.ReactNode; count: number; taskIds: string[]
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
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto">
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

function SortableGlobalTaskItem({ task, project, onEdit, onView }: {
  task: Task
  project?: Project
  onEdit: (task: Task) => void
  onView: (task: Task) => void
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
      className={cn(isDragging && 'opacity-30')}
      {...attributes}
    >
      <TaskItem
        task={task}
        projectName={project?.name || task.projectId}
        projectPath={project?.path}
        showProjectBadge
        projectLink={project ? `/project/${project.id}` : undefined}
        onEdit={onEdit}
        onView={onView}
        dragListeners={listeners as unknown as Record<string, Function>}
      />
    </div>
  )
}

export function TasksPage() {
  const { data: tasks } = useAllTasks()
  const { data: projects } = useProjects()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity })
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [search, setSearch] = useState('')
  const [priorityFilters, setPriorityFilters] = useState<Set<Priority>>(new Set())
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [viewingTask, setViewingTask] = useState<Task | null>(null)
  const [sortBy, setSortBy] = useState<SortOption>(() =>
    (localStorage.getItem('shipyard:sort:global') as SortOption) || 'updated'
  )
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>(() =>
    (localStorage.getItem('shipyard:view:global') as 'kanban' | 'list') || 'kanban'
  )
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({
    inbox: INITIAL_VISIBLE,
    in_progress: INITIAL_VISIBLE,
    done: INITIAL_VISIBLE,
  })

  const handleShowMore = useCallback((colKey: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [colKey]: (prev[colKey] || INITIAL_VISIBLE) + LOAD_MORE_COUNT,
    }))
  }, [])

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

    for (const key of Object.keys(result)) {
      result[key] = sortTasks(result[key], sortBy)
    }

    return result
  }, [filteredTasks, sortBy])

  const findColumnForTask = useCallback((taskId: string): string | undefined => {
    for (const [key, colTasks] of Object.entries(grouped)) {
      if (colTasks.some(t => t.id === taskId)) return key
    }
    return undefined
  }, [grouped])

  const handleEdit = useCallback((task: Task) => {
    setEditingTask(task)
    setEditorOpen(true)
  }, [])

  const handleView = useCallback((task: Task) => {
    setViewingTask(task)
    setViewerOpen(true)
  }, [])

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

  const hasFilters = search.trim() || priorityFilters.size > 0

  const viewingProject = viewingTask ? projectMap.get(viewingTask.projectId) : undefined

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
          <select
            value={sortBy}
            onChange={e => {
              const v = e.target.value as SortOption
              setSortBy(v)
              localStorage.setItem('shipyard:sort:global', v)
            }}
            className="h-8 text-xs bg-background border rounded px-1.5 cursor-pointer outline-none"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <div className="flex items-center border rounded-md">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setViewMode('kanban'); localStorage.setItem('shipyard:view:global', 'kanban') }}
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
                  onClick={() => { setViewMode('list'); localStorage.setItem('shipyard:view:global', 'list') }}
                  className={cn('p-1.5 rounded-r-md transition-colors', viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>List view</TooltipContent>
            </Tooltip>
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setSearch(''); setPriorityFilters(new Set()) }}>
              Clear
            </Button>
          )}
        </div>

        {viewMode === 'kanban' ? (
          <DndContext
            sensors={sensors}
            collisionDetection={itemsFirstCollision}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="grid grid-cols-3 gap-4 h-full">
              {columns.map(col => {
                const colTasks = grouped[col.key] || []
                const limit = visibleCounts[col.key] || INITIAL_VISIBLE
                const visibleTasks = colTasks.slice(0, limit)
                const hiddenCount = colTasks.length - visibleTasks.length
                const taskIds = visibleTasks.map(t => t.id)
                return (
                  <DroppableColumn
                    key={col.key} col={col} count={colTasks.length} taskIds={taskIds}
                    hiddenCount={hiddenCount}
                    onShowMore={() => handleShowMore(col.key)}
                  >
                    {visibleTasks.length > 0 ? (
                      visibleTasks.map(task => (
                        <SortableGlobalTaskItem
                          key={task.id}
                          task={task}
                          project={projectMap.get(task.projectId)}
                          onEdit={handleEdit}
                          onView={handleView}
                        />
                      ))
                    ) : (
                      <div className="text-xs text-muted-foreground/50 py-6 text-center">
                        No tasks
                      </div>
                    )}
                  </DroppableColumn>
                )
              })}
            </div>

            <DragOverlay dropAnimation={null}>
              {activeTask && (
                <div className="opacity-90 rotate-2 max-w-sm">
                  <TaskItem
                    task={activeTask}
                    projectName={projectMap.get(activeTask.projectId)?.name}
                    showProjectBadge={true}
                    onEdit={() => {}}
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        ) : (
          <TaskListView
            tasks={filteredTasks}
            showProjectBadge
            projectMap={projectMap as any}
            onEdit={handleEdit}
            onView={handleView}
          />
        )}
      </div>

      <TaskViewer
        task={viewingTask}
        projectName={viewingProject?.name}
        projectPath={viewingProject?.path}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        onEdit={handleEdit}
      />

      <TaskEditor
        projectId={editingTask?.projectId || ''}
        task={editingTask}
        open={editorOpen}
        onOpenChange={setEditorOpen}
      />
    </>
  )
}
