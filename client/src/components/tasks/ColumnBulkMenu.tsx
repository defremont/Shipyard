import { useState } from 'react'
import { MoreHorizontal, Trash2, ArrowRight, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useBulkUpdateTasks, useBulkDeleteTasks, type Task } from '@/hooks/useTasks'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type BulkScope = 'inbox' | 'backlog' | 'in_progress' | 'done'

interface MoveOption {
  label: string
  status: Task['status']
}

const MOVE_OPTIONS: Record<BulkScope, MoveOption[]> = {
  inbox: [
    { label: 'In Progress', status: 'in_progress' },
    { label: 'Done', status: 'done' },
    { label: 'Backlog', status: 'backlog' },
  ],
  backlog: [
    { label: 'To Do', status: 'todo' },
    { label: 'In Progress', status: 'in_progress' },
    { label: 'Done', status: 'done' },
  ],
  in_progress: [
    { label: 'To Do', status: 'todo' },
    { label: 'Backlog', status: 'backlog' },
    { label: 'Done', status: 'done' },
  ],
  done: [
    { label: 'To Do', status: 'todo' },
    { label: 'In Progress', status: 'in_progress' },
    { label: 'Backlog', status: 'backlog' },
  ],
}

interface Props {
  projectId: string
  scope: BulkScope
  scopeLabel: string
  tasks: Task[]
}

export function ColumnBulkMenu({ projectId, scope, scopeLabel, tasks }: Props) {
  const [open, setOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const bulkUpdate = useBulkUpdateTasks()
  const bulkDelete = useBulkDeleteTasks()
  const busy = bulkUpdate.isPending || bulkDelete.isPending

  if (tasks.length === 0) return null

  const taskIds = tasks.map(t => t.id)
  const moveOptions = MOVE_OPTIONS[scope]

  const handleMove = (status: Task['status'], label: string) => {
    setOpen(false)
    bulkUpdate.mutate(
      { projectId, taskIds, data: { status } },
      {
        onSuccess: () => toast.success(`Moved ${tasks.length} task${tasks.length === 1 ? '' : 's'} to ${label}`),
        onError: () => toast.error('Failed to move tasks'),
      },
    )
  }

  const handleDelete = () => {
    setConfirmDelete(false)
    setOpen(false)
    bulkDelete.mutate(
      { projectId, taskIds },
      {
        onSuccess: () => toast.success(`Deleted ${tasks.length} task${tasks.length === 1 ? '' : 's'}`),
        onError: () => toast.error('Failed to delete tasks'),
      },
    )
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                className={cn(
                  'text-muted-foreground/40 hover:text-foreground transition-colors',
                  busy && 'opacity-50 cursor-not-allowed',
                )}
                disabled={busy}
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MoreHorizontal className="h-3.5 w-3.5" />}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Bulk actions</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-56 p-1">
          <div className="px-2 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
            {tasks.length} {scopeLabel} task{tasks.length === 1 ? '' : 's'}
          </div>
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/50">
            Move all to
          </div>
          {moveOptions.map(opt => (
            <button
              key={opt.status}
              onClick={() => handleMove(opt.status, opt.label)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent text-left"
            >
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              {opt.label}
            </button>
          ))}
          <div className="my-1 border-t" />
          <button
            onClick={() => setConfirmDelete(true)}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-destructive/10 text-destructive text-left"
          >
            <Trash2 className="h-3 w-3" />
            Delete all
          </button>
        </PopoverContent>
      </Popover>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {tasks.length} task{tasks.length === 1 ? '' : 's'}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete every task in {scopeLabel}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
