import { CheckCircle2, CircleDashed, ExternalLink, Loader2, TriangleAlert, HelpCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAllDeployStatus, useDeployStatus } from '@/hooks/useDeploy'
import type { DeployState, DeployStatus } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * Did the last build go up? One pill in the project toolbar, so the answer
 * doesn't need a trip to the Railway dashboard.
 *
 * A project with no deploy linked shows nothing at all — this must not add
 * chrome to the projects that don't use it.
 */

const STATE_CONFIG: Record<DeployState, { label: string; icon: typeof CheckCircle2; className: string; spin?: boolean }> = {
  success: { label: 'Deployed', icon: CheckCircle2, className: 'text-success' },
  failed: { label: 'Deploy failed', icon: TriangleAlert, className: 'text-destructive' },
  building: { label: 'Building', icon: Loader2, className: 'text-warning', spin: true },
  idle: { label: 'No deploys', icon: CircleDashed, className: 'text-muted-foreground' },
  unknown: { label: 'Deploy', icon: HelpCircle, className: 'text-muted-foreground' },
}

function relative(date?: string): string {
  if (!date) return ''
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true })
  } catch {
    return ''
  }
}

function DeployDetail({ status }: { status: DeployStatus }) {
  const config = STATE_CONFIG[status.state]
  const Icon = config.icon
  const where = [status.projectName, status.serviceName, status.environmentName].filter(Boolean).join(' · ')

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', config.className, config.spin && 'animate-spin')} />
        <span className="text-xs font-medium">{status.error ? 'Deploy status unavailable' : config.label}</span>
        {status.rawStatus && !status.error && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{status.rawStatus}</span>
        )}
      </div>

      {status.error ? (
        <p className="text-[11px] text-muted-foreground">{status.error}</p>
      ) : (
        <div className="space-y-1 text-[11px] text-muted-foreground">
          {where && <p className="truncate">{where}</p>}
          {status.deployedAt && <p>{relative(status.deployedAt)}</p>}
          {status.commitMessage && (
            <p className="truncate text-foreground/80">
              {status.commitHash && <span className="font-mono text-muted-foreground">{status.commitHash} </span>}
              {status.commitMessage}
            </p>
          )}
          {status.branch && <p className="font-mono">{status.branch}</p>}
        </div>
      )}

      <div className="flex items-center gap-3 border-t pt-2">
        {status.url && (
          <a
            href={status.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Open app
          </a>
        )}
        {status.consoleUrl && (
          <a
            href={status.consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Railway
          </a>
        )}
      </div>
    </div>
  )
}

export function DeployBadge({ projectId, className }: { projectId: string; className?: string }) {
  const { data: status } = useDeployStatus(projectId)
  if (!status?.configured) return null

  const config = STATE_CONFIG[status.state]
  const Icon = status.error ? HelpCircle : config.icon
  const when = relative(status.deployedAt)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          title={status.error || `${config.label}${when ? ` ${when}` : ''}`}
          className={cn(
            'inline-flex h-5 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium transition-colors hover:bg-accent',
            status.error ? 'text-muted-foreground' : config.className,
            className
          )}
        >
          <Icon className={cn('h-2.5 w-2.5', !status.error && config.spin && 'animate-spin')} />
          <span>{status.error ? 'Deploy?' : config.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <DeployDetail status={status} />
      </PopoverContent>
    </Popover>
  )
}

/** Just the dot, for dense lists like the dashboard cards — one shared query. */
export function DeployDot({ projectId }: { projectId: string }) {
  const { data } = useAllDeployStatus()
  const status = data?.statuses?.[projectId]
  if (!status?.configured || status.error || status.state === 'idle' || status.state === 'unknown') return null

  const config = STATE_CONFIG[status.state]
  const Icon = config.icon
  return (
    <span title={`${config.label} ${relative(status.deployedAt)}`.trim()} className="inline-flex items-center">
      <Icon className={cn('h-3 w-3', config.className, config.spin && 'animate-spin')} />
    </span>
  )
}
