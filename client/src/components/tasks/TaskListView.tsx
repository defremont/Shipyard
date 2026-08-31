import { useState, useMemo, useCallback, memo } from 'react'
import { ChevronDown, ChevronRight, Circle, Check, Pencil, Trash2, Copy, CopyPlus, Paperclip, MessageSquare } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { useUpdateTask, useDeleteTask, useCreateTask, type Task } from '@/hooks/useTasks'
import { buildTaskPrompt } from '@/lib/promptBuilder'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { priorityVisual } from '@/lib/taskVisuals'

const statusSections = [
  { key: 'in_progress', label: 'In Progress', statuses: ['in_progress'] as Task['status'][], color: 'text-warning' },
  { key: 'inbox', label: 'Inbox', statuses: ['backlog', 'todo'] as Task['status'][], color: 'text-primary' },
  { key: 'done', label: 'Done', statuses: ['done'] as Task['status'][], color: 'text-success' },
]

interface TaskListViewProps {
  tasks: Task[]
  projectName?: string
  projectPath?: string
  showProjectBadge?: boolean
  projectMap?: Map<string, { id: string; name: string; path: string }>
  onEdit: (task: Task) => void
  onView?: (task: Task) => void
}

const TaskRow = memo(function TaskRow({ task, projectName, projectPath, showProjectBadge, projectMap, onEdit, onView }: {
  task: Task
  projectName?: string
  projectPath?: string
  showProjectBadge?: boolean
  projectMap?: Map<string, { id: string; name: string; path: string }>
  onEdit: (task: Task) => void
  onView?: (task: Task) => void
}) {
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const createTask = useCreateTask()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity })
  const [deleteOpen, setDeleteOpen] = useState(false)

  const priority = priorityVisual(task.priority)
  const PriorityIcon = priority.icon
  const project = projectMap?.get(task.projectId)
  const displayProjectName = projectName || project?.name || task.projectId
  const displayProjectPath = projectPath || project?.path

  const handleStatusToggle = () => {
    const nextStatus = task.status === 'done' ? 'todo' :
                       task.status === 'todo' ? 'in_progress' :
                       task.status === 'in_progress' ? 'done' : 'todo'
    updateTask.mutate({ projectId: task.projectId, taskId: task.id, status: nextStatus })
  }

  const handleCopyPrompt = () => {
    const prompt = buildTaskPrompt(task, displayProjectName, displayProjectPath, settings?.tasksDir)
    navigator.clipboard.writeText(prompt)
    toast.success('Copied to clipboard')
  }

  const handleDuplicate = () => {
    createTask.mutate(
      { projectId: task.projectId, title: `Copy of ${task.title}`, description: task.description || '', priority: task.priority, effort: task.effort, effortSource: task.effort ? 'manual' : undefined, status: 'todo', prompt: task.prompt || '' },
      { onSuccess: () => toast.success('Task duplicated') }
    )
  }

  const age = task.createdAt ? formatDistanceToNow(new Date(task.createdAt), { addSuffix: false }) : ''
  const doneDate = task.status === 'done' && task.doneAt ? new Date(task.doneAt) : null

  return (
    <div className={cn(
      'group relative flex items-center gap-3 px-3 py-1.5 pr-10 hover:bg-accent/50 rounded transition-colors',
      task.needsReview && 'bg-primary/5'
    )}>
      <button onClick={handleStatusToggle} className="shrink-0 relative">
        {task.status === 'done' ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
        )}
        {task.needsReview && (
          <span className="absolute -top-1 -right-1 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/70" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
          </span>
        )}
      </button>

      <PriorityIcon className={cn('h-3 w-3 shrink-0', priority.color)} />

      <span className="text-[10px] text-muted-foreground/50 font-mono shrink-0 select-all">#{task.number || '?'}</span>

      <span
        className={cn('text-sm flex-1 truncate cursor-pointer hover:text-primary transition-colors', task.status === 'done' && 'text-muted-foreground')}
        onClick={() => onView?.(task)}
      >
        {task.title}
      </span>

      {task.effort && (
        <span className="text-[10px] text-muted-foreground tabular-nums">{task.effort} pts</span>
      )}      {task.subtasks && task.subtasks.length > 0 && (
        <span className="text-[10px] text-muted-foreground shrink-0">
          {task.subtasks.filter((s: any) => s.done).length}/{task.subtasks.length}
        </span>
      )}

      {(task.attachments?.length ?? task.attachmentCount ?? 0) > 0 && (
        <span className="text-[10px] text-muted-foreground shrink-0 inline-flex items-center gap-0.5" title="Attachments from Trello">
          <Paperclip className="h-2.5 w-2.5" />
          {task.attachments?.length ?? task.attachmentCount}
        </span>
      )}
      {(task.comments?.length ?? task.commentCount ?? 0) > 0 && (
        <span className="text-[10px] text-muted-foreground shrink-0 inline-flex items-center gap-0.5" title="Comments from Trello">
          <MessageSquare className="h-2.5 w-2.5" />
          {task.comments?.length ?? task.commentCount}
        </span>
      )}

      {showProjectBadge && (
        project ? (
          <Link to={`/project/${project.id}`} className="shrink-0">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 hover:bg-accent">{project.name}</Badge>
          </Link>
        ) : (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{task.projectId}</Badge>
        )
      )}

      {doneDate ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-[10px] text-success/80 shrink-0 text-right">
              {doneDate.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </span>
          </TooltipTrigger>
          <TooltipContent>Completed {formatDistanceToNow(doneDate, { addSuffix: true })}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="text-[10px] text-muted-foreground shrink-0 w-12 text-right">{age}</span>
      )}

      <div className="hidden group-hover:flex items-center gap-0.5 absolute right-2 top-1/2 -translate-y-1/2 bg-card rounded-md shadow-sm border px-0.5 py-0.5 z-10">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyPrompt}><Copy className="h-3 w-3" /></Button>
          </TooltipTrigger>
          <TooltipContent>Copy as prompt</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleDuplicate}><CopyPlus className="h-3 w-3" /></Button>
          </TooltipTrigger>
          <TooltipContent>Duplicate</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEdit(task)}><Pencil className="h-3 w-3" /></Button>
          </TooltipTrigger>
          <TooltipContent>Edit</TooltipContent>
        </Tooltip>
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive"><Trash2 className="h-3 w-3" /></Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete task?</AlertDialogTitle>
              <AlertDialogDescription>"{task.title}" will be permanently deleted.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteTask.mutate({ projectId: task.projectId, taskId: task.id })} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
})

const LIST_INITIAL_VISIBLE = 20
const LIST_LOAD_MORE = 20

export function TaskListView({ tasks, projectName, projectPath, showProjectBadge, projectMap, onEdit, onView }: TaskListViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [visibleCounts, setVisibleCounts] = useState<Record<string, number>>({})

  const sections = useMemo(() => {
    return statusSections.map(section => ({
      ...section,
      tasks: tasks.filter(t => section.statuses.includes(t.status))
        .sort((a, b) => {
          if (section.key === 'inbox' && a.status !== b.status) {
            return a.status === 'backlog' ? 1 : -1
          }
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        })
    }))
  }, [tasks])

  const toggleSection = (key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleShowMore = useCallback((key: string) => {
    setVisibleCounts(prev => ({
      ...prev,
      [key]: (prev[key] || LIST_INITIAL_VISIBLE) + LIST_LOAD_MORE,
    }))
  }, [])

  return (
    <div className="space-y-1">
      {sections.map(section => {
        const limit = visibleCounts[section.key] || LIST_INITIAL_VISIBLE
        const visibleTasks = section.tasks.slice(0, limit)
        const hiddenCount = section.tasks.length - visibleTasks.length
        return (
          <div key={section.key} className="rounded-lg border bg-card">
            <button
              onClick={() => toggleSection(section.key)}
              className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-accent/30 transition-colors rounded-t-lg"
            >
              {collapsed.has(section.key) ? (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className={cn('text-xs font-semibold uppercase tracking-wider', section.color)}>
                {section.label}
              </span>
              <span className="text-xs text-muted-foreground">({section.tasks.length})</span>
            </button>
            {!collapsed.has(section.key) && section.tasks.length > 0 && (
              <div className="pb-1">
                {visibleTasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    projectName={projectName}
                    projectPath={projectPath}
                    showProjectBadge={showProjectBadge}
                    projectMap={projectMap}
                    onEdit={onEdit}
                    onView={onView}
                  />
                ))}
                {hiddenCount > 0 && (
                  <button
                    onClick={() => handleShowMore(section.key)}
                    className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
                  >
                    <ChevronDown className="h-3 w-3" />
                    Show {hiddenCount} more
                  </button>
                )}
              </div>
            )}
            {!collapsed.has(section.key) && section.tasks.length === 0 && (
              <div className="text-xs text-muted-foreground/50 py-3 text-center">No tasks</div>
            )}
          </div>
        )
      })}
    </div>
  )
}
