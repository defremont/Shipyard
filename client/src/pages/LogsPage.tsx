import { useState, useMemo } from 'react'
import {
  ScrollText, AlertTriangle, AlertCircle, Info, Trash2, RefreshCw,
  Filter, GitBranch, Bot, Server, ArrowUpDown, Terminal, Blocks, FileText, ClipboardList
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useLogs, useLogStats, useClearLogs } from '@/hooks/useLogs'
import { cn } from '@/lib/utils'

type LogLevel = 'info' | 'warn' | 'error'
type LogCategory = 'server' | 'git' | 'claude' | 'sync' | 'terminal' | 'mcp' | 'tasks' | 'files'

const levelConfig: Record<LogLevel, { icon: typeof Info; color: string; bg: string }> = {
  info: { icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10' },
  warn: { icon: AlertTriangle, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  error: { icon: AlertCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
}

const categoryConfig: Record<LogCategory, { icon: typeof Server; color: string; label: string }> = {
  server: { icon: Server, color: 'text-gray-400', label: 'Server' },
  git: { icon: GitBranch, color: 'text-orange-400', label: 'Git' },
  claude: { icon: Bot, color: 'text-purple-400', label: 'Claude' },
  sync: { icon: ArrowUpDown, color: 'text-green-400', label: 'Sync' },
  terminal: { icon: Terminal, color: 'text-cyan-400', label: 'Terminal' },
  mcp: { icon: Blocks, color: 'text-indigo-400', label: 'MCP' },
  tasks: { icon: ClipboardList, color: 'text-teal-400', label: 'Tasks' },
  files: { icon: FileText, color: 'text-amber-400', label: 'Files' },
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function LogsPage() {
  const [levelFilter, setLevelFilter] = useState<LogLevel | ''>('')
  const [categoryFilter, setCategoryFilter] = useState<LogCategory | ''>('')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data, isLoading, refetch } = useLogs({
    level: levelFilter || undefined,
    category: categoryFilter || undefined,
    limit: 500,
  })
  const { data: stats } = useLogStats()
  const clearLogs = useClearLogs()

  const logs = data?.logs || []

  // Group logs by date
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof logs>()
    for (const log of logs) {
      const dateKey = formatDate(log.timestamp)
      if (!groups.has(dateKey)) groups.set(dateKey, [])
      groups.get(dateKey)!.push(log)
    }
    return groups
  }, [logs])

  const hasFilters = levelFilter || categoryFilter

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ScrollText className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-semibold">System Logs</h1>
            {stats && (
              <div className="flex items-center gap-2 ml-2">
                <Badge variant="outline" className="text-[11px] gap-1">
                  {stats.total} total
                </Badge>
                {stats.errors > 0 && (
                  <Badge variant="outline" className="text-[11px] gap-1 text-red-400 border-red-400/30">
                    <AlertCircle className="h-3 w-3" />
                    {stats.errors}
                  </Badge>
                )}
                {stats.warnings > 0 && (
                  <Badge variant="outline" className="text-[11px] gap-1 text-yellow-400 border-yellow-400/30">
                    <AlertTriangle className="h-3 w-3" />
                    {stats.warnings}
                  </Badge>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={() => refetch()}>
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs gap-1.5 text-red-400 hover:text-red-300"
              onClick={() => clearLogs.mutate()}
              disabled={clearLogs.isPending || logs.length === 0}
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2 mt-3">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />

          {/* Level filter */}
          <div className="flex items-center gap-1">
            {(['info', 'warn', 'error'] as LogLevel[]).map(level => {
              const cfg = levelConfig[level]
              const Icon = cfg.icon
              return (
                <Button
                  key={level}
                  variant={levelFilter === level ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn('h-6 text-[11px] gap-1 px-2', levelFilter === level && cfg.color)}
                  onClick={() => setLevelFilter(prev => prev === level ? '' : level)}
                >
                  <Icon className="h-3 w-3" />
                  {level}
                </Button>
              )
            })}
          </div>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Category filter */}
          <div className="flex items-center gap-1 flex-wrap">
            {(Object.keys(categoryConfig) as LogCategory[]).map(cat => {
              const cfg = categoryConfig[cat]
              const Icon = cfg.icon
              return (
                <Button
                  key={cat}
                  variant={categoryFilter === cat ? 'secondary' : 'ghost'}
                  size="sm"
                  className={cn('h-6 text-[11px] gap-1 px-2', categoryFilter === cat && cfg.color)}
                  onClick={() => setCategoryFilter(prev => prev === cat ? '' : cat)}
                >
                  <Icon className="h-3 w-3" />
                  {cfg.label}
                </Button>
              )
            })}
          </div>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] px-2 text-muted-foreground"
              onClick={() => { setLevelFilter(''); setCategoryFilter('') }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto scrollbar-dark">
        {isLoading ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            Loading logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
            <ScrollText className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-sm">{hasFilters ? 'No logs match the current filters' : 'No logs yet'}</p>
            <p className="text-xs mt-1 opacity-60">Server events will appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {[...grouped.entries()].map(([dateLabel, dateLogs]) => (
              <div key={dateLabel}>
                <div className="sticky top-0 bg-background/95 backdrop-blur px-6 py-1.5 text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide border-b border-border/30 z-10">
                  {dateLabel}
                </div>
                {dateLogs.map(log => {
                  const lvl = levelConfig[log.level as LogLevel] || levelConfig.info
                  const cat = categoryConfig[log.category as LogCategory] || categoryConfig.server
                  const LvlIcon = lvl.icon
                  const CatIcon = cat.icon
                  const isExpanded = expandedId === log.id

                  return (
                    <button
                      key={log.id}
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      className={cn(
                        'w-full text-left px-6 py-2 hover:bg-accent/30 transition-colors flex items-start gap-3 group',
                        log.level === 'error' && 'bg-red-500/[0.03]',
                        log.level === 'warn' && 'bg-yellow-500/[0.02]',
                      )}
                    >
                      {/* Level icon */}
                      <div className={cn('mt-0.5 shrink-0', lvl.color)}>
                        <LvlIcon className="h-3.5 w-3.5" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground/50 font-mono shrink-0">
                            {formatTime(log.timestamp)}
                          </span>
                          <span className={cn('flex items-center gap-1 text-[11px] shrink-0', cat.color)}>
                            <CatIcon className="h-3 w-3" />
                            {cat.label}
                          </span>
                          {log.projectId && (
                            <span className="text-[11px] text-muted-foreground/40 truncate">
                              {log.projectId}
                            </span>
                          )}
                        </div>
                        <p className={cn(
                          'text-sm mt-0.5',
                          log.level === 'error' ? 'text-red-300' : log.level === 'warn' ? 'text-yellow-200' : 'text-foreground/80'
                        )}>
                          {log.message}
                        </p>
                        {isExpanded && log.details && (
                          <pre className="mt-2 text-xs text-muted-foreground bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                            {log.details}
                          </pre>
                        )}
                        {log.details && !isExpanded && (
                          <span className="text-[10px] text-muted-foreground/40 mt-0.5 block">
                            Click to expand details
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
