import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Rocket, Check, Loader2, Trash2, RefreshCw, ExternalLink } from 'lucide-react'
import {
  useAutoLinkDeploys, useConnectRailway, useDeployMatches, useDeployProviders, useDisconnectRailway,
  useLinkDeploy,
} from '@/hooks/useDeploy'
import type { DeployMatch } from '@/lib/api'
import { toast } from 'sonner'

/**
 * Connecting Railway is one field and one button: the token goes in, and every
 * project whose git remote matches a Railway service is linked on the same
 * click. Only the genuinely ambiguous ones — one repo, several services — come
 * back as a question.
 */

const TOKEN_URL = 'https://railway.com/account/tokens'

/**
 * One repo, several Railway services. Sometimes that is a choice — staging next
 * to production — and sometimes all of them are wanted at once, as when a
 * marketplace runs one service per city. So each service is a toggle, already
 * linked ones are marked, and "Watch all" takes the whole row.
 */
function AmbiguousMatch({ match }: { match: DeployMatch }) {
  const link = useLinkDeploy(match.projectId)
  const linked = new Set(match.linkedServiceIds)

  const watch = async (candidate: DeployMatch['candidates'][number]) => {
    await link.mutateAsync({
      projectId: candidate.railwayProjectId,
      projectName: candidate.railwayProjectName,
      serviceId: candidate.serviceId,
      serviceName: candidate.serviceName,
      ...(match.subrepo ? { subrepo: match.subrepo } : {}),
      ...(candidate.environmentId ? { environmentId: candidate.environmentId } : {}),
      ...(candidate.environmentName ? { environmentName: candidate.environmentName } : {}),
    })
  }

  const pending = match.candidates.filter(candidate => !linked.has(candidate.serviceId))

  return (
    <div className="space-y-1.5 rounded-md border px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-[11px]">
          <span className="font-medium">{match.projectName}</span>
          {match.subrepo && <span className="text-foreground/70"> / {match.subrepo}</span>}
          <span className="font-mono text-[10px] text-muted-foreground"> · {match.repo}</span>
          {match.linked && (
            <span className="text-[10px] text-success"> · {match.linkedServiceIds.length} watched</span>
          )}
        </p>
        {pending.length > 1 && (
          <button
            disabled={link.isPending}
            className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-primary transition-colors hover:bg-accent"
            onClick={async () => {
              try {
                for (const candidate of pending) await watch(candidate)
                toast.success(`Watching ${pending.length} deploys of ${match.subrepo || match.projectName}`)
              } catch (err: any) {
                toast.error(err.message || 'Could not link')
              }
            }}
          >
            Watch all {pending.length}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {match.candidates.map(candidate => {
          const already = linked.has(candidate.serviceId)
          return (
            <button
              key={candidate.serviceId}
              disabled={already || link.isPending}
              className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent disabled:hover:bg-transparent ${
                already ? 'border-success/40 text-success' : ''
              }`}
              onClick={async () => {
                try {
                  await watch(candidate)
                  toast.success(`${match.subrepo || match.projectName} → ${candidate.serviceName}`)
                } catch (err: any) {
                  toast.error(err.message || 'Could not link')
                }
              }}
            >
              {candidate.railwayProjectName} · {candidate.serviceName}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function RailwaySettingsCard() {
  const { data } = useDeployProviders()
  const connect = useConnectRailway()
  const disconnect = useDisconnectRailway()
  const autoLink = useAutoLinkDeploys()
  const [token, setToken] = useState('')

  const connected = !!data?.providers?.railway?.connected
  const { data: report, isFetching: matching } = useDeployMatches(connected)

  const linkedCount = report?.matched.filter(m => m.linked).length ?? 0
  const pending = report?.matched.filter(m => !m.linked) ?? []

  const save = async () => {
    if (!token.trim()) return
    try {
      const result = await connect.mutateAsync(token.trim())
      setToken('')
      const count = result.linked?.length || 0
      toast.success(
        count > 0
          ? `Railway connected — ${count} checkout${count === 1 ? '' : 's'} linked by repository`
          : 'Railway connected'
      )
    } catch (err: any) {
      toast.error(err.message || 'Railway refused the token')
    }
  }

  const rescan = async () => {
    try {
      const result = await autoLink.mutateAsync({})
      toast.success(
        result.linked.length > 0
          ? `Linked ${result.linked.length} checkout${result.linked.length === 1 ? '' : 's'}`
          : 'Nothing new to link'
      )
    } catch (err: any) {
      toast.error(err.message || 'Could not read your Railway projects')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          Railway deploys
          {connected && (
            <span className="inline-flex items-center gap-1 text-[10px] font-normal text-success">
              <Check className="h-3 w-3" />
              connected
            </span>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Show in each project whether its last build went up. Paste an account token — projects are matched to Railway services by their GitHub repository, so there is nothing else to set up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={connected ? 'Replace the saved token…' : 'Railway account token'}
            className="h-8 text-xs"
            onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          />
          <Button size="sm" className="h-8 text-xs" onClick={save} disabled={!token.trim() || connect.isPending}>
            {connect.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : connected ? 'Replace' : 'Connect'}
          </Button>
          {connected && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              title="Remove the saved token"
              disabled={disconnect.isPending}
              onClick={async () => {
                await disconnect.mutateAsync()
                toast.success('Railway token removed')
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {!connected && (
          <a
            href={TOKEN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Create a token at railway.com/account/tokens
          </a>
        )}

        {connected && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-muted-foreground">
                {matching && !report
                  ? 'Reading your Railway projects…'
                  : `${linkedCount} checkout${linkedCount === 1 ? '' : 's'} linked by repository`}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-[10px]"
                disabled={autoLink.isPending}
                onClick={rescan}
              >
                <RefreshCw className={autoLink.isPending ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
                Rescan
              </Button>
            </div>

            {report && !report.sourceAvailable && (
              <p className="text-[11px] text-muted-foreground">
                Railway did not say which repository each service builds, so projects have to be linked by hand in Project settings → Launch.
              </p>
            )}

            {pending.length > 0 && (
              <p className="text-[11px] text-warning">
                {pending.length} more could be linked — press Rescan.
              </p>
            )}

            {report && report.ambiguous.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Several services build the same repository — pick the ones to watch, or all of them when the same code deploys once per city or tenant.
                </p>
                {report.ambiguous.map(match => (
                  <AmbiguousMatch key={`${match.projectId}::${match.subrepo || '__root__'}`} match={match} />
                ))}
              </div>
            )}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground">
          Read-only use: Shipyard only asks for the latest deployment. It never redeploys or rolls back.
        </p>
      </CardContent>
    </Card>
  )
}
