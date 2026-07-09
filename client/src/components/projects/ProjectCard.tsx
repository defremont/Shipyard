import { GitBranch, Star, Sparkles, Play, Monitor, Clock, FolderOpen, ArrowUp, ArrowDown, FileEdit } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useLaunchTerminal, useOpenFolder, useUpdateProject, type Project } from '@/hooks/useProjects'
import { useTabs } from '@/hooks/useTabs'
import { toast } from 'sonner'

export interface TaskCounts {
  inbox: number
  inProgress: number
  done: number
  total: number
  hasUrgent: boolean
}

interface ProjectCardProps {
  project: Project
  taskCounts?: TaskCounts
}

export function ProjectCard({ project, taskCounts }: ProjectCardProps) {
  const { openTab } = useTabs()
  const launchTerminal = useLaunchTerminal()
  const openFolder = useOpenFolder()
  const updateProject = useUpdateProject()

  const handleLaunch = (e: React.MouseEvent, type: string) => {
    e.stopPropagation()
    launchTerminal.mutate(
      { projectId: project.id, type },
      { onSuccess: () => toast.success(`Launched ${type}`) }
    )
  }

  const toggleFavorite = (e: React.MouseEvent) => {
    e.stopPropagation()
    updateProject.mutate({ id: project.id, favorite: !project.favorite })
  }

  const changes = (project.gitStaged ?? 0) + (project.gitUnstaged ?? 0) + (project.gitUntracked ?? 0)
  const activeTasks = (taskCounts?.inbox || 0) + (taskCounts?.inProgress || 0)

  return (
    <div
      className="rounded-lg border bg-card px-3 py-2.5 cursor-pointer hover:border-primary/40 transition-all group space-y-1.5"
      onClick={() => openTab(project.id)}
    >
      {/* Name + star + tasks */}
      <div className="flex items-center gap-1.5">
        <button onClick={toggleFavorite} className="shrink-0">
          <Star className={cn(
            'h-3 w-3 transition-colors',
            project.favorite
              ? 'fill-warning text-warning'
              : 'text-muted-foreground/20 hover:text-warning'
          )} />
        </button>
        <span className="text-[13px] font-medium truncate flex-1">{project.name}</span>
        {/* Task dots */}
        {activeTasks > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            {(taskCounts?.inProgress || 0) > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-warning/80">
                <span className="w-1 h-1 rounded-full bg-warning" />
                {taskCounts!.inProgress}
              </span>
            )}
            {(taskCounts?.inbox || 0) > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-primary/70">
                <span className="w-1 h-1 rounded-full bg-primary" />
                {taskCounts!.inbox}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Git + time in one line */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
        {project.isGitRepo && project.gitBranch && (
          <>
            <GitBranch className="h-2.5 w-2.5 shrink-0" />
            <span className="font-mono truncate max-w-[80px]">{project.gitBranch}</span>
            {(project.gitAhead ?? 0) > 0 && (
              <span className="text-muted-foreground shrink-0"><ArrowUp className="h-2.5 w-2.5 inline" />{project.gitAhead}</span>
            )}
            {(project.gitBehind ?? 0) > 0 && (
              <span className="text-muted-foreground shrink-0"><ArrowDown className="h-2.5 w-2.5 inline" />{project.gitBehind}</span>
            )}
            {changes > 0 && (
              <span className="text-warning shrink-0"><FileEdit className="h-2.5 w-2.5 inline" />{changes}</span>
            )}
          </>
        )}
        {project.lastCommitDate && (
          <>
            {project.isGitRepo && <span className="text-muted-foreground/20">·</span>}
            <Clock className="h-2.5 w-2.5 shrink-0" />
            <span className="shrink-0">{formatDistanceToNow(new Date(project.lastCommitDate), { addSuffix: true })}</span>
          </>
        )}
      </div>

      {/* Tech stack */}
      {project.techStack.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {project.techStack.slice(0, 4).map(tech => (
            <span key={tech} className="text-[9px] text-muted-foreground/40 bg-muted/50 px-1.5 py-0 rounded">
              {tech}
            </span>
          ))}
          {project.techStack.length > 4 && (
            <span className="text-[9px] text-muted-foreground/30">+{project.techStack.length - 4}</span>
          )}
        </div>
      )}

      {/* Quick actions - hover only */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity -mb-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-primary" onClick={e => handleLaunch(e, 'claude')}>
              <Sparkles className="h-2.5 w-2.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Claude Code</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-success" onClick={e => handleLaunch(e, 'dev')}>
              <Play className="h-2.5 w-2.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Dev Server</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={e => handleLaunch(e, 'shell')}>
              <Monitor className="h-2.5 w-2.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Shell</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5"
              onClick={e => { e.stopPropagation(); openFolder.mutate(project.id, { onSuccess: () => toast.success('Opened') }) }}>
              <FolderOpen className="h-2.5 w-2.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Open Folder</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
