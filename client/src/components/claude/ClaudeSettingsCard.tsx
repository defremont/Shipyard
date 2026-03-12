import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useClaudeStatus } from '@/hooks/useClaude'
import { ClaudeConfigDialog } from './ClaudeConfigDialog'
import { Sparkles, Settings, Check, Terminal } from 'lucide-react'

export function ClaudeSettingsCard() {
  const { data: status } = useClaudeStatus()
  const [configOpen, setConfigOpen] = useState(false)

  const hasAny = status?.configured || status?.cliAvailable

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
          AI features use your Claude CLI subscription (free) first, with API key as optional fallback for streaming chat.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* CLI status */}
        <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
          <div>
            <p className="text-sm font-medium">Claude CLI</p>
            <p className="text-xs text-muted-foreground">
              {status?.cliAvailable
                ? 'Detected — uses your monthly subscription'
                : 'Not found — install Claude Code CLI for free AI features'}
            </p>
          </div>
          <div className={`h-2 w-2 rounded-full ${status?.cliAvailable ? 'bg-green-500' : 'bg-muted-foreground/30'}`} />
        </div>

        {/* API status */}
        <div className="flex items-center justify-between bg-muted/30 rounded-lg p-3">
          <div>
            <p className="text-sm font-medium">API Key {!status?.configured && <span className="text-muted-foreground font-normal">(optional)</span>}</p>
            <p className="text-xs text-muted-foreground">
              {status?.configured
                ? `Model: ${status.model || 'Default'} — enables streaming chat`
                : 'Optional pay-per-use fallback for streaming chat'}
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
              <li>Chat panel in workspace sidebar {status?.configured ? '(streaming)' : '(single-turn via CLI)'}</li>
              <li>1-click commit message generation</li>
              <li>AI Analyze in task editor</li>
              <li>Bulk import with AI organization</li>
              <li>Project-aware context in all interactions</li>
            </ul>
          </div>
        )}

        {!hasAny && (
          <div className="text-center py-2">
            <p className="text-xs text-muted-foreground">
              Install the Claude Code CLI (<code className="bg-muted px-1 rounded">claude</code>) for free AI features, or add an API key below.
            </p>
          </div>
        )}
      </CardContent>
      <ClaudeConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
    </Card>
  )
}
