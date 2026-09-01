import { useState, useEffect, useRef, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCreateTask, useUpdateTask, type Task, type EffortPoints } from '@/hooks/useTasks'
import { useMilestones } from '@/hooks/useMilestones'
import { TaskAnalysisButton } from '@/components/claude/TaskAnalysisButton'
import { PRIORITY_CONFIG, STATUS_CONFIG } from '@/lib/taskVisuals'
import { X, ChevronRight, Plus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface TaskEditorProps {
  projectId: string
  task?: Task | null
  milestoneId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type Subtask = { id: string; title: string; done: boolean }

const PRIORITY_ORDER: Task['priority'][] = ['urgent', 'high', 'medium', 'low']
const STATUS_ORDER: Task['status'][] = ['backlog', 'todo', 'in_progress', 'done']

const EFFORT_OPTIONS = [
  { value: 'none', label: 'No estimate' },
  { value: '1', label: '1 · Trivial' },
  { value: '2', label: '2 · Small' },
  { value: '3', label: '3 · Medium' },
  { value: '5', label: '5 · Large' },
  { value: '8', label: '8 · Very large' },
]

const newSubtaskId = () => Math.random().toString(36).slice(2, 12)

export function TaskEditor({ projectId, task, milestoneId, open, onOpenChange }: TaskEditorProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<string>('medium')
  const [effort, setEffort] = useState<string>('none')
  const [effortSource, setEffortSource] = useState<'claude' | 'manual'>('manual')
  const [status, setStatus] = useState<string>('todo')
  const [prompt, setPrompt] = useState('')
  const [subtasks, setSubtasks] = useState<Subtask[]>([])
  const [newSubtask, setNewSubtask] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [quickCreate, setQuickCreate] = useState(() =>
    localStorage.getItem('shipyard:quick-create') === 'true'
  )
  const titleInputRef = useRef<HTMLInputElement>(null)

  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const saving = createTask.isPending || updateTask.isPending

  const { data: milestones } = useMilestones(open ? projectId : undefined)
  const targetMilestoneId = task ? task.milestoneId : milestoneId
  const milestoneName = useMemo(() => {
    if (!targetMilestoneId || targetMilestoneId === 'default') return null
    return milestones?.find(m => m.id === targetMilestoneId)?.name ?? null
  }, [milestones, targetMilestoneId])

  useEffect(() => {
    if (task) {
      setTitle(task.title)
      setDescription(task.description)
      setPriority(task.priority)
      setEffort(task.effort ? String(task.effort) : 'none')
      setEffortSource(task.effortSource === 'claude' ? 'claude' : 'manual')
      setStatus(task.status)
      setPrompt(task.prompt || '')
      setSubtasks(task.subtasks || [])
      setShowDetails(Boolean(task.prompt) || (task.subtasks?.length ?? 0) > 0)
    } else {
      setTitle('')
      setDescription('')
      setPriority('medium')
      setEffort('none')
      setStatus('todo')
      setPrompt('')
      setSubtasks([])
      setShowDetails(false)
    }
    setNewSubtask('')
  }, [task, open])

  /** Quick create keeps the bucket (priority/status) so a burst of similar tasks stays fast. */
  const resetForm = () => {
    setTitle('')
    setDescription('')
    setEffort('none')
    setEffortSource('manual')
    setPrompt('')
    setSubtasks([])
    setNewSubtask('')
    setShowDetails(false)
    setTimeout(() => titleInputRef.current?.focus(), 50)
  }

  const commitSubtask = () => {
    const value = newSubtask.trim()
    if (!value) return null
    const entry = { id: newSubtaskId(), title: value, done: false }
    setSubtasks(prev => [...prev, entry])
    setNewSubtask('')
    return entry
  }

  const handleSave = () => {
    if (!title.trim() || saving) return

    // A subtask still sitting in the input would otherwise be dropped on save.
    const pending = newSubtask.trim()
    const finalSubtasks = pending
      ? [...subtasks, { id: newSubtaskId(), title: pending, done: false }]
      : subtasks

    if (task) {
      updateTask.mutate(
        {
          projectId,
          taskId: task.id,
          title,
          description,
          priority,
          effort: effort === 'none' ? null : Number(effort),
          effortSource: effort === 'none' ? null : effortSource,
          status,
          prompt: prompt || undefined,
          subtasks: finalSubtasks.length > 0 ? finalSubtasks : undefined,
        },
        { onSuccess: () => onOpenChange(false) }
      )
    } else {
      createTask.mutate(
        {
          projectId,
          title,
          description,
          priority,
          effort: effort === 'none' ? undefined : (Number(effort) as EffortPoints),
          effortSource: effort === 'none' ? undefined : effortSource,
          status,
          prompt: prompt || undefined,
          milestoneId: milestoneId && milestoneId !== 'default' ? milestoneId : undefined,
          subtasks: finalSubtasks.length > 0 ? finalSubtasks : undefined,
        },
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

  /** Ctrl/Cmd+Enter saves from any field, so long descriptions don't force a trip to the mouse. */
  const handleFormKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && title.trim()) {
      e.preventDefault()
      handleSave()
    }
  }

  const toggleQuickCreate = () => {
    const next = !quickCreate
    setQuickCreate(next)
    localStorage.setItem('shipyard:quick-create', String(next))
  }

  const detailsCount = (prompt.trim() ? 1 : 0) + subtasks.length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            {task ? 'Edit Task' : 'New Task'}
            {task && (
              <span className="text-xs text-muted-foreground/60 font-mono font-normal">
                #{task.number || '?'}
              </span>
            )}
            {milestoneName && (
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
                {milestoneName}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-4 space-y-3" onKeyDown={handleFormKeyDown}>
          <div className="flex items-center gap-2">
            <Input
              ref={titleInputRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={handleTitleKeyDown}
              placeholder="What needs to be done?"
              className="h-11 flex-1 text-base font-medium"
              autoFocus
            />
            <TaskAnalysisButton
              projectId={projectId}
              taskId={task?.id}
              title={title}
              className="h-11 shrink-0"
              onResult={({ title: t, description: d, prompt: p, effort: e }) => {
                if (t) setTitle(t)
                if (d) setDescription(d)
                if (p) { setPrompt(p); setShowDetails(true) }
                if (e) { setEffort(String(e)); setEffortSource('claude') }
              }}
            />
          </div>

          <Textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Description — what the user gets out of it (optional)"
            className="resize-y"
            rows={4}
          />

          <div className="grid grid-cols-3 gap-2">
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="h-9" aria-label="Priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_ORDER.map(key => {
                  const { icon: Icon, color, label } = PRIORITY_CONFIG[key]
                  return (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <Icon className={cn('h-3.5 w-3.5', color)} />
                        {label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>

            <Select value={effort} onValueChange={value => { setEffort(value); setEffortSource('manual') }}>
              <SelectTrigger className="h-9" aria-label="Effort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EFFORT_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value}>
                    <span className={cn(o.value === 'none' && 'text-muted-foreground')}>{o.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9" aria-label="Status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_ORDER.map(key => {
                  const { icon: Icon, color, label } = STATUS_CONFIG[key]
                  return (
                    <SelectItem key={key} value={key}>
                      <span className="flex items-center gap-2">
                        <Icon className={cn('h-3.5 w-3.5', color)} />
                        {label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>

          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowDetails(v => !v)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', showDetails && 'rotate-90')} />
              Technical details and subtasks
              {!showDetails && detailsCount > 0 && (
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">{detailsCount}</span>
              )}
            </button>

            {showDetails && (
              <div className="mt-3 space-y-3">
                <Textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="Causes, files, approach, implementation checklist..."
                  className="font-mono text-xs resize-y"
                  rows={5}
                />

                <div className="space-y-1">
                  {subtasks.map(st => (
                    <div key={st.id} className="flex items-center gap-2 group/st">
                      <input
                        type="checkbox"
                        checked={st.done}
                        onChange={() => setSubtasks(prev => prev.map(s => (s.id === st.id ? { ...s, done: !s.done } : s)))}
                        className="rounded border-border"
                      />
                      <span className={cn('text-sm flex-1', st.done && 'text-muted-foreground')}>{st.title}</span>
                      <button
                        type="button"
                        onClick={() => setSubtasks(prev => prev.filter(s => s.id !== st.id))}
                        className="opacity-0 group-hover/st:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                        aria-label={`Remove subtask ${st.title}`}
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
                        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && newSubtask.trim()) {
                          e.preventDefault()
                          commitSubtask()
                        }
                      }}
                      placeholder="Add subtask..."
                      className="flex-1 text-sm bg-background border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 shrink-0"
                      disabled={!newSubtask.trim()}
                      onClick={commitSubtask}
                      aria-label="Add subtask"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between shrink-0 border-t px-6 py-4">
          {!task ? (
            <label
              className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none"
              title="Keep the dialog open after creating, ready for the next task"
            >
              <input
                type="checkbox"
                checked={quickCreate}
                onChange={toggleQuickCreate}
                className="rounded border-border"
              />
              Keep open for the next task
            </label>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <kbd className="hidden sm:inline text-[10px] text-muted-foreground/70 mr-1">Ctrl+Enter</kbd>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!title.trim() || saving} className="min-w-[84px]">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : task ? 'Save' : 'Create'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
