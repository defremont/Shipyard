import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

export type ActivityId = 'projects' | 'explorer' | 'search' | 'git' | 'claude'

interface ActivityContextValue {
  activity: ActivityId
  panelOpen: boolean
  selectActivity: (id: ActivityId) => void
  openActivity: (id: ActivityId) => void
  togglePanel: () => void
}

const STORAGE_ACTIVITY = 'shipyard:activity'
const STORAGE_PANEL = 'shipyard:activity-panel-open'

function loadActivity(): ActivityId {
  const v = localStorage.getItem(STORAGE_ACTIVITY)
  if (v === 'projects' || v === 'explorer' || v === 'search' || v === 'git' || v === 'claude') return v
  return 'projects'
}

function loadPanelOpen(): boolean {
  const v = localStorage.getItem(STORAGE_PANEL)
  return v === null ? true : v === 'true'
}

const ActivityContext = createContext<ActivityContextValue | null>(null)

// Full-page routes (settings, logs, help) are not project-scoped — the side
// panel auto-collapses there and the user's preference is restored on return.
const FULL_PAGE_ROUTES = ['/settings', '/logs', '/help']

export function ActivityProvider({ children }: { children: ReactNode }) {
  const [activity, setActivity] = useState<ActivityId>(loadActivity)
  const [panelOpen, setPanelOpen] = useState<boolean>(loadPanelOpen)
  const location = useLocation()

  const isFullPage = FULL_PAGE_ROUTES.some(p => location.pathname.startsWith(p))
  const wasFullPage = useRef(false)
  useEffect(() => {
    if (isFullPage && !wasFullPage.current) {
      // Ephemeral close — localStorage keeps the user's real preference
      setPanelOpen(false)
    } else if (!isFullPage && wasFullPage.current) {
      setPanelOpen(loadPanelOpen())
    }
    wasFullPage.current = isFullPage
  }, [isFullPage])

  const persistActivity = (id: ActivityId) => {
    setActivity(id)
    localStorage.setItem(STORAGE_ACTIVITY, id)
  }

  const persistPanel = (open: boolean) => {
    setPanelOpen(open)
    localStorage.setItem(STORAGE_PANEL, String(open))
  }

  // Click an activity: if it's already selected, toggle panel; otherwise select + open.
  const selectActivity = useCallback((id: ActivityId) => {
    if (id === activity) {
      persistPanel(!panelOpen)
    } else {
      persistActivity(id)
      if (!panelOpen) persistPanel(true)
    }
  }, [activity, panelOpen])

  // Force open and select (for keyboard shortcuts / external triggers).
  const openActivity = useCallback((id: ActivityId) => {
    persistActivity(id)
    persistPanel(true)
  }, [])

  const togglePanel = useCallback(() => {
    persistPanel(!panelOpen)
  }, [panelOpen])

  return (
    <ActivityContext.Provider value={{ activity, panelOpen, selectActivity, openActivity, togglePanel }}>
      {children}
    </ActivityContext.Provider>
  )
}

export function useActivity() {
  const ctx = useContext(ActivityContext)
  if (!ctx) throw new Error('useActivity must be used within ActivityProvider')
  return ctx
}
