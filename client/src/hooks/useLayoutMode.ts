import { useSyncExternalStore } from 'react'

/** `focus`: the panel you click takes the whole work area and the other one
 *  gets out of the way. `split`: workspace on top, terminal below at the
 *  height the user dragged it to. */
export type LayoutMode = 'focus' | 'split'

interface LayoutState {
  mode: LayoutMode
  /** Reported by TerminalPanel — Layout hides the workspace while it is true. */
  terminalFull: boolean
  /** The chat takes the whole window. Not persisted: a reload should never
   *  come back with the workspace hidden. */
  chatFull: boolean
  /** The task list beside the terminal and the editor. The user's choice. */
  taskRail: boolean
  /** Where the workspace toolbar wants the session tabs drawn. TerminalPanel
   *  portals its tab strip here, so project toolbar and terminal tabs share
   *  one row instead of stacking two. */
  tabSlot: HTMLElement | null
}

const MODE_KEY = 'shipyard:layout-mode'
const TASK_RAIL_KEY = 'shipyard:task-rail'

let state: LayoutState = {
  mode: localStorage.getItem(MODE_KEY) === 'split' ? 'split' : 'focus',
  terminalFull: false,
  chatFull: false,
  taskRail: localStorage.getItem(TASK_RAIL_KEY) !== 'false',
  tabSlot: null,
}

const listeners = new Set<() => void>()

function update(patch: Partial<LayoutState>) {
  const keys = Object.keys(patch) as (keyof LayoutState)[]
  if (keys.every(key => state[key] === patch[key])) return
  state = { ...state, ...patch }
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const layoutStore = {
  get: () => state,
  setMode(mode: LayoutMode) {
    localStorage.setItem(MODE_KEY, mode)
    update({ mode })
  },
  setTerminalFull: (terminalFull: boolean) => update({ terminalFull }),
  setChatFull: (chatFull: boolean) => update({ chatFull }),
  setTaskRail(taskRail: boolean) {
    localStorage.setItem(TASK_RAIL_KEY, String(taskRail))
    update({ taskRail })
  },
  setTabSlot: (tabSlot: HTMLElement | null) => update({ tabSlot }),
}

export function useLayoutMode(): LayoutState {
  return useSyncExternalStore(subscribe, layoutStore.get)
}
