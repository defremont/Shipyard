import { ArrowUp, CheckCircle2, CircleDashed, ExternalLink, GitCommitHorizontal, Loader2, TriangleAlert, HelpCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAllDeployStatus, useDeployStatuses, useScopeDeployStatuses } from '@/hooks/useDeploy'
import { useGitStatus } from '@/hooks/useGit'
import type { DeployState, DeployStatus } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Did the last build go up? One pill in the project toolbar, so the answer
 * doesn't need a trip to the Railway dashboard.
 *
 * A project can have several deploys at once — a client folder with a dozen
 * sub-repositories, or one repository deployed once per city — so the pill
 * speaks for all of them: the worst state wins, and the popover lists each one.
 *
 * A project with nothing linked shows nothing at all; this must not add chrome
 * to the projects that don't use it.
 */

const STATE_CONFIG: Record<DeployState, { label: string; icon: typeof CheckCircle2; className: string; spin?: boolean }> = {
  success: { label: 'Deployed', icon: CheckCircle2, className: 'text-success' },
  failed: { label: 'Deploy failed', icon: TriangleAlert, className: 'text-destructive' },
  building: { label: 'Building', icon: Loader2, className: 'text-warning', spin: true },
  idle: { label: 'No deploys', icon: CircleDashed, className: 'text-muted-foreground' },
  unknown: { label: 'Deploy', icon: HelpCircle, className: 'text-muted-foreground' },
}

/** A failure has to win, or one broken service hides behind four green ones. */
const STATE_RANK: Record<DeployState, number> = {
  failed: 0,
  building: 1,
  unknown: 2,
  success: 3,
  idle: 4,
}

function worstState(statuses: DeployStatus[]): DeployState {
  return statuses
    .map(status => (status.error ? 'unknown' : status.state))
    .sort((a, b) => STATE_RANK[a] - STATE_RANK[b])[0] ?? 'unknown'
}

function relative(date?: string): string {
  if (!date) return ''
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true })
  } catch {
    return ''
  }
}

/**
 * What names this deploy in a list. The service is what tells two deploys of the
 * same checkout apart, so it wins; the sub-repository is only added when the
 * project has more than one checkout to confuse.
 */
function scopeLabel(status: DeployStatus): string {
  const name = status.serviceName || status.projectName
  if (status.subrepo && name) return `${status.subrepo} · ${name}`
  return status.subrepo || name || 'root'
}

/**
 * What the checkout still holds back from the deploy: uncommitted changes and
 * commits not pushed yet. The row only mounts while the popover is open, so this
 * polls git only while someone is looking — and it shares the git panel's query
 * key, so the same checkout is never asked twice.
 */
function PendingGit({ projectId, subrepo, deployBranch }: {
  projectId: string
  subrepo?: string
  deployBranch?: string
}) {
  const { data: git } = useGitStatus(projectId, subrepo || undefined)
  if (!git) return null

  const uncommitted = (git.files || []).length as number
  const ahead = (git.ahead || 0) as number
  const current = git.current as string | undefined
  const otherBranch = !!deployBranch && !!current && current !== deployBranch

  if (uncommitted === 0 && ahead === 0 && git.tracking) {
    return (
      <p className="text-muted-foreground">
        Nothing to commit or push{otherBranch && <> · on <span className="font-mono">{current}</span></>}
      </p>
    )
  }

  return (
    <p className="flex flex-wrap items-center gap-x-2 text-warning">
      {uncommitted > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <GitCommitHorizontal className="h-2.5 w-2.5" />
          {uncommitted} uncommitted
        </span>
      )}
      {ahead > 0 && (
        <span className="inline-flex items-center gap-0.5">
          <ArrowUp className="h-2.5 w-2.5" />
          {ahead} to push
        </span>
      )}
      {!git.tracking && <span>no upstream branch</span>}
      {otherBranch && (
        <span className="text-muted-foreground">on <span className="font-mono">{current}</span>, deploys <span className="font-mono">{deployBranch}</span></span>
      )}
    </p>
  )
}

/** One deploy, as a row in the popover. */
function DeployRow({ projectId, status }: { projectId: string; status: DeployStatus }) {
  const config = STATE_CONFIG[status.state]
  const Icon = status.error ? HelpCircle : config.icon

  return (
    <div className="space-y-0.5 border-t pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5 shrink-0', status.error ? 'text-muted-foreground' : config.className, !status.error && config.spin && 'animate-spin')} />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{scopeLabel(status)}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {status.error ? 'unknown' : relative(status.deployedAt)}
        </span>
      </div>

      <div className="space-y-0.5 pl-5 text-[10px] text-muted-foreground">
        {status.error ? (
          <p>{status.error}</p>
        ) : (
          <>
            {(status.projectName || status.serviceName) && (
              <p className="truncate">{[status.projectName, status.serviceName].filter(Boolean).join(' · ')}</p>
            )}
            {status.commitMessage && (
              <p className="truncate text-foreground/70">
                {status.commitHash && <span className="font-mono">{status.commitHash} </span>}
                {status.commitMessage}
              </p>
            )}
          </>
        )}
        <PendingGit projectId={projectId} subrepo={status.subrepo} deployBranch={status.branch} />
        <div className="flex items-center gap-3 pt-0.5">
          {status.url && (
            <a href={status.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink className="h-2.5 w-2.5" />
              App
            </a>
          )}
          {status.consoleUrl && (
            <a href={status.consoleUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              <ExternalLink className="h-2.5 w-2.5" />
              Railway
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function Pill({ projectId, statuses, className }: { projectId: string; statuses: DeployStatus[]; className?: string }) {
  const state = worstState(statuses)
  const config = STATE_CONFIG[state]
  const Icon = config.icon
  const single = statuses.length === 1 ? statuses[0] : null

  // With one checkout the pill says what happened; with several it says how
  // many, since "Deployed" would be a claim about all of them.
  const label = single
    ? (single.error ? 'Deploy?' : config.label)
    : state === 'failed'
      ? `${statuses.filter(s => s.state === 'failed').length} of ${statuses.length} failed`
      : state === 'building'
        ? `${statuses.filter(s => s.state === 'building').length} building`
        : `${statuses.length} deploys`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title={statuses.map(s => `${scopeLabel(s)}: ${s.error ? 'unknown' : STATE_CONFIG[s.state].label}`).join('\n')}
          className={cn(
            'inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium transition-colors hover:bg-accent',
            config.className,
            className
          )}
        >
          <Icon className={cn('h-2.5 w-2.5', config.spin && 'animate-spin')} />
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-80 w-72 space-y-2 overflow-y-auto p-3">
        {statuses.map(status => (
          <DeployRow key={status.id || status.subrepo || '__root__'} projectId={projectId} status={status} />
        ))}
      </PopoverContent>
    </Popover>
  )
}

/** Every deploy of a project, folded into one pill. */
export function DeployBadge({ projectId, className }: { projectId: string; className?: string }) {
  const { data: statuses } = useDeployStatuses(projectId)
  const linked = (statuses || []).filter(status => status.configured)
  if (linked.length === 0) return null
  return <Pill projectId={projectId} statuses={linked} className={className} />
}

/** One checkout's deploys — used beside the repository picker in Source Control. */
export function DeployScopeBadge({ projectId, subrepo, className }: {
  projectId: string
  subrepo?: string
  className?: string
}) {
  const { data: statuses } = useScopeDeployStatuses(projectId, subrepo)
  const linked = (statuses || []).filter(status => status.configured)
  if (linked.length === 0) return null
  return <Pill projectId={projectId} statuses={linked} className={className} />
}

/** Just the icon, for dense lists like the dashboard cards — one shared query. */
export function DeployDot({ projectId }: { projectId: string }) {
  const { data } = useAllDeployStatus()
  const statuses = (data?.statuses?.[projectId] || []).filter(status => status.configured && !status.error)
  if (statuses.length === 0) return null

  const state = worstState(statuses)
  if (state === 'idle' || state === 'unknown') return null

  const config = STATE_CONFIG[state]
  const Icon = config.icon
  const title = statuses.length === 1
    ? `${config.label} ${relative(statuses[0].deployedAt)}`.trim()
    : `${statuses.length} deploys · ${config.label}`

  return (
    <span title={title} className="inline-flex items-center">
      <Icon className={cn('h-3 w-3', config.className, config.spin && 'animate-spin')} />
    </span>
  )
}
