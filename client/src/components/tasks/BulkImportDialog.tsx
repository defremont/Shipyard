import { useState } from 'react'
import { Loader2, Sparkles, Trash2, Import } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useClaudeStatus } from '@/hooks/useClaude'
import { useCreateTask } from '@/hooks/useTasks'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface ParsedTask {
  title: string
  description: string
  prompt: string
  priority: string
  status: string
  selected: boolean
}

interface BulkImportDialogProps {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function BulkImportDialog({ projectId, open, onOpenChange }: BulkImportDialogProps) {
  const { data: claudeStatus } = useClaudeStatus()
  const createTask = useCreateTask()
  const [rawText, setRawText] = useState('')
  const [tasks, setTasks] = useState<ParsedTask[]>([])
  const [state, setState] = useState<'idle' | 'analyzing' | 'preview' | 'importing'>('idle')

  const handleAnalyze = async () => {
    if (!rawText.trim()) return
    setState('analyzing')
    try {
      const result = await api.bulkOrganizeTasks(projectId, rawText)
      if (result.tasks.length === 0) {
        toast.error('No tasks found in text')
        setState('idle')
        return
      }
      setTasks(result.tasks.map(t => ({ ...t, selected: true })))
      setState('preview')
    } catch (err: any) {
      toast.error(err.message || 'Analysis failed')
      setState('idle')
    }
  }

  const handleBasicParse = () => {
    const lines = rawText.split('\n').map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
    if (lines.length === 0) { toast.error('No lines found'); return }
    setTasks(lines.map(line => ({
      title: line,
      description: '',
      prompt: '',
      priority: 'medium',
      status: 'todo',
      selected: true,
    })))
    setState('preview')
  }

  const handleImport = async () => {
    const selected = tasks.filter(t => t.selected)
    if (selected.length === 0) { toast.info('No tasks selected'); return }
    setState('importing')
    let imported = 0
    for (const t of selected) {
      try {
        await createTask.mutateAsync({
          projectId,
          title: t.title,
          description: t.description,
          priority: t.priority as any,
          status: t.status as any,
          prompt: t.prompt,
        })
        imported++
      } catch {}
    }
    toast.success(`Imported ${imported} tasks`)
    setRawText('')
    setTasks([])
    setState('idle')
    onOpenChange(false)
  }

  const handleClose = (open: boolean) => {
    if (!open) {
      setRawText('')
      setTasks([])
      setState('idle')
    }
    onOpenChange(open)
  }

  const toggleTask = (i: number) => {
    setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, selected: !t.selected } : t))
  }

  const updateTask = (i: number, field: keyof ParsedTask, value: string) => {
    setTasks(prev => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t))
  }

  const removeTask = (i: number) => {
    setTasks(prev => prev.filter((_, idx) => idx !== i))
  }

  const selectedCount = tasks.filter(t => t.selected).length

  const priorityColors: Record<string, string> = {
    urgent: 'bg-red-500/15 text-red-400',
    high: 'bg-orange-500/15 text-orange-400',
    medium: 'bg-blue-500/15 text-blue-400',
    low: 'bg-muted text-muted-foreground',
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm">Import Tasks</DialogTitle>
        </DialogHeader>

        {(state === 'idle' || state === 'analyzing') && (
          <div className="space-y-3 flex-1">
            <Textarea
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              placeholder={"Paste tasks here — one per line, CSV, bullet points, or free-form notes...\n\nExamples:\n- Fix login page not loading on mobile\n- Add dark mode toggle to settings\n- Refactor API routes to use middleware"}
              className="min-h-[200px] text-xs font-mono resize-none"
              disabled={state === 'analyzing'}
            />
            <div className="flex items-center gap-2">
              {claudeStatus?.configured && (
                <Button
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={handleAnalyze}
                  disabled={!rawText.trim() || state === 'analyzing'}
                >
                  {state === 'analyzing' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {state === 'analyzing' ? 'Analyzing...' : 'Analyze with AI'}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs"
                onClick={handleBasicParse}
                disabled={!rawText.trim() || state === 'analyzing'}
              >
                Quick Import (one per line)
              </Button>
            </div>
          </div>
        )}

        {(state === 'preview' || state === 'importing') && (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {selectedCount} of {tasks.length} tasks selected
              </p>
              <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => { setTasks([]); setState('idle') }}>
                Back to edit
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {tasks.map((task, i) => (
                <div
                  key={i}
                  className={cn(
                    'border rounded-lg p-3 space-y-2 transition-opacity',
                    !task.selected && 'opacity-40'
                  )}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={task.selected}
                      onChange={() => toggleTask(i)}
                      className="mt-1 rounded border-muted-foreground/30"
                    />
                    <input
                      value={task.title}
                      onChange={e => updateTask(i, 'title', e.target.value)}
                      className="flex-1 text-xs font-medium bg-transparent border-none outline-none"
                    />
                    <div className="flex items-center gap-1 shrink-0">
                      <select
                        value={task.priority}
                        onChange={e => updateTask(i, 'priority', e.target.value)}
                        className={cn('text-[10px] px-1.5 py-0.5 rounded-full border-none outline-none cursor-pointer', priorityColors[task.priority])}
                      >
                        <option value="urgent">urgent</option>
                        <option value="high">high</option>
                        <option value="medium">medium</option>
                        <option value="low">low</option>
                      </select>
                      <select
                        value={task.status}
                        onChange={e => updateTask(i, 'status', e.target.value)}
                        className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full border-none outline-none cursor-pointer"
                      >
                        <option value="todo">todo</option>
                        <option value="in_progress">in progress</option>
                        <option value="done">done</option>
                      </select>
                      <button onClick={() => removeTask(i)} className="text-muted-foreground/40 hover:text-red-400 p-0.5">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {task.description && (
                    <p className="text-[11px] text-muted-foreground pl-6 line-clamp-2">{task.description}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-end pt-2 border-t">
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                onClick={handleImport}
                disabled={selectedCount === 0 || state === 'importing'}
              >
                {state === 'importing' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Import className="h-3.5 w-3.5" />
                )}
                {state === 'importing' ? 'Importing...' : `Import ${selectedCount} Tasks`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
