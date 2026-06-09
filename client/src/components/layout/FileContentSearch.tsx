import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Search, Loader2, FileText, CaseSensitive, ChevronRight } from 'lucide-react'
import { useTabs } from '@/hooks/useTabs'
import { useProjects } from '@/hooks/useProjects'
import { FileIcon } from '@/components/files/FileIcon'
import { api } from '@/lib/api'

interface ContentMatch {
  line: number
  text: string
  column: number
}

interface ContentResult {
  file: string
  filePath: string
  projectId: string
  projectName: string
  extension?: string
  matches: ContentMatch[]
}

export function FileContentSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<ContentResult[]>([])
  const [totalMatches, setTotalMatches] = useState(0)
  const [searching, setSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const { openTab } = useTabs()
  const { data: projects } = useProjects()

  // Get active project from current tab context
  const activeProjectId = useMemo(() => {
    const path = window.location.pathname
    const match = path.match(/^\/project\/([^/]+)/)
    return match?.[1] || undefined
  }, [open])

  // Listen for Ctrl+Shift+F and the Electron menu action
  useEffect(() => {
    const toggle = () => {
      setOpen(prev => {
        if (!prev) {
          setQuery('')
          setResults([])
          setTotalMatches(0)
          setSelectedIndex(0)
          setCollapsedFiles(new Set())
        }
        return !prev
      })
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        e.stopPropagation()
        toggle()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('shipyard:toggle-file-search', toggle)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('shipyard:toggle-file-search', toggle)
    }
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Debounced content search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!query || query.length < 2) {
      setResults([])
      setTotalMatches(0)
      setSearching(false)
      return
    }

    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.searchContent(query, activeProjectId, caseSensitive)
        setResults(data.results)
        setTotalMatches(data.totalMatches)
      } catch {
        setResults([])
        setTotalMatches(0)
      } finally {
        setSearching(false)
      }
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, caseSensitive, activeProjectId])

  // Build flat navigation items (file headers + visible matches)
  const flatItems = useMemo(() => {
    const items: Array<{
      type: 'file-header' | 'match'
      result: ContentResult
      match?: ContentMatch
      matchIdx?: number
    }> = []

    for (const result of results) {
      const fileKey = `${result.projectId}:${result.filePath}`
      items.push({ type: 'file-header', result })
      if (!collapsedFiles.has(fileKey)) {
        result.matches.forEach((m, i) => {
          items.push({ type: 'match', result, match: m, matchIdx: i })
        })
      }
    }

    return items
  }, [results, collapsedFiles])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [flatItems.length])

  // Scroll selected into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.querySelector('[data-selected="true"]')
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const close = useCallback(() => setOpen(false), [])

  const toggleFileCollapse = useCallback((fileKey: string) => {
    setCollapsedFiles(prev => {
      const next = new Set(prev)
      if (next.has(fileKey)) {
        next.delete(fileKey)
      } else {
        next.add(fileKey)
      }
      return next
    })
  }, [])

  const openFileAtLine = useCallback((result: ContentResult, line?: number) => {
    localStorage.setItem('shipyard:pending-editor-file', JSON.stringify({
      projectId: result.projectId,
      path: result.filePath,
      name: result.file,
      extension: result.extension || '',
      line,
    }))
    openTab(result.projectId)
    close()
  }, [openTab, close])

  const runItem = useCallback((index: number) => {
    const item = flatItems[index]
    if (!item) return

    if (item.type === 'file-header') {
      const fileKey = `${item.result.projectId}:${item.result.filePath}`
      toggleFileCollapse(fileKey)
    } else if (item.match) {
      openFileAtLine(item.result, item.match.line)
    }
  }, [flatItems, toggleFileCollapse, openFileAtLine])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(prev => Math.min(prev + 1, flatItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = flatItems[selectedIndex]
      if (item) {
        if (item.type === 'match' && item.match) {
          openFileAtLine(item.result, item.match.line)
        } else if (item.type === 'file-header') {
          openFileAtLine(item.result, item.result.matches[0]?.line)
        }
      }
    } else if (e.key === ' ' && flatItems[selectedIndex]?.type === 'file-header') {
      e.preventDefault()
      const item = flatItems[selectedIndex]
      toggleFileCollapse(`${item.result.projectId}:${item.result.filePath}`)
    }
  }, [close, flatItems, selectedIndex, openFileAtLine, toggleFileCollapse])

  // Highlight matching text in a line
  const highlightMatch = useCallback((text: string, matchQuery: string, isCaseSensitive: boolean) => {
    if (!matchQuery) return text
    try {
      const escaped = matchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = new RegExp(`(${escaped})`, isCaseSensitive ? 'g' : 'gi')
      const parts = text.split(regex)
      return parts.map((part, i) =>
        regex.test(part)
          ? <span key={i} className="bg-yellow-500/30 text-yellow-200 rounded-sm px-0.5">{part}</span>
          : part
      )
    } catch {
      return text
    }
  }, [])

  // Project name lookup
  const multiProject = !activeProjectId
  const projectNameMap = useMemo(() => {
    const map = new Map<string, string>()
    projects?.forEach(p => map.set(p.id, p.name))
    return map
  }, [projects])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50" onKeyDown={handleKeyDown}>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />

      {/* Search panel */}
      <div className="fixed left-1/2 top-[8%] -translate-x-1/2 w-full max-w-3xl px-4">
        <div className="rounded-xl border bg-popover text-popover-foreground shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="flex items-center border-b px-4 gap-3">
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={activeProjectId
                ? 'Search in file contents...'
                : 'Search in file contents across all projects...'
              }
              className="flex-1 h-14 bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
              autoComplete="off"
              spellCheck={false}
            />
            {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <button
              onClick={() => setCaseSensitive(prev => !prev)}
              className={`p-1.5 rounded transition-colors ${
                caseSensitive
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground/40 hover:text-muted-foreground'
              }`}
              title="Match case"
            >
              <CaseSensitive className="h-4 w-4" />
            </button>
            <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground shrink-0">
              Esc
            </kbd>
          </div>

          {/* Stats bar */}
          {query.length >= 2 && (
            <div className="px-4 py-1.5 border-b text-[11px] text-muted-foreground flex items-center gap-3">
              {searching ? (
                <span>Searching...</span>
              ) : (
                <>
                  <span>{totalMatches} result{totalMatches !== 1 ? 's' : ''} in {results.length} file{results.length !== 1 ? 's' : ''}</span>
                  {activeProjectId && (
                    <span className="text-muted-foreground/50">
                      in {projectNameMap.get(activeProjectId) || 'current project'}
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Results */}
          <div ref={listRef} className="max-h-[65vh] overflow-y-auto scrollbar-dark">
            {flatItems.length === 0 && (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {query.length < 2
                  ? 'Type at least 2 characters to search...'
                  : searching
                    ? 'Searching file contents...'
                    : 'No matches found'
                }
              </div>
            )}

            {results.map((result) => {
              const fileKey = `${result.projectId}:${result.filePath}`
              const isCollapsed = collapsedFiles.has(fileKey)
              const headerIdx = flatItems.findIndex(
                i => i.type === 'file-header' && i.result === result
              )

              return (
                <div key={fileKey} className="border-b border-border/50 last:border-b-0">
                  {/* File header */}
                  <div
                    data-selected={selectedIndex === headerIdx}
                    onClick={() => toggleFileCollapse(fileKey)}
                    className={`flex items-center gap-2 px-4 py-2 cursor-pointer transition-colors sticky top-0 bg-popover z-10 ${
                      selectedIndex === headerIdx ? 'bg-accent/80' : 'hover:bg-accent/40'
                    }`}
                  >
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${
                      !isCollapsed ? 'rotate-90' : ''
                    }`} />
                    <FileIcon
                      name={result.file}
                      extension={result.extension}
                      type="file"
                      className="shrink-0"
                    />
                    <span className="text-sm font-medium truncate">{result.file}</span>
                    <span className="text-[11px] text-muted-foreground/50 truncate">{result.filePath}</span>
                    {multiProject && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded shrink-0 ml-auto">
                        {result.projectName}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                      {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
                    </span>
                  </div>

                  {/* Matches */}
                  {!isCollapsed && result.matches.map((match, matchIdx) => {
                    const flatIdx = flatItems.findIndex(
                      i => i.type === 'match' && i.result === result && i.matchIdx === matchIdx
                    )

                    return (
                      <div
                        key={`${fileKey}-${match.line}`}
                        data-selected={selectedIndex === flatIdx}
                        onClick={() => openFileAtLine(result, match.line)}
                        className={`flex items-start gap-3 px-4 py-1 cursor-pointer transition-colors text-[13px] font-mono ${
                          selectedIndex === flatIdx ? 'bg-accent/60' : 'hover:bg-accent/30'
                        }`}
                      >
                        <span className="text-muted-foreground/50 w-8 text-right shrink-0 select-none text-[11px] pt-0.5">
                          {match.line}
                        </span>
                        <span className="truncate text-muted-foreground whitespace-pre">
                          {highlightMatch(match.text, query, caseSensitive)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
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
                open file
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px]">Space</kbd>
                toggle group
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
