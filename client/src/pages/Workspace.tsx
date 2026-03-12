import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { TaskBoard } from '@/components/tasks/TaskBoard'
import { GitPanel } from '@/components/git/GitPanel'
import { TerminalLauncher } from '@/components/terminals/TerminalLauncher'
import { ChatPanel } from '@/components/claude/ChatPanel'
import { useProjects, useUpdateProject } from '@/hooks/useProjects'
import { Badge } from '@/components/ui/badge'
import { GitBranch, Star, ExternalLink, Link2, Settings } from 'lucide-react'
import { FileExplorer } from '@/components/files/FileExplorer'
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function Workspace() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: projects } = useProjects()
  const updateProject = useUpdateProject()
  const project = projects?.find(p => p.id === projectId)
  const [settingsOpen, setSettingsOpen] = useState(false)

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Project not found. Try refreshing projects.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="flex-1 overflow-hidden flex min-h-0">
        {/* Tasks - main area */}
        <div className="flex-1 overflow-y-auto p-6 min-w-0 scrollbar-dark">
          {/* Compact project info bar */}
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => updateProject.mutate({ id: project.id, favorite: !project.favorite })}
              className="shrink-0"
            >
              <Star className={cn(
                'h-4 w-4 transition-colors',
                project.favorite
                  ? 'fill-yellow-500 text-yellow-500'
                  : 'text-muted-foreground/30 hover:text-yellow-500'
              )} />
            </button>
            <span className="text-xs font-medium text-foreground shrink-0">{project.name}</span>
            <span className="text-muted-foreground/30">·</span>
            <p className="text-xs text-muted-foreground truncate">{project.path}</p>
            {project.isGitRepo && project.gitBranch && (
              <Badge variant="outline" className="text-[10px] shrink-0 gap-1">
                <GitBranch className="h-2.5 w-2.5" />
                {project.gitBranch}
                {project.gitDirty && ' *'}
              </Badge>
            )}
            {project.gitRemoteUrl && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={project.gitRemoteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-muted-foreground/40 hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>Open repository</TooltipContent>
              </Tooltip>
            )}
            {project.externalLink && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <a
                    href={project.externalLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-blue-500/60 hover:text-blue-400 transition-colors"
                  >
                    <Link2 className="h-3.5 w-3.5" />
                  </a>
                </TooltipTrigger>
                <TooltipContent>{project.externalLink}</TooltipContent>
              </Tooltip>
            )}
            <button
              onClick={() => setSettingsOpen(true)}
              className="shrink-0 text-muted-foreground/30 hover:text-foreground transition-colors ml-auto"
              title="Project settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
          <TaskBoard projectId={project.id} projectName={project.name} projectPath={project.path} />
        </div>

        {/* Sidebar - 1/4 width */}
        <div className="w-72 xl:w-80 border-l overflow-y-auto p-4 space-y-6 shrink-0 bg-card/50 scrollbar-dark">
          <TerminalLauncher projectId={project.id} projectPath={project.path} projectName={project.name} />
          <ChatPanel projectId={project.id} />
          <FileExplorer projectId={project.id} projectPath={project.path} />
          {project.isGitRepo && (
            <GitPanel projectId={project.id} />
          )}
        </div>
      </div>

      <ProjectSettingsDialog project={project} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
