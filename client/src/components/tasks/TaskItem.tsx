import { Pencil, Trash2, Copy, Check, Circle, AlertTriangle, ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useUpdateTask, useDeleteTask, type Task } from '@/hooks/useTasks'
import { toast } from 'sonner'

interface TaskItemProps {
  task: Task
  projectName?: string
  onEdit: (task: Task) => void
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

export function TaskItem({ task, projectName, onEdit, dragListeners }: TaskItemProps) {
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()

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
    const prompt = task.promptTemplate ||
      `Task: ${task.title}\n${task.description ? `\nDescription: ${task.description}` : ''}${projectName ? `\nProject: ${projectName}` : ''}`
    navigator.clipboard.writeText(prompt)
    toast.success('Copied to clipboard')
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
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

      <span className={cn('text-sm line-clamp-2 min-w-0', task.status === 'done' && 'line-through')}>
        {task.title}
      </span>

      {projectName && (
        <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 ml-auto">
          {projectName}
        </Badge>
      )}

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-auto">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCopyPrompt} title="Copy as prompt">
          <Copy className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleEdit} title="Edit">
          <Pencil className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={handleDelete} title="Delete">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}
