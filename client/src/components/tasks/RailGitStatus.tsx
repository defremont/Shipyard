import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowUp, Check, GitBranch, GitCommit } from 'lucide-react'
import { api, type GitPendingRepo } from '@/lib/api'
import type { Project } from '@/hooks/useProjects'
import { useActivity } from '@/hooks/useActivity'
import { useTerminalTabs } from '@/hooks/useTerminalTabs'
import { cn } from '@/lib/utils'

// A branch without upstream is not flagged: a repo with no remote at all would
// read "not pushed" forever.
function pending(r: GitPendingRepo): boolean {
  return r.uncommitted > 0 || r.ahead > 0
}

/**
 * Bottom of the task list beside the agents: did the work reach the remote?
 * One line when every repo is clean; otherwise one row per repo that still
 * holds uncommitted files or commits not pushed. Refreshed when an agent of
 * this project finishes, so the answer is there the moment it stops.
 */
export function RailGitStatus({ project }: { project: Project }) {
  const hasRepo = project.isGitRepo || (project.subRepos?.length ?? 0) > 0
  const { data, refetch } = useQuery({
    queryKey: ['git-pending', project.id],
    queryFn: () => api.getGitPending(project.id),
    enabled: hasRepo,
    refetchInterval: 20000,
  })
  const { openActivity } = useActivity()

  // An agent of this project just stopped: ask again instead of waiting for the poll.
  const sessions = useTerminalTabs()
  const finished = useMemo(
    () => sessions.filter(s => s.projectId === project.id && (s.status === 'finished' || s.status === 'idle' || s.status === 'exited')).length,
    [sessions, project.id],
  )
  const lastFinished = useRef(finished)
  useEffect(() => {
    if (finished > lastFinished.current) void refetch()
    lastFinished.current = finished
  }, [finished, refetch])

  if (!hasRepo || !data) return null
  const dirty = data.repos.filter(pending)
  const multi = data.repos.length > 1

  const open = (repo: string | null) => {
    window.dispatchEvent(new CustomEvent('shipyard:select-git-repo', { detail: { projectId: project.id, repo } }))
    openActivity('git')
  }

  return (
    <div className="shrink-0 border-t px-3 py-2 text-[11px]">
      {dirty.length === 0 ? (
        <button
          onClick={() => open(null)}
          title="Everything committed and pushed"
          className="flex w-full items-center gap-1.5 text-muted-foreground/70 transition-colors hover:text-foreground"
        >
          <Check className="h-3 w-3" />
          {multi ? `${data.repos.length} repos clean` : 'Committed and pushed'}
        </button>
      ) : (
        <>
          <div className="mb-1 text-muted-foreground">
            {multi ? `${dirty.length} of ${data.repos.length} repos with work not pushed` : 'Work not pushed'}
          </div>
          <div className="max-h-28 space-y-0.5 overflow-y-auto scrollbar-dark">
            {dirty.map(r => (
              <button
                key={r.repo ?? '__root__'}
                onClick={() => open(r.repo)}
                title="Open in Source Control"
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-accent"
              >
                <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                <span className="min-w-0 flex-1 truncate">{r.repo ?? project.name}</span>
                <span className={cn('flex shrink-0 items-center gap-1.5 tabular-nums text-warning')}>
                  {r.uncommitted > 0 && (
                    <span className="inline-flex items-center gap-0.5" title={`${r.uncommitted} uncommitted`}>
                      <GitCommit className="h-2.5 w-2.5" />{r.uncommitted}
                    </span>
                  )}
                  {r.ahead > 0 && (
                    <span className="inline-flex items-center gap-0.5" title={`${r.ahead} to push`}>
                      <ArrowUp className="h-2.5 w-2.5" />{r.ahead}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
