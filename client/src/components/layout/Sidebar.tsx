import { useState, useCallback, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, RefreshCw, Settings, ClipboardList, PanelLeftClose, PanelLeft,
  ArrowUp, ArrowDown, FileEdit, Search, HelpCircle, ChevronRight, Loader, GitBranch, ScrollText
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useProjects, type Project } from '@/hooks/useProjects'
import { useAllTasks } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'
import { useRefreshProjects } from '@/hooks/useProjects'

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

// --- Collapsed sidebar project item ---
function CollapsedProjectItem({ project: p, location, openTab, taskCount, isActive }: {
  project: Project
  location: { pathname: string }
  openTab: (id: string) => void
  taskCount?: number
  isActive?: boolean
}) {
  const gitInfo = []
  if ((p.gitAhead ?? 0) > 0) gitInfo.push(`${p.gitAhead} unpushed`)
  if ((p.gitBehind ?? 0) > 0) gitInfo.push(`${p.gitBehind} to pull`)
  const changes = (p.gitStaged ?? 0) + (p.gitUnstaged ?? 0) + (p.gitUntracked ?? 0)
  if (changes > 0) gitInfo.push(`${changes} changed`)
  const hasGitPending = p.gitDirty || (p.gitAhead ?? 0) > 0 || (p.gitBehind ?? 0) > 0

  const tooltipParts = [p.name]
  if (taskCount) tooltipParts.push(`${taskCount} task${taskCount > 1 ? 's' : ''}`)
  if (gitInfo.length > 0) tooltipParts.push(gitInfo.join(', '))

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
          {isActive && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          )}
          {!isActive && hasGitPending && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400" />
          )}
          {!isActive && !hasGitPending && taskCount && taskCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary/70" />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{tooltipParts.join(' · ')}</TooltipContent>
    </Tooltip>
  )
}

// --- Expanded sidebar project item ---
function ExpandedProjectItem({ project: p, location, openTab, taskCount, showBranch }: {
  project: Project
  location: { pathname: string }
  openTab: (id: string) => void
  taskCount?: number
  showBranch?: boolean
}) {
  return (
    <button
      onClick={() => openTab(p.id)}
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors w-full text-left group',
        location.pathname === `/project/${p.id}`
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50'
      )}
    >
      <ProjectAvatar name={p.name} className="w-5 h-5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="truncate block leading-tight">{p.name}</span>
        {showBranch && p.gitBranch && (
          <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground/50 leading-tight">
            <GitBranch className="h-2.5 w-2.5" />
            <span className="truncate">{p.gitBranch}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <GitIndicators project={p} />
        {taskCount !== undefined && taskCount > 0 && (
          <span className="text-[10px] bg-primary/10 text-primary px-1 py-0.5 rounded font-medium min-w-[16px] text-center">
            {taskCount}
          </span>
        )}
      </div>
    </button>
  )
}

// --- Collapsible section ---
const SECTION_STORAGE_KEY = 'shipyard:sidebar-sections'

function loadSectionState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SECTION_STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function SectionHeader({ label, count, isOpen, onToggle, icon }: {
  label: string
  count: number
  isOpen: boolean
  onToggle: () => void
  icon?: React.ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full px-2.5 pt-3 pb-1 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider hover:text-muted-foreground transition-colors group"
    >
      <ChevronRight className={cn('h-3 w-3 transition-transform duration-150', isOpen && 'rotate-90')} />
      {icon}
      <span>{label}</span>
      <span className="text-[10px] font-normal text-muted-foreground/40 ml-auto">{count}</span>
    </button>
  )
}


// --- Main Sidebar ---
interface SidebarProps {
  collapsed: boolean
  onToggle: () => void
}

function openGlobalSearch() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation()
  const { data: projects } = useProjects()
  const { data: tasks } = useAllTasks()
  const refreshProjects = useRefreshProjects()
  const { openTab } = useTabs()

  // Section collapsed state with localStorage persistence
  const [sectionState, setSectionState] = useState<Record<string, boolean>>(loadSectionState)
  const toggleSection = useCallback((key: string) => {
    setSectionState(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])
  const isSectionOpen = (key: string, defaultOpen: boolean) => {
    return sectionState[key] !== undefined ? sectionState[key] : defaultOpen
  }

  // Compute task counts per project (only todo + in_progress — backlog is not actionable)
  const { pendingByProject, inProgressProjects } = useMemo(() => {
    const pending = new Map<string, number>()
    const inProgress = new Set<string>()
    if (tasks) {
      for (const t of tasks) {
        if (t.status === 'todo' || t.status === 'in_progress') {
          pending.set(t.projectId, (pending.get(t.projectId) || 0) + 1)
        }
        if (t.status === 'in_progress') {
          inProgress.add(t.projectId)
        }
      }
    }
    return { pendingByProject: pending, inProgressProjects: inProgress }
  }, [tasks])

  // Categorize projects
  const favorites = useMemo(() => projects?.filter(p => p.favorite) || [], [projects])
  const favoriteIds = useMemo(() => new Set(favorites.map(p => p.id)), [favorites])

  const activeProjects = useMemo(() =>
    projects?.filter(p => !favoriteIds.has(p.id) && inProgressProjects.has(p.id)) || [],
    [projects, favoriteIds, inProgressProjects]
  )
  const activeIds = useMemo(() => new Set(activeProjects.map(p => p.id)), [activeProjects])

  const otherProjects = useMemo(() =>
    projects?.filter(p => !favoriteIds.has(p.id) && !activeIds.has(p.id)) || [],
    [projects, favoriteIds, activeIds]
  )

  // Global task counts
  const inboxCount = tasks?.filter(t => t.status === 'backlog' || t.status === 'todo').length || 0
  const inProgressCount = tasks?.filter(t => t.status === 'in_progress').length || 0

  // Collapsed sidebar
  if (collapsed) {
    return (
      <aside className="w-12 border-r bg-card flex flex-col h-screen shrink-0">
        <div className="p-2 border-b flex justify-center">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle}>
            <PanelLeft className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 flex flex-col items-center gap-1 scrollbar-dark">
          {/* Navigation icons */}
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
            <TooltipContent side="right">Dashboard</TooltipContent>
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

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={openGlobalSearch}
                className="flex items-center justify-center w-8 h-8 rounded-md transition-colors text-muted-foreground hover:bg-accent/50"
              >
                <Search className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Search (Ctrl+K)</TooltipContent>
          </Tooltip>

          {/* Favorites */}
          {favorites.length > 0 && (
            <>
              <div className="w-6 border-t my-1" />
              {favorites.map(p => (
                <CollapsedProjectItem
                  key={p.id}
                  project={p}
                  location={location}
                  openTab={openTab}
                  taskCount={pendingByProject.get(p.id)}
                  isActive={inProgressProjects.has(p.id)}
                />
              ))}
            </>
          )}

          {/* Active (in-progress, non-favorite) */}
          {activeProjects.length > 0 && (
            <>
              <div className="w-6 border-t my-1" />
              {activeProjects.map(p => (
                <CollapsedProjectItem
                  key={p.id}
                  project={p}
                  location={location}
                  openTab={openTab}
                  taskCount={pendingByProject.get(p.id)}
                  isActive
                />
              ))}
            </>
          )}

          {/* Remaining projects */}
          {otherProjects.length > 0 && (
            <>
              <div className="w-6 border-t my-1" />
              {otherProjects.map(p => (
                <CollapsedProjectItem
                  key={p.id}
                  project={p}
                  location={location}
                  openTab={openTab}
                  taskCount={pendingByProject.get(p.id)}
                />
              ))}
            </>
          )}
        </nav>

        <div className="p-2 border-t flex flex-col items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to="/logs">
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Logs</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link to="/help">
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">Help</TooltipContent>
          </Tooltip>
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
    <aside className="w-56 border-r bg-card flex flex-col h-screen shrink-0">
      {/* Header */}
      <div className="px-3 py-3 border-b flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-base">
          <LayoutDashboard className="h-4 w-4 text-primary" />
          Shipyard
        </Link>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => refreshProjects.mutate()}
            disabled={refreshProjects.isPending}
            title="Refresh projects"
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', refreshProjects.isPending && 'animate-spin')} />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggle} title="Collapse sidebar">
            <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-1">
        <button
          onClick={openGlobalSearch}
          className="flex items-center gap-2 h-7 w-full rounded-md border border-input bg-transparent px-2.5 text-xs text-muted-foreground/60 hover:bg-accent/50 hover:text-muted-foreground transition-colors"
        >
          <Search className="h-3 w-3 shrink-0" />
          <span className="flex-1 text-left">Search...</span>
          <kbd className="pointer-events-none inline-flex h-4 select-none items-center rounded border bg-muted px-1 font-mono text-[9px] font-medium">
            Ctrl+K
          </kbd>
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-dark">
        <div className="space-y-0.5 pt-1">
          <Link
            to="/"
            className={cn(
              'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors',
              location.pathname === '/'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Dashboard
          </Link>

          <Link
            to="/tasks"
            className={cn(
              'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors',
              location.pathname === '/tasks'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            <ClipboardList className="h-3.5 w-3.5" />
            All Tasks
            {(inboxCount > 0 || inProgressCount > 0) && (
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium ml-auto">
                {inboxCount + inProgressCount}
              </span>
            )}
          </Link>
        </div>

        {/* Favorites section */}
        {favorites.length > 0 && (
          <div>
            <SectionHeader
              label="Favorites"
              count={favorites.length}
              isOpen={isSectionOpen('favorites', true)}
              onToggle={() => toggleSection('favorites')}
            />
            {isSectionOpen('favorites', true) && (
              <div className="space-y-0.5">
                {favorites.map(p => (
                  <ExpandedProjectItem
                    key={p.id}
                    project={p}
                    location={location}
                    openTab={openTab}
                    taskCount={pendingByProject.get(p.id)}
                    showBranch
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Active section (in-progress, not favorites) */}
        {activeProjects.length > 0 && (
          <div>
            <SectionHeader
              label="Active"
              count={activeProjects.length}
              isOpen={isSectionOpen('active', true)}
              onToggle={() => toggleSection('active')}
              icon={<Loader className="h-2.5 w-2.5 text-yellow-500" />}
            />
            {isSectionOpen('active', true) && (
              <div className="space-y-0.5">
                {activeProjects.map(p => (
                  <ExpandedProjectItem
                    key={p.id}
                    project={p}
                    location={location}
                    openTab={openTab}
                    taskCount={pendingByProject.get(p.id)}
                    showBranch
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Other projects */}
        {otherProjects.length > 0 && (
          <div>
            <SectionHeader
              label="Projects"
              count={otherProjects.length}
              isOpen={isSectionOpen('projects', otherProjects.length <= 8)}
              onToggle={() => toggleSection('projects')}
            />
            {isSectionOpen('projects', otherProjects.length <= 8) && (
              <div className="space-y-0.5">
                {otherProjects.map(p => (
                  <ExpandedProjectItem
                    key={p.id}
                    project={p}
                    location={location}
                    openTab={openTab}
                    taskCount={pendingByProject.get(p.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div className="px-3 py-2 border-t">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground/50">{projects?.length || 0} projects</span>
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/logs">
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <ScrollText className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top">Logs</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/help">
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <HelpCircle className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top">Help</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link to="/settings">
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    <Settings className="h-3 w-3 text-muted-foreground" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top">Settings</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <a href="https://dcoder.io/" target="_blank" rel="noopener noreferrer" className="block text-[10px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
          by dcoder.io
        </a>
      </div>
    </aside>
  )
}
