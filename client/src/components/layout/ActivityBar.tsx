import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  Files, Search, GitBranch, Sparkles, Settings, HelpCircle, ScrollText, FolderKanban, ListChecks, LayoutList,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useActivity, type ActivityId } from '@/hooks/useActivity'
import { useTabs } from '@/hooks/useTabs'
import { useProjects } from '@/hooks/useProjects'
import { useGitStatus } from '@/hooks/useGit'
import { useAllTasks } from '@/hooks/useTasks'
import { useClaudeStatus } from '@/hooks/useClaude'

interface ActivityItem {
  id: ActivityId
  label: string
  icon: typeof Files
  badge?: number | string
}

function ActivityButton({
  item,
  selected,
  panelOpen,
  onClick,
}: {
  item: ActivityItem
  selected: boolean
  panelOpen: boolean
  onClick: () => void
}) {
  const Icon = item.icon
  const active = selected && panelOpen
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'relative flex items-center justify-center w-12 h-12 transition-colors group',
            active
              ? 'text-foreground'
              : 'text-muted-foreground/60 hover:text-foreground'
          )}
        >
          <span
            className={cn(
              'absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full transition-all',
              active ? 'bg-foreground' : 'bg-transparent group-hover:bg-muted-foreground/20'
            )}
          />
          <Icon className="h-5 w-5" />
          {item.badge !== undefined && item.badge !== 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-medium flex items-center justify-center">
              {item.badge}
            </span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

function NavLink({
  to, label, icon: Icon, badge, position = 'top',
}: { to: string; label: string; icon: typeof Settings; badge?: number; position?: 'top' | 'bottom' }) {
  const location = useLocation()
  const active = location.pathname === to
  const sizeClass = position === 'top' ? 'w-12 h-12' : 'w-12 h-10'
  const iconSize = position === 'top' ? 'h-5 w-5' : 'h-4 w-4'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={to}
          className={cn(
            'relative flex items-center justify-center transition-colors group',
            sizeClass,
            active ? 'text-foreground' : 'text-muted-foreground/60 hover:text-foreground'
          )}
        >
          {position === 'top' && (
            <span
              className={cn(
                'absolute left-0 top-2 bottom-2 w-[2px] rounded-r-full transition-all',
                active ? 'bg-foreground' : 'bg-transparent group-hover:bg-muted-foreground/20'
              )}
            />
          )}
          <Icon className={iconSize} />
          {badge !== undefined && badge > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-medium flex items-center justify-center">
              {badge}
            </span>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

export function ActivityBar() {
  const { activity, panelOpen, selectActivity } = useActivity()
  const { activeTabId } = useTabs()
  const { data: projects } = useProjects()
  const project = projects?.find(p => p.id === activeTabId)
  const { data: gitStatus } = useGitStatus(project?.isGitRepo ? activeTabId ?? undefined : undefined)
  const { data: tasks } = useAllTasks()
  const { data: claudeStatus } = useClaudeStatus()
  const navigate = useNavigate()
  const location = useLocation()

  const projectTaskCount = activeTabId && tasks
    ? tasks.filter(t => t.projectId === activeTabId && (t.status === 'backlog' || t.status === 'todo' || t.status === 'in_progress')).length
    : 0

  const showProjectTasks = () => {
    if (!activeTabId) {
      navigate('/tasks')
      return
    }
    localStorage.setItem(`shipyard:workspace-mode:${activeTabId}`, 'tasks')
    if (location.pathname !== `/project/${activeTabId}`) {
      navigate(`/project/${activeTabId}`)
    } else {
      window.dispatchEvent(new CustomEvent('shipyard:workspace-mode', { detail: { mode: 'tasks' } }))
    }
  }

  const gitChanges = gitStatus
    ? (gitStatus.staged?.length || 0) + (gitStatus.modified?.length || 0) + (gitStatus.not_added?.length || 0)
    : 0

  const totalActiveTasks = tasks?.filter(t => t.status === 'backlog' || t.status === 'todo' || t.status === 'in_progress').length || 0

  const items: ActivityItem[] = [
    { id: 'projects', label: 'Projects', icon: FolderKanban },
    { id: 'explorer', label: 'Explorer', icon: Files },
    { id: 'search', label: 'Search (Ctrl+K)', icon: Search },
    { id: 'git', label: 'Source Control', icon: GitBranch, badge: gitChanges || undefined },
    {
      id: 'claude',
      label: 'Claude AI',
      icon: Sparkles,
      badge: claudeStatus?.cliAvailable || claudeStatus?.configured ? undefined : '!',
    },
  ]

  return (
    <aside className="w-12 shrink-0 border-r bg-card/30 flex flex-col h-screen">
      <nav className="flex-1 flex flex-col items-stretch py-1">
        {items.map(item => (
          <ActivityButton
            key={item.id}
            item={item}
            selected={activity === item.id}
            panelOpen={panelOpen}
            onClick={() => selectActivity(item.id)}
          />
        ))}

        {/* Project Tasks shortcut — flips the active project's workspace to
            its kanban without making the user hunt for the header toggle. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={showProjectTasks}
              disabled={!activeTabId}
              className={cn(
                'relative flex items-center justify-center w-12 h-12 transition-colors group',
                activeTabId
                  ? 'text-muted-foreground/60 hover:text-foreground'
                  : 'text-muted-foreground/20 cursor-not-allowed'
              )}
            >
              <LayoutList className="h-5 w-5" />
              {projectTaskCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-medium flex items-center justify-center">
                  {projectTaskCount}
                </span>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {activeTabId ? `${project?.name ?? 'Project'} — Tasks` : 'Open a project to see its tasks'}
          </TooltipContent>
        </Tooltip>

        <NavLink to="/tasks" label="All Tasks" icon={ListChecks} badge={totalActiveTasks} />
      </nav>

      <div className="flex flex-col items-stretch py-1 border-t">
        <NavLink to="/logs" label="Logs" icon={ScrollText} position="bottom" />
        <NavLink to="/help" label="Help" icon={HelpCircle} position="bottom" />
        <NavLink to="/settings" label="Settings" icon={Settings} position="bottom" />
      </div>
    </aside>
  )
}
