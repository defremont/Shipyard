import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, Sparkles } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import type { EffortPoints } from '@/hooks/useTasks'

type Suggestion = {
  taskId: string
  title: string
  effort: EffortPoints
  confidence: 'low' | 'medium' | 'high'
  rationale: string
  selected: boolean
}

export function EffortBackfillDialog({ projectId, open, onOpenChange }: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [state, setState] = useState<'idle' | 'classifying' | 'review' | 'applying'>('idle')

  const classify = async () => {
    setState('classifying')
    try {
      const result = await api.classifyTaskEffort(projectId)
      setSuggestions(result.suggestions.map(item => ({ ...item, selected: true })))
      setState('review')
      if (result.suggestions.length === 0) toast.info('All tasks already have effort estimates')
    } catch (error: any) {
      toast.error(error.message || 'Effort classification failed')
      setState('idle')
    }
  }

  const apply = async () => {
    const selected = suggestions.filter(item => item.selected)
    if (selected.length === 0) return
    setState('applying')
    try {
      const result = await api.applyTaskEffort(projectId, selected.map(({ taskId, effort, confidence }) => ({ taskId, effort, confidence })))
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      queryClient.invalidateQueries({ queryKey: ['task-forecast', projectId] })
      toast.success(`Effort added to ${result.updated} tasks`)
      onOpenChange(false)
      setSuggestions([])
      setState('idle')
    } catch (error: any) {
      toast.error(error.message || 'Could not apply effort')
      setState('review')
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && state !== 'applying') {
      setSuggestions([])
      setState('idle')
    }
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Classify historical effort</DialogTitle>
        </DialogHeader>

        {state === 'idle' && (
          <div className="space-y-4 text-sm text-muted-foreground">
            <p>Claude will suggest Fibonacci effort for every task without an estimate, using only its title, description, technical details, and subtasks.</p>
            <p>Measured duration is deliberately hidden from Claude. You can review every suggestion before anything is saved.</p>
            <Button onClick={classify} className="gap-2"><Sparkles className="h-4 w-4" />Classify missing effort</Button>
          </div>
        )}

        {state === 'classifying' && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />Classifying tasks with Claude...
          </div>
        )}

        {(state === 'review' || state === 'applying') && (
          <div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">
            {suggestions.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No unclassified tasks found.</p>
            ) : suggestions.map((item, index) => (
              <div key={item.taskId} className="flex items-start gap-3 rounded-md border p-3">
                <input
                  type="checkbox"
                  checked={item.selected}
                  onChange={() => setSuggestions(current => current.map((value, i) => i === index ? { ...value, selected: !value.selected } : value))}
                  className="mt-1 rounded border-border"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{item.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{item.rationale || 'No rationale provided'} - {item.confidence} confidence</div>
                </div>
                <select
                  value={item.effort}
                  onChange={event => setSuggestions(current => current.map((value, i) => i === index ? { ...value, effort: Number(event.target.value) as EffortPoints } : value))}
                  className="rounded-md border bg-background px-2 py-1 text-xs"
                >
                  {[1, 2, 3, 5, 8].map(value => <option key={value} value={value}>{value} pts</option>)}
                </select>
              </div>
            ))}
          </div>
        )}

        {(state === 'review' || state === 'applying') && suggestions.length > 0 && (
          <DialogFooter>
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={state === 'applying'}>Cancel</Button>
            <Button onClick={apply} disabled={state === 'applying' || !suggestions.some(item => item.selected)}>
              {state === 'applying' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply selected
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}