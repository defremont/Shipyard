import { useState } from 'react'
import { Loader2, Wand2, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useClaudeStatus } from '@/hooks/useClaude'
import { useTerminalStatus } from '@/hooks/useTerminal'
import { type Task } from '@/hooks/useTasks'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface TaskManagerDialogProps {
  projectId: string
  tasks: Task[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TaskManagerDialog({ projectId, tasks, open, onOpenChange }: TaskManagerDialogProps) {
  const { data: claudeStatus } = useClaudeStatus()
  const { data: terminalStatus } = useTerminalStatus()
  const [rawText, setRawText] = useState('')
  const [loading, setLoading] = useState(false)

  const aiAvailable = claudeStatus?.configured || claudeStatus?.cliAvailable
  const hasIntegrated = terminalStatus?.available ?? false

  const handleRunInCli = async () => {
    if (!rawText.trim()) return
    if (!hasIntegrated) {
      toast.error('Integrated terminal required for AI Task Manager')
      return
    }
    setLoading(true)
    try {
      const { prompt } = await api.getAiManagePrompt(projectId, rawText)
      window.dispatchEvent(new CustomEvent('shipyard:open-terminal', {
        detail: { projectId, type: 'ai-manage', prompt }
      }))
      toast.success('AI Task Manager started in terminal')
      setRawText('')
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || 'Failed to start AI Task Manager')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = (open: boolean) => {
    if (!open) {
      setRawText('')
      setLoading(false)
    }
    onOpenChange(open)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Wand2 className="h-4 w-4" />
            AI Task Manager
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 flex-1">
          <p className="text-xs text-muted-foreground">
            Paste any text — task lists, meeting notes, client emails, bug reports — and AI will organize them into tasks.
            It can also update existing tasks, detect duplicates, and handle instructions like "mark all X as done".
          </p>
          <Textarea
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            placeholder={"Paste anything here...\n\nExamples:\n- Fix login page not loading on mobile\n- Add dark mode toggle to settings\n- Mark all auth tasks as done\n- The checkout flow needs validation on the email field (URGENT)"}
            className="min-h-[220px] text-xs font-mono resize-none"
            disabled={loading}
            autoFocus
          />
          {tasks.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              AI will compare against {tasks.length} existing task{tasks.length !== 1 ? 's' : ''} to avoid duplicates
            </p>
          )}
          <div className="flex items-center gap-2">
            {aiAvailable && hasIntegrated ? (
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                onClick={handleRunInCli}
                disabled={!rawText.trim() || loading}
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Terminal className="h-3.5 w-3.5" />
                )}
                {loading ? 'Starting...' : 'Run in CLI'}
              </Button>
            ) : !aiAvailable ? (
              <p className="text-xs text-muted-foreground">
                Install Claude CLI or configure API key in Settings to use AI features
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Integrated terminal required — install node-pty
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
