import { useState } from 'react'
import { Sparkles, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useGitCommit, useGitPush, useGenerateCommitMessage } from '@/hooks/useGit'
import { useClaudeStatus } from '@/hooks/useClaude'
import { toast } from 'sonner'
import { playAiCompleteSound } from '@/lib/sounds'

interface CommitFormProps {
  projectId: string
  hasStagedChanges: boolean
  subrepo?: string
}

export function CommitForm({ projectId, hasStagedChanges, subrepo }: CommitFormProps) {
  const [message, setMessage] = useState('')
  const gitCommit = useGitCommit()
  const gitPush = useGitPush()
  const generateMsg = useGenerateCommitMessage()
  const { data: claudeStatus } = useClaudeStatus()

  const aiAvailable = claudeStatus?.cliAvailable || claudeStatus?.configured
  const isBusy = gitCommit.isPending || gitPush.isPending

  const handleGenerate = () => {
    generateMsg.mutate({ projectId, subrepo }, {
      onSuccess: (data) => {
        setMessage(data.message)
        playAiCompleteSound()
        const source = data.source === 'cli' ? 'CLI' : 'API'
        toast.success(`Message generated (${source})`)
      },
      onError: (err) => toast.error(err.message),
    })
  }

  const handleCommit = () => {
    if (!message.trim()) return
    gitCommit.mutate(
      { projectId, message, subrepo },
      {
        onSuccess: () => {
          toast.success('Committed successfully')
          setMessage('')
        },
        onError: (err) => toast.error(`Commit failed: ${err.message}`),
      }
    )
  }

  const handleCommitAndPush = () => {
    if (!message.trim()) return
    gitCommit.mutate(
      { projectId, message, subrepo },
      {
        onSuccess: () => {
          setMessage('')
          gitPush.mutate({ projectId, subrepo }, {
            onSuccess: () => toast.success('Committed and pushed'),
            onError: (err) => toast.error(`Push failed: ${err.message}`),
          })
        },
        onError: (err) => toast.error(`Commit failed: ${err.message}`),
      }
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <Textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Commit message..."
          className="text-sm min-h-[60px] max-h-[200px] resize-y"
          rows={2}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleCommit()
            }
          }}
          onInput={e => {
            const el = e.target as HTMLTextAreaElement
            el.style.height = 'auto'
            el.style.height = Math.min(el.scrollHeight, 200) + 'px'
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={!hasStagedChanges || !aiAvailable || generateMsg.isPending}
          onClick={handleGenerate}
          title={aiAvailable ? 'Generate commit message with AI' : 'Install Claude CLI or configure API key'}
        >
          {generateMsg.isPending
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Sparkles className="h-4 w-4" />
          }
        </Button>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 h-8 text-xs"
          disabled={!message.trim() || !hasStagedChanges || isBusy}
          onClick={handleCommit}
        >
          {gitCommit.isPending ? 'Committing...' : 'Commit'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-8 text-xs"
          disabled={!message.trim() || !hasStagedChanges || isBusy}
          onClick={handleCommitAndPush}
        >
          {gitPush.isPending ? 'Pushing...' : 'Commit & Push'}
        </Button>
      </div>
    </div>
  )
}
