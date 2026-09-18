import { useState } from 'react'
import { Loader2, Rocket, Unlink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useDeployProviders, useDeployStatus, useLinkDeploy, useRailwayProjects, useUnlinkDeploy,
} from '@/hooks/useDeploy'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Which Railway project (and, if it has more than one, which service) this
 * project deploys to. Picked from the account's own list — nobody should have
 * to copy ids out of the Railway dashboard.
 */
export function ProjectDeploySettings({ projectId }: { projectId: string }) {
  const { data: providers } = useDeployProviders()
  const { data: status } = useDeployStatus(projectId)
  const connected = !!providers?.providers?.railway?.connected

  const [picking, setPicking] = useState(false)
  const { data: railway, isLoading, error } = useRailwayProjects(picking && connected)
  const link = useLinkDeploy(projectId)
  const unlink = useUnlinkDeploy(projectId)

  const [selectedProject, setSelectedProject] = useState<string>('')
  const chosen = railway?.projects.find(p => p.id === selectedProject)

  const save = async (input: {
    projectId: string; projectName: string
    environmentId?: string; environmentName?: string
    serviceId?: string; serviceName?: string
  }) => {
    try {
      await link.mutateAsync(input)
      setPicking(false)
      setSelectedProject('')
      toast.success('Railway project linked')
    } catch (err: any) {
      toast.error(err.message || 'Could not link the project')
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

      {status?.configured && !picking && (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <Rocket className="h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium">{status.projectName || 'Railway project'}</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {[status.serviceName, status.environmentName].filter(Boolean).join(' · ') || 'All services'}
            </p>
          </div>
          <Button size="sm" variant="ghost" className="h-7 text-[10px]" onClick={() => setPicking(true)}>
            Change
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title="Unlink"
            disabled={unlink.isPending}
            onClick={async () => {
              await unlink.mutateAsync()
              toast.success('Railway project unlinked')
            }}
          >
            <Unlink className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {!status?.configured && !picking && (
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setPicking(true)}>
          <Rocket className="h-3.5 w-3.5" />
          Link a Railway project
        </Button>
      )}

      {picking && (
        <div className="space-y-2 rounded-md border p-2">
          {isLoading && (
            <p className="flex items-center gap-2 px-1 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Reading your Railway projects…
            </p>
          )}
          {error && (
            <p className="px-1 py-2 text-[11px] text-destructive">{(error as Error).message}</p>
          )}

          {railway && !selectedProject && (
            <div className="max-h-48 space-y-0.5 overflow-y-auto">
              {railway.projects.map(project => (
                <button
                  key={project.id}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onClick={() => {
                    // One service and one environment is the common case — no
                    // point asking a question with a single answer.
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
                      setSelectedProject(project.id)
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
                    className={cn('w-full truncate rounded px-2 py-1.5 text-left text-xs hover:bg-accent')}
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
                    {service.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t pt-2">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px]"
              onClick={() => { setPicking(false); setSelectedProject('') }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
