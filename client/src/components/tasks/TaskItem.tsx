import { useState } from 'react'
import { Pencil, Trash2, Copy, Check, Circle, AlertTriangle, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import { useUpdateTask, useDeleteTask, type Task } from '@/hooks/useTasks'
import { buildTaskPrompt } from '@/lib/promptBuilder'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface TaskItemProps {
  task: Task
  projectName?: string
  projectPath?: string
  onEdit: (task: Task) => void
  onView?: (task: Task) => void
  dragListeners?: Record<string, Function>
}

const priorityConfig = {
  urgent: { icon: AlertTriangle, color: 'text-red-500', label: 'Urgent' },
  high: { icon: ArrowUp, color: 'text-orange-500', label: 'High' },
  medium: { icon: Minus, color: 'text-blue-500', label: 'Medium' },
  low: { icon: ArrowDown, color: 'text-red-500', label: 'Low' },
}

const statusConfig = {
  backlog: { label: 'Backlog', variant: 'outline' as const },
  todo: { label: 'To Do', variant: 'secondary' as const },
  in_progress: { label: 'In Progress', variant: 'default' as const },
  done: { label: 'Done', variant: 'outline' as const },
}

export function TaskItem({ task, projectName, projectPath, onEdit, onView, dragListeners }: TaskItemProps) {
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity })

  const priority = priorityConfig[task.priority] || priorityConfig.medium
  const status = statusConfig[task.status] || statusConfig.todo
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

  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleDelete = () => {
    deleteTask.mutate({ projectId: task.projectId, taskId: task.id })
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit(task)
  }

  return (
    <div
      className={cn(
        'group flex items-start gap-2 p-2 rounded-lg border bg-card transition-colors hover:border-primary/30 cursor-grab active:cursor-grabbing',
        task.status === 'done' && 'opacity-60'
      )}
      {...dragListeners}
    >
      <button onClick={handleStatusToggle} className="shrink-0 mt-0.5">
        {task.status === 'done' ? (
          <Check className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Circle className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      <PriorityIcon className={cn('h-3 w-3 shrink-0 mt-1', priority.color)} />

      <span
        className={cn('text-sm line-clamp-2 min-w-0 cursor-pointer hover:text-primary transition-colors', task.status === 'done' && 'line-through')}
        onClick={(e) => { e.stopPropagation(); onView?.(task) }}
      >
        {task.title}
      </span>

      {projectName && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 ml-auto">
          {projectName}
        </Badge>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-auto">
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
  )
}
