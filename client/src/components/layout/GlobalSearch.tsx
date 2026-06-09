import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  FolderOpen,
  ClipboardList,
  Settings,
  HelpCircle,
  LayoutDashboard,
  Search,
  AlertTriangle,
  ArrowUp,
  Minus,
  ArrowDown as ArrowDownIcon,
  File,
  Folder,
  Loader2,
} from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { useAllTasks, type Task } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'
import { FileIcon } from '@/components/files/FileIcon'
import { api } from '@/lib/api'

type FilterTab = 'all' | 'projects' | 'tasks' | 'files'

const priorityConfig: Record<string, { icon: typeof AlertTriangle; color: string; label: string }> = {
  urgent: { icon: AlertTriangle, color: 'text-red-400', label: 'Urgent' },
  high: { icon: ArrowUp, color: 'text-orange-400', label: 'High' },
  medium: { icon: Minus, color: 'text-yellow-400', label: 'Medium' },
  low: { icon: ArrowDownIcon, color: 'text-blue-400', label: 'Low' },
}

const statusLabels: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
}

interface FileResult {
  name: string
  path: string
  projectId: string
  projectName: string
  type: 'file' | 'dir'
  extension?: string
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
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const navigate = useNavigate()
  const { openTab } = useTabs()
  const { data: projects } = useProjects()
  const { data: tasks } = useAllTasks()

  // Listen for Ctrl+K and the Electron menu action
  useEffect(() => {
    const toggle = () => {
      setOpen(prev => {
        if (!prev) {
          setQuery('')
          setActiveFilter('all')
          setSelectedIndex(0)
          setFileResults([])
        }
        return !prev
      })
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        toggle()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('shipyard:toggle-search', toggle)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('shipyard:toggle-search', toggle)
    }
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Debounced file search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query || query.length < 2 || (activeFilter !== 'all' && activeFilter !== 'files')) {
      setFileResults([])
      setFileSearching(false)
      return
    }

    setFileSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.searchFiles(query)
        setFileResults(data.results)
      } catch {
        setFileResults([])
      } finally {
        setFileSearching(false)
      }
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, activeFilter])

  // Build project name lookup
  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>()
    projects?.forEach(p => map.set(p.id, p.name))
    return map
  }, [projects])

  // Filter projects
  const filteredProjects = useMemo(() => {
    if (!projects || !query) return projects || []
    const q = query.toLowerCase()
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category?.toLowerCase().includes(q) ||
      p.techStack?.some((t: string) => t.toLowerCase().includes(q))
    )
  }, [projects, query])

  // Filter tasks
  const filteredTasks = useMemo(() => {
    if (!tasks) return []
    const activeTasks = tasks.filter((t: Task) => t.status !== 'done')
    if (!query) return activeTasks.slice(0, 30)
    const q = query.toLowerCase()
    return activeTasks.filter((t: Task) =>
      t.title.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      (statusLabels[t.status] || t.status).toLowerCase().includes(q) ||
      t.priority.toLowerCase().includes(q) ||
      (projectNameMap.get(t.projectId) || '').toLowerCase().includes(q)
    ).slice(0, 30)
  }, [tasks, query, projectNameMap])

  // Quick actions (only show when no query)
  const quickActions = useMemo(() => {
    if (query) return []
    return [
      { id: 'dashboard', label: 'Go to Dashboard', icon: LayoutDashboard, action: () => navigate('/') },
      { id: 'tasks', label: 'All Tasks', icon: ClipboardList, action: () => navigate('/tasks') },
      { id: 'settings', label: 'Open Settings', icon: Settings, action: () => navigate('/settings') },
      { id: 'help', label: 'Open Help', icon: HelpCircle, action: () => navigate('/help') },
    ]
  }, [query, navigate])

  // Build flat items list for keyboard navigation
  const allItems = useMemo(() => {
    const items: Array<{ id: string; type: 'action' | 'project' | 'task' | 'file'; action: () => void }> = []

    if (activeFilter === 'all' || activeFilter === 'projects') {
      if (!query) {
        quickActions.forEach(a => items.push({ id: `action-${a.id}`, type: 'action', action: a.action }))
      }
      filteredProjects.forEach(p => items.push({ id: `project-${p.id}`, type: 'project', action: () => openTab(p.id) }))
    }

    if (activeFilter === 'all' || activeFilter === 'tasks') {
      filteredTasks.forEach((t: Task) => items.push({ id: `task-${t.id}`, type: 'task', action: () => openTab(t.projectId) }))
    }

    if (activeFilter === 'all' || activeFilter === 'files') {
      fileResults.forEach((f, i) => items.push({ id: `file-${i}-${f.path}`, type: 'file', action: () => {
        if (f.type === 'file') {
          localStorage.setItem('shipyard:pending-editor-file', JSON.stringify({
            projectId: f.projectId,
            path: f.path,
            name: f.name,
            extension: f.extension || '',
          }))
        }
        openTab(f.projectId)
      }}))
    }

    return items
  }, [activeFilter, query, quickActions, filteredProjects, filteredTasks, fileResults, openTab])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [allItems.length, activeFilter, query])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.querySelector('[data-selected="true"]')
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const close = useCallback(() => {
    setOpen(false)
  }, [])

  const runItem = useCallback((index: number) => {
    const item = allItems[index]
    if (item) {
      item.action()
      close()
    }
  }, [allItems, close])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, allItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runItem(selectedIndex)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const filters: FilterTab[] = ['all', 'projects', 'tasks', 'files']
      const currentIdx = filters.indexOf(activeFilter)
      const nextIdx = e.shiftKey
        ? (currentIdx - 1 + filters.length) % filters.length
        : (currentIdx + 1) % filters.length
      setActiveFilter(filters[nextIdx])
    }
  }, [close, allItems.length, selectedIndex, runItem, activeFilter])

  const filterTabs: { id: FilterTab; label: string; count?: number }[] = [
    { id: 'all', label: 'All' },
    { id: 'projects', label: 'Projects', count: filteredProjects.length },
    { id: 'tasks', label: 'Tasks', count: filteredTasks.length },
    { id: 'files', label: 'Files', count: fileResults.length },
  ]

  if (!open) return null

  let itemIndex = -1

  return (
    <div className="fixed inset-0 z-50" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={close}
      />

      {/* Search panel */}
      <div className="fixed left-1/2 top-[12%] -translate-x-1/2 w-full max-w-2xl px-4">
        <div className="rounded-xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center border-b px-4 gap-3">
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search projects, tasks, files..."
              className="flex-1 h-14 bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
              autoComplete="off"
              spellCheck={false}
            />
            {fileSearching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground shrink-0">
              Esc
            </kbd>
          </div>

          {/* Filter tabs */}
          <div className="flex items-center gap-1 px-4 py-2 border-b">
            {filterTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  activeFilter === tab.id
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && query && (
                  <span className="ml-1.5 text-[10px] opacity-70">{tab.count}</span>
                )}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-muted-foreground">Tab to switch</span>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2 scrollbar-dark">
            {allItems.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {query ? (
                  fileSearching ? 'Searching files...' : 'No results found'
                ) : (
                  'Start typing to search...'
                )}
              </div>
            )}

            {/* Quick Actions */}
            {(activeFilter === 'all' || activeFilter === 'projects') && quickActions.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Quick Actions</div>
                {quickActions.map(action => {
                  itemIndex++
                  const idx = itemIndex
                  const Icon = action.icon
                  return (
                    <div
                      key={action.id}
                      data-selected={selectedIndex === idx}
                      onClick={() => runItem(idx)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                        selectedIndex === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                      }`}
                    >
                      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm">{action.label}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Projects */}
            {(activeFilter === 'all' || activeFilter === 'projects') && filteredProjects.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Projects
                  {query && <span className="ml-1 opacity-70">({filteredProjects.length})</span>}
                </div>
                {filteredProjects.map(project => {
                  itemIndex++
                  const idx = itemIndex
                  return (
                    <div
                      key={project.id}
                      data-selected={selectedIndex === idx}
                      onClick={() => runItem(idx)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                        selectedIndex === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                      }`}
                    >
                      <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate flex-1">{project.name}</span>
                      {project.techStack?.length > 0 && (
                        <span className="text-[10px] text-muted-foreground/60 truncate max-w-[120px]">
                          {project.techStack.slice(0, 3).join(', ')}
                        </span>
                      )}
                      {project.gitBranch && (
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0 max-w-[100px] truncate">
                          {project.gitBranch}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Tasks */}
            {(activeFilter === 'all' || activeFilter === 'tasks') && filteredTasks.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Tasks
                  {query && <span className="ml-1 opacity-70">({filteredTasks.length})</span>}
                </div>
                {filteredTasks.map((task: Task) => {
                  itemIndex++
                  const idx = itemIndex
                  const pConfig = priorityConfig[task.priority]
                  const PriorityIcon = pConfig?.icon || Minus
                  const projectName = projectNameMap.get(task.projectId) || task.projectId

                  return (
                    <div
                      key={task.id}
                      data-selected={selectedIndex === idx}
                      onClick={() => runItem(idx)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                        selectedIndex === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                      }`}
                    >
                      <PriorityIcon className={`h-4 w-4 shrink-0 ${pConfig?.color || 'text-muted-foreground'}`} />
                      <span className="text-sm truncate flex-1">{task.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 truncate max-w-[100px]">
                        {projectName}
                      </span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                        task.status === 'in_progress' ? 'bg-blue-500/15 text-blue-400' :
                        task.status === 'todo' ? 'bg-yellow-500/15 text-yellow-400' :
                        'bg-muted text-muted-foreground'
                      }`}>
                        {statusLabels[task.status] || task.status}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Files */}
            {(activeFilter === 'all' || activeFilter === 'files') && fileResults.length > 0 && (
              <div className="mb-1">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Files
                  <span className="ml-1 opacity-70">({fileResults.length})</span>
                </div>
                {fileResults.map((file, i) => {
                  itemIndex++
                  const idx = itemIndex
                  return (
                    <div
                      key={`${file.projectId}-${file.path}-${i}`}
                      data-selected={selectedIndex === idx}
                      onClick={() => runItem(idx)}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 cursor-pointer transition-colors ${
                        selectedIndex === idx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                      }`}
                    >
                      <FileIcon name={file.name} extension={file.extension} type={file.type} className="shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm truncate">{file.name}</span>
                        <span className="text-[10px] text-muted-foreground/60 truncate">{file.path}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0 max-w-[120px] truncate">
                        {file.projectName}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t px-4 py-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px]">&uarr;&darr;</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px]">&crarr;</kbd>
                open
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px]">Tab</kbd>
                filter
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px]">Esc</kbd>
                close
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
