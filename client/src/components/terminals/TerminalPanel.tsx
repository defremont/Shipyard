import { useState, useRef, useCallback, useEffect, memo, lazy, Suspense } from 'react'
import { Plus, X, ChevronDown, ChevronUp, Terminal, Trash2, ExternalLink, Sparkles, XCircle, CheckCircle2, Columns2, MessageCircleQuestion, Pencil } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu'
import {
  useTerminalStatus,
  useCreateTerminalSession,
  useKillTerminalSession,
  useLiveTerminalSessions,
  useRenameTerminalSession,
} from '@/hooks/useTerminal'
import { useLaunchTerminal } from '@/hooks/useProjects'
import { useTabs } from '@/hooks/useTabs'
import { useAiSessions } from '@/hooks/useAiSessions'
import { api } from '@/lib/api'
// xterm + its addons are ~300kB and TerminalPanel is mounted by Layout on
// every page, so load the terminal only once a session actually exists.
const IntegratedTerminal = lazy(() =>
  import('./IntegratedTerminal').then(m => ({ default: m.IntegratedTerminal }))
)
import type { TerminalState } from './IntegratedTerminal'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface GlobalTab {
  sessionId: string
  projectId: string
  title: string
  type: string
  exited: boolean
  hasNotification: boolean
  /** Claude CLI is blocked on a decision. Transient — never trusted from
   *  localStorage, the server replays the state when the socket reconnects. */
  awaitingInput?: boolean
  /** Claude CLI came back to an empty prompt after working. Same transience:
   *  it is a moment, not a property of the session. */
  finished?: boolean
  taskId?: string
  taskNumber?: number
  /** Label parts the server keeps for this session — see describeTab(). */
  projectName?: string
  typeLabel?: string
  taskTitle?: string
  customTitle?: string
  summary?: string
}

/** Fields the server owns. Copied onto the tab whenever a session is read. */
function labelFieldsOf(session: any): Partial<GlobalTab> {
  return {
    projectName: session?.projectName,
    typeLabel: session?.typeLabel,
    taskTitle: session?.taskTitle,
    customTitle: session?.customTitle,
    summary: session?.summary,
    ...(session?.taskNumber ? { taskNumber: session.taskNumber } : {}),
  }
}

/** The old one-string title, "[Project] Shell", split back into its halves. */
function parseLegacyTitle(title: string): { project: string; detail: string } {
  const clean = title.replace(/\s*\[exited\]\s*$/, '')
  const match = clean.match(/^\[(.*?)\]\s*(.*)$/)
  if (match) return { project: match[1], detail: match[2] || 'Shell' }
  return { project: '', detail: clean }
}

/**
 * What a tab says and what its tooltip spells out. The short line is what fits
 * in a narrow tab; the tooltip carries the whole thing — the full task title,
 * which agent runs there, and the folder.
 */
function describeTab(tab: GlobalTab): { project: string; detail: string; tooltip: string[] } {
  const legacy = parseLegacyTitle(tab.title)
  const project = tab.projectName || legacy.project
  const taskLabel = tab.taskTitle ? `#${tab.taskNumber ?? '?'} ${tab.taskTitle}` : ''
  const kind = tab.typeLabel || legacy.detail
  const detail = tab.customTitle || taskLabel || tab.summary || kind

  const tooltip: string[] = []
  tooltip.push(project ? `${project} · ${kind}` : kind)
  if (tab.customTitle) tooltip.push(tab.customTitle)
  if (taskLabel) tooltip.push(taskLabel)
  else if (tab.summary) tooltip.push(tab.summary)
  if (tab.exited) tooltip.push('Process exited')
  else if (tab.finished) tooltip.push('Finished — waiting at the prompt')
  else if (tab.awaitingInput) tooltip.push('Waiting for an answer')
  return { project, detail, tooltip }
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

/**
 * What ties a tab to the pane it is showing in. Only the small number badge
 * and the pane's top rule carry colour — an outline around the tab itself read
 * as noise next to the neutral project tabs.
 */
const PANE_STYLES = [
  { badge: 'bg-primary text-primary-foreground', rule: 'border-primary' },
  { badge: 'bg-success text-success-foreground', rule: 'border-success' },
] as const

interface TerminalTabProps {
  tab: GlobalTab
  /** Which pane shows this tab (0 left, 1 right), or null when it is hidden. */
  paneIndex: 0 | 1 | null
  isSplit: boolean
  isDragging: boolean
  isDragOver: boolean
  isRenaming: boolean
  onClick: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  onOpenExternal: () => void
  onClearExited: () => void
  onRenameStart: () => void
  onRenameCommit: (title: string) => void
  onRenameCancel: () => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: React.DragEvent) => void
}

const TerminalTab = memo(function TerminalTab({
  tab, paneIndex, isSplit, isDragging, isDragOver, isRenaming,
  onClick, onClose, onCloseOthers, onCloseAll, onOpenExternal, onClearExited,
  onRenameStart, onRenameCommit, onRenameCancel,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}: TerminalTabProps) {
  const { project, detail, tooltip } = describeTab(tab)
  const inPane = paneIndex !== null
  const pane = paneIndex !== null ? PANE_STYLES[paneIndex] : null

  if (isRenaming) {
    return (
      <div className="flex h-6 min-w-[120px] max-w-[260px] basis-0 flex-1 items-center rounded-sm bg-background px-1.5 ring-1 ring-primary/60">
        <input
          autoFocus
          defaultValue={tab.customTitle || detail}
          placeholder="Tab name"
          // Typing replaces the old name; an empty field restores the automatic one.
          onFocus={(e) => e.currentTarget.select()}
          className="w-full bg-transparent text-[11px] text-foreground outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onRenameCommit(e.currentTarget.value) }
            else if (e.key === 'Escape') { e.preventDefault(); onRenameCancel() }
          }}
          onBlur={(e) => onRenameCommit(e.currentTarget.value)}
        />
      </div>
    )
  }

  const tab_ = (
    <div
      role="tab"
      aria-selected={inPane}
      // Native title, like the project tab strip: a Radix tooltip wrapped
      // around the trigger swallows the right-click that opens this menu.
      title={tooltip.join('\n')}
      draggable
      onClick={onClick}
      onDoubleClick={(e) => { e.preventDefault(); onRenameStart() }}
      onAuxClick={(e) => {
        if (e.button === 1) { e.preventDefault(); onClose() }
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'group flex h-6 min-w-[104px] max-w-[260px] basis-0 flex-1 cursor-pointer items-center gap-1.5 overflow-hidden rounded-sm px-2 text-[11px] transition-colors',
        inPane
          ? 'bg-background text-foreground shadow-sm ring-1 ring-border/80'
          : 'text-muted-foreground hover:bg-background/40 hover:text-foreground',
        tab.exited && !tab.hasNotification && 'opacity-60',
        isDragging && 'opacity-40',
        isDragOver && 'ring-2 ring-primary ring-inset'
      )}
    >
      {/* Split: the number says which pane this tab is showing in */}
      {isSplit && pane && paneIndex !== null && (
        <span className={cn(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[8px] font-bold leading-none',
          pane.badge
        )}>
          {paneIndex + 1}
        </span>
      )}
      {/* The agent is done: same check as an exited task tab, because to the
          user it is the same news — the run ended while they were elsewhere. */}
      {tab.finished && !tab.exited && <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />}
      {tab.taskId && !tab.exited && !tab.finished && (
        <Sparkles className="h-3 w-3 shrink-0 animate-pulse text-primary" />
      )}
      {tab.taskId && tab.exited && <CheckCircle2 className="h-3 w-3 shrink-0 text-success" />}
      {tab.awaitingInput && !tab.exited && (
        <MessageCircleQuestion className="h-3 w-3 shrink-0 text-warning animate-pulse" />
      )}
      {tab.hasNotification && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-warning opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-warning" />
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-left">
        {project && <span className="opacity-50">{project} · </span>}
        {detail}
      </span>
      <button
        aria-label="Close terminal"
        className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        onClick={(e) => { e.stopPropagation(); onClose() }}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tab_}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={onRenameStart}>
          <Pencil />
          Rename tab
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onClose}>
          <X />
          Close
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseOthers}>
          <XCircle />
          Close Others
        </ContextMenuItem>
        <ContextMenuItem onClick={onCloseAll}>
          <Trash2 />
          Close All
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onOpenExternal}>
          <ExternalLink />
          Open in External Terminal
        </ContextMenuItem>
        <ContextMenuItem onClick={onClearExited}>
          <Trash2 />
          Clear Exited Tabs
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})

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
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const renameSession = useRenameTerminalSession()
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
          const needsClear = prev.some(
            t => visibleIds.includes(t.sessionId) && (t.hasNotification || t.awaitingInput || t.finished)
          )
          if (!needsClear) return prev
          return prev.map(t =>
            visibleIds.includes(t.sessionId) && (t.hasNotification || t.awaitingInput || t.finished)
              ? { ...t, hasNotification: false, awaitingInput: false, finished: false }
              : t
          )
        })
      }
    }
  }, [isVisible, activeTabId, splitSessionId])

  // Labels are written server-side after the tab exists — the AI summary of a
  // shell, or a rename. Poll while there are tabs and copy them onto the tabs.
  const { data: liveSessions } = useLiveTerminalSessions(tabs.length > 0)
  useEffect(() => {
    const sessions = liveSessions?.sessions
    if (!sessions) return
    const byId = new Map(sessions.map(s => [s.id, s]))
    setTabs(prev => {
      let changed = false
      const next = prev.map(tab => {
        const session = byId.get(tab.sessionId)
        if (!session) return tab
        const fields = labelFieldsOf(session)
        const same = (Object.keys(fields) as (keyof GlobalTab)[])
          .every(key => tab[key] === fields[key])
        if (same) return tab
        changed = true
        return { ...tab, ...fields }
      })
      return changed ? next : prev
    })
  }, [liveSessions])

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
            valid.push({
              ...t,
              exited: false,
              hasNotification: false,
              awaitingInput: false,
              finished: false,
              taskId: t.taskId || srv?.taskId, // Recover taskId
              ...labelFieldsOf(srv),
            })
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
              ...labelFieldsOf(s),
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
  const handleNewTab = useCallback(async (type = 'shell', forProjectId?: string, taskId?: string, prompt?: string, taskNumber?: number, agent?: string) => {
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
        ...(prompt ? { prompt } : {}),
        ...(agent ? { agent } : {}),
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
        ...labelFieldsOf(session),
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

  // Keyboard shortcut: Ctrl+` to toggle terminal (also via Electron menu action)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        togglePanel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('shipyard:toggle-terminal', togglePanel)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('shipyard:toggle-terminal', togglePanel)
    }
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

  /** Bring the project tab of a terminal to the front — closing or focusing a
   *  terminal that belongs to another project used to leave the workspace
   *  showing the old one. */
  const followTabProject = useCallback((sessionId: string | null | undefined) => {
    if (!sessionId) return
    const tab = tabsRef.current.find(t => t.sessionId === sessionId)
    if (tab && tab.projectId !== activeProjectIdRef.current) openProjectTab(tab.projectId)
  }, [openProjectTab])

  const handleCloseTab = useCallback((sessionId: string) => {
    killSession.mutate(sessionId)
    aiSessions.unregisterBySession(sessionId)
    if (renamingId === sessionId) setRenamingId(null)

    // Handle split mode cleanup
    const isSplitLeft = activeTabIdRef.current === sessionId && !!splitSessionIdRef.current
    const isSplitRight = splitSessionIdRef.current === sessionId

    if (isSplitRight) {
      setSplitSessionId(null)
      setActivePaneIndex(0)
      followTabProject(activeTabIdRef.current)
    } else if (isSplitLeft) {
      setActiveTabId(splitSessionIdRef.current!)
      setSplitSessionId(null)
      setActivePaneIndex(0)
      followTabProject(splitSessionIdRef.current)
    }

    setTabs(prev => {
      const index = prev.findIndex(t => t.sessionId === sessionId)
      const next = prev.filter(t => t.sessionId !== sessionId)
      if (!isSplitLeft && !isSplitRight && activeTabIdRef.current === sessionId) {
        // Adjacent tab, like the project and editor tab strips — jumping to
        // the last tab loses the user's place.
        const neighbour = next[Math.min(Math.max(index, 0), next.length - 1)]
        setActiveTabId(neighbour ? neighbour.sessionId : null)
        // The tab that takes over may belong to another project; the workspace
        // follows it, so terminal and project never disagree.
        if (neighbour) followTabProject(neighbour.sessionId)
      }
      if (next.length === 0) setIsVisible(false)
      return next
    })
  }, [killSession, aiSessions, followTabProject, renamingId])

  /** Drag a tab onto another to reorder — same gesture as the project tabs. */
  const reorderTabs = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return
    setTabs(prev => {
      const fromIdx = prev.findIndex(t => t.sessionId === fromId)
      const toIdx = prev.findIndex(t => t.sessionId === toId)
      if (fromIdx === -1 || toIdx === -1) return prev
      const next = prev.slice()
      const [moved] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, moved)
      return next
    })
  }, [])

  /** Name a tab by hand. An empty name hands it back to the automatic label. */
  const handleRename = useCallback((sessionId: string, title: string) => {
    const clean = title.trim()
    setRenamingId(null)
    setTabs(prev => prev.map(t => (
      t.sessionId === sessionId ? { ...t, customTitle: clean || undefined } : t
    )))
    renameSession.mutate({ sessionId, title: clean || null })
  }, [renameSession])

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
        const fallback = remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null
        setActiveTabId(fallback)
        followTabProject(fallback)
      } else if (splitGone) {
        setSplitSessionId(null)
        setActivePaneIndex(0)
      } else if (activeGone) {
        if (splitSessionIdRef.current) {
          setActiveTabId(splitSessionIdRef.current)
          setSplitSessionId(null)
          setActivePaneIndex(0)
          followTabProject(splitSessionIdRef.current)
        } else {
          const fallback = remaining.length > 0 ? remaining[remaining.length - 1].sessionId : null
          setActiveTabId(fallback)
          followTabProject(fallback)
        }
      }

      if (remaining.length === 0) setIsVisible(false)
      return remaining
    })
  }, [followTabProject])

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
    // whether the task moved to done. If Claude forgot to update the
    // task status via the API, auto-mark it as done so tasks don't
    // stay stuck in_progress after the AI finishes.
    if (tab?.taskId) {
      const { projectId, taskId } = tab
      setTimeout(async () => {
        try {
          const { tasks } = await api.getTasks(projectId)
          const task = tasks.find((t: any) => t.id === taskId)
          if (!task) return
          if (task.status === 'done' && !task.needsReview) {
            // Claude updated the task — just flag for review
            await api.updateTask(projectId, taskId, { needsReview: true })
          } else if (task.status !== 'done') {
            // Claude did NOT update the task — auto-mark as done
            await api.updateTask(projectId, taskId, { status: 'done', needsReview: true })
          }
        } catch {}
      }, 3000)
    }
  }, [aiSessions])

  // Stable ref so IntegratedTerminal doesn't re-create on every render
  const handleTabExitRef = useRef(handleTabExit)
  handleTabExitRef.current = handleTabExit

  // Claude CLI stopped — to ask something, or because it finished. Either way
  // the tab is flagged unless the user is already looking at it; otherwise the
  // question sits unanswered, or the finished run goes unnoticed, behind
  // another tab.
  const handleTabState = useCallback((sessionId: string, state: TerminalState) => {
    const isVisibleToUser =
      (activeTabIdRef.current === sessionId || splitSessionIdRef.current === sessionId) && isVisibleRef.current

    setTabs(prev => {
      const tab = prev.find(t => t.sessionId === sessionId)
      if (!tab) return prev
      const awaiting = state === 'awaiting-input' && !isVisibleToUser
      // Going back to work clears the flag; the tab the user is on never gets
      // one, since they can see the prompt for themselves.
      const finished = state === 'finished' && !isVisibleToUser
      if (!!tab.awaitingInput === awaiting && !!tab.finished === finished) return prev
      return prev.map(t => (t.sessionId === sessionId ? { ...t, awaitingInput: awaiting, finished } : t))
    })
  }, [])

  // --- Bidirectional sync: terminal tabs <-> project tabs ---

  // Terminal tab click → also switch to that project's tab
  const handleTerminalTabClick = useCallback((sessionId: string) => {
    // Clear notification when user views this tab
    setTabs(prev => prev.map(t =>
      t.sessionId === sessionId && (t.hasNotification || t.awaitingInput || t.finished)
        ? { ...t, hasNotification: false, awaitingInput: false, finished: false }
        : t
    ))
    followTabProject(sessionId)

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
  }, [followTabProject])

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
    const handler = (e: CustomEvent<{ projectId: string; type: string; taskId?: string; taskNumber?: number; prompt?: string; agent?: string }>) => {
      handleNewTab(e.detail.type, e.detail.projectId, e.detail.taskId, e.detail.prompt, e.detail.taskNumber, e.detail.agent)
    }
    window.addEventListener('shipyard:open-terminal' as any, handler as any)
    return () => window.removeEventListener('shipyard:open-terminal' as any, handler as any)
  }, [handleNewTab])

  // Don't render if terminal not available
  if (!status?.available) return null

  const isSplit = !!splitSessionId

  // The dot on the closed panel: a question outranks a finished run, since one
  // is blocking and the other is just news.
  const someAsking = tabs.some(t => t.hasNotification || t.awaitingInput)
  const someFinished = tabs.some(t => t.finished)

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
                {(someAsking || someFinished) && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className={cn(
                      'animate-ping absolute inline-flex h-full w-full rounded-full opacity-75',
                      someAsking ? 'bg-warning' : 'bg-success'
                    )} />
                    <span className={cn(
                      'relative inline-flex rounded-full h-2 w-2',
                      someAsking ? 'bg-warning' : 'bg-success'
                    )} />
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

        {/* Session tabs — they share the width, truncate and can be dragged
            into a new order, like the project tab strip. */}
        {isVisible && (
          <div className="ml-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {tabs.map(tab => {
              const paneIndex: 0 | 1 | null = activeTabId === tab.sessionId
                ? 0
                : splitSessionId === tab.sessionId
                  ? 1
                  : null
              return (
                <TerminalTab
                  key={tab.sessionId}
                  tab={tab}
                  paneIndex={paneIndex}
                  isSplit={isSplit}
                  isDragging={draggingId === tab.sessionId}
                  isDragOver={dragOverId === tab.sessionId && draggingId !== tab.sessionId}
                  isRenaming={renamingId === tab.sessionId}
                  onClick={() => handleTerminalTabClick(tab.sessionId)}
                  onClose={() => handleCloseTab(tab.sessionId)}
                  onCloseOthers={() => tabsRef.current
                    .filter(t => t.sessionId !== tab.sessionId)
                    .forEach(t => handleCloseTab(t.sessionId))}
                  onCloseAll={handleCloseAll}
                  onOpenExternal={handleOpenExternal}
                  onClearExited={handleClearExited}
                  onRenameStart={() => setRenamingId(tab.sessionId)}
                  onRenameCommit={(title) => handleRename(tab.sessionId, title)}
                  onRenameCancel={() => setRenamingId(null)}
                  onDragStart={(event) => {
                    setDraggingId(tab.sessionId)
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData('text/plain', tab.sessionId)
                  }}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
                  onDragOver={(event) => {
                    if (draggingId && draggingId !== tab.sessionId) {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setDragOverId(tab.sessionId)
                    }
                  }}
                  onDragLeave={() => setDragOverId(prev => prev === tab.sessionId ? null : prev)}
                  onDrop={(event) => {
                    event.preventDefault()
                    const fromId = event.dataTransfer.getData('text/plain') || draggingId
                    if (fromId) reorderTabs(fromId, tab.sessionId)
                    setDraggingId(null)
                    setDragOverId(null)
                  }}
                />
              )
            })}

            {/* New tab button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handleNewTab('shell')}
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-background/30 hover:text-foreground"
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

          {tabs.map(tab => {
            const isLeft = activeTabId === tab.sessionId
            const isRight = splitSessionId === tab.sessionId
            const isShown = isLeft || isRight
            const paneIndex: 0 | 1 = isLeft ? 0 : 1
            const pane = PANE_STYLES[paneIndex]
            const isPaneActive = isSplit && activePaneIndex === paneIndex
            const { project, detail } = describeTab(tab)

            return (
              <div
                key={tab.sessionId}
                className={cn(
                  isShown ? 'flex flex-col' : 'hidden',
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
                    setActivePaneIndex(paneIndex)
                  }
                }}
              >
                {/* Split: each pane says out loud which terminal it holds, in
                    the same colour and number as that terminal's tab. */}
                {isSplit && isShown && (
                  <div className={cn(
                    'flex h-6 shrink-0 items-center gap-1.5 border-b border-t-2 px-2 text-[10px] transition-colors',
                    isPaneActive
                      ? `${pane.rule} border-b-border/60 bg-card/70 text-foreground`
                      : 'border-t-transparent border-b-border/30 bg-card/20 text-muted-foreground'
                  )}>
                    <span className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] text-[8px] font-bold leading-none',
                      pane.badge
                    )}>
                      {paneIndex + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {project && <span className="opacity-50">{project} · </span>}
                      {detail}
                    </span>
                    <button
                      aria-label="Close terminal"
                      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.sessionId) }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                <div className={cn('min-h-0', isSplit ? 'flex-1' : 'h-full')}>
                  <Suspense fallback={null}>
                    <IntegratedTerminal
                      sessionId={tab.sessionId}
                      isActive={isShown}
                      onExit={handleTabExit}
                      onStateChange={handleTabState}
                    />
                  </Suspense>
                </div>
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
