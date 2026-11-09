import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FolderOpen,
  ClipboardList,
  Settings,
  HelpCircle,
  LayoutDashboard,
  LayoutGrid,
  ScrollText,
  TextSearch,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { useAllTasks, type Task } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'
import { useEditorTabsContext } from '@/hooks/useEditorTabsContext'
import { FileIcon } from '@/components/files/FileIcon'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { makeContextRank, rankProjects, rankTasks } from '@/lib/searchRanking'
import { priorityVisual, statusVisual } from '@/lib/taskVisuals'
import {
  PaletteShell, PaletteInput, PaletteFooter, SectionHeader, EmptyState, Highlight, Kbd,
  usePaletteToggle, termsMatcher, openContentSearch, TOGGLE_SEARCH_EVENT, TOGGLE_CONTENT_SEARCH_EVENT,
} from './SearchPalette'

type FilterTab = 'all' | 'projects' | 'tasks' | 'files'
const FILTERS: Array<{ id: FilterTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'projects', label: 'Projects' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'files', label: 'Files' },
]

interface FileResult {
  name: string
  path: string
  projectId: string
  projectName: string
  type: 'file' | 'dir'
  extension?: string
}

interface Command {
  id: string
  label: string
  icon: LucideIcon
  shortcut?: string
  run: () => void
}

interface Item {
  id: string
  run: () => void
}

const isShortcut = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK'

/** A palette row: one height, one selection style, hover selects. */
function Row({ selected, onSelect, onRun, children, className }: {
  selected: boolean
  onSelect: () => void
  onRun: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <div
      data-selected={selected}
      onMouseMove={() => !selected && onSelect()}
      onClick={onRun}
      className={cn(
        'mx-1.5 flex h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm',
        selected ? 'bg-accent text-accent-foreground' : 'text-foreground',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [fileResults, setFileResults] = useState<FileResult[]>([])
  const [fileSearching, setFileSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { openTab, activeTabId } = useTabs()
  const { openFileForProject } = useEditorTabsContext()
  const { data: projects } = useProjects()
  // Mounted on every page, but only visible on Ctrl+K — don't poll while closed.
  const { data: tasks } = useAllTasks({ enabled: open })

  // The open project and its client rank first everywhere in the palette.
  const contextRank = useMemo(() => makeContextRank(projects, activeTabId), [projects, activeTabId])
  const activeProject = useMemo(() => projects?.find(p => p.id === activeTabId), [projects, activeTabId])

  const close = useCallback(() => setOpen(false), [])
  const onToggle = useCallback((detail?: { open?: boolean }) => {
    setOpen(prev => {
      const next = detail?.open ? true : !prev
      if (next) {
        setQuery('')
        setActiveFilter('all')
        setFileResults([])
      }
      return next
    })
  }, [])
  usePaletteToggle(TOGGLE_SEARCH_EVENT, TOGGLE_CONTENT_SEARCH_EVENT, isShortcut, onToggle, close)

  const trimmedQuery = query.trim()
  const isTaskNumber = /^#\d+$/.test(trimmedQuery)
  const matcher = useMemo(() => termsMatcher(trimmedQuery), [trimmedQuery])

  // Debounced file search. The server answers from an in-memory index, so the
  // wait is short; a newer query aborts the request still in flight.
  useEffect(() => {
    if (!open || trimmedQuery.length < 2 || isTaskNumber || (activeFilter !== 'all' && activeFilter !== 'files')) {
      setFileResults([])
      setFileSearching(false)
      return
    }
    setFileSearching(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const data = await api.searchFiles(trimmedQuery, { prefer: activeTabId ?? undefined, signal: controller.signal })
        if (!controller.signal.aborted) setFileResults(data.results)
      } catch {
        if (!controller.signal.aborted) setFileResults([])
      } finally {
        if (!controller.signal.aborted) setFileSearching(false)
      }
    }, 120)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, trimmedQuery, isTaskNumber, activeFilter, activeTabId])

  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>()
    projects?.forEach(p => map.set(p.id, p.name))
    return map
  }, [projects])

  // A task number ("#378") names one task; projects would only be noise.
  const filteredProjects = useMemo(
    () => (isTaskNumber ? [] : rankProjects(projects, trimmedQuery, contextRank)),
    [projects, trimmedQuery, isTaskNumber, contextRank],
  )

  const filteredTasks = useMemo(
    () => rankTasks(tasks, trimmedQuery, {
      projectName: id => projectNameMap.get(id) || '',
      contextRank,
      limit: 30,
    }),
    [tasks, trimmedQuery, projectNameMap, contextRank],
  )

  // Opening a task shows it, not just its project: the dialog lives in
  // TaskViewerHost because the palette unmounts on close.
  const openTask = useCallback((task: Task) => {
    openTab(task.projectId)
    window.dispatchEvent(new CustomEvent('shipyard:open-task', { detail: task }))
  }, [openTab])

  const openFile = useCallback((f: FileResult) => {
    if (f.type === 'file') openFileForProject(f.projectId, f.path, f.name, f.extension || '')
    else openTab(f.projectId)
  }, [openFileForProject, openTab])

  const commands = useMemo<Command[]>(() => [
    { id: 'dashboard', label: 'Go to Dashboard', icon: LayoutDashboard, run: () => navigate('/') },
    { id: 'tasks', label: 'All Tasks', icon: ClipboardList, run: () => navigate('/tasks') },
    { id: 'agents', label: 'Agents', icon: LayoutGrid, run: () => navigate('/agents') },
    { id: 'content', label: 'Search in file contents', icon: TextSearch, shortcut: 'Ctrl+Shift+F', run: () => openContentSearch() },
    { id: 'settings', label: 'Open Settings', icon: Settings, run: () => navigate('/settings') },
    { id: 'logs', label: 'Open Logs', icon: ScrollText, run: () => navigate('/logs') },
    { id: 'help', label: 'Open Help', icon: HelpCircle, run: () => navigate('/help') },
  ], [navigate])

  // Commands answer to their name too ("set" finds Settings).
  const filteredCommands = useMemo(() => {
    if (activeFilter !== 'all' || isTaskNumber) return []
    if (!trimmedQuery) return commands
    const terms = trimmedQuery.toLowerCase().split(/\s+/)
    return commands.filter(c => c.id !== 'content' && terms.every(t => c.label.toLowerCase().includes(t)))
  }, [commands, activeFilter, trimmedQuery, isTaskNumber])

  // The way out when the name isn't enough: the same text, in every file.
  const contentSearchRow = activeFilter === 'all' && trimmedQuery.length >= 2 && !isTaskNumber

  const showProjects = activeFilter === 'all' || activeFilter === 'projects'
  const showTasks = activeFilter === 'all' || activeFilter === 'tasks'
  const showFiles = activeFilter === 'all' || activeFilter === 'files'

  // Without a query the palette is a launcher: commands first. With one,
  // the answers first and the commands last.
  const sections = useMemo(() => {
    const list: Array<'commands' | 'projects' | 'tasks' | 'files'> = trimmedQuery
      ? ['projects', 'tasks', 'files', 'commands']
      : ['commands', 'projects', 'tasks', 'files']
    return list
  }, [trimmedQuery])

  const items = useMemo(() => {
    const out: Item[] = []
    for (const section of sections) {
      if (section === 'commands') filteredCommands.forEach(c => out.push({ id: `cmd-${c.id}`, run: c.run }))
      if (section === 'projects' && showProjects) filteredProjects.forEach(p => out.push({ id: `project-${p.id}`, run: () => openTab(p.id) }))
      if (section === 'tasks' && showTasks) filteredTasks.forEach((t, i) => out.push({ id: `task-${i}-${t.id}`, run: () => openTask(t) }))
      if (section === 'files' && showFiles) fileResults.forEach((f, i) => out.push({ id: `file-${i}-${f.path}`, run: () => openFile(f) }))
    }
    if (contentSearchRow) out.push({ id: 'content-search', run: () => openContentSearch(trimmedQuery) })
    return out
  }, [sections, filteredCommands, filteredProjects, filteredTasks, fileResults, showProjects, showTasks, showFiles, contentSearchRow, trimmedQuery, openTab, openTask, openFile])

  const indexOf = useMemo(() => new Map(items.map((item, i) => [item.id, i])), [items])

  // A new query or filter starts at the top; file results landing later keep
  // the row the user is on.
  useEffect(() => { setSelectedIndex(0) }, [trimmedQuery, activeFilter])
  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, items.length - 1)))
  }, [items.length])

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // The content search opens on top of this palette and closes it itself.
  const runItem = useCallback((index: number) => {
    const item = items[index]
    if (!item) return
    if (item.id !== 'content-search' && item.id !== 'cmd-content') close()
    item.run()
  }, [items, close])

  // Hand the task to AiResolveHost — the palette unmounts on close, so
  // neither the run nor the agent dialog can live here. Plain click runs;
  // Shift opens the dialog for context or another agent.
  const runWithAgent = useCallback((task: Task, withDialog = false) => {
    close()
    window.dispatchEvent(new CustomEvent(withDialog ? 'shipyard:run-task-with-agent' : 'shipyard:run-task', { detail: task }))
  }, [close])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runItem(selectedIndex)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const i = FILTERS.findIndex(f => f.id === activeFilter)
      setActiveFilter(FILTERS[(i + (e.shiftKey ? FILTERS.length - 1 : 1)) % FILTERS.length].id)
    }
  }, [close, items.length, selectedIndex, runItem, activeFilter])

  if (!open) return null

  const counts: Record<FilterTab, number | undefined> = {
    all: undefined,
    projects: filteredProjects.length,
    tasks: filteredTasks.length,
    files: fileResults.length,
  }

  const row = (id: string, content: ReactNode, className?: string) => {
    const idx = indexOf.get(id) ?? -1
    return (
      <Row
        key={id}
        selected={selectedIndex === idx}
        onSelect={() => setSelectedIndex(idx)}
        onRun={() => runItem(idx)}
        className={className}
      >
        {content}
      </Row>
    )
  }

  const renderSection = (section: 'commands' | 'projects' | 'tasks' | 'files') => {
    if (section === 'commands' && filteredCommands.length > 0) {
      return (
        <div key="commands">
          <SectionHeader label="Commands" />
          {filteredCommands.map(c => row(`cmd-${c.id}`, <>
            <c.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 truncate"><Highlight text={c.label} matcher={matcher} /></span>
            {c.shortcut && <Kbd>{c.shortcut}</Kbd>}
          </>))}
        </div>
      )
    }
    if (section === 'projects' && showProjects && filteredProjects.length > 0) {
      return (
        <div key="projects">
          <SectionHeader label="Projects" count={trimmedQuery ? filteredProjects.length : undefined} />
          {filteredProjects.map(project => row(`project-${project.id}`, <>
            <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate"><Highlight text={project.name} matcher={matcher} /></span>
            {project.techStack?.length > 0 && (
              <span className="max-w-[160px] truncate text-[11px] text-muted-foreground/60">{project.techStack.slice(0, 3).join(', ')}</span>
            )}
            {project.id === activeTabId && <span className="shrink-0 text-[11px] text-muted-foreground">open</span>}
          </>))}
        </div>
      )
    }
    if (section === 'tasks' && showTasks && filteredTasks.length > 0) {
      return (
        <div key="tasks">
          <SectionHeader label={trimmedQuery ? 'Tasks' : 'Open tasks'} count={trimmedQuery ? filteredTasks.length : undefined} />
          {filteredTasks.map((task, i) => {
            const priority = priorityVisual(task.priority)
            const status = statusVisual(task.status)
            const StatusIcon = status.icon
            return row(`task-${i}-${task.id}`, <>
              <priority.icon className={cn('h-4 w-4 shrink-0', priority.color)} />
              {task.number != null && (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">#{task.number}</span>
              )}
              <span className={cn('min-w-0 flex-1 truncate', task.status === 'done' && 'text-muted-foreground')}>
                <Highlight text={task.title} matcher={matcher} />
              </span>
              <button
                title="Run with AI (Shift+click to add context or pick the agent)"
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground [[data-selected=true]_&]:opacity-100"
                onClick={(e) => { e.stopPropagation(); runWithAgent(task, e.shiftKey) }}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
              <span className="max-w-[110px] shrink-0 truncate text-[11px] text-muted-foreground">
                {projectNameMap.get(task.projectId) || task.projectId}
              </span>
              <span className="flex w-[92px] shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                <StatusIcon className={cn('h-3 w-3 shrink-0', status.color)} />
                {status.label}
              </span>
            </>)
          })}
        </div>
      )
    }
    if (section === 'files' && showFiles && fileResults.length > 0) {
      return (
        <div key="files">
          <SectionHeader label="Files" count={fileResults.length} />
          {fileResults.map((file, i) => {
            const dir = file.path.slice(0, Math.max(0, file.path.length - file.name.length - 1))
            return row(`file-${i}-${file.path}`, <>
              <FileIcon name={file.name} extension={file.extension} type={file.type} className="shrink-0" />
              <span className="shrink-0 truncate"><Highlight text={file.name} matcher={matcher} /></span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/60" title={file.path}>{dir}</span>
              <span className="max-w-[120px] shrink-0 truncate text-[11px] text-muted-foreground">{file.projectName}</span>
            </>)
          })}
        </div>
      )
    }
    return null
  }

  const nothing = items.length === 0 || (items.length === 1 && contentSearchRow)

  return (
    <PaletteShell onClose={close} onKeyDown={handleKeyDown} label="Search">
      <PaletteInput
        inputRef={inputRef}
        value={query}
        onChange={setQuery}
        placeholder="Search projects, tasks, files and commands · #123 for a task"
        busy={fileSearching}
      />

      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
        {FILTERS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveFilter(tab.id)}
            onMouseDown={e => e.preventDefault()}
            className={cn(
              'h-6 rounded px-2.5 text-xs font-medium transition-colors',
              activeFilter === tab.id ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
          >
            {tab.label}
            {counts[tab.id] !== undefined && trimmedQuery && (
              <span className="ml-1.5 tabular-nums text-muted-foreground/70">{counts[tab.id]}</span>
            )}
          </button>
        ))}
        {activeProject && (
          <span className="ml-auto truncate text-[11px] text-muted-foreground/60">
            {activeProject.category || activeProject.name} first
          </span>
        )}
      </div>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-1.5 scrollbar-dark">
        {nothing && (
          <EmptyState>
            {fileSearching ? 'Searching…' : trimmedQuery ? `Nothing named “${trimmedQuery}”.` : 'Start typing to search.'}
          </EmptyState>
        )}
        {sections.map(renderSection)}
        {contentSearchRow && (
          <div className={cn(!nothing && 'mt-1 border-t pt-1.5')}>
            {row('content-search', <>
              <TextSearch className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                Search <span className="font-medium">“{trimmedQuery}”</span> in file contents
              </span>
              <Kbd>Ctrl+Shift+F</Kbd>
            </>)}
          </div>
        )}
      </div>

      <PaletteFooter hints={[['↑↓', 'navigate'], ['↵', 'open'], ['Tab', 'filter'], ['Esc', 'close']]} />
    </PaletteShell>
  )
}
