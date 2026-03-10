import { GitBranch, Star, Terminal, Play, Monitor, Clock, FolderOpen, Inbox, Loader, CheckCircle2, ArrowUp, ArrowDown, FilePlus2, FileEdit } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
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

  // Accent border: yellow if in_progress tasks, red if urgent in inbox
  const accentBorder = taskCounts?.hasUrgent
    ? 'border-l-red-500'
    : taskCounts?.inProgress
      ? 'border-l-yellow-500'
      : 'border-l-transparent'

  // Truncate path for display
  const displayPath = project.path.length > 50
    ? '...' + project.path.slice(-47)
    : project.path

  return (
    <Card
      className={cn(
        'cursor-pointer hover:border-primary/50 transition-colors group border-l-[3px]',
        accentBorder
      )}
      onClick={() => openTab(project.id)}
    >
      <CardContent className="p-4 space-y-2.5">
        {/* Name + favorite */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-base truncate">{project.name}</h3>
              <button onClick={toggleFavorite} className="shrink-0">
                <Star className={cn(
                  'h-4 w-4 transition-colors',
                  project.favorite
                    ? 'fill-yellow-500 text-yellow-500'
                    : 'text-muted-foreground/30 hover:text-yellow-500'
                )} />
              </button>
            </div>
            {project.category !== 'root' && (
              <span className="text-xs text-muted-foreground">{project.category}/</span>
            )}
          </div>
        </div>

        {/* Path */}
        <p className="text-[11px] text-muted-foreground/50 truncate" title={project.path}>
          {displayPath}
        </p>

        {/* Git info: branch + status indicators */}
        {project.isGitRepo && project.gitBranch && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <div className="flex items-center gap-1">
              <GitBranch className="h-3 w-3 shrink-0" />
              <span className="truncate">{project.gitBranch}</span>
            </div>
            {(project.gitAhead ?? 0) > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 text-orange-400 cursor-default">
                    <ArrowUp className="h-3 w-3" />
                    {project.gitAhead}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{project.gitAhead} commit{project.gitAhead! > 1 ? 's' : ''} not pushed to remote</TooltipContent>
              </Tooltip>
            )}
            {(project.gitBehind ?? 0) > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 text-blue-400 cursor-default">
                    <ArrowDown className="h-3 w-3" />
                    {project.gitBehind}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{project.gitBehind} commit{project.gitBehind! > 1 ? 's' : ''} behind remote (pull needed)</TooltipContent>
              </Tooltip>
            )}
            {(project.gitStaged ?? 0) > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-green-500/50 text-green-500 cursor-default gap-0.5">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    {project.gitStaged} staged
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>{project.gitStaged} file{project.gitStaged! > 1 ? 's' : ''} staged and ready to commit</TooltipContent>
              </Tooltip>
            )}
            {((project.gitUnstaged ?? 0) > 0 || (project.gitUntracked ?? 0) > 0) && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-yellow-500/50 text-yellow-500 cursor-default gap-0.5">
                    <FileEdit className="h-2.5 w-2.5" />
                    {(project.gitUnstaged ?? 0) + (project.gitUntracked ?? 0)} changes
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  {(project.gitUnstaged ?? 0) > 0 && <span>{project.gitUnstaged} modified</span>}
                  {(project.gitUnstaged ?? 0) > 0 && (project.gitUntracked ?? 0) > 0 && <span>, </span>}
                  {(project.gitUntracked ?? 0) > 0 && <span>{project.gitUntracked} untracked</span>}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {/* Last commit */}
        {project.lastCommitDate && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" />
            <span>{formatDistanceToNow(new Date(project.lastCommitDate), { addSuffix: true })}</span>
            {project.lastCommitMessage && (
              <>
                <span className="text-muted-foreground/30">·</span>
                <span className="truncate text-muted-foreground/70">
                  {project.lastCommitMessage.length > 60
                    ? project.lastCommitMessage.slice(0, 60) + '...'
                    : project.lastCommitMessage}
                </span>
              </>
            )}
          </div>
        )}

        {/* Tech stack */}
        {project.techStack.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {project.techStack.slice(0, 5).map(tech => (
              <Badge key={tech} variant="secondary" className="text-[10px] px-1.5 py-0">
                {tech}
              </Badge>
            ))}
            {project.techStack.length > 5 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                +{project.techStack.length - 5}
              </Badge>
            )}
          </div>
        )}

        {/* Task counts */}
        {taskCounts && taskCounts.total > 0 && (
          <div className="flex items-center gap-3 text-[11px]">
            {taskCounts.inbox > 0 && (
              <span className="flex items-center gap-1 text-blue-500">
                <Inbox className="h-3 w-3" />
                {taskCounts.inbox}
              </span>
            )}
            {taskCounts.inProgress > 0 && (
              <span className="flex items-center gap-1 text-yellow-500">
                <Loader className="h-3 w-3" />
                {taskCounts.inProgress}
              </span>
            )}
            {taskCounts.done > 0 && (
              <span className="flex items-center gap-1 text-green-500">
                <CheckCircle2 className="h-3 w-3" />
                {taskCounts.done}
              </span>
            )}
          </div>
        )}

        {/* Action buttons - always visible, with separator */}
        <div className="flex items-center gap-1 pt-1 border-t border-border/50">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => handleLaunch(e, 'claude')}>
                <Terminal className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open Claude Code in terminal</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => handleLaunch(e, 'dev')}>
                <Play className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Launch dev server (npm run dev)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => handleLaunch(e, 'shell')}>
                <Monitor className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open terminal in project directory</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={e => {
                  e.stopPropagation()
                  openFolder.mutate(project.id, { onSuccess: () => toast.success('Opened folder') })
                }}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open in file manager</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  )
}
