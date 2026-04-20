import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  CheckCircle2, XCircle, Trash2, Upload, Download, ArrowLeftRight,
  ExternalLink, Loader2, KeyRound, ShieldCheck,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { getProvider } from '@/lib/sync/registry'
import { api, type SyncIntegration } from '@/lib/api'
import type { ConfigField, ProviderId } from '@/lib/sync/types'
import type { Project } from '@/hooks/useProjects'

interface Props {
  providerId: Extract<ProviderId, 'trello' | 'clickup'>
  projects: Project[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProviderConfigDialog({ providerId, projects, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()
  const provider = getProvider(providerId)
  const def = provider?.definition

  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [settings, setSettings] = useState<Record<string, any>>({})
  const [autoSync, setAutoSync] = useState(false)
  const [integration, setIntegration] = useState<SyncIntegration | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState<'push' | 'pull' | 'merge' | null>(null)

  // ClickUp discovery state
  const [teams, setTeams] = useState<Array<{ id: string; name: string }>>([])
  const [spaces, setSpaces] = useState<Array<{ id: string; name: string; private: boolean }>>([])
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const [discovering, setDiscovering] = useState(false)

  const selectedProject = useMemo(
    () => projects.find(p => p.id === selectedProjectId),
    [projects, selectedProjectId],
  )

  useEffect(() => {
    if (!open) return
    if (!selectedProjectId && projects[0]) setSelectedProjectId(projects[0].id)
  }, [open, projects, selectedProjectId])

  // Load existing integration for this project.
  useEffect(() => {
    if (!open || !selectedProjectId) return
    let cancelled = false
    api.listIntegrations(selectedProjectId).then(({ integrations }) => {
      if (cancelled) return
      const found = integrations.find(i => i.providerId === providerId) ?? null
      setIntegration(found)
      setAutoSync(found?.autoSync ?? false)
      const s = found?.settings ?? {}
      // When settings already exist, settings values for secrets come back as
      // presence flags (apiKeySet / tokenSet). Only populate non-secret fields;
      // leave the password inputs blank so the user doesn't see "••••••••" text.
      const nextSettings: Record<string, any> = {}
      for (const field of def?.configFields ?? []) {
        if (field.type === 'password') continue
        if (s[field.key] !== undefined) nextSettings[field.key] = s[field.key]
      }
      setSettings(nextSettings)
      setTestResult(null)
      setTeams([])
      setSpaces([])
      setSelectedTeamId('')
    }).catch(() => {
      if (!cancelled) setIntegration(null)
    })
    return () => { cancelled = true }
  }, [open, selectedProjectId, providerId, def])

  if (!def || !provider) return null

  const isConfigured = !!integration
  const hasSecret = (k: string) => integration?.settings?.[`${k}Set`] === true || !!settings[k]
  const missingFields = def.configFields.filter(f => f.required && !hasSecret(f.key))

  async function refreshIntegration() {
    if (!selectedProjectId) return
    const { integrations } = await api.listIntegrations(selectedProjectId)
    setIntegration(integrations.find(i => i.providerId === providerId) ?? null)
  }

  async function handleSave(): Promise<boolean> {
    if (!selectedProjectId) return false
    if (missingFields.length > 0) {
      toast.error(`Missing: ${missingFields.map(m => m.label).join(', ')}`)
      return false
    }
    try {
      // Only send fields the user actually typed, so empty password inputs
      // don't wipe the stored secret.
      const body: Record<string, any> = { ...settings, projectName: selectedProject?.name }
      for (const field of def?.configFields ?? []) {
        if (field.type === 'password' && !settings[field.key]) delete body[field.key]
      }
      const { integration: saved } = await api.saveIntegration(selectedProjectId, providerId, {
        settings: body,
        autoSync,
      })
      setIntegration(saved)
      toast.success(`${def?.name} saved`)
      return true
    } catch (err: any) {
      toast.error(err?.message || 'Save failed')
      return false
    }
  }

  async function handleTest() {
    if (!selectedProjectId) return
    setTesting(true)
    try {
      const overrides: Record<string, any> = {}
      for (const field of def?.configFields ?? []) {
        if (settings[field.key]) overrides[field.key] = settings[field.key]
      }
      const result = await api.testIntegration(selectedProjectId, providerId,
        Object.keys(overrides).length > 0 ? overrides : undefined)
      setTestResult(result)
      if (result.ok) toast.success(result.message)
      else toast.error(result.message)
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || 'Test failed' })
      toast.error(err?.message || 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  async function handleAction(kind: 'push' | 'pull' | 'merge') {
    if (!selectedProjectId) return
    // Save any pending edits first so operations use fresh creds.
    if (Object.values(settings).some(v => typeof v === 'string' && v.length > 0)) {
      const ok = await handleSave()
      if (!ok) return
    }
    setBusy(kind)
    try {
      const call =
        kind === 'push' ? api.pushIntegration :
        kind === 'pull' ? api.pullIntegration :
        api.mergeIntegration
      const result = await call(selectedProjectId, providerId)
      await refreshIntegration()
      // Pull may have created/updated local tasks — invalidate task queries.
      if (kind === 'pull' || kind === 'merge') {
        queryClient.invalidateQueries({ queryKey: ['tasks', selectedProjectId] })
        queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      }
      if (result.success) toast.success(result.message)
      else toast.error(result.message)
    } catch (err: any) {
      toast.error(err?.message || 'Operation failed')
    } finally {
      setBusy(null)
    }
  }

  async function handleDisconnect() {
    if (!selectedProjectId) return
    await api.deleteIntegration(selectedProjectId, providerId)
    setIntegration(null)
    setSettings({})
    setTestResult(null)
    toast.success(`${def?.name} disconnected`)
  }

  // ── Trello onboarding helpers ───────────────────────────────────────
  async function openTrelloAuthorize() {
    const apiKey = settings.apiKey
    if (!apiKey) {
      toast.error('Paste your Trello API Key first')
      return
    }
    try {
      const { url } = await api.trelloAuthorizeUrl(selectedProjectId, apiKey)
      window.open(url, '_blank', 'noopener')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to build authorize URL')
    }
  }

  // ── ClickUp discovery ───────────────────────────────────────────────
  async function loadClickUpTeams() {
    if (!selectedProjectId) return
    const token = settings.token
    setDiscovering(true)
    try {
      const { teams: t = [] } = await api.clickupDiscover(selectedProjectId, token ? { token } : {})
      setTeams(t)
      if (t.length === 1) {
        setSelectedTeamId(t[0].id)
        await loadClickUpSpaces(t[0].id)
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not load workspaces')
    } finally {
      setDiscovering(false)
    }
  }

  async function loadClickUpSpaces(teamId: string) {
    if (!selectedProjectId) return
    const token = settings.token
    setDiscovering(true)
    try {
      const { spaces: sp = [] } = await api.clickupDiscover(selectedProjectId, {
        ...(token ? { token } : {}),
        teamId,
      })
      setSpaces(sp)
    } catch (err: any) {
      toast.error(err?.message || 'Could not load spaces')
    } finally {
      setDiscovering(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connect {def.name}</DialogTitle>
          <DialogDescription>{def.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Project picker */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Project</label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {providerId === 'trello' && (
            <TrelloOnboarding
              settings={settings}
              setSettings={setSettings}
              onAuthorize={openTrelloAuthorize}
              isConfigured={isConfigured}
            />
          )}

          {providerId === 'clickup' && (
            <ClickUpOnboarding
              settings={settings}
              setSettings={setSettings}
              teams={teams}
              spaces={spaces}
              selectedTeamId={selectedTeamId}
              setSelectedTeamId={setSelectedTeamId}
              loadTeams={loadClickUpTeams}
              loadSpaces={loadClickUpSpaces}
              discovering={discovering}
              isConfigured={isConfigured}
            />
          )}

          {/* Auto-sync toggle */}
          <label className="flex items-start gap-2 p-3 rounded-md border cursor-pointer hover:bg-accent/30">
            <input
              type="checkbox"
              checked={autoSync}
              onChange={e => setAutoSync(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5"
            />
            <div className="flex-1">
              <div className="text-xs font-medium">Auto-sync on task changes</div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Push to {def.name} automatically 2–3 seconds after you create, edit, or move a task.
              </p>
            </div>
          </label>

          {/* Status */}
          {integration?.lastSyncAt && (
            <div className="flex items-center gap-2 text-xs rounded-md border p-2">
              {integration.lastSyncStatus === 'ok' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-red-500" />
              )}
              <span className="text-muted-foreground">Last sync:</span>
              <span>{new Date(integration.lastSyncAt).toLocaleString()}</span>
              {integration.lastSyncError && (
                <span className="text-red-500 truncate"> — {integration.lastSyncError}</span>
              )}
              {(integration.state?.boardUrl || integration.state?.listUrl) && (
                <a
                  href={integration.state.boardUrl || integration.state.listUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                >
                  Open <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          {testResult && (
            <div className={cn(
              'text-xs rounded-md border p-2',
              testResult.ok ? 'text-emerald-600 border-emerald-500/30 bg-emerald-500/5' : 'text-red-600 border-red-500/30 bg-red-500/5'
            )}>
              {testResult.message}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          {isConfigured && (
            <Button variant="ghost" size="sm" onClick={handleDisconnect} className="mr-auto text-red-500 hover:text-red-600">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Disconnect
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || !selectedProjectId}>
            {testing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
            Test
          </Button>
          <Button variant="outline" size="sm" onClick={handleSave} disabled={!selectedProjectId}>
            Save
          </Button>
          {isConfigured && (
            <>
              <Button variant="outline" size="sm" onClick={() => handleAction('pull')} disabled={busy !== null}>
                {busy === 'pull' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
                Pull
              </Button>
              <Button variant="outline" size="sm" onClick={() => handleAction('merge')} disabled={busy !== null}>
                {busy === 'merge' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5 mr-1.5" />}
                Sync
              </Button>
            </>
          )}
          <Button size="sm" onClick={() => handleAction('push')} disabled={busy !== null || !selectedProjectId}>
            {busy === 'push' ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            Push all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Provider-specific onboarding panels ─────────────────────────────────

function TrelloOnboarding({
  settings, setSettings, onAuthorize, isConfigured,
}: {
  settings: Record<string, any>
  setSettings: (s: Record<string, any> | ((p: Record<string, any>) => Record<string, any>)) => void
  onAuthorize: () => void
  isConfigured: boolean
}) {
  return (
    <div className="space-y-3">
      {!isConfigured && (
        <OnboardingStep n={1} title="Get your Trello API Key" body="Click below to open the Trello Power-Ups admin page. Create (or pick) a Power-Up and copy the API Key.">
          <Button variant="outline" size="sm" asChild className="h-7 text-xs">
            <a href="https://trello.com/power-ups/admin" target="_blank" rel="noreferrer">
              Open Trello admin <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
        </OnboardingStep>
      )}

      <FieldInput
        field={{ key: 'apiKey', label: 'API Key', type: 'password', required: true, helpText: 'Paste the API Key from Trello here.' }}
        value={settings.apiKey}
        onChange={v => setSettings(s => ({ ...s, apiKey: v }))}
        masked={isConfigured && !settings.apiKey}
      />

      {!isConfigured && (
        <OnboardingStep n={2} title="Authorize Shipyard" body="With the API Key filled above, click Authorize. Trello will ask you to allow access and give you a token to paste below.">
          <Button variant="outline" size="sm" onClick={onAuthorize} className="h-7 text-xs">
            <KeyRound className="h-3 w-3 mr-1.5" />
            Authorize
          </Button>
        </OnboardingStep>
      )}

      <FieldInput
        field={{ key: 'token', label: 'Token', type: 'password', required: true, helpText: isConfigured ? 'Leave blank to keep the stored token.' : 'Paste the token Trello showed after clicking Authorize.' }}
        value={settings.token}
        onChange={v => setSettings(s => ({ ...s, token: v }))}
        masked={isConfigured && !settings.token}
      />
    </div>
  )
}

function ClickUpOnboarding({
  settings, setSettings, teams, spaces, selectedTeamId, setSelectedTeamId,
  loadTeams, loadSpaces, discovering, isConfigured,
}: {
  settings: Record<string, any>
  setSettings: (s: Record<string, any> | ((p: Record<string, any>) => Record<string, any>)) => void
  teams: Array<{ id: string; name: string }>
  spaces: Array<{ id: string; name: string; private: boolean }>
  selectedTeamId: string
  setSelectedTeamId: (id: string) => void
  loadTeams: () => Promise<void>
  loadSpaces: (teamId: string) => Promise<void>
  discovering: boolean
  isConfigured: boolean
}) {
  return (
    <div className="space-y-3">
      {!isConfigured && (
        <OnboardingStep n={1} title="Get a ClickUp Personal Token" body="Open ClickUp Apps settings, scroll to API Token, generate a personal token and paste it below.">
          <Button variant="outline" size="sm" asChild className="h-7 text-xs">
            <a href="https://app.clickup.com/settings/apps" target="_blank" rel="noreferrer">
              Open ClickUp Apps <ExternalLink className="h-3 w-3 ml-1" />
            </a>
          </Button>
        </OnboardingStep>
      )}

      <FieldInput
        field={{ key: 'token', label: 'Personal API Token', type: 'password', required: true, helpText: isConfigured ? 'Leave blank to keep the stored token.' : 'Starts with "pk_".' }}
        value={settings.token}
        onChange={v => setSettings(s => ({ ...s, token: v }))}
        masked={isConfigured && !settings.token}
      />

      <OnboardingStep n={2} title="Pick your workspace and space" body="Load your workspaces, then pick which one to use. Shipyard will create a dedicated list inside the space on first sync.">
        <div className="space-y-2 w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={loadTeams}
            disabled={discovering || (!settings.token && !isConfigured)}
            className="h-7 text-xs"
          >
            {discovering ? <Loader2 className="h-3 w-3 mr-1.5 animate-spin" /> : null}
            Load workspaces
          </Button>

          {teams.length > 0 && (
            <Select value={selectedTeamId} onValueChange={(v) => { setSelectedTeamId(v); loadSpaces(v) }}>
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a workspace" />
              </SelectTrigger>
              <SelectContent>
                {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}

          {spaces.length > 0 && (
            <Select
              value={settings.spaceId ?? ''}
              onValueChange={v => setSettings(s => ({ ...s, spaceId: v }))}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Select a space" />
              </SelectTrigger>
              <SelectContent>
                {spaces.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}{s.private ? ' (private)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {(!teams.length || settings.spaceId) && (
            <Input
              placeholder="Or paste a Space ID directly"
              value={settings.spaceId ?? ''}
              onChange={e => setSettings(s => ({ ...s, spaceId: e.target.value }))}
              className="h-9"
            />
          )}
        </div>
      </OnboardingStep>
    </div>
  )
}

function OnboardingStep({ n, title, body, children }: { n: number; title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-md border p-3">
      <div className="h-6 w-6 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">{n}</div>
      <div className="flex-1 space-y-1.5">
        <div className="text-xs font-medium">{title}</div>
        <p className="text-[11px] text-muted-foreground">{body}</p>
        {children}
      </div>
    </div>
  )
}

function FieldInput({
  field, value, onChange, masked,
}: {
  field: ConfigField
  value: any
  onChange: (v: any) => void
  masked?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">
        {field.label}
        {field.required && <Badge variant="outline" className="ml-2 text-[9px] px-1 py-0">required</Badge>}
        {masked && <Badge variant="outline" className="ml-2 text-[9px] px-1 py-0 text-emerald-600 border-emerald-500/30">saved</Badge>}
      </label>
      <Input
        type={field.type === 'password' ? 'password' : field.type === 'url' ? 'url' : 'text'}
        placeholder={masked ? '•••••••• (leave blank to keep)' : field.placeholder}
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="h-9"
      />
      {field.helpText && <p className="text-[11px] text-muted-foreground">{field.helpText}</p>}
    </div>
  )
}
