import { useState, useEffect, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateTask, useUpdateTask, type Task } from '@/hooks/useTasks'
import { TaskAnalysisButton } from '@/components/claude/TaskAnalysisButton'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface TaskEditorProps {
  projectId: string
  task?: Task | null
  milestoneId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskEditor({ projectId, task, milestoneId, open, onOpenChange }: TaskEditorProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<string>('medium')
  const [status, setStatus] = useState<string>('todo')
  const [prompt, setPrompt] = useState('')
  const [subtasks, setSubtasks] = useState<{ id: string; title: string; done: boolean }[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  const [quickCreate, setQuickCreate] = useState(() =>
    localStorage.getItem('shipyard:quick-create') === 'true'
  )
  const titleInputRef = useRef<HTMLInputElement>(null)

  const createTask = useCreateTask()
  const updateTask = useUpdateTask()

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description)
      setPriority(task.priority)
      setStatus(task.status)
      setPrompt(task.prompt || '')
      setSubtasks(task.subtasks || [])
    } else {
      setTitle('')
      setDescription('')
      setPriority('medium')
      setStatus('todo')
      setPrompt('')
      setSubtasks([])
    }
  }, [task, open])

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setStatus('todo')
    setPrompt('')
    setSubtasks([])
    setNewSubtask('')
    setTimeout(() => titleInputRef.current?.focus(), 50)
  }

  const handleSave = () => {
    if (!title.trim()) return

    if (task) {
      updateTask.mutate(
        { projectId, taskId: task.id, title, description, priority, status, prompt: prompt || undefined, subtasks: subtasks.length > 0 ? subtasks : undefined },
        { onSuccess: () => onOpenChange(false) }
      )
    } else {
      createTask.mutate(
        { projectId, title, description, priority, status, prompt: prompt || undefined, milestoneId: milestoneId && milestoneId !== 'default' ? milestoneId : undefined, subtasks: subtasks.length > 0 ? subtasks : undefined },
        {
          onSuccess: () => {
            if (quickCreate) {
              toast.success(`Task created: ${title.length > 50 ? title.slice(0, 50) + '…' : title}`)
              resetForm()
            } else {
              onOpenChange(false)
            }
          },
        }
      )
    }
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && title.trim()) {
      e.preventDefault()
      handleSave()
    }
  }

  const toggleQuickCreate = () => {
    const next = !quickCreate
    setQuickCreate(next)
    localStorage.setItem('shipyard:quick-create', String(next))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            {task ? 'Edit Task' : 'New Task'}
            {task && <span className="text-xs text-muted-foreground/60 font-mono font-normal">#{task.number || '?'}</span>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4 overflow-y-auto min-h-0">
          <div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Title</label>
              <TaskAnalysisButton
                projectId={projectId}
                taskId={task?.id}
                title={title}
                onResult={({ title: t, description: d, prompt: p }) => {
                  if (t) setTitle(t)
                  if (d) setDescription(d)
                  if (p) setPrompt(p)
                }}
              />
            </div>
            <Input
              ref={titleInputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              placeholder="Task title..."
              className="mt-1"
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium">Description</label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description..."
              className="mt-1"
              rows={6}
            />
          </div>
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="text-sm font-medium">Priority</label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="urgent">Urgent</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <label className="text-sm font-medium">Status</label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="backlog">Backlog</SelectItem>
                  <SelectItem value="todo">To Do</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">Details</label>
            <Textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Technical details, causes, solutions, relevant files..."
              className="mt-1 font-mono text-xs"
              rows={4}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Subtasks</label>
            <div className="mt-1 space-y-1">
              {subtasks.map((st) => (
                <div key={st.id} className="flex items-center gap-2 group/st">
                  <input
                    type="checkbox"
                    checked={st.done}
                    onChange={() => setSubtasks(prev => prev.map(s => s.id === st.id ? { ...s, done: !s.done } : s))}
                    className="rounded border-border"
                  />
                  <span className={cn('text-sm flex-1', st.done && 'line-through text-muted-foreground')}>{st.title}</span>
                  <button
                    type="button"
                    onClick={() => setSubtasks(prev => prev.filter(s => s.id !== st.id))}
                    className="opacity-0 group-hover/st:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newSubtask}
                  onChange={e => setNewSubtask(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && newSubtask.trim()) {
                      e.preventDefault()
                      setSubtasks(prev => [...prev, { id: Math.random().toString(36).slice(2, 12), title: newSubtask.trim(), done: false }])
                      setNewSubtask('')
                    }
                  }}
                  placeholder="Add subtask... (Enter)"
                  className="flex-1 text-sm bg-background border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between sm:justify-between shrink-0">
          {!task && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={quickCreate}
                onChange={toggleQuickCreate}
                className="rounded border-border"
              />
              Quick create
            </label>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!title.trim()}>
              {task ? 'Save' : 'Create'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
