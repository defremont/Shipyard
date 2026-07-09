import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  RefreshCw, LayoutDashboard, ClipboardList, CheckCircle2, XCircle, Loader2,
  ExternalLink, Upload, Download, ArrowLeftRight, Plug, Link2,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { api, type SyncIntegration, type SyncProviderStatus } from '@/lib/api'
import { SheetSyncPanel } from '@/components/tasks/SheetSyncPanel'
import { useMilestones } from '@/hooks/useMilestones'
import type { Task } from '@/hooks/useTasks'

// A unified "Sync" menu that lives in the project toolbar. Every integration
// is scoped to a single milestone — switching the active milestone in the
// kanban changes which Trello board / ClickUp list / Google Sheet this menu
// configures. The default milestone uses id 'default' (the General column).
//
// Credentials for Trello/ClickUp are held globally in the server store
// (Settings → Integrations). This menu only toggles whether *this* milestone
// of *this* project participates and, for ClickUp, which Space the tasks
// go into.

type ProviderId = 'trello' | 'clickup'

const DEFAULT_MILESTONE = 'default'

function normalizeMilestone(milestoneId?: string): string {
  return milestoneId && milestoneId !== '' ? milestoneId : DEFAULT_MILESTONE
}

interface Props {
  projectId: string
  projectName: string
  milestoneId?: string
  tasks: Task[]
}

export function SyncMenu({ projectId, projectName, milestoneId, tasks }: Props) {
  const [open, setOpen] = useState(false)
  const activeMilestone = normalizeMilestone(milestoneId)

  const { data: providersData } = useQuery({
    queryKey: ['sync', 'providers'],
    queryFn: () => api.listSyncProviders(),
    enabled: open,
  })
  const { data: integrationsData, refetch: refetchIntegrations } = useQuery({
    queryKey: ['sync', 'integrations', projectId],
    queryFn: () => api.listIntegrations(projectId),
    enabled: open,
  })
  const { data: milestones } = useMilestones(projectId)

  const providers = providersData?.providers ?? []
  const integrations = integrationsData?.integrations ?? []

  const milestoneName = useMemo(() => {
    if (activeMilestone === DEFAULT_MILESTONE) return 'General'
    return milestones?.find(m => m.id === activeMilestone)?.name ?? activeMilestone
  }, [activeMilestone, milestones])

  // Find the integration for the active milestone (one record per milestone now).
  const findIntegration = (providerId: ProviderId): SyncIntegration | undefined =>
    integrations.find(i => i.providerId === providerId && i.milestoneId === activeMilestone)

  const trelloInt = findIntegration('trello')
  const clickupInt = findIntegration('clickup')
  const trelloProv = providers.find(p => p.providerId === 'trello')
  const clickupProv = providers.find(p => p.providerId === 'clickup')

  // "Any enabled" used to color the toolbar icon — count any milestone of this
  // project, so the icon stays lit when the user isn't on the active one.
  const anyEnabled = integrations.some(i => i.enabled)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5">
              <RefreshCw className={cn('h-3.5 w-3.5', anyEnabled && 'text-success')} />
              Sync
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Sync tasks with Google Sheets, Trello or ClickUp</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-[420px] p-0" align="end">
        <div className="p-3 border-b">
          <div className="text-xs font-semibold flex items-center gap-2">
            Sync integrations
            <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">
              Milestone: {milestoneName}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Each milestone gets its own board / list / sheet. Switch milestone in the kanban toolbar to configure another.
          </p>
        </div>

        <div className="p-3 space-y-3 max-h-[60vh] overflow-y-auto">
          {/* Google Sheets keeps its own self-contained panel (already milestone-scoped) */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">Google Sheets</span>
              <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">
                per milestone
              </Badge>
            </div>
            <div className="pl-0.5">
              <SheetSyncPanel projectId={projectId} milestoneId={milestoneId} tasks={tasks} />
            </div>
          </div>

          <div className="border-t -mx-3" />

          <ProjectProviderRow
            providerId="trello"
            providerLabel="Trello"
            providerIcon={LayoutDashboard}
            providerColor="text-sky-500"
            providerStatus={trelloProv}
            integration={trelloInt}
            projectId={projectId}
            projectName={projectName}
            milestoneId={activeMilestone}
            milestoneName={milestoneName}
            onChanged={refetchIntegrations}
          />

          <div className="border-t -mx-3" />

          <ProjectProviderRow
            providerId="clickup"
            providerLabel="ClickUp"
            providerIcon={ClipboardList}
            providerColor="text-purple-500"
            providerStatus={clickupProv}
            integration={clickupInt}
            projectId={projectId}
            projectName={projectName}
            milestoneId={activeMilestone}
            milestoneName={milestoneName}
            onChanged={refetchIntegrations}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ProjectProviderRow({
  providerId,
  providerLabel,
  providerIcon: Icon,
  providerColor,
  providerStatus,
  integration,
  projectId,
  projectName,
  milestoneId,
  milestoneName,
  onChanged,
}: {
  providerId: ProviderId
  providerLabel: string
  providerIcon: React.ElementType
  providerColor: string
  providerStatus?: SyncProviderStatus
  integration?: SyncIntegration
  projectId: string
  projectName: string
  milestoneId: string
  milestoneName: string
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const connected = providerStatus?.connected ?? false
  const enabled = integration?.enabled ?? false
  const [busy, setBusy] = useState<'push' | 'pull' | 'merge' | null>(null)
  const [spaceId, setSpaceId] = useState<string>(integration?.settings?.spaceId ?? '')

  // Link-to-existing state
  const [linkMode, setLinkMode] = useState(false)
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkItems, setLinkItems] = useState<Array<{ id: string; name: string; url?: string }>>([])
  const [pickedLinkId, setPickedLinkId] = useState('')
  const [linking, setLinking] = useState(false)

  // Keep spaceId in sync when the integration updates from the server.
  if (integration?.settings?.spaceId && spaceId !== integration.settings.spaceId && !spaceId) {
    setSpaceId(integration.settings.spaceId)
  }

  const saveMutation = useMutation({
    mutationFn: (body: { settings?: Record<string, any>; enabled?: boolean; autoSync?: boolean }) =>
      api.saveIntegration(projectId, providerId, { ...body, milestoneId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', 'integrations'] })
      onChanged()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const disableMutation = useMutation({
    mutationFn: () => api.deleteIntegration(projectId, providerId, milestoneId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sync', 'integrations'] })
      onChanged()
      toast.success(`${providerLabel} disabled for ${milestoneName}`)
    },
  })

  async function handleToggleEnabled() {
    if (!connected) {
      toast.error(`Connect ${providerLabel} first (Settings → Integrations)`)
      return
    }
    if (enabled) {
      disableMutation.mutate()
      return
    }
    if (providerId === 'clickup' && !spaceId) {
      toast.error('Pick a ClickUp Space first')
      return
    }
    await saveMutation.mutateAsync({
      enabled: true,
      // Bidirectional sync runs as soon as the integration is enabled —
      // setting autoSync alongside keeps the persisted flag consistent
      // with what actually happens.
      autoSync: true,
      settings: {
        projectName,
        // Pass the milestone name so the auto-created board/list is named
        // "Shipyard · Project · Milestone" instead of just "Shipyard · Project".
        ...(milestoneId !== 'default' ? { milestoneName } : {}),
        ...(providerId === 'clickup' ? { spaceId } : {}),
      },
    })
    toast.success(`${providerLabel} enabled for ${milestoneName} — bidirectional sync is on`)
  }

  async function enterLinkMode() {
    if (providerId === 'clickup' && !spaceId) {
      toast.error('Pick a ClickUp Space first')
      return
    }
    setLinkMode(true)
    setPickedLinkId('')
    setLinkLoading(true)
    try {
      if (providerId === 'trello') {
        const { boards } = await api.listTrelloBoards()
        setLinkItems(boards.map(b => ({ id: b.id, name: b.name, url: b.url })))
      } else {
        const { lists } = await api.listClickupLists(spaceId)
        setLinkItems(lists.map(l => ({ id: l.id, name: l.name, url: l.url })))
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load')
      setLinkMode(false)
    } finally {
      setLinkLoading(false)
    }
  }

  async function confirmLink() {
    if (!pickedLinkId) return
    setLinking(true)
    try {
      const result = providerId === 'trello'
        ? await api.linkTrelloBoard(projectId, pickedLinkId, milestoneId)
        : await api.linkClickupList(projectId, spaceId, pickedLinkId, milestoneId)
      toast.success(result.message || `Linked to existing ${providerLabel}`)
      setLinkMode(false)
      queryClient.invalidateQueries({ queryKey: ['sync', 'integrations'] })
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      onChanged()
    } catch (err: any) {
      toast.error(err?.message || 'Link failed')
    } finally {
      setLinking(false)
    }
  }

  async function runAction(kind: 'push' | 'pull' | 'merge') {
    setBusy(kind)
    try {
      const call =
        kind === 'push' ? api.pushIntegration :
        kind === 'pull' ? api.pullIntegration :
        api.mergeIntegration
      const result = await call(projectId, providerId, milestoneId)
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
      if (kind !== 'push') {
        queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
        queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      }
      queryClient.invalidateQueries({ queryKey: ['sync', 'integrations'] })
      onChanged()
    } catch (err: any) {
      toast.error(err?.message || 'Operation failed')
    } finally {
      setBusy(null)
    }
  }

  const lastSyncLabel = integration?.lastSyncAt
    ? formatDistanceToNow(new Date(integration.lastSyncAt), { addSuffix: true })
    : null
  const remoteUrl = integration?.state?.boardUrl || integration?.state?.listUrl

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', providerColor)} />
        <span className="text-xs font-medium">{providerLabel}</span>
        {!connected && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">
            not connected
          </Badge>
        )}
        {connected && enabled && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 text-success border-success/30">
            <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" />
            enabled · {milestoneName}
          </Badge>
        )}
        {integration?.lastSyncStatus === 'error' && (
          <Badge variant="outline" className="text-[9px] px-1 py-0 text-red-500 border-red-500/30">
            <XCircle className="h-2.5 w-2.5 mr-0.5" />
            error
          </Badge>
        )}
        {remoteUrl && (
          <a
            href={remoteUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
          >
            Open <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>

      {!connected ? (
        <p className="text-[11px] text-muted-foreground">
          Go to <span className="font-medium">Settings → Integrations → {providerLabel}</span> to paste your API credentials once.
        </p>
      ) : (
        <>
          {providerId === 'clickup' && (
            <ClickUpSpacePicker value={spaceId} onChange={setSpaceId} disabled={enabled && !!integration?.settings?.spaceId} />
          )}

          <label className="flex items-start gap-2 p-2 rounded-md border cursor-pointer hover:bg-accent/30">
            <input
              type="checkbox"
              checked={enabled}
              onChange={handleToggleEnabled}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <div className="flex-1">
              <div className="text-xs font-medium">Enable sync for {milestoneName}</div>
              <p className="text-[10px] text-muted-foreground">
                {providerId === 'trello'
                  ? `Creates a dedicated Trello board on first push: "Shipyard · ${projectName}${milestoneId !== 'default' ? ` · ${milestoneName}` : ''}".`
                  : `Creates a dedicated ClickUp list inside the selected space: "Shipyard · ${projectName}${milestoneId !== 'default' ? ` · ${milestoneName}` : ''}".`}
              </p>
            </div>
          </label>

          {!enabled && !linkMode && (
            <button
              type="button"
              onClick={enterLinkMode}
              className="flex items-center gap-1.5 text-[11px] text-primary hover:underline w-fit"
            >
              <Link2 className="h-3 w-3" />
              Already have a {providerId === 'trello' ? 'board' : 'list'}? Link to existing
            </button>
          )}

          {linkMode && (
            <div className="space-y-2 p-2 rounded-md border bg-accent/30">
              <div className="text-[11px] font-medium">
                Link {milestoneName} to existing {providerId === 'trello' ? 'board' : 'list'}
              </div>
              {linkLoading ? (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading {providerId === 'trello' ? 'boards' : 'lists'}…
                </div>
              ) : linkItems.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  No open {providerId === 'trello' ? 'boards' : 'lists'} found in your account{providerId === 'clickup' ? ' for this space' : ''}.
                </p>
              ) : (
                <Select value={pickedLinkId} onValueChange={setPickedLinkId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={`Choose a ${providerId === 'trello' ? 'board' : 'list'}`} />
                  </SelectTrigger>
                  <SelectContent>
                    {linkItems.map(it => (
                      <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[10px] text-muted-foreground">
                Local tasks of this milestone matching remote items by title will be re-linked. Unmatched remote items can be pulled as new tasks (assigned to {milestoneName}).
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  onClick={confirmLink}
                  disabled={!pickedLinkId || linking}
                  className="h-7 text-xs"
                >
                  {linking && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  Link
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLinkMode(false)}
                  disabled={linking}
                  className="h-7 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {enabled && (
            <p className="text-[10px] text-muted-foreground px-1">
              Local edits push to {providerLabel} ~2.5s after the change. Remote
              edits pull every 30s. Use the buttons below for an immediate one-off.
            </p>
          )}

          {enabled && (
            <div className="flex items-center gap-1 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => runAction('push')} disabled={busy !== null} className="h-7 text-xs">
                {busy === 'push' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                Push
              </Button>
              <Button variant="outline" size="sm" onClick={() => runAction('pull')} disabled={busy !== null} className="h-7 text-xs">
                {busy === 'pull' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Download className="h-3 w-3 mr-1" />}
                Pull
              </Button>
              <Button variant="outline" size="sm" onClick={() => runAction('merge')} disabled={busy !== null} className="h-7 text-xs">
                {busy === 'merge' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <ArrowLeftRight className="h-3 w-3 mr-1" />}
                Sync
              </Button>
              {lastSyncLabel && (
                <span className="text-[10px] text-muted-foreground ml-auto">
                  Last: {lastSyncLabel}
                </span>
              )}
            </div>
          )}

          {integration?.lastSyncError && (
            <p className="text-[10px] text-red-500 truncate">{integration.lastSyncError}</p>
          )}
        </>
      )}
    </div>
  )
}

function ClickUpSpacePicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const [loading, setLoading] = useState(false)
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([])
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string; private: boolean }>>([])
  const [teamId, setTeamId] = useState<string>('')

  async function loadTeams() {
    setLoading(true)
    try {
      const { teams: t = [] } = await api.clickupDiscover({})
      setTeams(t)
      if (t.length === 1) {
        setTeamId(t[0].id)
        const { spaces: sp = [] } = await api.clickupDiscover({ teamId: t[0].id })
        setSpaces(sp)
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not load workspaces')
    } finally {
      setLoading(false)
    }
  }

  async function selectTeam(id: string) {
    setTeamId(id)
    setLoading(true)
    try {
      const { spaces: sp = [] } = await api.clickupDiscover({ teamId: id })
      setSpaces(sp)
    } catch (err: any) {
      toast.error(err?.message || 'Could not load spaces')
    } finally {
      setLoading(false)
    }
  }

  if (disabled) {
    return (
      <div className="text-[10px] text-muted-foreground border rounded p-2">
        Space: <code>{value}</code>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-medium text-muted-foreground">Space</span>
        <Button variant="outline" size="sm" onClick={loadTeams} disabled={loading} className="h-6 text-[10px] ml-auto">
          {loading && <Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />}
          Load workspaces
        </Button>
      </div>
      {teams.length > 0 && (
        <Select value={teamId} onValueChange={selectTeam}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Workspace" /></SelectTrigger>
          <SelectContent>
            {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
      {spaces.length > 0 && (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Space" /></SelectTrigger>
          <SelectContent>
            {spaces.map(s => <SelectItem key={s.id} value={s.id}>{s.name}{s.private ? ' (private)' : ''}</SelectItem>)}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

// Keep the Plug icon import referenced so the bundler doesn't complain
// in dev mode; used conditionally when nothing is connected yet.
void Plug
