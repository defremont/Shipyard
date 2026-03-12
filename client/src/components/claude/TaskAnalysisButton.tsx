import { Button } from '@/components/ui/button'
import { useClaudeStatus, useAnalyzeTask } from '@/hooks/useClaude'
import { Sparkles, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

interface TaskAnalysisButtonProps {
  projectId: string
  taskId?: string
  title: string
  onResult: (result: { description: string; prompt: string }) => void
}

export function TaskAnalysisButton({ projectId, taskId, title, onResult }: TaskAnalysisButtonProps) {
  const { data: status } = useClaudeStatus()
  const analyze = useAnalyzeTask()

  if (!status?.configured && !status?.cliAvailable) return null

  const handleAnalyze = async () => {
    if (!title.trim()) {
      toast.error('Enter a task title first')
      return
    }
    try {
      const result = await analyze.mutateAsync({ projectId, title, taskId })
      onResult(result)
      toast.success('AI analysis complete')
    } catch (err: any) {
      toast.error(err.message || 'Analysis failed')
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleAnalyze}
      disabled={analyze.isPending || !title.trim()}
      className="gap-1.5 text-xs"
      title="Use Claude AI to analyze this task and generate description/details"
    >
      {analyze.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      AI Analyze
    </Button>
  )
}
