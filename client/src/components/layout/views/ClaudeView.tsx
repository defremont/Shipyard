import { useState } from 'react'
import { Sparkles, Terminal, Settings, Check, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useTabs } from '@/hooks/useTabs'
import { useProjects } from '@/hooks/useProjects'
import { useClaudeStatus } from '@/hooks/useClaude'
import { ClaudeConfigDialog } from '@/components/claude/ClaudeConfigDialog'
import { ChatPanel } from '@/components/claude/ChatPanel'
import { TerminalLauncher } from '@/components/terminals/TerminalLauncher'

export function ClaudeView() {
  const { activeTabId } = useTabs()
  const { data: projects } = useProjects()
  const project = projects?.find(p => p.id === activeTabId)
  const { data: status } = useClaudeStatus()
  const [configOpen, setConfigOpen] = useState(false)

  const cli = !!status?.cliAvailable
  const api = !!status?.configured

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Claude AI</span>
          {cli && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 gap-1 bg-green-500/10 border-green-500/30 text-green-400">
              <Terminal className="h-2.5 w-2.5" />
              CLI
            </Badge>
          )}
          {api && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 gap-1 bg-blue-500/10 border-blue-500/30 text-blue-400">
              <Check className="h-2.5 w-2.5" />
              API
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setConfigOpen(true)} title="Settings">
          <Settings className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto scrollbar-dark px-3 py-3 space-y-3 min-h-0">
        {!cli && !api && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs text-muted-foreground space-y-2">
            <div className="flex items-center gap-1.5 text-yellow-400 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              Claude not configured
            </div>
            <p>Install the <code className="bg-muted px-1 rounded text-[11px]">claude</code> CLI for free AI features, or add an API key.</p>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => setConfigOpen(true)}>
              <Settings className="h-3 w-3" />
              Configure
            </Button>
          </div>
        )}

        {project ? (
          <>
            <TerminalLauncher
              projectId={project.id}
              projectPath={project.path}
              projectName={project.name}
            />

            {(cli || api) && (
              <div className="border-t pt-3">
                <ChatPanel projectId={project.id} />
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground/70 text-center py-8">
            Open a project to launch terminals, run AI, and chat with Claude using its context.
          </p>
        )}
      </div>

      <ClaudeConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  )
}
