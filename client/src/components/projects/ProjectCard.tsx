import { GitBranch, Star, Terminal, Code2, Play, Monitor, Clock, FolderOpen, Inbox, Loader, CheckCircle2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useLaunchTerminal, useLaunchVSCode, useOpenFolder, useUpdateProject, type Project } from '@/hooks/useProjects'
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
  const launchVSCode = useLaunchVSCode()
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

        {/* Git info: branch + dirty */}
        {project.isGitRepo && project.gitBranch && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <GitBranch className="h-3 w-3 shrink-0" />
            <span className="truncate">{project.gitBranch}</span>
            {project.gitDirty && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-yellow-500/50 text-yellow-500">
                uncommitted
              </Badge>
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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => handleLaunch(e, 'claude')} title="Claude Code">
            <Terminal className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => handleLaunch(e, 'dev')} title="Dev Server">
            <Play className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={e => handleLaunch(e, 'shell')} title="Shell">
            <Monitor className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={e => {
              e.stopPropagation()
              launchVSCode.mutate(project.id, { onSuccess: () => toast.success('Opened VS Code') })
            }}
            title="VS Code"
          >
            <Code2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={e => {
              e.stopPropagation()
              openFolder.mutate(project.id, { onSuccess: () => toast.success('Opened folder') })
            }}
            title="Open Folder"
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
