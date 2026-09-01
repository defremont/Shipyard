import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useAiStatus, useSetPreferredAiProvider } from '@/hooks/useAi'
import { AI_PROVIDERS, AI_PROVIDER_ORDER, BACKEND_LABELS } from '@/lib/aiProviders'
import type { AiProvider, AiProviderStatus } from '@/lib/api'
import { AiProviderDialog } from './AiProviderDialog'
import { Sparkles, Settings, Terminal, Key } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

function ProviderRow({ status, onConfigure }: { status: AiProviderStatus; onConfigure: () => void }) {
  const meta = AI_PROVIDERS[status.provider]
  const connected = status.activeBackend !== null

  return (
    <div className="flex items-center justify-between gap-3 bg-muted/30 rounded-lg p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium flex items-center gap-2">
          {meta.label}
          {status.cliAvailable && (
            <span className="inline-flex items-center gap-1 text-[10px] text-success">
              <Terminal className="h-2.5 w-2.5" />
              {meta.cliCommand}
            </span>
          )}
          {status.apiConfigured && (
            <span className="inline-flex items-center gap-1 text-[10px] text-primary">
              <Key className="h-2.5 w-2.5" />
              key
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {status.cliAvailable
            ? meta.cliBlurb
            : <>CLI not found — install with <code className="bg-muted px-1 rounded">{meta.cliInstall}</code>, then run <code className="bg-muted px-1 rounded">{meta.cliCommand}</code> once to log in</>}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className={cn('h-2 w-2 rounded-full', connected ? 'bg-success' : 'bg-muted-foreground/30')} />
        <Button variant="outline" size="sm" onClick={onConfigure} className="gap-1 h-7 text-xs">
          {status.apiConfigured ? <><Settings className="h-3 w-3" />Edit key</> : 'Add key'}
        </Button>
      </div>
    </div>
  )
}

export function AiSettingsCard() {
  const { data: status } = useAiStatus()
  const setPreferred = useSetPreferredAiProvider()
  const [dialogProvider, setDialogProvider] = useState<AiProvider | null>(null)

  const byId = new Map((status?.providers ?? []).map(p => [p.provider, p]))
  const active = status?.activeProvider ? byId.get(status.activeProvider) : undefined
  const activeLabel = status?.activeBackend ? BACKEND_LABELS[status.activeBackend] : null

  const choose = async (provider: AiProvider) => {
    if (provider === status?.preferredProvider) return
    try {
      await setPreferred.mutateAsync(provider)
    } catch (err: any) {
      toast.error(err.message || 'Failed to change provider')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          AI
        </CardTitle>
        <CardDescription>
          Chat, commit messages, task analysis and bulk import all run through one backend.
          Each provider tries its CLI first — that runs on your subscription at no extra cost —
          and falls back to an API key. If the preferred provider has nothing available, the
          others are tried in turn.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Preferred provider */}
        <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-lg">
          {AI_PROVIDER_ORDER.map(provider => (
            <button
              key={provider}
              onClick={() => choose(provider)}
              className={cn(
                'flex-1 text-xs font-medium rounded-md py-1.5 transition-colors',
                provider === status?.preferredProvider
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {AI_PROVIDERS[provider].label}
            </button>
          ))}
        </div>

        {active && activeLabel && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-2.5">
            <div className="h-2 w-2 rounded-full bg-success" />
            Answering now: <span className="font-medium text-foreground">{active.label} — {activeLabel}</span>
            {active.provider !== status?.preferredProvider && (
              <span className="text-warning">(preferred provider unavailable)</span>
            )}
          </div>
        )}

        {(status?.providers ?? []).map(provider => (
          <ProviderRow
            key={provider.provider}
            status={provider}
            onConfigure={() => setDialogProvider(provider.provider)}
          />
        ))}

        {status && !status.activeProvider && (
          <p className="text-xs text-muted-foreground text-center py-2">
            No AI backend yet. Install one of the CLIs above, or add an API key.
          </p>
        )}
      </CardContent>

      {dialogProvider && (
        <AiProviderDialog
          provider={dialogProvider}
          status={byId.get(dialogProvider)}
          open
          onOpenChange={open => { if (!open) setDialogProvider(null) }}
        />
      )}
    </Card>
  )
}
