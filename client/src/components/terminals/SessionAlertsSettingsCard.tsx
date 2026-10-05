import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { BellRing } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { SessionStatusIcon } from './SessionStatusIcon'
import { playSessionSound } from '@/lib/sounds'
import {
  alertSession,
  desktopAlertsNeedPermission,
  loadSessionAlertSettings,
  requestDesktopAlertPermission,
  saveSessionAlertSettings,
  type SessionAlertChannel,
  type SessionAlertKind,
  type SessionAlertSettings,
} from '@/lib/sessionAlerts'

const KINDS: { kind: SessionAlertKind; title: string; hint: string }[] = [
  { kind: 'question', title: 'Waiting for an answer', hint: 'A permission dialog, a choice, or a run that ended on a question' },
  { kind: 'finished', title: 'Finished', hint: 'The agent is done and back at the prompt' },
]

const CHANNELS: { channel: SessionAlertChannel; label: string }[] = [
  { channel: 'sound', label: 'Sound' },
  { channel: 'desktop', label: 'Notification' },
  { channel: 'flash', label: 'Taskbar' },
]

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', on ? 'bg-primary' : 'bg-muted')}
    >
      <span className={cn(
        'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
        on ? 'translate-x-4' : 'translate-x-0.5'
      )} />
    </button>
  )
}

/**
 * What happens when an agent session stops to ask something or finishes while
 * the user is elsewhere. Kept in this browser (localStorage), like the other
 * sound preference: it is about this machine's speakers and desktop.
 */
export function SessionAlertsSettingsCard() {
  const [settings, setSettings] = useState<SessionAlertSettings>(loadSessionAlertSettings)

  const update = (next: SessionAlertSettings) => {
    setSettings(next)
    saveSessionAlertSettings(next)
  }

  const toggle = async (kind: SessionAlertKind, channel: SessionAlertChannel) => {
    const on = !settings[kind][channel]
    // In a browser the notification has to be allowed first; the desktop app
    // needs no asking.
    if (on && channel === 'desktop' && desktopAlertsNeedPermission() && !(await requestDesktopAlertPermission())) {
      toast.error('Notifications are blocked for this page in the browser')
      return
    }
    update({ ...settings, [kind]: { ...settings[kind], [channel]: on } })
    if (on && channel === 'sound') playSessionSound(kind)
  }

  const test = (kind: SessionAlertKind) => {
    alertSession(kind, { sessionId: 'test', project: 'Shipyard', label: 'This is what an alert looks like', watching: false }, settings)
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <BellRing className="h-4 w-4 text-primary" />
          Agent session alerts
        </CardTitle>
        <CardDescription className="text-xs">
          How Shipyard tells you that an agent needs you — also with the window minimised or behind another one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border">
          <div className="grid grid-cols-[1fr_repeat(3,5.5rem)_3.5rem] items-center gap-x-2 border-b px-3 py-2 text-[11px] text-muted-foreground">
            <span>When a session is</span>
            {CHANNELS.map(({ channel, label }) => <span key={channel} className="text-center">{label}</span>)}
            <span />
          </div>
          {KINDS.map(({ kind, title, hint }, index) => (
            <div
              key={kind}
              className={cn(
                'grid grid-cols-[1fr_repeat(3,5.5rem)_3.5rem] items-center gap-x-2 px-3 py-2.5',
                index > 0 && 'border-t'
              )}
            >
              <div className="flex min-w-0 items-start gap-2">
                <SessionStatusIcon status={kind} className="mt-1" />
                <div className="min-w-0">
                  <span className="text-sm font-medium">{title}</span>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
              </div>
              {CHANNELS.map(({ channel, label }) => (
                <span key={channel} className="flex justify-center">
                  <Switch on={settings[kind][channel]} label={`${title}: ${label}`} onToggle={() => toggle(kind, channel)} />
                </span>
              ))}
              <button
                onClick={() => test(kind)}
                className="justify-self-end rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Test
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
          <div>
            <span className="text-sm font-medium">Play the sound for the session on screen too</span>
            <p className="text-xs text-muted-foreground">
              Off: a session you are looking at stays quiet. Notification and taskbar are only used when you are elsewhere.
            </p>
          </div>
          <Switch
            on={settings.whenWatching}
            label="Play the sound for the session on screen too"
            onToggle={() => update({ ...settings, whenWatching: !settings.whenWatching })}
          />
        </div>
      </CardContent>
    </Card>
  )
}
