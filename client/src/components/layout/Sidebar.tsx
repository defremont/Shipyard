import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LayoutDashboard, Star, FolderOpen, RefreshCw, Settings, ClipboardList, PanelLeftClose, PanelLeft, ArrowUp, ArrowDown, FileEdit, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useProjects, useRefreshProjects } from '@/hooks/useProjects'
import { useAllTasks } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'

const avatarColors = [
  'bg-red-500/20 text-red-400',
  'bg-orange-500/20 text-orange-400',
  'bg-amber-500/20 text-amber-400',
  'bg-yellow-500/20 text-yellow-400',
  'bg-lime-500/20 text-lime-400',
  'bg-green-500/20 text-green-400',
  'bg-emerald-500/20 text-emerald-400',
  'bg-teal-500/20 text-teal-400',
  'bg-cyan-500/20 text-cyan-400',
  'bg-sky-500/20 text-sky-400',
  'bg-blue-500/20 text-blue-400',
  'bg-indigo-500/20 text-indigo-400',
  'bg-violet-500/20 text-violet-400',
  'bg-purple-500/20 text-purple-400',
  'bg-fuchsia-500/20 text-fuchsia-400',
  'bg-pink-500/20 text-pink-400',
  'bg-rose-500/20 text-rose-400',
]

function projectColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

function ProjectAvatar({ name, className }: { name: string; className?: string }) {
  const initial = name.charAt(0).toUpperCase()
  return (
    <span className={cn('flex items-center justify-center rounded-md text-[11px] font-bold', projectColor(name), className)}>
      {initial}
    </span>
  )
}

function GitIndicators({ project }: { project: { gitAhead?: number; gitBehind?: number; gitDirty?: boolean; gitStaged?: number; gitUnstaged?: number; gitUntracked?: number } }) {
  const ahead = project.gitAhead ?? 0
  const behind = project.gitBehind ?? 0
  const changes = (project.gitStaged ?? 0) + (project.gitUnstaged ?? 0) + (project.gitUntracked ?? 0)

  if (!ahead && !behind && !changes) return null

  return (
    <div className="flex items-center gap-1 shrink-0">
      {ahead > 0 && (
        <span className="flex items-center text-[10px] text-orange-400" title={`${ahead} unpushed`}>
          <ArrowUp className="h-2.5 w-2.5" />{ahead}
        </span>
      )}
      {behind > 0 && (
        <span className="flex items-center text-[10px] text-blue-400" title={`${behind} to pull`}>
          <ArrowDown className="h-2.5 w-2.5" />{behind}
        </span>
      )}
      {changes > 0 && (
        <span className="flex items-center text-[10px] text-yellow-400" title={`${changes} uncommitted`}>
          <FileEdit className="h-2.5 w-2.5" />{changes}
        </span>
      )}
    </div>
  )
}

function CollapsedProjectItem({ project: p, location, openTab }: {
  project: { id: string; name: string; gitDirty?: boolean; gitAhead?: number; gitBehind?: number; gitStaged?: number; gitUnstaged?: number; gitUntracked?: number }
  location: { pathname: string }
  openTab: (id: string) => void
}) {
  const gitInfo = []
  if ((p.gitAhead ?? 0) > 0) gitInfo.push(`${p.gitAhead} unpushed`)
  if ((p.gitBehind ?? 0) > 0) gitInfo.push(`${p.gitBehind} to pull`)
  const changes = (p.gitStaged ?? 0) + (p.gitUnstaged ?? 0) + (p.gitUntracked ?? 0)
  if (changes > 0) gitInfo.push(`${changes} changed`)
  const hasGitPending = p.gitDirty || (p.gitAhead ?? 0) > 0 || (p.gitBehind ?? 0) > 0

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => openTab(p.id)}
          className={cn(
            'relative flex items-center justify-center w-8 h-8 rounded-md transition-colors',
            location.pathname === `/project/${p.id}` ? 'ring-1 ring-primary' : 'hover:bg-accent/50'
          )}
        >
          <ProjectAvatar name={p.name} className="w-7 h-7" />
          {hasGitPending && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {p.name}{gitInfo.length > 0 && ` (${gitInfo.join(', ')})`}
      </TooltipContent>
    </Tooltip>
  )
}

interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation()
  const { data: projects } = useProjects()
  const { data: tasks } = useAllTasks()
  const refreshProjects = useRefreshProjects()
  const { openTab } = useTabs()
  const [search, setSearch] = useState('')

  const [collapsedSearchOpen, setCollapsedSearchOpen] = useState(false)
  const [collapsedSearch, setCollapsedSearch] = useState('')
  const collapsedInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (collapsedSearchOpen) {
      setCollapsedSearch('')
      setTimeout(() => collapsedInputRef.current?.focus(), 0)
    }
  }, [collapsedSearchOpen])

  const favorites = projects?.filter(p => p.favorite) || []
  const filtered = search
    ? projects?.filter(p => p.name.toLowerCase().includes(search.toLowerCase())) || []
    : []
  const collapsedFiltered = collapsedSearch
    ? projects?.filter(p => p.name.toLowerCase().includes(collapsedSearch.toLowerCase())) || []
    : []

  const inboxCount = tasks?.filter(t => t.status === 'backlog' || t.status === 'todo').length || 0
  const inProgressCount = tasks?.filter(t => t.status === 'in_progress').length || 0

  const activeProjects = projects?.filter(p =>
    tasks?.some(t => t.projectId === p.id && (t.status === 'backlog' || t.status === 'todo'))
  ) || []

  // Projects with pending git changes (not already in active or favorites)
  const activeIds = new Set(activeProjects.map(p => p.id))
  const favoriteIds = new Set(favorites.map(p => p.id))
  const gitPendingProjects = projects?.filter(p =>
    !activeIds.has(p.id) && !favoriteIds.has(p.id) &&
    (p.gitDirty || (p.gitAhead ?? 0) > 0 || (p.gitBehind ?? 0) > 0)
  ) || []

  // Collapsed sidebar - icons only
  if (collapsed) {
    return (
      <aside className="w-12 border-r bg-card flex flex-col h-screen shrink-0">
        <div className="p-2 border-b flex justify-center">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle}>
            <PanelLeft className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1 scrollbar-dark">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/"
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
                  location.pathname === '/' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <LayoutDashboard className="h-4 w-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">All Projects</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                to="/tasks"
                className={cn(
                  'relative flex items-center justify-center w-8 h-8 rounded-md transition-colors',
                  location.pathname === '/tasks' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <ClipboardList className="h-4 w-4" />
                {(inboxCount + inProgressCount) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 bg-primary text-primary-foreground text-[8px] rounded-full w-3.5 h-3.5 flex items-center justify-center font-medium">
                    {inboxCount + inProgressCount}
                  </span>
                )}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">All Tasks ({inboxCount + inProgressCount})</TooltipContent>
          </Tooltip>

          <Popover open={collapsedSearchOpen} onOpenChange={setCollapsedSearchOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    className="flex items-center justify-center w-8 h-8 rounded-md transition-colors text-muted-foreground hover:bg-accent/50"
                  >
                    <Search className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">Search projects</TooltipContent>
            </Tooltip>
            <PopoverContent side="right" align="start" className="w-56 p-2">
              <Input
                ref={collapsedInputRef}
                placeholder="Search projects..."
                value={collapsedSearch}
                onChange={e => setCollapsedSearch(e.target.value)}
                className="h-7 text-xs mb-1"
              />
              {collapsedFiltered.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-0.5">
                  {collapsedFiltered.slice(0, 8).map(p => (
                    <button
                      key={p.id}
                      onClick={() => { openTab(p.id); setCollapsedSearchOpen(false) }}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs w-full text-left hover:bg-accent/50 transition-colors"
                    >
                      <ProjectAvatar name={p.name} className="w-5 h-5 shrink-0" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {collapsedSearch && collapsedFiltered.length === 0 && (
                <p className="text-[10px] text-muted-foreground/50 text-center py-2">No projects found</p>
              )}
            </PopoverContent>
          </Popover>

          {activeProjects.length > 0 && (
            <>
              <div className="w-6 border-t my-1" />
              {activeProjects.map(p => <CollapsedProjectItem key={p.id} project={p} location={location} openTab={openTab} />)}
            </>
          )}

          {favorites.length > 0 && (
            <>
              <div className="w-6 border-t my-1" />
              {favorites.map(p => <CollapsedProjectItem key={p.id} project={p} location={location} openTab={openTab} />)}
            </>
          )}

          {gitPendingProjects.length > 0 && (
            <>
              <div className="w-6 border-t my-1" />
              {gitPendingProjects.map(p => <CollapsedProjectItem key={p.id} project={p} location={location} openTab={openTab} />)}
            </>
          )}
        </nav>

        <div className="p-2 border-t flex justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to="/settings">
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <Settings className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Settings</TooltipContent>
          </Tooltip>
        </div>
      </aside>
    )
  }

  // Expanded sidebar
  return (
    <aside className="w-64 border-r bg-card flex flex-col h-screen shrink-0">
      <div className="p-4 border-b flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-lg">
          <LayoutDashboard className="h-5 w-5 text-primary" />
          DevDash
        </Link>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle}>
          <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      <div className="p-3">
        <div className="flex gap-1">
          <Input
            placeholder="Search projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => refreshProjects.mutate()}
            disabled={refreshProjects.isPending}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshProjects.isPending && 'animate-spin')} />
          </Button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 space-y-1 scrollbar-dark">
        <Link
          to="/"
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
            location.pathname === '/'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50'
          )}
        >
          <LayoutDashboard className="h-4 w-4" />
          All Projects
        </Link>

        {/* Tasks link */}
        <Link
          to="/tasks"
          className={cn(
            'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
            location.pathname === '/tasks'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50'
          )}
        >
          <ClipboardList className="h-4 w-4" />
          All Tasks
          {(inboxCount > 0 || inProgressCount > 0) && (
            <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium ml-auto">
              {inboxCount + inProgressCount}
            </span>
          )}
        </Link>

        {/* Active projects (with in-progress tasks) */}
        {activeProjects.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Active
            </div>
            {activeProjects.map(p => (
              <button
                key={p.id}
                onClick={() => openTab(p.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors w-full text-left',
                  location.pathname === `/project/${p.id}`
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <ProjectAvatar name={p.name} className="w-5 h-5 shrink-0" />
                <span className="truncate flex-1">{p.name}</span>
                <GitIndicators project={p} />
              </button>
            ))}
          </>
        )}

        {/* Favorites */}
        {favorites.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Favorites
            </div>
            {favorites.map(p => (
              <button
                key={p.id}
                onClick={() => openTab(p.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors w-full text-left',
                  location.pathname === `/project/${p.id}`
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <ProjectAvatar name={p.name} className="w-5 h-5 shrink-0" />
                <span className="truncate flex-1">{p.name}</span>
                <GitIndicators project={p} />
                <Star className="h-3 w-3 fill-yellow-500 text-yellow-500 shrink-0" />
              </button>
            ))}
          </>
        )}

        {/* Search results */}
        {search && filtered.length > 0 && (
          <>
            <div className="pt-4 pb-1 px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Search Results
            </div>
            {filtered.map(p => (
              <button
                key={p.id}
                onClick={() => openTab(p.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors w-full text-left',
                  location.pathname === `/project/${p.id}`
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50'
                )}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
          </>
        )}
      </nav>

      <div className="p-3 border-t flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{projects?.length || 0} projects</span>
        <Link to="/settings">
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Settings className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </Link>
      </div>
    </aside>
  )
}
