import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TerminalSquare } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * A terminal tab opened for a task is named after the task. A plain shell has
 * nothing to name it, so the AI backend writes a short label from the
 * terminal's own output. It runs on the CLI first, so it costs nothing per
 * token — but it is still a call, hence the switch.
 */
export function TerminalTitleSettingsCard() {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
    staleTime: 30_000,
  })

  const save = useMutation({
    mutationFn: (enabled: boolean) => api.updateSettings({ terminalAiTitles: enabled }),
    onSuccess: (settings) => {
      queryClient.setQueryData(['settings'], settings)
      toast.success(settings.terminalAiTitles === false ? 'AI tab names off' : 'AI tab names on')
    },
    onError: (err: any) => toast.error(err.message || 'Could not save the setting'),
  })

  const enabled = data?.terminalAiTitles !== false

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-primary" />
          Terminal tab names
        </CardTitle>
        <CardDescription className="text-xs">
          A tab opened for a task carries the task's number and title. This names the other tabs too.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <button
          onClick={() => save.mutate(!enabled)}
          disabled={save.isPending}
          className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 transition-colors hover:bg-accent/50"
        >
          <div className="text-left">
            <span className="text-sm font-medium">Let the AI name shell tabs</span>
            <p className="text-xs text-muted-foreground">
              A short label written from what the terminal shows, refreshed at most once a minute per tab. Renaming a tab by hand always wins.
            </p>
          </div>
          <div className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', enabled ? 'bg-primary' : 'bg-muted')}>
            <div className={cn(
              'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
              enabled ? 'translate-x-4' : 'translate-x-0.5'
            )} />
          </div>
        </button>
      </CardContent>
    </Card>
  )
}
