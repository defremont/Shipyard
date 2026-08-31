import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

export interface Tab {
  id: string   // projectId
  path: string // /project/:id
}

interface TabsContextType {
  tabs: Tab[]
  activeTabId: string | null
  openTab: (projectId: string) => void
  closeTab: (id: string) => void
  closeOtherTabs: (keepId: string) => void
  switchTab: (id: string) => void
  reorderTabs: (fromId: string, toId: string) => void
}

const STORAGE_KEY = 'shipyard-tabs'
const ACTIVE_TAB_KEY = 'shipyard-active-tab'

function loadTabs(): Tab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function saveTabs(tabs: Tab[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs))
}

const TabsContext = createContext<TabsContextType | null>(null)

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tabs, setTabs] = useState<Tab[]>(loadTabs)
  const location = useLocation()
  const navigate = useNavigate()
  const closedRef = useRef(new Set<string>())
  const restoredRef = useRef(false)

  // Persist tabs to localStorage on change
  useEffect(() => {
    saveTabs(tabs)
  }, [tabs])

  const activeTabId = useMemo(() => {
    const match = location.pathname.match(/^\/project\/(.+)$/)
    return match ? match[1] : null
  }, [location.pathname])

  // Persist active tab ID
  useEffect(() => {
    if (activeTabId) {
      localStorage.setItem(ACTIVE_TAB_KEY, activeTabId)
    }
  }, [activeTabId])

  // Restore active tab on initial load
  useEffect(() => {
    if (restoredRef.current) return
    restoredRef.current = true

    // Only restore if we're at home page (fresh load)
    if (location.pathname !== '/') return

    const savedActiveId = localStorage.getItem(ACTIVE_TAB_KEY)
    if (savedActiveId && tabs.some(t => t.id === savedActiveId)) {
      navigate(`/project/${savedActiveId}`, { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-add tab when navigating to a project URL directly
  // (skip tabs that were just intentionally closed)
  useEffect(() => {
    if (activeTabId && !closedRef.current.has(activeTabId)) {
      setTabs(prev => {
        if (prev.some(t => t.id === activeTabId)) return prev
        return [...prev, { id: activeTabId, path: `/project/${activeTabId}` }]
      })
    }
  }, [activeTabId])

  const openTab = useCallback((projectId: string) => {
    closedRef.current.delete(projectId)
    setTabs(prev => {
      if (prev.some(t => t.id === projectId)) return prev
      return [...prev, { id: projectId, path: `/project/${projectId}` }]
    })
    navigate(`/project/${projectId}`)
  }, [navigate])

  const closeTab = useCallback((id: string) => {
    closedRef.current.add(id)

    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      if (idx === -1) return prev
      const next = prev.filter(t => t.id !== id)

      // If closing the active tab, navigate to adjacent or home
      if (id === activeTabId) {
        if (next.length > 0) {
          const newIdx = Math.min(idx, next.length - 1)
          // Use setTimeout to navigate after state update
          setTimeout(() => navigate(next[newIdx].path), 0)
        } else {
          setTimeout(() => navigate('/'), 0)
        }
      }

      return next
    })
  }, [activeTabId, navigate])

  /** Close every tab but one, in a single update. Doing it with repeated
   *  closeTab calls navigates to a neighbour that is about to be closed. */
  const closeOtherTabs = useCallback((keepId: string) => {
    setTabs(prev => {
      const keep = prev.find(t => t.id === keepId)
      if (!keep || prev.length <= 1) return prev
      for (const tab of prev) {
        if (tab.id !== keepId) closedRef.current.add(tab.id)
      }
      closedRef.current.delete(keepId)
      setTimeout(() => navigate(keep.path), 0)
      return [keep]
    })
  }, [navigate])

  const switchTab = useCallback((id: string) => {
    const tab = tabs.find(t => t.id === id)
    if (tab) navigate(tab.path)
  }, [tabs, navigate])

  const reorderTabs = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setTabs(prev => {
      const fromIdx = prev.findIndex(t => t.id === fromId)
      const toIdx = prev.findIndex(t => t.id === toId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = prev.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  return (
    <TabsContext.Provider value={{ tabs, activeTabId, openTab, closeTab, closeOtherTabs, switchTab, reorderTabs }}>
      {children}
    </TabsContext.Provider>
  )
}

export function useTabs() {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('useTabs must be used within TabsProvider')
  return ctx
}
