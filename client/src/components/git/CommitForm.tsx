import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useGitCommit, useGitPush } from '@/hooks/useGit'
import { useLaunchTerminal } from '@/hooks/useProjects'
import { toast } from 'sonner'

interface CommitFormProps {
  projectId: string
  hasStagedChanges: boolean
}

export function CommitForm({ projectId, hasStagedChanges }: CommitFormProps) {
  const [message, setMessage] = useState('')
  const gitCommit = useGitCommit()
  const gitPush = useGitPush()
  const launchTerminal = useLaunchTerminal()

  const handleAICommit = () => {
    const prompt = 'Veja as mudanças staged com git diff --cached, faça o commit com uma mensagem simples e descritiva. Só commitar, sem push.'
    navigator.clipboard.writeText(prompt)
    const skipPerm = localStorage.getItem('devdash:skipPermissions') === 'true'
    launchTerminal.mutate(
      { projectId, type: skipPerm ? 'claude-yolo' : 'claude' },
      { onSuccess: () => toast.success('Claude aberto — cole o prompt') }
    )
  }

  const handleCommit = () => {
    if (!message.trim()) return
    gitCommit.mutate(
      { projectId, message },
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
      { projectId, message },
      {
        onSuccess: () => {
          setMessage('')
          gitPush.mutate(projectId, {
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
        <Input
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Commit message..."
          className="text-sm"
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleCommit()}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={!hasStagedChanges}
          onClick={handleAICommit}
          title="Abrir Claude para commitar"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1 h-8 text-xs"
          disabled={!message.trim() || !hasStagedChanges || gitCommit.isPending}
          onClick={handleCommit}
        >
          Commit
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1 h-8 text-xs"
          disabled={!message.trim() || !hasStagedChanges || gitCommit.isPending}
          onClick={handleCommitAndPush}
        >
          Commit & Push
        </Button>
      </div>
    </div>
  )
}
