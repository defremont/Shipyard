import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Trash2, ExternalLink, Loader2, KeyRound, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { api, type SyncProviderStatus } from '@/lib/api'

type ProviderId = 'trello' | 'clickup'

interface Props {
  providerId: ProviderId
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Connect the user's Trello / ClickUp account once. Credentials are saved
// globally in the server-side sync store and reused by every project that
// enables this provider.
export function ProviderConnectDialog({ providerId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient()

  const [status, setStatus] = useState<SyncProviderStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [token, setToken] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    if (!open) return
    void refresh()
    setApiKey('')
    setToken('')
    setTestResult(null)
  }, [open, providerId])

  async function refresh() {
    const { providers } = await api.listSyncProviders()
    setStatus(providers.find(p => p.providerId === providerId) ?? null)
  }

  const isConnected = status?.connected ?? false
  const hasStoredApiKey = status?.settingsSet.apiKeySet ?? false
  const hasStoredToken = status?.settingsSet.tokenSet ?? false

  const title = providerId === 'trello' ? 'Connect Trello' : 'Connect ClickUp'
  const description = providerId === 'trello'
    ? 'One-time setup — after this, enable sync per project from Settings or the project toolbar.'
    : 'One-time setup — after this, pick the Space for each project you want to sync.'

  async function openTrelloAuthorize() {
    if (!apiKey) {
      toast.error('Paste your Trello API Key first')
      return
    }
    try {
      const { url } = await api.trelloAuthorizeUrl(apiKey)
      window.open(url, '_blank', 'noopener')
    } catch (err: any) {
      toast.error(err?.message || 'Failed to build authorize URL')
    }
  }

  async function handleTest() {
    setTesting(true)
    try {
      const overrides: Record<string, any> = {}
      if (providerId === 'trello') {
        if (apiKey) overrides.apiKey = apiKey
        if (token) overrides.token = token
      } else {
        if (token) overrides.token = token
      }
      const result = await api.testSyncProvider(
        providerId,
        Object.keys(overrides).length > 0 ? overrides : undefined,
      )
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

  async function handleSave() {
    setSaving(true)
    try {
      const patch: Record<string, any> = {}
      if (providerId === 'trello') {
        if (apiKey) patch.apiKey = apiKey
        if (token) patch.token = token
        if (!patch.apiKey && !hasStoredApiKey) {
          toast.error('API Key required')
          return
        }
        if (!patch.token && !hasStoredToken) {
          toast.error('Token required')
          return
        }
      } else {
        if (token) patch.token = token
        if (!patch.token && !hasStoredToken) {
          toast.error('Token required')
          return
        }
      }
      await api.saveSyncProvider(providerId, patch)
      queryClient.invalidateQueries({ queryKey: ['sync', 'providers'] })
      await refresh()
      setApiKey('')
      setToken('')
      toast.success(`${providerId === 'trello' ? 'Trello' : 'ClickUp'} connected`)
    } catch (err: any) {
      toast.error(err?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisconnect() {
    const confirmed = window.confirm(`Disconnect ${providerId === 'trello' ? 'Trello' : 'ClickUp'}? Sync will stop for every project using this account.`)
    if (!confirmed) return
    await api.deleteSyncProvider(providerId)
    queryClient.invalidateQueries({ queryKey: ['sync', 'providers'] })
    queryClient.invalidateQueries({ queryKey: ['sync', 'integrations'] })
    setApiKey('')
    setToken('')
    await refresh()
    toast.success('Disconnected')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isConnected && (
            <div className="flex items-center gap-2 text-xs rounded-md border p-2 text-emerald-600 border-emerald-500/30 bg-emerald-500/5">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>Connected. Leave fields blank to keep your stored credentials.</span>
            </div>
          )}

          {providerId === 'trello' ? (
            <>
              <OnboardingStep n={1} title="Get your Trello API Key" body="Open the Trello Power-Ups admin, create (or pick) a Power-Up, and copy the API Key.">
                <Button variant="outline" size="sm" asChild className="h-7 text-xs">
                  <a href="https://trello.com/power-ups/admin" target="_blank" rel="noreferrer">
                    Open Trello admin <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </OnboardingStep>

              <Field
                label="API Key"
                type="password"
                value={apiKey}
                onChange={setApiKey}
                savedBadge={!apiKey && hasStoredApiKey}
                placeholder={hasStoredApiKey ? '•••••••• (leave blank to keep)' : ''}
              />

              <OnboardingStep n={2} title="Authorize Shipyard" body="With the API Key above, click Authorize. Trello will show a token; copy it here.">
                <Button variant="outline" size="sm" onClick={openTrelloAuthorize} className="h-7 text-xs">
                  <KeyRound className="h-3 w-3 mr-1.5" />
                  Authorize
                </Button>
              </OnboardingStep>

              <Field
                label="Token"
                type="password"
                value={token}
                onChange={setToken}
                savedBadge={!token && hasStoredToken}
                placeholder={hasStoredToken ? '•••••••• (leave blank to keep)' : ''}
              />
            </>
          ) : (
            <>
              <OnboardingStep n={1} title="Get a ClickUp Personal Token" body="Open the ClickUp Apps page, scroll to API Token, generate a personal token.">
                <Button variant="outline" size="sm" asChild className="h-7 text-xs">
                  <a href="https://app.clickup.com/settings/apps" target="_blank" rel="noreferrer">
                    Open ClickUp Apps <ExternalLink className="h-3 w-3 ml-1" />
                  </a>
                </Button>
              </OnboardingStep>

              <Field
                label="Personal API Token"
                type="password"
                value={token}
                onChange={setToken}
                savedBadge={!token && hasStoredToken}
                placeholder={hasStoredToken ? '•••••••• (leave blank to keep)' : 'Starts with "pk_"'}
              />
            </>
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
          {isConnected && (
            <Button variant="ghost" size="sm" onClick={handleDisconnect} className="mr-auto text-red-500 hover:text-red-600">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Disconnect
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />}
            Test
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}
            {isConnected ? 'Update' : 'Connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

function Field({
  label, type, value, onChange, savedBadge, placeholder,
}: {
  label: string
  type: 'text' | 'password'
  value: string
  onChange: (v: string) => void
  savedBadge?: boolean
  placeholder?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium flex items-center">
        {label}
        {savedBadge && <Badge variant="outline" className="ml-2 text-[9px] px-1 py-0 text-emerald-600 border-emerald-500/30">saved</Badge>}
      </label>
      <Input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9"
      />
    </div>
  )
}

