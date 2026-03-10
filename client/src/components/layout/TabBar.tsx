import { X, Home } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useTabs } from '@/hooks/useTabs'
import { useProjects, type Project } from '@/hooks/useProjects'
import { useGitStatus } from '@/hooks/useGit'

function ProjectTab({ tabId, project, isActive, onSwitch, onClose }: {
  tabId: string
  project?: Project
  isActive: boolean
  onSwitch: () => void
  onClose: () => void
}) {
  const { data: gitStatus } = useGitStatus(project?.isGitRepo ? tabId : undefined)
  const label = project?.name || tabId

  // Show dot when project has staged or unstaged modifications
  const hasLocalChanges = gitStatus
    ? ((gitStatus.staged?.length ?? 0) > 0 || (gitStatus.modified?.length ?? 0) > 0 || (gitStatus.not_added?.length ?? 0) > 0)
    : ((project?.gitStaged ?? 0) > 0 || (project?.gitUnstaged ?? 0) > 0 || (project?.gitUntracked ?? 0) > 0)

  return (
    <div
      className={cn(
        'flex items-center gap-1 pl-3 pr-1 h-8 rounded-t-md transition-colors shrink-0 group max-w-[200px]',
        isActive
          ? 'bg-background border border-b-0 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
      )}
    >
      <button
        className="text-xs truncate font-medium"
        onClick={onSwitch}
        title={project?.path || tabId}
      >
        {label}
      </button>
      {hasLocalChanges && (
        <span className="w-1.5 h-1.5 rounded-full bg-white/70 shrink-0" title="Has uncommitted changes" />
      )}
      <button
        className={cn(
          'p-0.5 rounded hover:bg-accent shrink-0 ml-1',
          isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
        )}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        title="Close tab"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}

export function TabBar() {
  const { tabs, activeTabId, switchTab, closeTab } = useTabs()
  const { data: projects } = useProjects()
  const location = useLocation()
  const navigate = useNavigate()

  const isHome = location.pathname === '/' || location.pathname === '/tasks' || location.pathname === '/settings'

  if (tabs.length === 0) return null

  return (
    <div className="h-9 bg-muted/30 border-b flex items-end px-1 gap-0.5 shrink-0 overflow-x-auto">
      {/* Home tab */}
      <button
        className={cn(
          'flex items-center gap-1.5 px-3 h-8 text-xs rounded-t-md transition-colors shrink-0',
          isHome
            ? 'bg-background border border-b-0 text-foreground font-medium'
            : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
        )}
        onClick={() => navigate('/')}
      >
        <Home className="h-3 w-3" />
        Home
      </button>

      {/* Project tabs */}
      {tabs.map(tab => (
        <ProjectTab
          key={tab.id}
          tabId={tab.id}
          project={projects?.find(p => p.id === tab.id)}
          isActive={tab.id === activeTabId}
          onSwitch={() => switchTab(tab.id)}
          onClose={() => closeTab(tab.id)}
        />
      ))}
    </div>
  )
}
