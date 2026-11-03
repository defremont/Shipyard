import { memo, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, Check, CornerDownLeft, GitCommit, SquareTerminal } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useProjects } from '@/hooks/useProjects'
import { useTerminalTabs, type SessionStatus, type TerminalTabInfo } from '@/hooks/useTerminalTabs'
import { SessionStatusIcon } from '@/components/terminals/SessionStatusIcon'
import { cn } from '@/lib/utils'

/**
 * Every agent and shell of every project on one screen, the ones waiting for
 * an answer first. Each card shows what the session settled on last and
 * whether its project still holds work that was not committed or pushed.
 * Click to open the terminal; a waiting agent can be answered from here.
 */

const GROUPS: { key: string; label: string; statuses: SessionStatus[] }[] = [
  { key: 'question', label: 'Waiting for you', statuses: ['question'] },
  { key: 'finished', label: 'Finished', statuses: ['finished'] },
  { key: 'busy', label: 'Working', statuses: ['busy'] },
  { key: 'rest', label: 'Idle and shells', statuses: ['idle', 'none', 'exited'] },
]

function usePreviews(enabled: boolean) {
  return useQuery({
    queryKey: ['terminal-previews'],
    queryFn: api.getTerminalPreviews,
    enabled,
    // The server only keeps what the watcher already cleaned; this is a map read.
    refetchInterval: 3000,
  })
}

function ProjectGit({ projectId }: { projectId: string }) {
  // Same key as the task rail footer: one fetch serves both.
  const { data } = useQuery({
    queryKey: ['git-pending', projectId],
    queryFn: () => api.getGitPending(projectId),
    refetchInterval: 30000,
  })
  if (!data) return null
  const uncommitted = data.repos.reduce((n, r) => n + r.uncommitted, 0)
  const ahead = data.repos.reduce((n, r) => n + r.ahead, 0)
  if (!uncommitted && !ahead) {
    return <span className="inline-flex items-center gap-1 text-muted-foreground/60"><Check className="h-3 w-3" />pushed</span>
  }
  return (
    <span className="inline-flex items-center gap-2 tabular-nums text-warning">
      {uncommitted > 0 && <span className="inline-flex items-center gap-0.5" title={`${uncommitted} uncommitted`}><GitCommit className="h-3 w-3" />{uncommitted}</span>}
      {ahead > 0 && <span className="inline-flex items-center gap-0.5" title={`${ahead} to push`}><ArrowUp className="h-3 w-3" />{ahead}</span>}
    </span>
  )
}

const AgentCard = memo(function AgentCard({ tab, projectName, lines }: { tab: TerminalTabInfo; projectName: string; lines?: string[] }) {
  const [answer, setAnswer] = useState('')
  const waiting = tab.status === 'question'

  const open = () => window.dispatchEvent(new CustomEvent('shipyard:focus-terminal', { detail: { sessionId: tab.sessionId } }))

  const send = async () => {
    const text = answer.trim()
    if (!text) return
    try {
      // Typed, then Enter a moment later: a burst ending in \r can read as a paste.
      await api.writeToTerminalSession(tab.sessionId, text)
      await new Promise(r => setTimeout(r, 150))
      await api.writeToTerminalSession(tab.sessionId, '\r')
      setAnswer('')
    } catch (err: any) {
      toast.error(err.message || 'Could not send')
    }
  }

  return (
    <div
      className={cn(
        'anim-rise flex min-w-0 flex-col rounded-lg border bg-card transition-colors hover:border-muted-foreground/30',
        waiting && 'border-warning/50',
      )}
    >
      <button onClick={open} className="flex min-w-0 items-center gap-2 border-b px-3 py-2 text-left" title="Open this terminal">
        <SessionStatusIcon status={tab.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{tab.label || 'Terminal'}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{projectName}</span>
        </span>
        <SquareTerminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      </button>
      <button onClick={open} className="min-h-[92px] flex-1 overflow-hidden px-3 py-2 text-left">
        {lines?.length ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.45] text-muted-foreground">
            {lines.join('\n')}
          </pre>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">Nothing printed yet</span>
        )}
      </button>
      {waiting && (
        <form
          onSubmit={(e) => { e.preventDefault(); void send() }}
          className="flex items-center gap-1.5 border-t px-2 py-1.5"
        >
          <input
            value={answer}
            onChange={e => setAnswer(e.target.value)}
            placeholder="Answer (1, 2… picks an option)"
            className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <button type="submit" title="Send" className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground">
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
        </form>
      )}
      <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11px]">
        <span className="text-muted-foreground/70">git</span>
        <ProjectGit projectId={tab.projectId} />
      </div>
    </div>
  )
})

export function AgentsPage() {
  const tabs = useTerminalTabs()
  const { data: projects } = useProjects()
  const { data } = usePreviews(tabs.length > 0)
  const names = useMemo(() => new Map((projects || []).map(p => [p.id, p.name])), [projects])

  const groups = useMemo(() => GROUPS.map(g => ({
    ...g,
    tabs: tabs
      .filter(t => g.statuses.includes(t.status))
      .sort((a, b) => (names.get(a.projectId) || a.projectId).localeCompare(names.get(b.projectId) || b.projectId)),
  })).filter(g => g.tabs.length), [tabs, names])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-6 py-5">
        <div className="mb-4 flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">Agents</h1>
          <span className="text-xs text-muted-foreground">
            {tabs.length ? `${tabs.length} session${tabs.length === 1 ? '' : 's'} in ${new Set(tabs.map(t => t.projectId)).size} project(s)` : 'No terminal open'}
          </span>
        </div>
        {groups.length === 0 && (
          <p className="text-sm text-muted-foreground">Open Claude YOLO or a shell in any project and it shows up here.</p>
        )}
        {groups.map(g => (
          <section key={g.key} className="mb-6">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {g.label} <span className="tabular-nums text-muted-foreground/50">{g.tabs.length}</span>
            </h2>
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]">
              {g.tabs.map(tab => (
                <AgentCard
                  key={tab.sessionId}
                  tab={tab}
                  projectName={names.get(tab.projectId) || tab.projectId}
                  lines={data?.previews[tab.sessionId]?.lines}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
