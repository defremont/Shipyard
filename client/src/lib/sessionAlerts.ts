import { playSessionSound } from './sounds'

/**
 * Telling the user that an agent session wants them: it stopped to ask
 * something, or it finished. Three channels, each switchable per kind — a
 * sound, a desktop notification and the taskbar button flashing — so the news
 * arrives with the window minimised or behind another one.
 */
export type SessionAlertKind = 'question' | 'finished'
export type SessionAlertChannel = 'sound' | 'desktop' | 'flash'

export interface SessionAlertSettings {
  question: Record<SessionAlertChannel, boolean>
  finished: Record<SessionAlertChannel, boolean>
  /** Also play the sound for the session that is on screen right now. */
  whenWatching: boolean
}

const SETTINGS_KEY = 'shipyard:session-alerts'

const DEFAULT_SETTINGS: SessionAlertSettings = {
  question: { sound: true, desktop: true, flash: true },
  finished: { sound: true, desktop: true, flash: true },
  whenWatching: false,
}

export function loadSessionAlertSettings(): SessionAlertSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      question: { ...DEFAULT_SETTINGS.question, ...saved.question },
      finished: { ...DEFAULT_SETTINGS.finished, ...saved.finished },
      whenWatching: saved.whenWatching ?? DEFAULT_SETTINGS.whenWatching,
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSessionAlertSettings(settings: SessionAlertSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

interface AlertPayload {
  sessionId: string
  title: string
  body: string
  desktop: boolean
  flash: boolean
}

interface ElectronAlertAPI {
  sessionAlert?: (alert: AlertPayload) => void
  onSessionAlertClick?: (callback: (sessionId: string) => void) => () => void
}

function electronAPI(): ElectronAlertAPI | undefined {
  return (window as { electronAPI?: ElectronAlertAPI }).electronAPI
}

/** The desktop app shows notifications itself; a browser has to be asked. */
export function desktopAlertsNeedPermission(): boolean {
  return !electronAPI()?.sessionAlert && 'Notification' in window && Notification.permission !== 'granted'
}

export async function requestDesktopAlertPermission(): Promise<boolean> {
  if (electronAPI()?.sessionAlert) return true
  if (!('Notification' in window)) return false
  return (await Notification.requestPermission()) === 'granted'
}

function focusSession(sessionId: string) {
  window.dispatchEvent(new CustomEvent('shipyard:focus-terminal', { detail: { sessionId } }))
}

/** Clicking a desktop notification brings up the session it was about. */
export function listenForAlertClicks(): () => void {
  return electronAPI()?.onSessionAlertClick?.(focusSession) ?? (() => {})
}

// Browser only: the tab title carries a mark until the window is looked at —
// the nearest thing a tab has to a flashing taskbar button.
let markedTitle: string | null = null

function markTabTitle() {
  if (markedTitle !== null || document.hasFocus()) return
  markedTitle = document.title
  document.title = `● ${markedTitle}`
  window.addEventListener('focus', () => {
    if (markedTitle !== null) document.title = markedTitle
    markedTitle = null
  }, { once: true })
}

const LABELS: Record<SessionAlertKind, string> = {
  question: 'needs your answer',
  finished: 'finished',
}

export function alertSession(
  kind: SessionAlertKind,
  session: { sessionId: string; project: string; label: string; watching: boolean },
  settings = loadSessionAlertSettings(),
) {
  const channels = settings[kind]
  // The user is looking at this very session: nothing to bring them back to.
  if (session.watching) {
    if (settings.whenWatching && channels.sound) playSessionSound(kind)
    return
  }

  if (channels.sound) playSessionSound(kind)
  if (!channels.desktop && !channels.flash) return

  const title = `${session.project || 'Shipyard'} — ${LABELS[kind]}`
  const desktop = electronAPI()
  if (desktop?.sessionAlert) {
    desktop.sessionAlert({ sessionId: session.sessionId, title, body: session.label, desktop: channels.desktop, flash: channels.flash })
    return
  }

  if (channels.flash) markTabTitle()
  if (channels.desktop && 'Notification' in window && Notification.permission === 'granted') {
    try {
      // The sound is ours; one notification per session, the newest replacing the last.
      const notification = new Notification(title, { body: session.label, tag: session.sessionId, silent: true })
      notification.onclick = () => {
        window.focus()
        focusSession(session.sessionId)
        notification.close()
      }
    } catch {
      // Not allowed here (insecure origin, blocked) — the other channels stand.
    }
  }
}
