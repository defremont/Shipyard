import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Cloud, Loader2, RefreshCw, LogOut, Monitor, FolderX, ExternalLink, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useCloudLogin, useCloudLogout, useCloudSignup, useCloudStatus, useCloudSyncNow } from '@/hooks/useCloud'
import type { CloudStatus } from '@/lib/api'

function timeAgo(iso?: string | null): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function SignInForm({ status }: { status: CloudStatus }) {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const login = useCloudLogin()
  const signup = useCloudSignup()
  const busy = login.isPending || signup.isPending

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'signup' && password !== confirm) { toast.error('Passwords do not match'); return }
    const body = {
      email: email.trim(),
      password,
      ...(deviceName.trim() ? { deviceName: deviceName.trim() } : {}),
      ...(serverUrl.trim() ? { serverUrl: serverUrl.trim() } : {}),
    }
    try {
      if (mode === 'signup') await signup.mutateAsync(body)
      else await login.mutateAsync(body)
      toast.success(mode === 'signup' ? 'Account created — uploading this machine' : 'Signed in — syncing')
    } catch (err: any) {
      toast.error(err.message || 'Could not connect')
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="flex gap-1 rounded-md bg-muted p-0.5 w-fit">
        {(['login', 'signup'] as const).map(m => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'px-3 py-1 rounded text-xs transition-colors',
              mode === m ? 'bg-background text-foreground shadow-sm font-medium' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {m === 'login' ? 'Sign in' : 'Create account'}
          </button>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" />
        <Input placeholder="Name of this computer (optional)" value={deviceName} onChange={e => setDeviceName(e.target.value)} />
        <Input
          type="password"
          placeholder={mode === 'signup' ? 'Password (8+ characters)' : 'Password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          required
          minLength={mode === 'signup' ? 8 : undefined}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        />
        {mode === 'signup' && (
          <Input type="password" placeholder="Confirm password" value={confirm} onChange={e => setConfirm(e.target.value)} required autoComplete="new-password" />
        )}
      </div>
      {mode === 'signup' && (
        <p className="text-[11px] text-muted-foreground">
          Your password is the key that encrypts your data. There is no reset: if you lose it, the cloud copy is lost
          too — what is on your computers stays.
        </p>
      )}
      <button
        type="button"
        onClick={() => setAdvanced(v => !v)}
        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn('h-3 w-3 transition-transform', advanced && 'rotate-90')} />
        Server
      </button>
      {advanced && (
        <Input placeholder={status.defaultServerUrl} value={serverUrl} onChange={e => setServerUrl(e.target.value)} className="font-mono text-xs" />
      )}
      <Button type="submit" size="sm" disabled={busy} className="gap-2">
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Cloud className="h-3.5 w-3.5" />}
        {busy ? 'Connecting…' : mode === 'signup' ? 'Create account' : 'Sign in'}
      </Button>
    </form>
  )
}

function Connected({ status }: { status: CloudStatus }) {
  const syncNow = useCloudSyncNow()
  const logout = useCloudLogout()
  const plan = status.plan
  const missing = status.missingProjects ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{status.email}</span>
        <span className="text-muted-foreground">· {status.deviceName}</span>
        {plan && (
          <Badge variant="outline" className={cn('text-[10px]', plan.active ? 'text-success border-success/40' : 'text-warning border-warning/40')}>
            {plan.plan}{plan.active ? '' : ' · inactive'}
          </Badge>
        )}
      </div>

      {plan && !plan.active && (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
          Your plan is not active, so changes stay on this computer until it is. Nothing is lost.
          {plan.upgradeUrl && (
            <a href={plan.upgradeUrl} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-1 text-primary hover:underline">
              Activate <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {status.syncing
            ? <><Loader2 className="h-3 w-3 animate-spin" /> Syncing…</>
            : <>Last sync {timeAgo(status.lastSyncAt)}</>}
        </span>
        {!!status.pending && <span className="text-warning">{status.pending} change(s) waiting to upload</span>}
        {status.usage && <span>{status.usage.records} records · {formatBytes(status.usage.bytes)}</span>}
      </div>
      {status.lastError && <p className="text-xs text-destructive">{status.lastError}</p>}

      {!!status.devices?.length && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">Computers</p>
          {status.devices.map(d => (
            <div key={d.id} className="flex items-center gap-2 text-xs">
              <Monitor className="h-3.5 w-3.5 text-muted-foreground" />
              <span className={cn(d.current && 'font-medium')}>{d.name}</span>
              <span className="text-muted-foreground">{d.current ? '· this one' : `· seen ${timeAgo(d.lastSeenAt)}`}</span>
            </div>
          ))}
        </div>
      )}

      {missing.length > 0 && (
        <div className="space-y-1.5 rounded-md border px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <FolderX className="h-3.5 w-3.5 text-muted-foreground" />
            {missing.length} project(s) from your other computers are not on this one
          </p>
          <p className="text-[11px] text-muted-foreground">
            Their tasks are already here. Clone each one into a folder with the same name, next to your other
            projects, and it shows up by itself on the next sync.
          </p>
          <div className="space-y-0.5 max-h-40 overflow-y-auto scrollbar-dark">
            {missing.map(p => (
              <div key={p.id} className="flex items-center gap-2 text-[11px]">
                <span className="font-medium">{p.folder}</span>
                {p.remote && <span className="font-mono text-muted-foreground truncate">{p.remote}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={syncNow.isPending || status.syncing}
          onClick={() => syncNow.mutate(undefined, { onError: (err: any) => toast.error(err.message) })}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', (syncNow.isPending || status.syncing) && 'animate-spin')} />
          Sync now
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="gap-2 text-muted-foreground"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onSuccess: () => toast.success('Signed out. Your data stays on this computer.') })}
        >
          <LogOut className="h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </div>
  )
}

/**
 * Shipyard Cloud: the same projects, tasks and integrations on every computer.
 * Everything is encrypted here before it goes up.
 */
export function CloudSettingsCard() {
  const { data: status, isLoading } = useCloudStatus()

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Cloud className="h-4 w-4 text-primary" />
          Shipyard Cloud
        </CardTitle>
        <CardDescription className="text-xs">
          Keep projects, tasks, milestones and integrations (Trello, ClickUp, Railway, AI keys) the same on every
          computer you use. Data is encrypted on this computer before upload; the server cannot read it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !status
          ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          : status.connected || status.email
            ? <Connected status={status} />
            : <SignInForm status={status} />}
      </CardContent>
    </Card>
  )
}
