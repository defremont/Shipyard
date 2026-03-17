import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Pencil, Copy, AlertTriangle, ArrowUp, ArrowDown, Minus, Inbox, Loader, CheckCircle2, Trash2, Check, Wand2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUpdateTask, useDeleteTask, type Task } from '@/hooks/useTasks'
import { buildTaskPrompt } from '@/lib/promptBuilder'
import { useClaudeStatus, useAnalyzeTask } from '@/hooks/useClaude'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { playAiCompleteSound } from '@/lib/sounds'

interface TaskViewerProps {
  task: Task | null
  projectName?: string
  projectPath?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (task: Task) => void
}

const priorityConfig: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  urgent: { icon: AlertTriangle, color: 'text-red-500', label: 'Urgent' },
  high: { icon: ArrowUp, color: 'text-orange-500', label: 'High' },
  medium: { icon: Minus, color: 'text-blue-500', label: 'Medium' },
  low: { icon: ArrowDown, color: 'text-green-500', label: 'Low' },
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  backlog: { label: 'Backlog', variant: 'outline' },
  todo: { label: 'To Do', variant: 'secondary' },
  in_progress: { label: 'In Progress', variant: 'default' },
  done: { label: 'Done', variant: 'outline' },
}

function formatDate(date?: string) {
  if (!date) return null
  try { return formatDistanceToNow(new Date(date), { addSuffix: true }) }
  catch { return null }
}

export function TaskViewer({ task, projectName, projectPath, open, onOpenChange, onEdit }: TaskViewerProps) {
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity })
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const { data: claudeStatus } = useClaudeStatus()
  const analyzeTask = useAnalyzeTask()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const canAiImprove = !!(claudeStatus?.configured || claudeStatus?.cliAvailable)

  // Clear "needs review" indicator when the user opens/views the task
  useEffect(() => {
    if (open && task?.needsReview) {
      updateTask.mutate({ projectId: task.projectId, taskId: task.id, needsReview: false })
    }
  }, [open, task?.id, task?.needsReview])

  if (!task) return null

  const pri = priorityConfig[task.priority] || priorityConfig.medium
  const sts = statusConfig[task.status] || statusConfig.todo
  const PriIcon = pri.icon

  const handleCopy = () => {
    const prompt = buildTaskPrompt(task, projectName, projectPath, settings?.tasksDir)
    navigator.clipboard.writeText(prompt)
    toast.success('Copied to clipboard')
  }

  const handleEdit = () => {
    onOpenChange(false)
    onEdit(task)
  }

  const handleAiImprove = async () => {
    try {
      const result = await analyzeTask.mutateAsync({
        projectId: task.projectId,
        title: task.title,
        taskId: task.id,
      })
      updateTask.mutate({
        projectId: task.projectId,
        taskId: task.id,
        description: result.description,
        prompt: result.prompt,
      })
      playAiCompleteSound()
      toast.success('Task improved with AI')
    } catch (err: any) {
      toast.error(err.message || 'AI analysis failed')
    }
  }

  const handleStatusChange = (status: Task['status']) => {
    updateTask.mutate({ projectId: task.projectId, taskId: task.id, status })
    onOpenChange(false)
  }

  const handleDelete = () => {
    deleteTask.mutate({ projectId: task.projectId, taskId: task.id })
    setDeleteOpen(false)
    onOpenChange(false)
  }

  const statusActions = [
    { status: 'todo' as const, label: 'Inbox', icon: Inbox, color: 'text-blue-500' },
    { status: 'in_progress' as const, label: 'In Progress', icon: Loader, color: 'text-yellow-500' },
    { status: 'done' as const, label: 'Done', icon: CheckCircle2, color: 'text-green-500' },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <div className="flex items-start gap-3">
            <PriIcon className={cn('h-5 w-5 mt-0.5 shrink-0', pri.color)} />
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-base leading-snug">{task.title}</DialogTitle>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant={sts.variant} className="text-[10px]">{sts.label}</Badge>
                <Badge variant="outline" className="text-[10px] gap-1">
                  <PriIcon className={cn('h-2.5 w-2.5', pri.color)} />
                  {pri.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground/60 font-mono select-all ml-auto">#{task.number || '?'}</span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto min-h-0">
          {task.description && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Description</label>
              <p className="mt-1.5 text-sm whitespace-pre-wrap leading-relaxed">{task.description}</p>
            </div>
          )}

          {task.prompt && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Details</label>
              <pre className="mt-1.5 text-xs font-mono bg-muted/50 rounded-md p-3 whitespace-pre-wrap max-h-40 overflow-y-auto">{task.prompt}</pre>
            </div>
          )}

          {task.subtasks && task.subtasks.length > 0 && (
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Subtasks ({task.subtasks.filter(s => s.done).length}/{task.subtasks.length})
              </label>
              <div className="mt-1.5 space-y-1">
                {task.subtasks.map((st) => (
                  <div key={st.id} className="flex items-center gap-2">
                    {st.done ? (
                      <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-sm border border-muted-foreground/40 shrink-0" />
                    )}
                    <span className={cn('text-sm', st.done && 'line-through text-muted-foreground')}>{st.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-muted-foreground pt-2 border-t">
            {task.createdAt && <span>Created {formatDate(task.createdAt)}</span>}
            {task.inProgressAt && <span>Started {formatDate(task.inProgressAt)}</span>}
            {task.doneAt && <span>Done {formatDate(task.doneAt)}</span>}
          </div>
        </div>

        {/* Status actions */}
        <div className="flex items-center gap-2 pt-2 border-t shrink-0">
          <span className="text-xs text-muted-foreground mr-1">Move to:</span>
          {statusActions.map(({ status, label, icon: Icon, color }) => {
            const isCurrent = task.status === status || (status === 'todo' && task.status === 'backlog')
            return (
              <Button
                key={status}
                variant={isCurrent ? 'secondary' : 'outline'}
                size="sm"
                className={cn('gap-1.5 text-xs', isCurrent && 'pointer-events-none opacity-60')}
                onClick={() => handleStatusChange(status)}
                disabled={isCurrent}
              >
                <Icon className={cn('h-3.5 w-3.5', color)} />
                {label}
              </Button>
            )
          })}
        </div>

        <div className="flex items-center justify-between pt-2 shrink-0">
          <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
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
                <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={handleCopy}>
              <Copy className="h-3.5 w-3.5" />
              Copy as Prompt
            </Button>
            {canAiImprove && task.status !== 'done' && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs text-blue-500 hover:text-blue-400"
                onClick={handleAiImprove}
                disabled={analyzeTask.isPending}
              >
                {analyzeTask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
                AI Improve
              </Button>
            )}
            <Button variant="default" size="sm" className="gap-1.5 text-xs" onClick={handleEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
