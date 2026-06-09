import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useClaudeStatus } from '@/hooks/useClaude'
import { ClaudeConfigDialog } from './ClaudeConfigDialog'
import { Sparkles, Settings, Check, Terminal } from 'lucide-react'

const BACKEND_LABELS: Record<string, string> = {
  'cli-oauth': 'Claude CLI (subscription)',
  'cli': 'Claude CLI',
  'api': 'API key',
}

export function ClaudeSettingsCard() {
  const { data: status } = useClaudeStatus()
  const [configOpen, setConfigOpen] = useState(false)

  const hasAny = status?.configured || status?.cliAvailable
  const activeLabel = status?.activeBackend ? BACKEND_LABELS[status.activeBackend] : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          Claude AI
          {status?.cliAvailable && (
            <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-green-600">
              <Terminal className="h-2.5 w-2.5 mr-0.5" />
              CLI
            </Badge>
          )}
          {status?.configured && (
            <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-blue-600">
              <Check className="h-2.5 w-2.5 mr-0.5" />
              API
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          All AI features (chat, commit messages, task analysis, bulk organize) use the Claude CLI first —
          it runs on your subscription at no extra cost. A pay-per-use API key is an optional fallback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Active backend */}
        {activeLabel && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-2.5">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            Active backend: <span className="font-medium text-foreground">{activeLabel}</span>
          </div>
        )}

        {/* CLI status */}
        <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
          <div>
            <p className="text-sm font-medium">Claude CLI <span className="text-muted-foreground font-normal">(recommended)</span></p>
            <p className="text-xs text-muted-foreground">
              {status?.cliAvailable
                ? 'Connected — uses your Claude subscription, no per-token cost'
                : <>Not found — install with <code className="bg-muted px-1 rounded">npm i -g @anthropic-ai/claude-code</code> then run <code className="bg-muted px-1 rounded">claude</code> once to log in</>}
            </p>
          </div>
          <div className={`h-2 w-2 rounded-full shrink-0 ${status?.cliAvailable ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
        </div>

        {/* API status */}
        <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
          <div>
            <p className="text-sm font-medium">API Key {!status?.configured && <span className="text-muted-foreground font-normal">(optional fallback)</span>}</p>
            <p className="text-xs text-muted-foreground">
              {status?.configured
                ? `Model: ${status.model || 'Default'} — used only when the CLI is unavailable`
                : 'Pay-per-use Anthropic API key, used only when the CLI is unavailable'}
            </p>
          </div>
          {status?.configured ? (
            <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)} className="gap-1 h-7 text-xs">
              <Settings className="h-3 w-3" />
              Edit
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)} className="gap-1 h-7 text-xs">
              Setup
            </Button>
          )}
        </div>

        {/* Feature list */}
        {hasAny && (
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Available features:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>Streaming chat panel in workspace sidebar</li>
              <li>1-click commit message generation</li>
              <li>AI Analyze in task editor</li>
              <li>Bulk import with AI organization</li>
              <li>AI task resolution in the integrated terminal</li>
              <li>Project-aware context in all interactions</li>
            </ul>
          </div>
        )}

        {!hasAny && (
          <div className="text-center py-2">
            <p className="text-xs text-muted-foreground">
              Install the Claude Code CLI (<code className="bg-muted px-1 rounded">claude</code>) for AI features on your subscription, or add an API key below.
            </p>
          </div>
        )}
      </CardContent>
      <ClaudeConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
    </Card>
  )
}
