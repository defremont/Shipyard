import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, FolderOpen, Loader2, AlertTriangle, ArrowUp, Minus, ArrowDown as ArrowDownIcon } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { useAllTasks, type Task } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'
import { FileIcon } from '@/components/files/FileIcon'
import { useEditorTabsContext } from '@/hooks/useEditorTabsContext'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

interface FileResult {
  name: string
  path: string
  projectId: string
  projectName: string
  type: 'file' | 'dir'
  extension?: string
}

const priorityConfig: Record<string, { icon: typeof AlertTriangle; color: string }> = {
  urgent: { icon: AlertTriangle, color: 'text-red-400' },
  high: { icon: ArrowUp, color: 'text-orange-400' },
  medium: { icon: Minus, color: 'text-yellow-400' },
  low: { icon: ArrowDownIcon, color: 'text-blue-400' },
}

const statusLabels: Record<string, string> = {
  backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', done: 'Done',
}

export function SearchView() {
  const [query, setQuery] = useState('')
  const [fileResults, setFileResults] = useState<FileResult[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const { openTab } = useTabs()
  const editor = useEditorTabsContext()
  const { data: projects } = useProjects()
  const { data: tasks } = useAllTasks()

  useEffect(() => { inputRef.current?.focus() }, [])

  // Debounced file search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query || query.length < 2) {
      setFileResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.searchFiles(query)
        setFileResults(data.results)
      } catch {
        setFileResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>()
    projects?.forEach(p => map.set(p.id, p.name))
    return map
  }, [projects])

  const filteredProjects = useMemo(() => {
    if (!projects || !query) return []
    const q = query.toLowerCase()
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category?.toLowerCase().includes(q) ||
      p.techStack?.some((t: string) => t.toLowerCase().includes(q))
    )
  }, [projects, query])

  const filteredTasks = useMemo(() => {
    if (!tasks || !query) return []
    const q = query.toLowerCase()
    return tasks.filter((t: Task) =>
      t.status !== 'done' && (
        t.title.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q) ||
        (statusLabels[t.status] || t.status).toLowerCase().includes(q) ||
        t.priority.toLowerCase().includes(q) ||
        (projectNameMap.get(t.projectId) || '').toLowerCase().includes(q)
      )
    ).slice(0, 30)
  }, [tasks, query, projectNameMap])

  const total = filteredProjects.length + filteredTasks.length + fileResults.length

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2 pb-2 shrink-0">
        <div className="flex items-center gap-2 h-8 px-2 rounded-md border bg-background focus-within:border-primary/50 transition-colors">
          <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search projects, tasks, files..."
            className="flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50"
            autoComplete="off"
            spellCheck={false}
          />
          {searching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
        </div>
        <p className="text-[10px] text-muted-foreground/40 mt-1.5 px-1">
          Tip: <kbd className="px-1 rounded bg-muted text-[9px] font-mono">Ctrl+K</kbd> for full search
        </p>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-dark min-h-0 px-1 pb-2">
        {!query && (
          <div className="text-xs text-muted-foreground/60 text-center py-8">
            Start typing to search
          </div>
        )}

        {query && total === 0 && !searching && (
          <div className="text-xs text-muted-foreground/60 text-center py-8">
            No results
          </div>
        )}

        {filteredProjects.length > 0 && (
          <div className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Projects · {filteredProjects.length}
            </div>
            {filteredProjects.map(p => (
              <button
                key={p.id}
                onClick={() => openTab(p.id)}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] text-left text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
              >
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate flex-1">{p.name}</span>
                {p.gitBranch && (
                  <span className="text-[9px] font-mono text-muted-foreground/50 truncate max-w-[80px]">{p.gitBranch}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {filteredTasks.length > 0 && (
          <div className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Tasks · {filteredTasks.length}
            </div>
            {filteredTasks.map(task => {
              const pConfig = priorityConfig[task.priority]
              const PriorityIcon = pConfig?.icon || Minus
              return (
                <button
                  key={task.id}
                  onClick={() => { openTab(task.projectId); navigate(`/project/${task.projectId}`) }}
                  className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] text-left text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                >
                  <PriorityIcon className={cn('h-3.5 w-3.5 shrink-0', pConfig?.color || 'text-muted-foreground')} />
                  <span className="truncate flex-1">{task.title}</span>
                  <span className="text-[9px] text-muted-foreground/50 truncate max-w-[60px]">
                    {projectNameMap.get(task.projectId) || ''}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {fileResults.length > 0 && (
          <div className="mb-2">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Files · {fileResults.length}
            </div>
            {fileResults.map((f, i) => (
              <button
                key={`${f.projectId}-${f.path}-${i}`}
                onClick={() => {
                  if (f.type === 'file') {
                    editor.openFileForProject(f.projectId, f.path, f.name, f.extension || '')
                  } else {
                    openTab(f.projectId)
                  }
                }}
                className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-[12px] text-left text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
              >
                <FileIcon name={f.name} extension={f.extension} type={f.type} className="h-3.5 w-3.5 shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate">{f.name}</span>
                  <span className="text-[9px] text-muted-foreground/40 truncate">{f.path}</span>
                </div>
                <span className="text-[9px] text-muted-foreground/50 truncate max-w-[60px]">{f.projectName}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
