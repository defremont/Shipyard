import { useState, useRef, useCallback, useEffect } from 'react'
import { Plus, X, ChevronDown, ChevronUp, Terminal, Trash2, ExternalLink, Sparkles, XCircle, CheckCircle2, Columns2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  useTerminalStatus,
  useCreateTerminalSession,
  useKillTerminalSession,
} from '@/hooks/useTerminal'
import { useLaunchTerminal } from '@/hooks/useProjects'
import { useTabs } from '@/hooks/useTabs'
import { useAiSessions } from '@/hooks/useAiSessions'
import { api } from '@/lib/api'
import { IntegratedTerminal } from './IntegratedTerminal'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface GlobalTab {
  sessionId: string
  projectId: string
  title: string
  type: string
  exited: boolean
  hasNotification: boolean
  taskId?: string
  taskNumber?: number
}

const PANEL_HEIGHT_KEY = 'shipyard:terminal-height'
const PANEL_VISIBLE_KEY = 'shipyard:terminal-visible'
const TABS_STORAGE_KEY = 'shipyard:terminal-tabs'
const ACTIVE_TAB_KEY = 'shipyard:terminal-active-tab'
const SPLIT_SESSION_KEY = 'shipyard:terminal-split-session'
const MIN_HEIGHT = 150
const MAX_HEIGHT_RATIO = 0.7
const DEFAULT_HEIGHT = 300

function loadTerminalTabs(): GlobalTab[] {
  try {
    const raw = localStorage.getItem(TABS_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return []
}

function loadActiveTabId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY) || null
  } catch {}
  return null
}

function loadSplitSessionId(): string | null {
  try {
    return localStorage.getItem(SPLIT_SESSION_KEY) || null
  } catch {}
  return null
}

export function TerminalPanel() {
  const { data: status } = useTerminalStatus()
  const createSession = useCreateTerminalSession()
  const killSession = useKillTerminalSession()
  const launchNative = useLaunchTerminal()
  const { activeTabId: activeProjectId, openTab: openProjectTab } = useTabs()
  const aiSessions = useAiSessions()

  const [tabs, setTabs] = useState<GlobalTab[]>(loadTerminalTabs)
  const [activeTabId, setActiveTabId] = useState<string | null>(loadActiveTabId)
  const [splitSessionId, setSplitSessionId] = useState<string | null>(loadSplitSessionId)
  const [activePaneIndex, setActivePaneIndex] = useState<0 | 1>(0)
  const [panelHeight, setPanelHeight] = useState(() => {
    const saved = localStorage.getItem(PANEL_HEIGHT_KEY)
    return saved ? Math.max(MIN_HEIGHT, parseInt(saved, 10)) : DEFAULT_HEIGHT
  })
  const [isVisible, setIsVisible] = useState(() => {
    return localStorage.getItem(PANEL_VISIBLE_KEY) === 'true'
  })

  const panelRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const dragStartY = useRef(0)
  const dragStartHeight = useRef(0)
  const splitNextTabRef = useRef(false)

  // Refs for reading current state in callbacks without stale closures
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const splitSessionIdRef = useRef(splitSessionId)
  splitSessionIdRef.current = splitSessionId
  const activePaneIndexRef = useRef(activePaneIndex)
  activePaneIndexRef.current = activePaneIndex
  const activeProjectIdRef = useRef(activeProjectId)
  activeProjectIdRef.current = activeProjectId
  const isVisibleRef = useRef(isVisible)
  isVisibleRef.current = isVisible

  // Persist panel state
  useEffect(() => {
    localStorage.setItem(PANEL_HEIGHT_KEY, String(panelHeight))
  }, [panelHeight])

  useEffect(() => {
    localStorage.setItem(PANEL_VISIBLE_KEY, String(isVisible))
  }, [isVisible])

  // Persist terminal tabs
  useEffect(() => {
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs))
  }, [tabs])

  // Persist active terminal tab
  useEffect(() => {
    if (activeTabId) {
      localStorage.setItem(ACTIVE_TAB_KEY, activeTabId)
    } else {
      localStorage.removeItem(ACTIVE_TAB_KEY)
    }
  }, [activeTabId])

  // Persist split session
  useEffect(() => {
    if (splitSessionId) {
      localStorage.setItem(SPLIT_SESSION_KEY, splitSessionId)
    } else {
      localStorage.removeItem(SPLIT_SESSION_KEY)
    }
  }, [splitSessionId])

  // Clear notification when visible tabs become visible
  useEffect(() => {
    if (isVisible) {
      const visibleIds = [activeTabId, splitSessionId].filter(Boolean) as string[]
      if (visibleIds.length > 0) {
        setTabs(prev => {
          const hasNotif = prev.some(t => visibleIds.includes(t.sessionId) && t.hasNotification)
          if (!hasNotif) return prev
          return prev.map(t =>
            visibleIds.includes(t.sessionId) && t.hasNotification
              ? { ...t, hasNotification: false }
              : t
          )
        })
      }
    }
  }, [isVisible, activeTabId, splitSessionId])

  // On mount: validate persisted tabs against server sessions (recovery from refresh)
  const initializedRef = useRef(false)
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    api.getTerminalSessions().then(({ sessions }) => {
      const serverIds = new Set(sessions.map((s: any) => s.id))
      const serverMap = new Map(sessions.map((s: any) => [s.id, s]))
      setTabs(prev => {
        const valid: GlobalTab[] = []
        // Keep existing persisted tabs that still have server sessions
        for (const t of prev) {
          if (serverIds.has(t.sessionId)) {
            const srv = serverMap.get(t.sessionId) as any
            valid.push({ ...t, exited: false, hasNotification: false, taskId: t.taskId || srv?.taskId }) // Recover taskId
          }
        }
        // Add any server sessions not in our persisted tabs (recovery)
        for (const s of sessions) {
          if (!valid.some(t => t.sessionId === s.id)) {
            valid.push({
              sessionId: s.id,
              projectId: s.projectId,
              title: s.title,
              type: s.type,
              exited: false,
              hasNotification: false,
              taskId: (s as any).taskId,
            })
          }
        }
        return valid
      })
      // Fix active tab if it no longer exists
      setActiveTabId(prev => {
        if (prev && serverIds.has(prev)) return prev
        if (sessions.length > 0) return sessions[sessions.length - 1].id
        return null
      })
      // Validate split session
      setSplitSessionId(prev => {
        if (prev && serverIds.has(prev)) return prev
        return null
      })
      // If recovered sessions exist, show the panel
      if (sessions.length > 0) {
        setIsVisible(true)
      }
    }).catch(() => {})
  }, [])

  // Drag resize
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragStartY.current = e.clientY
    dragStartHeight.current = panelHeight

    const handleDragMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const diff = dragStartY.current - e.clientY
      const maxH = window.innerHeight * MAX_HEIGHT_RATIO
      const newHeight = Math.min(maxH, Math.max(MIN_HEIGHT, dragStartHeight.current + diff))
      setPanelHeight(newHeight)
    }

    const handleDragEnd = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', handleDragMove)
      document.removeEventListener('mouseup', handleDragEnd)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', handleDragMove)
    document.addEventListener('mouseup', handleDragEnd)
  }, [panelHeight])

  // Create a new terminal tab for a given project (or active project)
  const handleNewTab = useCallback(async (type = 'shell', forProjectId?: string, taskId?: string, prompt?: string, taskNumber?: number) => {
    if (!status?.available) {
      toast.error('Integrated terminal not available')
      return
    }

    const targetProject = forProjectId
      || activeProjectIdRef.current
      || tabsRef.current.find(t => t.sessionId === activeTabIdRef.current)?.projectId

    if (!targetProject) {
      toast.error('No project selected')
      return
    }

    try {
      // For AI resolve sessions, pass the prompt to the server so it can
      // inject it when Claude CLI is ready (output-based detection + chunked writes).
      const session = await createSession.mutateAsync({
        projectId: targetProject, type, cols: 80, rows: 24, taskId,
        ...(taskId && prompt ? { prompt } : {}),
      })
      const tab: GlobalTab = {
        sessionId: session.id,
        projectId: targetProject,
        title: session.title,
        type: session.type,
        exited: false,
        hasNotification: false,
        taskId,
        taskNumber,
      }
      setTabs(prev => [...prev, tab])

      if (splitNextTabRef.current) {
        // This tab was created for the split right pane
        splitNextTabRef.current = false
        setSplitSessionId(session.id)
        setActivePaneIndex(1)
      } else if (splitSessionIdRef.current) {
        // In split mode: assign to active pane
        if (activePaneIndexRef.current === 1) {
          setSplitSessionId(session.id)
        } else {
          setActiveTabId(session.id)
        }
      } else {
        setActiveTabId(session.id)
      }
      setIsVisible(true)

      // Register AI session for UI indicators
      if (taskId && prompt) {
        aiSessions.register({ taskId, sessionId: session.id, projectId: targetProject })
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to create terminal')
    }
  }, [status, createSession, aiSessions])

  const togglePanel = useCallback(() => {
    if (!isVisible && tabs.length === 0) {
      if (activeProjectIdRef.current) {
        setIsVisible(true)
        handleNewTab('shell')
      } else {
        setIsVisible(prev => !prev)
      }
    } else {
      setIsVisible(prev => !prev)
    }
  }, [isVisible, tabs.length, handleNewTab])

  // Keyboard shortcut: Ctrl+` to toggle terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [togglePanel])

  // Toggle split mode
  const handleToggleSplit = useCallback(() => {
    if (splitSessionIdRef.current) {
      // Exit split: keep the focused pane's terminal as active
      if (activePaneIndexRef.current === 1 && splitSessionIdRef.current) {
        setActiveTabId(splitSessionIdRef.current)
      }
      setSplitSessionId(null)
      setActivePaneIndex(0)
    } else {
      // Enter split: find another tab or create one
      const currentActive = activeTabIdRef.current
      const otherTab = tabsRef.current.find(t => t.sessionId !== currentActive && !t.exited)
      if (otherTab) {
        setSplitSessionId(otherTab.sessionId)
        setActivePaneIndex(1)
      } else {
        // Create a new terminal for the right pane
        splitNextTabRef.current = true
        handleNewTab('shell')
      }
    }
  }, [handleNewTab])

  const handleCloseTab = useCallback((sessionId: string) => {
    killSession.mutate(sessionId)
    aiSessions.unregisterBySession(sessionId)

    // Handle split mode cleanup
    const isSplitLeft = activeTabIdRef.current === sessionId && !!splitSessionIdRef.current
    const isSplitRight = splitSessionIdRef.current === sessionId

    if (isSplitRight) {
      setSplitSessionId(null)
      setActivePaneIndex(0)
    } else if (isSplitLeft) {
      setActiveTabId(splitSessionIdRef.current!)
      setSplitSessionId(null)
      setActivePaneIndex(0)
    }

    setTabs(prev => {
      const next = prev.filter(t => t.sessionId !== sessionId)
      if (!isSplitLeft && !isSplitRight && activeTabIdRef.current === sessionId) {
        setActiveTabId(next.length > 0 ? next[next.length - 1].sessionId : null)
      }
      if (next.length === 0) setIsVisible(false)
      return next
    })
  }, [killSession, aiSessions])

  const handleCloseAll = useCallback(() => {
    for (const tab of tabsRef.current) {
      killSession.mutate(tab.sessionId)
      if (tab.taskId) aiSessions.unregisterBySession(tab.sessionId)
    }
    setTabs([])
    setActiveTabId(null)
    setSplitSessionId(null)
    setActivePaneIndex(0)
    setIsVisible(false)
  }, [killSession, aiSessions])

  const handleClearExited = useCallback(() => {
    setTabs(prev => {
      const remaining = prev.filter(t => !t.exited)

      // Clean up split if either pane's session was cleared
      const splitGone = splitSessionIdRef.current && !remaining.some(t => t.sessionId === splitSessionIdRef.current)
      const activeGone = activeTabIdRef.current && !remaining.some(t => t.sessionId === activeTabIdRef.current)

      if (splitGone && activeGone) {
        setSplitSessionId(null)
        setActivePaneIndex(0)
        setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null)
      } else if (splitGone) {
        setSplitSessionId(null)
        setActivePaneIndex(0)
      } else if (activeGone) {
        if (splitSessionIdRef.current) {
          setActiveTabId(splitSessionIdRef.current)
          setSplitSessionId(null)
          setActivePaneIndex(0)
        } else {
          setActiveTabId(remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null)
        }
      }

      if (remaining.length === 0) setIsVisible(false)
      return remaining
    })
  }, [])

  const handleTabExit = useCallback((sessionId: string, _code: number) => {
    // Find the tab before modifying state — we need the taskId for needsReview
    const tab = tabsRef.current.find(t => t.sessionId === sessionId)

    // Show notification if the exited tab is not currently visible
    // (either it's not in any visible pane, or the panel is collapsed)
    const isVisibleToUser = (activeTabIdRef.current === sessionId || splitSessionIdRef.current === sessionId) && isVisibleRef.current

    setTabs(prev => prev.map(t =>
      t.sessionId === sessionId
        ? {
            ...t,
            exited: true,
            hasNotification: !isVisibleToUser,
            title: t.title.includes('[exited]') ? t.title : `${t.title} [exited]`,
          }
        : t
    ))
    // Unregister AI session when the process exits
    aiSessions.unregisterBySession(sessionId)

    // If this was an AI resolve session, check after a brief delay
    // whether the task moved to done and mark it as needsReview
    if (tab?.taskId) {
      const { projectId, taskId } = tab
      setTimeout(async () => {
        try {
          const { tasks } = await api.getTasks(projectId)
          const task = tasks.find((t: any) => t.id === taskId)
          if (task && task.status === 'done' && !task.needsReview) {
            await api.updateTask(projectId, taskId, { needsReview: true })
          }
        } catch {}
      }, 2000)
    }
  }, [aiSessions])

  // Stable ref so IntegratedTerminal doesn't re-create on every render
  const handleTabExitRef = useRef(handleTabExit)
  handleTabExitRef.current = handleTabExit

  // --- Bidirectional sync: terminal tabs <-> project tabs ---

  // Terminal tab click → also switch to that project's tab
  const handleTerminalTabClick = useCallback((sessionId: string) => {
    // Clear notification when user views this tab
    setTabs(prev => prev.map(t =>
      t.sessionId === sessionId && t.hasNotification
        ? { ...t, hasNotification: false }
        : t
    ))
    const tab = tabsRef.current.find(t => t.sessionId === sessionId)
    if (tab) {
      openProjectTab(tab.projectId)
    }

    if (splitSessionIdRef.current) {
      // In split mode
      if (sessionId === activeTabIdRef.current) {
        setActivePaneIndex(0)
      } else if (sessionId === splitSessionIdRef.current) {
        setActivePaneIndex(1)
      } else {
        // Assign to active pane
        if (activePaneIndexRef.current === 1) {
          setSplitSessionId(sessionId)
        } else {
          setActiveTabId(sessionId)
        }
      }
    } else {
      setActiveTabId(sessionId)
    }
  }, [openProjectTab])

  // Project tab change → find and activate a terminal for that project
  useEffect(() => {
    if (!activeProjectId) return
    // Check if active terminal already belongs to this project
    const activeTab = tabsRef.current.find(t => t.sessionId === activeTabIdRef.current)
    if (activeTab && activeTab.projectId === activeProjectId) return
    // Also check if split session already belongs to this project
    if (splitSessionIdRef.current) {
      const splitTab = tabsRef.current.find(t => t.sessionId === splitSessionIdRef.current)
      if (splitTab && splitTab.projectId === activeProjectId) return
    }
    // Find a non-exited terminal for this project
    const match = tabsRef.current.find(t => t.projectId === activeProjectId && !t.exited)
    if (match) {
      setActiveTabId(match.sessionId)
    }
  }, [activeProjectId])

  // Open native terminal for the active terminal's project
  const handleOpenExternal = useCallback(() => {
    const projectId = tabsRef.current.find(t => t.sessionId === activeTabIdRef.current)?.projectId
      || activeProjectIdRef.current
    if (!projectId) return
    launchNative.mutate(
      { projectId, type: 'shell' },
      { onSuccess: () => toast.success('Opened in native terminal') }
    )
  }, [launchNative])

  // Listen for shipyard:open-terminal events (from TerminalLauncher) for ANY project
  useEffect(() => {
    const handler = (e: CustomEvent<{ projectId: string; type: string; taskId?: string; taskNumber?: number; prompt?: string }>) => {
      handleNewTab(e.detail.type, e.detail.projectId, e.detail.taskId, e.detail.prompt, e.detail.taskNumber)
    }
    window.addEventListener('shipyard:open-terminal' as any, handler as any)
    return () => window.removeEventListener('shipyard:open-terminal' as any, handler as any)
  }, [handleNewTab])

  // Don't render if terminal not available
  if (!status?.available) return null

  const isSplit = !!splitSessionId

  return (
    <div ref={panelRef} className="relative shrink-0 border-t bg-[#0a0a0f]">
      {/* Drag handle */}
      {isVisible && (
        <div
          className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-10 hover:bg-primary/30 transition-colors"
          onMouseDown={handleDragStart}
        />
      )}

      {/* Tab bar — always visible */}
      <div className="flex items-center gap-0.5 px-2 h-8 bg-card/80 border-b border-border/50 select-none">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={togglePanel}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span className="relative">
                <Terminal className="h-3.5 w-3.5" />
                {tabs.some(t => t.hasNotification) && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                  </span>
                )}
              </span>
              <span className="font-medium">Terminal</span>
              {tabs.length > 0 && (
                <span className="text-[10px] text-muted-foreground/60">({tabs.length})</span>
              )}
              {isVisible ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Toggle terminal (Ctrl+`)</TooltipContent>
        </Tooltip>

        {/* Session tabs */}
        {isVisible && (
          <div className="flex items-center gap-0.5 flex-1 overflow-x-auto ml-1">
            {tabs.map(tab => {
              const isLeftPane = activeTabId === tab.sessionId
              const isRightPane = splitSessionId === tab.sessionId
              const isInPane = isLeftPane || isRightPane
              return (
                <button
                  key={tab.sessionId}
                  onClick={() => handleTerminalTabClick(tab.sessionId)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-0.5 text-[11px] rounded-sm transition-colors max-w-[200px] group',
                    isInPane
                      ? tab.taskId && !tab.exited
                        ? 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40'
                        : tab.taskId && tab.exited
                          ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40'
                          : 'bg-background/60 text-foreground'
                      : tab.taskId && !tab.exited
                        ? 'text-purple-400/60 hover:text-purple-300 hover:bg-purple-500/10'
                        : tab.taskId && tab.exited
                          ? 'text-emerald-400/60 hover:text-emerald-300 hover:bg-emerald-500/10'
                          : 'text-muted-foreground hover:text-foreground hover:bg-background/30',
                    tab.exited && !tab.taskId && !tab.hasNotification && 'opacity-50'
                  )}
                >
                  {/* Split pane indicator dot */}
                  {isSplit && isLeftPane && (
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                  )}
                  {isSplit && isRightPane && (
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  )}
                  {tab.taskId && !tab.exited && <Sparkles className="h-3 w-3 shrink-0 animate-pulse" />}
                  {tab.taskId && tab.exited && <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />}
                  {tab.hasNotification && (
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                    </span>
                  )}
                  <span className="truncate">{tab.title.replace(/^\[(.*?)\]\s*/, '$1 · ')}</span>
                  {tab.taskId && (
                    <span className="text-[9px] font-mono opacity-60 shrink-0">#{tab.taskNumber || '?'}</span>
                  )}
                  <X
                    className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.sessionId) }}
                  />
                </button>
              )
            })}

            {/* New tab button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleNewTab('shell')}
                  className="p-0.5 text-muted-foreground hover:text-foreground transition-colors rounded-sm hover:bg-background/30"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">New terminal</TooltipContent>
            </Tooltip>
          </div>
        )}

        {/* Right actions */}
        {isVisible && tabs.length > 0 && (
          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            {/* Split toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleToggleSplit}
                  className={cn(
                    'p-1 transition-colors rounded-sm',
                    isSplit
                      ? 'text-primary bg-primary/10 hover:bg-primary/20'
                      : 'text-muted-foreground hover:text-foreground hover:bg-background/30'
                  )}
                >
                  <Columns2 className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{isSplit ? 'Unsplit terminal' : 'Split terminal'}</TooltipContent>
            </Tooltip>
            {tabs.some(t => t.exited) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleClearExited}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-sm hover:bg-background/30"
                  >
                    <XCircle className="h-3 w-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">Clear exited terminals</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleOpenExternal}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-sm hover:bg-background/30"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Open in native terminal</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleCloseAll}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors rounded-sm hover:bg-background/30"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Kill all terminals</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Terminal content area */}
      {isVisible && (
        <div style={{ height: panelHeight }} className="relative">
          {/* Split divider */}
          {isSplit && (
            <div className="absolute top-0 left-1/2 -translate-x-px w-px h-full bg-border/60 z-10" />
          )}
          {/* Active pane indicator bar */}
          {isSplit && (
            <div
              className={cn(
                'absolute top-0 h-0.5 z-10 transition-all duration-150',
                activePaneIndex === 0
                  ? 'left-0 w-[calc(50%-0.5px)] bg-blue-400/60'
                  : 'left-[calc(50%+0.5px)] w-[calc(50%-0.5px)] bg-emerald-400/60'
              )}
            />
          )}

          {tabs.map(tab => {
            const isLeft = activeTabId === tab.sessionId
            const isRight = splitSessionId === tab.sessionId
            const isShown = isLeft || isRight

            return (
              <div
                key={tab.sessionId}
                className={cn(
                  isShown ? 'block' : 'hidden',
                  !isSplit && 'h-full',
                  isSplit && isShown && 'absolute top-0',
                )}
                style={isSplit && isShown ? {
                  left: isLeft ? 0 : 'calc(50% + 0.5px)',
                  width: 'calc(50% - 0.5px)',
                  height: '100%',
                } : undefined}
                onMouseDown={() => {
                  if (isSplit && isShown) {
                    setActivePaneIndex(isLeft ? 0 : 1)
                  }
                }}
              >
                <IntegratedTerminal
                  sessionId={tab.sessionId}
                  isActive={isShown}
                  onExit={handleTabExit}
                />
              </div>
            )
          })}
          {tabs.length === 0 && (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              <button
                onClick={() => handleNewTab('shell')}
                className="flex items-center gap-2 px-4 py-2 rounded-md hover:bg-background/30 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Open a terminal
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
