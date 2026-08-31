import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Task } from '@/hooks/useTasks'

interface AiResolveDialogProps {
  task: Task | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRun: (feedback: string) => void
}

export function AiResolveDialog({ task, open, onOpenChange, onRun }: AiResolveDialogProps) {
  const [feedback, setFeedback] = useState('')

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) setFeedback('')
    onOpenChange(nextOpen)
  }

  const handleRun = () => {
    const value = feedback.trim()
    setFeedback('')
    onRun(value)
  }

  if (!task) return null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md gap-3">
        <DialogHeader>
          <DialogTitle className="text-sm">Run with AI</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground truncate">
          {task.number != null && <span className="tabular-nums">#{task.number} · </span>}
          {task.title}
        </p>
        <div className="space-y-1.5">
          <label htmlFor="ai-resolve-feedback" className="text-xs font-medium">
            Decision or extra context (optional)
          </label>
          <Textarea
            id="ai-resolve-feedback"
            autoFocus
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                handleRun()
              }
            }}
            placeholder={'e.g. "Use option B", "Skip the migration" — passed to the agent for this run only'}
            className="min-h-[90px] text-xs resize-none"
          />
          <p className="text-[11px] text-muted-foreground/70">
            Ctrl+Enter to run · Tip: Shift-click to run without this dialog
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button size="sm" className="gap-1.5 text-xs" onClick={handleRun}>
            <Sparkles className="h-3.5 w-3.5" />
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
