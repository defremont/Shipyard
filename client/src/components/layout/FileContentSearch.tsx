import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { ChevronRight, FolderDot, PackageOpen } from 'lucide-react'
import { useTabs } from '@/hooks/useTabs'
import { useProjects } from '@/hooks/useProjects'
import { useEditorTabsContext } from '@/hooks/useEditorTabsContext'
import { FileIcon } from '@/components/files/FileIcon'
import { api, type ContentSearchOptions, type ContentSearchResult } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  PaletteShell, PaletteInput, PaletteStatus, PaletteFooter, OptionToggle, EmptyState, Highlight,
  usePaletteToggle, TOGGLE_CONTENT_SEARCH_EVENT, TOGGLE_SEARCH_EVENT,
} from './SearchPalette'

interface Options extends Required<ContentSearchOptions> {
  onlyProject: boolean
}

const OPTIONS_KEY = 'shipyard:content-search-options'
const LEGACY_ONLY_PROJECT_KEY = 'shipyard:content-search-only-project'
const DEFAULT_OPTIONS: Options = { caseSensitive: false, wholeWord: false, regex: false, includeIgnored: false, onlyProject: false }

function loadOptions(): Options {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) || 'null')
    if (saved && typeof saved === 'object') return { ...DEFAULT_OPTIONS, ...saved }
    return { ...DEFAULT_OPTIONS, onlyProject: localStorage.getItem(LEGACY_ONLY_PROJECT_KEY) === 'true' }
  } catch {
    return DEFAULT_OPTIONS
  }
}

/** Same rules as buildMatcher in server/src/services/fileSearch.ts. */
function buildMatcher(query: string, o: ContentSearchOptions): RegExp {
  let source = o.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  if (o.wholeWord) source = `\\b(?:${source})\\b`
  return new RegExp(source, o.caseSensitive ? 'g' : 'gi')
}

const MIN_QUERY = 2
const DEBOUNCE_MS = 200

interface SearchState {
  results: ContentSearchResult[]
  totalMatches: number
  truncated: boolean
  timedOut: boolean
  elapsedMs: number
  /** Only the open project has answered so far. */
  partial: boolean
}

const EMPTY: SearchState = { results: [], totalMatches: 0, truncated: false, timedOut: false, elapsedMs: 0, partial: false }

const isShortcut = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === 'KeyF'

export function FileContentSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<Options>(loadOptions)
  const [state, setState] = useState<SearchState>(EMPTY)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { activeTabId } = useTabs()
  const { openFileForProject } = useEditorTabsContext()
  const { data: projects } = useProjects()

  const activeProjectId = activeTabId ?? undefined
  const scopedToProject = options.onlyProject && !!activeProjectId
  const activeProjectName = projects?.find(p => p.id === activeProjectId)?.name

  const setOption = useCallback((key: keyof Options) => {
    setOptions(prev => {
      const next = { ...prev, [key]: !prev[key] }
      try { localStorage.setItem(OPTIONS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])

  const close = useCallback(() => setOpen(false), [])

  // Reopening keeps the last query, selected, so typing replaces it.
  const onToggle = useCallback((detail?: { open?: boolean; query?: string }) => {
    setOpen(prev => {
      const next = detail?.open ? true : !prev
      if (next) {
        if (detail?.query) setQuery(detail.query)
        setCollapsedFiles(new Set())
      }
      return next
    })
  }, [])
  usePaletteToggle(TOGGLE_CONTENT_SEARCH_EVENT, TOGGLE_SEARCH_EVENT, isShortcut, onToggle, close)
  useEffect(() => { if (open) inputRef.current?.select() }, [open])

  const trimmed = query.trim()
  const matcher = useMemo(() => {
    if (trimmed.length < MIN_QUERY) return null
    try { return buildMatcher(trimmed, options) } catch { return null }
  }, [trimmed, options])
  const invalidRegex = options.regex && trimmed.length >= MIN_QUERY && !matcher

  // Debounced search. With every project in scope, the open project is asked
  // on its own first: it answers in a fraction of the time and its results
  // come first anyway. A newer query aborts both requests.
  useEffect(() => {
    if (!open) return
    if (trimmed.length < MIN_QUERY || invalidRegex) {
      setState(EMPTY)
      setSearching(false)
      setError(invalidRegex ? 'Invalid regular expression' : null)
      return
    }

    setSearching(true)
    const controller = new AbortController()
    const flags: ContentSearchOptions = {
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      regex: options.regex,
      includeIgnored: options.includeIgnored,
    }
    const timer = setTimeout(() => {
      let fullDone = false
      const base = { ...flags, prefer: activeProjectId, signal: controller.signal }
      if (!scopedToProject && activeProjectId) {
        api.searchContent(trimmed, { ...base, projectId: activeProjectId })
          .then(data => {
            if (controller.signal.aborted || fullDone || data.results.length === 0) return
            setError(null)
            setState({ ...data, partial: true })
          })
          .catch(() => { /* the full search reports errors */ })
      }
      api.searchContent(trimmed, { ...base, projectId: scopedToProject ? activeProjectId : undefined })
        .then(data => {
          fullDone = true
          if (controller.signal.aborted) return
          setError(null)
          setState({ ...data, partial: false })
        })
        .catch(err => {
          fullDone = true
          if (controller.signal.aborted) return
          setState(EMPTY)
          setError(err instanceof Error ? err.message : 'Search failed')
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, trimmed, invalidRegex, options.caseSensitive, options.wholeWord, options.regex, options.includeIgnored, activeProjectId, scopedToProject])

  const { results } = state

  // Flat list for the keyboard: file headers and their visible matches.
  const { flatItems, headerIndex } = useMemo(() => {
    const items: Array<{ type: 'file' | 'match'; result: ContentSearchResult; matchIdx?: number }> = []
    const headers = new Map<ContentSearchResult, number>()
    for (const result of results) {
      headers.set(result, items.length)
      items.push({ type: 'file', result })
      if (!collapsedFiles.has(`${result.projectId}:${result.filePath}`)) {
        result.matches.forEach((_, i) => items.push({ type: 'match', result, matchIdx: i }))
      }
    }
    return { flatItems: items, headerIndex: headers }
  }, [results, collapsedFiles])

  // A new query starts at the top; results arriving for the same query (the
  // rest of the projects) keep the row the user is on.
  useEffect(() => { setSelectedIndex(0) }, [trimmed, options])
  useEffect(() => {
    setSelectedIndex(prev => Math.min(prev, Math.max(0, flatItems.length - 1)))
  }, [flatItems.length])

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const toggleFileCollapse = useCallback((fileKey: string) => {
    setCollapsedFiles(prev => {
      const next = new Set(prev)
      if (next.has(fileKey)) next.delete(fileKey)
      else next.add(fileKey)
      return next
    })
  }, [])

  const openMatch = useCallback((result: ContentSearchResult, matchIdx = 0) => {
    const match = result.matches[matchIdx]
    openFileForProject(result.projectId, result.filePath, result.file, result.extension || '', {
      reveal: match ? { line: match.line, column: match.column, length: match.length } : undefined,
    })
    close()
  }, [openFileForProject, close])

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
      if (item) openMatch(item.result, item.matchIdx ?? 0)
    } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
      const key = ({ KeyC: 'caseSensitive', KeyW: 'wholeWord', KeyR: 'regex', KeyI: 'includeIgnored', KeyP: 'onlyProject' } as const)[e.code]
      if (!key || (key === 'onlyProject' && !activeProjectId)) return
      e.preventDefault()
      setOption(key)
    }
  }, [close, flatItems, selectedIndex, openMatch, activeProjectId, setOption])

  if (!open) return null

  const fileCount = results.length
  const busy = searching && trimmed.length >= MIN_QUERY
  const scopeLabel = scopedToProject
    ? `Only ${activeProjectName ?? 'this project'}`
    : activeProjectName ? `All projects · ${activeProjectName} first` : 'All projects'

  return (
    <PaletteShell onClose={close} onKeyDown={handleKeyDown} wide label="Search in file contents">
      <PaletteInput
        inputRef={inputRef}
        value={query}
        onChange={setQuery}
        placeholder={scopedToProject ? `Search in ${activeProjectName ?? 'this project'}` : 'Search in file contents'}
        busy={busy}
      >
        <OptionToggle active={options.caseSensitive} onClick={() => setOption('caseSensitive')} title="Match case" shortcut="Alt+C">
          <span className="font-mono text-[11px] font-semibold">Aa</span>
        </OptionToggle>
        <OptionToggle active={options.wholeWord} onClick={() => setOption('wholeWord')} title="Match whole word" shortcut="Alt+W">
          <span className="font-mono text-[11px] font-semibold underline underline-offset-2">ab</span>
        </OptionToggle>
        <OptionToggle active={options.regex} onClick={() => setOption('regex')} title="Use regular expression" shortcut="Alt+R">
          <span className="font-mono text-[11px] font-semibold">.*</span>
        </OptionToggle>
        <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
        {activeProjectId && (
          <OptionToggle active={scopedToProject} onClick={() => setOption('onlyProject')} title="Only the open project" shortcut="Alt+P">
            <FolderDot className="h-3.5 w-3.5" />
          </OptionToggle>
        )}
        <OptionToggle
          active={options.includeIgnored}
          onClick={() => setOption('includeIgnored')}
          title="Include node_modules, build output and git-ignored files"
          shortcut="Alt+I"
        >
          <PackageOpen className="h-3.5 w-3.5" />
        </OptionToggle>
      </PaletteInput>

      <PaletteStatus>
        <span className={cn('truncate', error && 'text-destructive')}>
          {error
            ? error
            : trimmed.length < MIN_QUERY
              ? 'Type at least 2 characters'
              : busy && !fileCount
                ? 'Searching…'
                : <>
                    <span className="tabular-nums">{state.totalMatches}</span> {state.totalMatches === 1 ? 'result' : 'results'} in{' '}
                    <span className="tabular-nums">{fileCount}</span> {fileCount === 1 ? 'file' : 'files'}
                    {state.partial
                      ? ' · searching the other projects…'
                      : <span className="text-muted-foreground/60"> · {state.elapsedMs} ms</span>}
                    {!state.partial && state.timedOut && <span className="text-warning"> · stopped after {Math.round(state.elapsedMs / 1000)} s</span>}
                    {!state.partial && state.truncated && !state.timedOut && <span> · first {fileCount} files shown, refine the search</span>}
                  </>}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground/60">{scopeLabel}</span>
        {!options.includeIgnored && (
          <button
            className="shrink-0 text-muted-foreground/60 underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setOption('includeIgnored')}
            onMouseDown={e => e.preventDefault()}
            title="node_modules, dist, build, .next, vendor and git-ignored files are skipped. Alt+I includes them."
          >
            · node_modules excluded
          </button>
        )}
      </PaletteStatus>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-dark">
        {flatItems.length === 0 && (
          <EmptyState>
            {trimmed.length < MIN_QUERY
              ? 'Search every file of every project. The open project comes first.'
              : busy ? 'Searching file contents…' : error ? 'Fix the pattern to search.' : 'No matches.'}
          </EmptyState>
        )}

        {results.map(result => {
          const fileKey = `${result.projectId}:${result.filePath}`
          const isCollapsed = collapsedFiles.has(fileKey)
          const headerIdx = headerIndex.get(result) ?? -1
          const dir = result.filePath.slice(0, Math.max(0, result.filePath.length - result.file.length - 1))
          return (
            <div key={fileKey}>
              <div
                data-selected={selectedIndex === headerIdx}
                onMouseMove={() => selectedIndex !== headerIdx && setSelectedIndex(headerIdx)}
                onClick={() => toggleFileCollapse(fileKey)}
                className={cn(
                  'sticky top-0 z-10 flex h-8 cursor-pointer items-center gap-2 border-b border-border/40 bg-popover px-3',
                  selectedIndex === headerIdx && 'bg-accent',
                )}
              >
                <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', !isCollapsed && 'rotate-90')} />
                <FileIcon name={result.file} extension={result.extension} type="file" className="shrink-0" />
                <span className="shrink-0 text-[13px] font-medium">{result.file}</span>
                <span className="min-w-0 truncate text-[11px] text-muted-foreground/60" title={result.filePath}>{dir}</span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {!scopedToProject && (
                    <span className="max-w-[140px] truncate rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {result.projectName}
                    </span>
                  )}
                  <span className="min-w-[18px] rounded-full bg-muted px-1.5 text-center text-[10px] tabular-nums text-muted-foreground">
                    {result.matches.length}
                  </span>
                </span>
              </div>

              {!isCollapsed && result.matches.map((match, matchIdx) => {
                const flatIdx = headerIdx + 1 + matchIdx
                return (
                  <div
                    key={`${match.line}:${matchIdx}`}
                    data-selected={selectedIndex === flatIdx}
                    onMouseMove={() => selectedIndex !== flatIdx && setSelectedIndex(flatIdx)}
                    onClick={() => openMatch(result, matchIdx)}
                    className={cn(
                      'flex h-7 cursor-pointer items-center gap-3 pl-9 pr-3 font-mono text-[12px]',
                      selectedIndex === flatIdx ? 'bg-accent text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    <span className="w-9 shrink-0 select-none text-right text-[11px] tabular-nums text-muted-foreground/50">{match.line}</span>
                    <span className="truncate whitespace-pre">
                      <Highlight text={match.text} matcher={matcher} />
                    </span>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <PaletteFooter hints={[['↑↓', 'navigate'], ['↵', 'open at line'], ['Esc', 'close']]}>
        <span className="text-muted-foreground/60">Alt+C case · Alt+W word · Alt+R regex · Alt+I ignored{activeProjectId ? ' · Alt+P project' : ''}</span>
      </PaletteFooter>
    </PaletteShell>
  )
}
