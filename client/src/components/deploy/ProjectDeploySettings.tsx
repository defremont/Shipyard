import { useState } from 'react'
import { Loader2, Rocket, Unlink, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useDeployProviders, useDeployStatuses, useLinkDeploy, useRailwayProjects, useUnlinkDeploy,
} from '@/hooks/useDeploy'
import { toast } from 'sonner'

/**
 * Which Railway service each checkout of this project deploys to.
 *
 * Most of this is filled in automatically by matching git remotes against
 * Railway's own repositories; what is left here is the exception — a checkout
 * whose repo matches several services, or none.
 */
export function ProjectDeploySettings({ projectId, subRepos }: { projectId: string; subRepos?: string[] }) {
  const { data: providers } = useDeployProviders()
  const { data: statuses } = useDeployStatuses(projectId)
  const connected = !!providers?.providers?.railway?.connected

  const [adding, setAdding] = useState(false)
  const [scope, setScope] = useState<string>('')
  const [railwayProject, setRailwayProject] = useState<string>('')
  const { data: railway, isLoading, error } = useRailwayProjects(adding && connected)
  const link = useLinkDeploy(projectId)
  const unlink = useUnlinkDeploy(projectId)

  const linked = (statuses || []).filter(status => status.configured)
  const chosen = railway?.projects.find(p => p.id === railwayProject)
  const checkouts = ['', ...(subRepos || [])]

  const reset = () => { setAdding(false); setScope(''); setRailwayProject('') }

  const save = async (input: {
    projectId: string; projectName: string
    serviceId?: string; serviceName?: string
    environmentId?: string; environmentName?: string
  }) => {
    try {
      await link.mutateAsync({ ...input, ...(scope ? { subrepo: scope } : {}) })
      toast.success(`Linked ${scope || 'the project'} to ${input.serviceName || input.projectName}`)
      reset()
    } catch (err: any) {
      toast.error(err.message || 'Could not link')
    }
  }

  if (!connected) {
    return (
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Deploys</label>
        <p className="text-[11px] text-muted-foreground">
          Connect a Railway token in Settings → AI &amp; Integrations to see build status here.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">Deploys</label>

      {linked.length > 0 && (
        <div className="space-y-1">
          {linked.map(status => (
            <div key={status.subrepo || '__root__'} className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Rocket className="h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  {status.subrepo || 'Project root'}
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {[status.projectName, status.serviceName, status.environmentName].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                title="Unlink"
                disabled={unlink.isPending}
                onClick={async () => {
                  await unlink.mutateAsync(status.subrepo ?? '')
                  toast.success('Unlinked')
                }}
              >
                <Unlink className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {!adding && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" />
          {linked.length > 0 ? 'Link another checkout' : 'Link a Railway project'}
        </Button>
      )}

      {adding && (
        <div className="space-y-2 rounded-md border p-2">
          {/* Which checkout — only worth asking when the project holds several */}
          {checkouts.length > 1 && (
            <div className="space-y-1">
              <p className="px-1 text-[10px] text-muted-foreground">Which checkout?</p>
              <div className="flex flex-wrap gap-1">
                {checkouts.map(value => (
                  <button
                    key={value || '__root__'}
                    className={`rounded border px-1.5 py-0.5 text-[10px] transition-colors hover:bg-accent ${
                      scope === value ? 'border-primary text-primary' : ''
                    }`}
                    onClick={() => setScope(value)}
                  >
                    {value || 'Project root'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLoading && (
            <p className="flex items-center gap-2 px-1 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Reading your Railway projects…
            </p>
          )}
          {error && <p className="px-1 py-2 text-[11px] text-destructive">{(error as Error).message}</p>}

          {railway && !railwayProject && (
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {railway.projects.map(project => (
                <button
                  key={project.id}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    if (project.services.length <= 1) {
                      save({
                        projectId: project.id,
                        projectName: project.name,
                        ...(project.services[0]
                          ? { serviceId: project.services[0].id, serviceName: project.services[0].name }
                          : {}),
                        ...(project.environments.length === 1
                          ? { environmentId: project.environments[0].id, environmentName: project.environments[0].name }
                          : {}),
                      })
                    } else {
                      setRailwayProject(project.id)
                    }
                  }}
                >
                  <span className="truncate">{project.name}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {project.services.length} {project.services.length === 1 ? 'service' : 'services'}
                  </span>
                </button>
              ))}
              {railway.projects.length === 0 && (
                <p className="px-2 py-1.5 text-[11px] text-muted-foreground">This token sees no projects.</p>
              )}
            </div>
          )}

          {chosen && (
            <div className="space-y-1">
              <p className="px-1 text-[10px] text-muted-foreground">
                Which service of <span className="text-foreground">{chosen.name}</span>?
              </p>
              <div className="max-h-48 space-y-0.5 overflow-y-auto">
                {chosen.services.map(service => (
                  <button
                    key={service.id}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                    onClick={() => save({
                      projectId: chosen.id,
                      projectName: chosen.name,
                      serviceId: service.id,
                      serviceName: service.name,
                      ...(chosen.environments.length === 1
                        ? { environmentId: chosen.environments[0].id, environmentName: chosen.environments[0].name }
                        : {}),
                    })}
                  >
                    <span className="truncate">{service.name}</span>
                    {service.repo && (
                      <span className="shrink-0 truncate pl-2 font-mono text-[9px] text-muted-foreground">{service.repo}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-2">
            <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
