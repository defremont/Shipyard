import { useState, useMemo, useSyncExternalStore, useCallback, memo } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Trash2, Copy, CopyPlus, Check, Circle, Sparkles, Wand2, Loader2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { useCreateTask, useUpdateTask, useDeleteTask, type Task } from '@/hooks/useTasks'
import { buildTaskPrompt } from '@/lib/promptBuilder'
import { useAiSessions } from '@/hooks/useAiSessions'
import { useClaudeStatus } from '@/hooks/useClaude'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { scheduleAutoSync } from '@/lib/sync/autoSync'
import { priorityVisual, statusVisual } from '@/lib/taskVisuals'

// Module-level store for AI improve operations — survives component unmounts
const _improvingTasks = new Set<string>()
const _listeners = new Set<() => void>()
function _subscribe(cb: () => void) { _listeners.add(cb); return () => _listeners.delete(cb) }
function _getSnapshot() { return _improvingTasks.size }
function _setImproving(taskId: string, value: boolean) {
  if (value) _improvingTasks.add(taskId); else _improvingTasks.delete(taskId)
  _listeners.forEach(cb => cb())
}

interface TaskItemProps {
  task: Task
  projectName?: string
  projectPath?: string
  showProjectBadge?: boolean
  projectLink?: string
  onEdit: (task: Task) => void
  onView?: (task: Task) => void
  onAiResolve?: (task: Task) => void
  dragListeners?: Record<string, Function>
}

// react-query's structural sharing keeps `task` referentially stable across
// polls when nothing changed, so memoizing here stops a board's worth of cards
// from re-rendering every few seconds.
export const TaskItem = memo(function TaskItem({ task, projectName, projectPath, showProjectBadge, projectLink, onEdit, onView, onAiResolve, dragListeners }: TaskItemProps) {
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const queryClient = useQueryClient()
  const { hasSession: hasAiSession } = useAiSessions()
  const { data: claudeStatus } = useClaudeStatus()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity })
  // Subscribe to module-level improving state so it persists across tab switches
  useSyncExternalStore(_subscribe, _getSnapshot)
  const isAiImproving = _improvingTasks.has(task.id)
  const isAiResolving = hasAiSession(task.id)
  const canAiImprove = !!(claudeStatus?.configured || claudeStatus?.cliAvailable)

  const priority = priorityVisual(task.priority)
  const status = statusVisual(task.status)
  const PriorityIcon = priority.icon

  const handleStatusToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    const nextStatus = task.status === 'done' ? 'todo' :
                       task.status === 'todo' ? 'in_progress' :
                       task.status === 'in_progress' ? 'done' : 'todo'
    updateTask.mutate({
      projectId: task.projectId,
      taskId: task.id,
      status: nextStatus,
    })
  }

  const handleCopyPrompt = (e: React.MouseEvent) => {
    e.stopPropagation()
    const prompt = buildTaskPrompt(task, projectName, projectPath, settings?.tasksDir)
    navigator.clipboard.writeText(prompt)
    toast.success('Copied to clipboard')
  }

  const handleDuplicate = (e: React.MouseEvent) => {
    e.stopPropagation()
    createTask.mutate(
      {
        projectId: task.projectId,
        title: `Copy of ${task.title}`,
        description: task.description || '',
        priority: task.priority,
        status: 'todo',
        prompt: task.prompt || '',
      },
      { onSuccess: () => toast.success('Task duplicated') }
    )
  }

  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleDelete = () => {
    deleteTask.mutate({ projectId: task.projectId, taskId: task.id })
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit(task)
  }

  const handleAiImprove = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (_improvingTasks.has(task.id)) return
    _setImproving(task.id, true)
    try {
      // Use direct API calls — not component-local mutations — so the operation
      // continues even if the user switches tabs and this component unmounts.
      const result = await api.analyzeTask(task.projectId, task.title, task.id)
      await api.updateTask(task.projectId, task.id, {
        title: result.title,
        description: result.description,
        prompt: result.prompt,
      })
      // Invalidate cache so UI refreshes regardless of which tab is active
      queryClient.invalidateQueries({ queryKey: ['tasks', task.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      scheduleAutoSync(task.projectId)
      toast.success('Task improved with AI')
    } catch (err: any) {
      toast.error(err.message || 'AI analysis failed')
    } finally {
      _setImproving(task.id, false)
    }
  }, [task.id, task.projectId, task.title, queryClient])

  // Timestamp of when the task entered its current column
  const columnDate = useMemo(() => {
    const ts = task.status === 'done' ? task.doneAt
      : task.status === 'in_progress' ? task.inProgressAt
      : task.inboxAt || task.createdAt
    if (!ts) return null
    const d = new Date(ts)
    if (isNaN(d.getTime())) return null
    return d
  }, [task.status, task.doneAt, task.inProgressAt, task.inboxAt, task.createdAt])

  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-card transition-colors hover:border-primary/40 cursor-grab active:cursor-grabbing p-2',
        task.needsReview && 'border-primary/30 bg-primary/5',
        isAiResolving && 'ring-2 ring-primary/40 border-primary/30 animate-pulse'
      )}
      {...dragListeners}
    >
      {task.needsReview && (
        <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/70" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
        </span>
      )}
      <div className="flex items-start gap-2">
        <button onClick={handleStatusToggle} className="shrink-0 mt-0.5">
          {isAiResolving ? (
            <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" />
          ) : task.status === 'done' ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Circle className="h-3.5 w-3.5 text-muted-foreground/60" />
          )}
        </button>

        <PriorityIcon className={cn('h-3 w-3 shrink-0 mt-1', priority.color)} />

        <div className="min-w-0 flex-1">
          <span
            className={cn('text-sm line-clamp-2 cursor-pointer hover:text-primary transition-colors', task.status === 'done' && 'text-muted-foreground')}
            onClick={(e) => { e.stopPropagation(); onView?.(task) }}
          >
            {task.title}
          </span>
          {showProjectBadge && projectName && (
            projectLink ? (
              <Link to={projectLink} onClick={(e) => e.stopPropagation()} className="inline-block mt-0.5">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 hover:bg-accent">
                  {projectName}
                </Badge>
              </Link>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 mt-0.5">
                {projectName}
              </Badge>
            )
          )}
          {task.subtasks && task.subtasks.length > 0 && (
            <span className="text-[10px] text-muted-foreground ml-1">
              {task.subtasks.filter(s => s.done).length}/{task.subtasks.length}
            </span>
          )}
        </div>

        <div className="hidden group-hover:flex items-center gap-0.5 absolute top-1.5 right-1.5 bg-card rounded-md shadow-sm border px-0.5 py-0.5 z-10">
          {onAiResolve && task.status === 'in_progress' && !isAiResolving && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-primary hover:text-primary/80" onClick={(e) => { e.stopPropagation(); onAiResolve(task) }}>
                  <Sparkles className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Resolve with AI — opens Claude Code to work on this task</TooltipContent>
            </Tooltip>
          )}
          {canAiImprove && task.status !== 'done' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-primary hover:text-primary/80"
                  onClick={handleAiImprove}
                  disabled={isAiImproving}
                >
                  {isAiImproving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>AI Improve — generate title, description and details</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyPrompt}>
                <Copy className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy task as prompt — paste into Claude or any AI assistant</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleDuplicate}>
                <CopyPlus className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Duplicate task</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleEdit}>
                <Pencil className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit task</TooltipContent>
          </Tooltip>
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={(e) => e.stopPropagation()}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent>Delete task</TooltipContent>
            </Tooltip>
            <AlertDialogContent onClick={(e) => e.stopPropagation()}>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete task?</AlertDialogTitle>
                <AlertDialogDescription>
                  "{task.title}" will be permanently deleted. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="flex items-center mt-1 gap-1">
        <span className="text-[10px] text-muted-foreground/50 font-mono select-all">#{task.number || '?'}</span>
        <span className="flex-1" />
        {columnDate && (
          <span className="text-[10px] text-muted-foreground/40">
            {formatDistanceToNow(columnDate, { addSuffix: true })}
          </span>
        )}
      </div>
    </div>
  )
})
