import { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo, memo, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Plus, X, ChevronDown, ChevronUp, Terminal, Trash2, ExternalLink, Sparkles, XCircle, Columns2, Pencil, Maximize2, Rows2, Play, Monitor } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { SessionStatusIcon } from './SessionStatusIcon'
import { terminalTabsStore, type SessionStatus } from '@/hooks/useTerminalTabs'
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
import { layoutStore, useLayoutMode } from '@/hooks/useLayoutMode'
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
  /** What the CLI is doing, as last reported by the server. Transient too. */
  state?: TerminalState
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

/**
 * One status per tab, shown by one icon. A question stays lit until it is
 * answered — the tab being open does not make the CLI any less blocked — while
 * "finished" is news and goes away once seen.
 */
function tabStatus(tab: GlobalTab): SessionStatus {
  if (tab.exited) return tab.hasNotification ? 'finished' : 'exited'
  if (tab.state === 'awaiting-input') return 'question'
  if (tab.finished) return 'finished'
  if (tab.state === 'busy') return 'busy'
  return tab.state ? 'idle' : 'none'
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
function describeTab(tab: GlobalTab): { number: string; project: string; detail: string; tooltip: string[] } {
  const legacy = parseLegacyTitle(tab.title)
  const project = tab.projectName || legacy.project
  const taskLabel = tab.taskTitle ? `#${tab.taskNumber ?? '?'} ${tab.taskTitle}` : ''
  // The task number leads the tab: truncation eats the end, never the number.
  const number = tab.taskTitle && tab.taskNumber != null ? `#${tab.taskNumber}` : ''
  const kind = tab.typeLabel || legacy.detail
  const detail = tab.customTitle || tab.taskTitle || tab.summary || kind

  const tooltip: string[] = []
  tooltip.push(project ? `${project} · ${kind}` : kind)
  if (tab.customTitle) tooltip.push(tab.customTitle)
  if (taskLabel) tooltip.push(taskLabel)
  else if (tab.summary) tooltip.push(tab.summary)
  const status = tabStatus(tab)
  if (tab.exited) tooltip.push('Process exited')
  else if (status === 'question') tooltip.push('Waiting for an answer')
  else if (status === 'finished') tooltip.push('Finished — waiting at the prompt')
  else if (status === 'busy') tooltip.push('Working')
  return { number, project, detail, tooltip }
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
  /** False when the strip only lists the open project's sessions — the
   *  project tab already says whose they are. */
  showProject: boolean
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
  tab, paneIndex, isSplit, showProject, isDragging, isDragOver, isRenaming,
  onClick, onClose, onCloseOthers, onCloseAll, onOpenExternal, onClearExited,
  onRenameStart, onRenameCommit, onRenameCancel,
  onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop,
}: TerminalTabProps) {
  const { number, project, detail, tooltip } = describeTab(tab)
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
        // The open tab has to be findable at a glance in a row of eight: it
        // keeps the lit background and adds weight and a rule of its own.
        inPane
          ? 'bg-background font-medium text-foreground shadow-sm ring-1 ring-border relative before:absolute before:inset-x-1 before:top-0 before:h-[2px] before:rounded-full before:bg-foreground/40'
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
      <SessionStatusIcon status={tabStatus(tab)} />
      <span className="min-w-0 flex-1 truncate text-left">
        {number && <span className="tabular-nums">{number} </span>}
        {showProject && project && <span className="opacity-50">{project} · </span>}
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

  // Focus layout: an open terminal takes the whole work area. Only inside a
  // project — the dashboard and the full-page routes keep the split height.
  const { mode: layoutMode, chatFull, tabSlot } = useLayoutMode()
  const focusMode = layoutMode === 'focus'
  const onWorkspace = useLocation().pathname.startsWith('/project/')
  // Inside a project the strip lists that project's sessions only. A global
  // list made every tab repeat its project name, and clicking one changed the
  // project underneath the user.
  const scoped = onWorkspace && !!activeProjectId
  const visibleTabs = useMemo(
    () => (scoped ? tabs.filter(t => t.projectId === activeProjectId) : tabs),
    [scoped, tabs, activeProjectId]
  )
  // Focus layout: the strip is drawn in the workspace toolbar, not in a bar
  // of its own.
  const portaled = !!tabSlot && focusMode && onWorkspace
  const isFull = !!status?.available && isVisible && focusMode && onWorkspace
  const isFullRef = useRef(isFull)
  isFullRef.current = isFull

  useLayoutEffect(() => {
    layoutStore.setTerminalFull(isFull)
    return () => layoutStore.setTerminalFull(false)
  }, [isFull])

  // Tasks/Editor was clicked: in focus layout the terminal steps aside.
  useEffect(() => {
    const handler = () => {
      if (layoutStore.get().mode === 'focus') setIsVisible(false)
    }
    window.addEventListener('shipyard:focus-workspace', handler)
    return () => window.removeEventListener('shipyard:focus-workspace', handler)
  }, [])

  const panelRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
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
  const scopedRef = useRef(scoped)
  scopedRef.current = scoped

  // The rest of the app (project tabs, the task rail) reads session status
  // from here.
  useEffect(() => {
    terminalTabsStore.set(tabs.map(tab => ({
      sessionId: tab.sessionId,
      projectId: tab.projectId,
      taskId: tab.taskId,
      status: tabStatus(tab),
    })))
  }, [tabs])

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

  /** A state the server reported for a session, turned into what the tab
   *  shows. Called for socket frames and for the poll alike. */
  const applyState = useCallback((tab: GlobalTab, state: TerminalState): GlobalTab => {
    if (tab.state === state) return tab
    const isVisibleToUser =
      (activeTabIdRef.current === tab.sessionId || splitSessionIdRef.current === tab.sessionId) && isVisibleRef.current
    return {
      ...tab,
      state,
      awaitingInput: state === 'awaiting-input' && !isVisibleToUser,
      // The tab the user is on never gets the "finished" flag: they can see
      // the prompt for themselves. Going back to work clears it.
      finished: state === 'finished' && !isVisibleToUser,
    }
  }, [])

  // Labels and states are written server-side after the tab exists. The socket
  // pushes both, but a terminal is only connected while it is mounted — with
  // the panel closed (the board is in front) nothing would arrive, which is
  // exactly when a flag matters. So the list is polled as well.
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
        const sameLabel = (Object.keys(fields) as (keyof GlobalTab)[])
          .every(key => tab[key] === fields[key])
        const labelled = sameLabel ? tab : { ...tab, ...fields }
        const stated = session.state ? applyState(labelled, session.state) : labelled
        if (stated !== tab) changed = true
        return stated
      })
      return changed ? next : prev
    })
  }, [liveSessions, applyState])

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
              state: srv?.state,
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
              state: s.state,
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
      // If recovered sessions exist, show the panel. Not in focus layout:
      // there "show" means covering the workspace, so the saved state stands.
      if (sessions.length > 0 && layoutStore.get().mode !== 'focus') {
        setIsVisible(true)
      }
    }).catch(() => {})
  }, [])

  // Drag resize
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true
    dragStartY.current = e.clientY
    // Dragging a full-size terminal is how a manual split starts: the first
    // move switches the layout to split, from the height it has right now.
    let leaveFull = isFullRef.current
    dragStartHeight.current = leaveFull && contentRef.current
      ? contentRef.current.offsetHeight
      : panelHeight

    const handleDragMove = (e: MouseEvent) => {
      if (!isDragging.current) return
      const diff = dragStartY.current - e.clientY
      if (leaveFull) {
        if (diff === 0) return
        leaveFull = false
        layoutStore.setMode('split')
      }
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
        state: session.state,
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
    if (!isVisible && visibleTabs.length === 0) {
      if (activeProjectIdRef.current) {
        setIsVisible(true)
        handleNewTab('shell')
      } else {
        setIsVisible(prev => !prev)
      }
    } else {
      setIsVisible(prev => !prev)
    }
  }, [isVisible, visibleTabs.length, handleNewTab])

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
      const closing = prev.find(t => t.sessionId === sessionId)
      // Inside a project the strip only shows that project's sessions, so the
      // tab that takes over has to come from the same strip.
      const strip = scopedRef.current && closing
        ? prev.filter(t => t.projectId === closing.projectId)
        : prev
      const index = strip.findIndex(t => t.sessionId === sessionId)
      const rest = strip.filter(t => t.sessionId !== sessionId)
      const next = prev.filter(t => t.sessionId !== sessionId)
      if (!isSplitLeft && !isSplitRight && activeTabIdRef.current === sessionId) {
        // Adjacent tab, like the project and editor tab strips — jumping to
        // the last tab loses the user's place.
        const neighbour = rest[Math.min(Math.max(index, 0), rest.length - 1)]
        setActiveTabId(neighbour ? neighbour.sessionId : null)
        // Outside a project the tab that takes over may belong to another
        // one; the workspace follows it, so terminal and project never disagree.
        if (neighbour) followTabProject(neighbour.sessionId)
      }
      if (rest.length === 0) setIsVisible(false)
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

  /** Close every tab of the strip: the open project's inside a project, all
   *  of them elsewhere. Another project's agents are never killed from here. */
  const handleCloseAll = useCallback(() => {
    const projectId = scopedRef.current ? activeProjectIdRef.current : null
    const closing = tabsRef.current.filter(t => !projectId || t.projectId === projectId)
    const closingIds = new Set(closing.map(t => t.sessionId))
    for (const tab of closing) {
      killSession.mutate(tab.sessionId)
      if (tab.taskId) aiSessions.unregisterBySession(tab.sessionId)
    }
    setTabs(prev => prev.filter(t => !closingIds.has(t.sessionId)))
    if (activeTabIdRef.current && closingIds.has(activeTabIdRef.current)) setActiveTabId(null)
    if (splitSessionIdRef.current && closingIds.has(splitSessionIdRef.current)) {
      setSplitSessionId(null)
      setActivePaneIndex(0)
    }
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
    setTabs(prev => {
      const tab = prev.find(t => t.sessionId === sessionId)
      if (!tab) return prev
      const next = applyState(tab, state)
      return next === tab ? prev : prev.map(t => (t.sessionId === sessionId ? next : t))
    })
  }, [applyState])

  // The server named the tab: the topic Claude Code gave its terminal, or the
  // AI summary of a shell. It lands at once instead of at the next poll.
  const handleTabLabel = useCallback((sessionId: string, summary: string | null) => {
    setTabs(prev => {
      const tab = prev.find(t => t.sessionId === sessionId)
      if (!tab || (tab.summary ?? null) === summary) return prev
      return prev.map(t => (t.sessionId === sessionId ? { ...t, summary: summary ?? undefined } : t))
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
    // Focus layout lists the tabs while the panel is closed; a click opens it.
    setIsVisible(true)

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
      || tabsRef.current.find(t => t.projectId === activeProjectId)
    // The pane never shows another project's terminal: with nothing of this
    // project to show it is empty, and in focus layout it gets out of the way
    // of the workspace the user just asked for.
    setActiveTabId(match ? match.sessionId : null)
    if (!match && layoutStore.get().mode === 'focus') setIsVisible(false)
  }, [activeProjectId])

  // The task rail asks for the terminal of a task.
  useEffect(() => {
    const handler = (e: Event) => {
      const sessionId = (e as CustomEvent<{ sessionId?: string }>).detail?.sessionId
      if (sessionId && tabsRef.current.some(t => t.sessionId === sessionId)) handleTerminalTabClick(sessionId)
    }
    window.addEventListener('shipyard:focus-terminal', handler)
    return () => window.removeEventListener('shipyard:focus-terminal', handler)
  }, [handleTerminalTabClick])

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
  const someAsking = visibleTabs.some(t => t.hasNotification || t.state === 'awaiting-input')
  const someFinished = visibleTabs.some(t => t.finished)

  const sessionTabs = visibleTabs.map(tab => {
    const paneIndex: 0 | 1 | null = activeTabId === tab.sessionId
      ? 0
      : splitSessionId === tab.sessionId
        ? 1
        : null
    return (
      <TerminalTab
        key={tab.sessionId}
        tab={tab}
        // With the panel closed no tab is "the open one".
        paneIndex={isVisible ? paneIndex : null}
        isSplit={isSplit}
        showProject={!scoped}
        isDragging={draggingId === tab.sessionId}
        isDragOver={dragOverId === tab.sessionId && draggingId !== tab.sessionId}
        isRenaming={renamingId === tab.sessionId}
        onClick={() => handleTerminalTabClick(tab.sessionId)}
        onClose={() => handleCloseTab(tab.sessionId)}
        onCloseOthers={() => visibleTabs
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
  })

  // One menu opens a session and holds the panel actions, so the toolbar row
  // carries a single button instead of six.
  const newMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="New session"
          title="New session"
          className="shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => handleNewTab('claude-yolo')}>
          <Sparkles />
          Claude Code (YOLO)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleNewTab('claude')}>
          <Sparkles />
          Claude Code
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleNewTab('shell')}>
          <Monitor />
          Shell
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleNewTab('dev')}>
          <Play />
          Dev server
        </DropdownMenuItem>
        {visibleTabs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleToggleSplit}>
              <Columns2 />
              {isSplit ? 'Unsplit terminal' : 'Split terminal'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => layoutStore.setMode(focusMode ? 'split' : 'focus')}>
              {focusMode ? <Rows2 /> : <Maximize2 />}
              {focusMode ? 'Split with the workspace' : 'Full-size panels'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenExternal}>
              <ExternalLink />
              Open in native terminal
            </DropdownMenuItem>
            {visibleTabs.some(t => t.exited) && (
              <DropdownMenuItem onClick={handleClearExited}>
                <XCircle />
                Clear exited terminals
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleCloseAll} className="text-destructive focus:text-destructive">
              <Trash2 />
              {scoped ? 'Kill this project\u2019s terminals' : 'Kill all terminals'}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div
      ref={panelRef}
      className={cn(
        'relative bg-[#0a0a0f]',
        // Closed and with its tabs drawn in the toolbar, the panel has
        // nothing of its own to show — not even a border.
        portaled && !isVisible ? 'hidden' : 'border-t',
        isFull ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0'
      )}
    >
      {/* Drag handle */}
      {isVisible && (
        <div
          className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize z-10 hover:bg-primary/30 transition-colors"
          onMouseDown={handleDragStart}
        />
      )}

      {portaled && tabSlot && createPortal(
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden select-none">
          {sessionTabs}
          {newMenu}
        </div>,
        tabSlot
      )}

      {/* Tab bar of its own — outside a project, and in the split layout */}
      {!portaled && (
      <div className="flex shrink-0 items-center gap-0.5 px-2 h-8 bg-card/80 border-b border-border/50 select-none">
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
                      'relative inline-flex rounded-full h-2 w-2',
                      someAsking ? 'bg-warning' : 'bg-success'
                    )} />
                  </span>
                )}
              </span>
              <span className="font-medium">Terminal</span>
              {visibleTabs.length > 0 && (
                <span className="text-[10px] text-muted-foreground/60">({visibleTabs.length})</span>
              )}
              {isVisible ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Toggle terminal (Ctrl+`)</TooltipContent>
        </Tooltip>

        {/* Session tabs — they share the width, truncate and can be dragged
            into a new order, like the project tab strip. */}
        {(isVisible || (onWorkspace && visibleTabs.length > 0)) && (
          <div className="ml-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
            {sessionTabs}
            {newMenu}
          </div>
        )}
      </div>
      )}

      {/* Terminal content area */}
      {isVisible && (
        <div
          ref={contentRef}
          style={isFull ? undefined : { height: panelHeight }}
          className={cn('relative', isFull && 'min-h-0 flex-1')}
        >
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
            const { number, project, detail } = describeTab(tab)

            return (
              <div
                key={tab.sessionId}
                className={cn(
                  isShown ? 'flex flex-col' : 'hidden',
                  !isSplit && (isFull ? 'absolute inset-0' : 'h-full'),
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
                      {number && <span className="tabular-nums">{number} </span>}
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
                      // Full-size chat hides the whole main column; a fit
                      // against a zero-size box would shrink the PTY.
                      isActive={isShown && !chatFull}
                      onExit={handleTabExit}
                      onStateChange={handleTabState}
                      onLabelChange={handleTabLabel}
                    />
                  </Suspense>
                </div>
              </div>
            )
          })}
          {visibleTabs.length === 0 && (
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
