import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  ChevronDown, ChevronRight, LayoutDashboard, ClipboardList, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useProjects, useRefreshProjects, type Project } from '@/hooks/useProjects'
import { useAllTasks } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'
import { ProjectContextMenu } from '@/components/projects/ProjectContextMenu'

// Restrained, desaturated set — enough hues to tell projects apart without
// turning the sidebar into a rainbow.
const avatarColors = [
  'bg-sky-500/15 text-sky-400', 'bg-teal-500/15 text-teal-400',
  'bg-emerald-500/15 text-emerald-400', 'bg-amber-500/15 text-amber-400',
  'bg-orange-500/15 text-orange-400', 'bg-rose-500/15 text-rose-400',
  'bg-slate-500/20 text-slate-300', 'bg-cyan-500/15 text-cyan-400',
]

function projectColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return avatarColors[Math.abs(hash) % avatarColors.length]
}

function ProjectAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn('flex items-center justify-center rounded text-[10px] font-bold', projectColor(name), className)}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

function ProjectItem({
  project, isCurrent, taskCount, isActive, onClick,
}: {
  project: Project
  isCurrent: boolean
  taskCount?: number
  isActive?: boolean
  onClick: () => void
}) {
  const changes = (project.gitStaged ?? 0) + (project.gitUnstaged ?? 0) + (project.gitUntracked ?? 0)
  return (
    <ProjectContextMenu project={project}>
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded-md text-[12px] transition-colors w-full text-left',
        isCurrent
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <ProjectAvatar name={project.name} className="w-4 h-4 shrink-0" />
      <span className="truncate flex-1">{project.name}</span>
      <div className="flex items-center gap-1 shrink-0">
        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-warning" />}
        {!isActive && changes > 0 && <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />}
        {taskCount !== undefined && taskCount > 0 && (
          <span className="text-[10px] text-muted-foreground/60 tabular-nums min-w-[14px] text-right">
            {taskCount}
          </span>
        )}
      </div>
    </button>
    </ProjectContextMenu>
  )
}

const SECTION_KEY = 'shipyard:projects-sections'

function loadSections(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SECTION_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function Section({
  id, title, count, defaultOpen, actions, children,
}: {
  id: string
  title: string
  count?: number
  defaultOpen?: boolean
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const [state, setState] = useState<Record<string, boolean>>(loadSections)
  const isOpen = state[id] !== undefined ? state[id] : (defaultOpen ?? true)
  const toggle = () => {
    setState(prev => {
      const next = { ...prev, [id]: !isOpen }
      localStorage.setItem(SECTION_KEY, JSON.stringify(next))
      return next
    })
  }
  return (
    <div>
      <div className="flex items-center group">
        <button
          onClick={toggle}
          className="flex items-center gap-1 flex-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground transition-colors min-w-0"
        >
          {isOpen ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span className="text-[10px] text-muted-foreground/40 ml-auto">{count}</span>
          )}
        </button>
        {actions && <div className="opacity-0 group-hover:opacity-100 transition-opacity pr-1">{actions}</div>}
      </div>
      {isOpen && <div className="px-1 pb-1">{children}</div>}
    </div>
  )
}

export function ProjectsView() {
  const location = useLocation()
  const { data: projects } = useProjects()
  const { data: tasks } = useAllTasks()
  const refreshProjects = useRefreshProjects()
  const { openTab } = useTabs()

  const { pendingByProject, inProgressProjects } = useMemo(() => {
    const pending = new Map<string, number>()
    const inProgress = new Set<string>()
    if (tasks) {
      for (const t of tasks) {
        if (t.status === 'todo' || t.status === 'in_progress') {
          pending.set(t.projectId, (pending.get(t.projectId) || 0) + 1)
        }
        if (t.status === 'in_progress') inProgress.add(t.projectId)
      }
    }
    return { pendingByProject: pending, inProgressProjects: inProgress }
  }, [tasks])

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

  const totalActive = tasks?.filter(t => t.status === 'backlog' || t.status === 'todo' || t.status === 'in_progress').length || 0

  return (
    <div className="flex flex-col h-full">
      {/* Quick links */}
      <div className="px-2 pt-2 pb-1 space-y-0.5 shrink-0">
        <Link
          to="/"
          className={cn(
            'flex items-center gap-2 px-2 py-1 rounded-md text-[12px] transition-colors',
            location.pathname === '/'
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          )}
        >
          <LayoutDashboard className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <Link
          to="/tasks"
          className={cn(
            'flex items-center gap-2 px-2 py-1 rounded-md text-[12px] transition-colors',
            location.pathname === '/tasks'
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          )}
        >
          <ClipboardList className="h-3.5 w-3.5" />
          All Tasks
          {totalActive > 0 && (
            <span className="text-[10px] text-muted-foreground/50 ml-auto tabular-nums">{totalActive}</span>
          )}
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-dark min-h-0 space-y-0.5 pb-2">
        {favorites.length > 0 && (
          <Section id="favorites" title="Favorites" count={favorites.length} defaultOpen>
            <div className="space-y-0.5">
              {favorites.map(p => (
                <ProjectItem
                  key={p.id} project={p}
                  isCurrent={location.pathname === `/project/${p.id}`}
                  taskCount={pendingByProject.get(p.id)}
                  isActive={inProgressProjects.has(p.id)}
                  onClick={() => openTab(p.id)}
                />
              ))}
            </div>
          </Section>
        )}
        {activeProjects.length > 0 && (
          <Section id="active" title="Active" count={activeProjects.length} defaultOpen>
            <div className="space-y-0.5">
              {activeProjects.map(p => (
                <ProjectItem
                  key={p.id} project={p}
                  isCurrent={location.pathname === `/project/${p.id}`}
                  taskCount={pendingByProject.get(p.id)}
                  isActive
                  onClick={() => openTab(p.id)}
                />
              ))}
            </div>
          </Section>
        )}
        {otherProjects.length > 0 && (
          <Section
            id="projects"
            title="Projects"
            count={otherProjects.length}
            defaultOpen={otherProjects.length <= 10}
            actions={
              <Button
                variant="ghost" size="icon" className="h-5 w-5"
                onClick={() => refreshProjects.mutate()}
                disabled={refreshProjects.isPending}
                title="Refresh"
              >
                <RefreshCw className={cn('h-3 w-3', refreshProjects.isPending && 'animate-spin')} />
              </Button>
            }
          >
            <div className="space-y-0.5">
              {otherProjects.map(p => (
                <ProjectItem
                  key={p.id} project={p}
                  isCurrent={location.pathname === `/project/${p.id}`}
                  taskCount={pendingByProject.get(p.id)}
                  onClick={() => openTab(p.id)}
                />
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
