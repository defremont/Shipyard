import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet, FileJson, FileText, Github, Webhook, Layers,
  LayoutDashboard, BookOpen, ClipboardList, CheckCircle2, Clock, Settings as SettingsIcon,
  Plug,
} from 'lucide-react'
import { getAllDefinitions } from '@/lib/sync/registry'
import { hasAnySyncConfig } from '@/lib/sync/configStore'
import { api, type SyncIntegration, type SyncProviderStatus } from '@/lib/api'
import type { ProviderDefinition, ProviderId } from '@/lib/sync/types'
import type { Project } from '@/hooks/useProjects'
import { cn } from '@/lib/utils'
import { ProviderConnectDialog } from './ProviderConnectDialog'

// Import providers to ensure registration
import '@/lib/sync/providers'

const ICON_MAP: Record<string, React.ElementType> = {
  Sheet, FileJson, FileText, Github, Webhook, Layers,
  LayoutDashboard, BookOpen, ClipboardList,
}

const GLOBAL_PROVIDERS: Array<'trello' | 'clickup'> = ['trello', 'clickup']

interface SyncSettingsCardProps {
  projects: Project[]
}

function getProjectSyncCount(
  providerId: ProviderId,
  projects: Project[],
  serverIntegrations: SyncIntegration[],
): number {
  if (providerId === 'trello' || providerId === 'clickup') {
    const seen = new Set<string>()
    for (const int of serverIntegrations) {
      if (int.providerId === providerId && int.enabled) seen.add(int.projectId)
    }
    return seen.size
  }
  let count = 0
  for (const p of projects) {
    const configured = hasAnySyncConfig(p.id)
    if (configured.includes(providerId)) count++
  }
  return count
}

function ProviderCard({
  def,
  projects,
  serverIntegrations,
  providerStatus,
  onConnect,
}: {
  def: ProviderDefinition
  projects: Project[]
  serverIntegrations: SyncIntegration[]
  providerStatus?: SyncProviderStatus
  onConnect: () => void
}) {
  const Icon = ICON_MAP[def.icon] || FileJson
  const syncCount = def.available ? getProjectSyncCount(def.id, projects, serverIntegrations) : 0
  const isGlobalProvider = (GLOBAL_PROVIDERS as string[]).includes(def.id)
  const isConnected = isGlobalProvider ? (providerStatus?.connected ?? false) : syncCount > 0
  const isExport = def.direction === 'export-only'
  const isComingSoon = !def.available

  return (
    <div className={cn(
      'flex items-start gap-3 p-4 rounded-lg border transition-colors',
      isComingSoon ? 'opacity-50' : 'hover:border-primary/30',
    )}>
      <div className={cn(
        'h-9 w-9 rounded-md flex items-center justify-center shrink-0',
        isConnected ? 'bg-emerald-500/10 text-emerald-500' :
        isExport ? 'bg-blue-500/10 text-blue-500' :
        'bg-muted text-muted-foreground'
      )}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{def.name}</span>
          {isGlobalProvider && isConnected && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-500 border-emerald-500/30">
              <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
              connected
            </Badge>
          )}
          {syncCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
              {syncCount} project{syncCount > 1 ? 's' : ''}
            </Badge>
          )}
          {isExport && !isComingSoon && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-blue-500 border-blue-500/30">
              Export
            </Badge>
          )}
          {isComingSoon && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              <Clock className="h-2.5 w-2.5 mr-0.5" />
              Phase {def.phase}
            </Badge>
          )}
          {def.direction === 'bidirectional' && !isComingSoon && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
              Bidirectional
            </Badge>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5">{def.description}</p>
        {isGlobalProvider && !isComingSoon && (
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            Credentials entered here apply to every project. Enable per-project from the project's Sync menu.
          </p>
        )}
        {!isGlobalProvider && !isComingSoon && !isExport && (
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            Configure per-project in each project's workspace
          </p>
        )}
      </div>
      {isGlobalProvider && !isComingSoon && (
        <Button
          variant={isConnected ? 'outline' : 'default'}
          size="sm"
          onClick={onConnect}
          className="shrink-0 h-7 text-xs"
        >
          {isConnected ? (
            <>
              <SettingsIcon className="h-3 w-3 mr-1.5" />
              Manage
            </>
          ) : (
            <>
              <Plug className="h-3 w-3 mr-1.5" />
              Connect
            </>
          )}
        </Button>
      )}
    </div>
  )
}

export function SyncSettingsCard({ projects }: SyncSettingsCardProps) {
  const definitions = getAllDefinitions()
  const [connectProviderId, setConnectProviderId] = useState<'trello' | 'clickup' | null>(null)

  const { data: providersData } = useQuery({
    queryKey: ['sync', 'providers'],
    queryFn: () => api.listSyncProviders(),
    refetchInterval: 30_000,
  })
  const { data: integrationsData } = useQuery({
    queryKey: ['sync', 'integrations'],
    queryFn: () => api.listIntegrations(),
    refetchInterval: 30_000,
  })

  const providerStatuses = providersData?.providers ?? []
  const serverIntegrations = integrationsData?.integrations ?? []

  const available = definitions.filter(d => d.available)
  const coming = definitions.filter(d => !d.available)

  const handleConnect = (id: ProviderId) => {
    if (id === 'trello' || id === 'clickup') setConnectProviderId(id)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Integrations</CardTitle>
        <CardDescription>
          Connect your Trello or ClickUp account once — then enable sync for any project from its Sync menu.
          Credentials live on this machine (under the Shipyard data folder), never in the repo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Available</p>
          <div className="grid grid-cols-1 gap-2">
            {available.map(def => (
              <ProviderCard
                key={def.id}
                def={def}
                projects={projects}
                serverIntegrations={serverIntegrations}
                providerStatus={providerStatuses.find(p => p.providerId === def.id)}
                onConnect={() => handleConnect(def.id)}
              />
            ))}
          </div>
        </div>

        {coming.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Coming Soon</p>
            <div className="grid grid-cols-1 gap-2">
              {coming.map(def => (
                <ProviderCard
                  key={def.id}
                  def={def}
                  projects={projects}
                  serverIntegrations={serverIntegrations}
                  onConnect={() => handleConnect(def.id)}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>

      {connectProviderId && (
        <ProviderConnectDialog
          providerId={connectProviderId}
          open={!!connectProviderId}
          onOpenChange={(o) => { if (!o) setConnectProviderId(null) }}
        />
      )}
    </Card>
  )
}
