import { useSyncExternalStore } from 'react'

/**
 * What one terminal session is doing, as every surface shows it: the session
 * tab, the project tab it belongs to and the task that started it.
 *
 *   question  the CLI is blocked on the user (a dialog, or a run that ended asking)
 *   finished  a run ended and nobody has looked at it yet
 *   busy      a run is in flight
 *   idle      a CLI sitting at an empty prompt
 *   exited    the process is gone
 *   none      a plain shell — nothing to report
 */
export type SessionStatus = 'question' | 'finished' | 'busy' | 'idle' | 'exited' | 'none'

/** Most urgent first — the order a project tab picks its one dot from. */
const STATUS_ORDER: SessionStatus[] = ['question', 'finished', 'busy', 'idle', 'exited', 'none']

export interface TerminalTabInfo {
  sessionId: string
  projectId: string
  taskId?: string
  status: SessionStatus
}

/**
 * The terminal panel owns its tabs; this is the read-only copy the rest of the
 * app looks at (project tabs, the task rail). A store rather than context
 * because the panel sits below its readers in the tree.
 */
let tabs: TerminalTabInfo[] = []
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const terminalTabsStore = {
  get: () => tabs,
  set(next: TerminalTabInfo[]) {
    const same = next.length === tabs.length && next.every((tab, i) => {
      const old = tabs[i]
      return old.sessionId === tab.sessionId && old.projectId === tab.projectId
        && old.taskId === tab.taskId && old.status === tab.status
    })
    if (same) return
    tabs = next
    listeners.forEach(listener => listener())
  },
}

export function useTerminalTabs(): TerminalTabInfo[] {
  return useSyncExternalStore(subscribe, terminalTabsStore.get)
}

/** The one status that speaks for a group of sessions. */
export function worstStatus(list: TerminalTabInfo[]): SessionStatus {
  for (const status of STATUS_ORDER) {
    if (list.some(tab => tab.status === status)) return status
  }
  return 'none'
}
