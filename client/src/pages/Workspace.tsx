import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { TaskBoard } from '@/components/tasks/TaskBoard'
import { GitPanel } from '@/components/git/GitPanel'
import { TerminalLauncher } from '@/components/terminals/TerminalLauncher'
import { useProjects, useUpdateProject } from '@/hooks/useProjects'
import { Badge } from '@/components/ui/badge'
import { GitBranch, Star, ExternalLink, Link2, Settings, Code2, LayoutList } from 'lucide-react'
import { FileExplorer } from '@/components/files/FileExplorer'
import { EditorPanel } from '@/components/editor/EditorPanel'
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditorTabs } from '@/hooks/useEditorTabs'

export function Workspace() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: projects } = useProjects()
  const updateProject = useUpdateProject()
  const project = projects?.find(p => p.id === projectId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [workspaceMode, setWorkspaceMode] = useState<'tasks' | 'editor'>('tasks')

  const editor = useEditorTabs(projectId || '')

  // Check for pending file from GlobalSearch
  useEffect(() => {
    const raw = localStorage.getItem('shipyard:pending-editor-file')
    if (!raw || !projectId) return
    try {
      const pending = JSON.parse(raw)
      if (pending.projectId === projectId) {
        localStorage.removeItem('shipyard:pending-editor-file')
        editor.openFile(pending.path, pending.name, pending.extension, '')
        setWorkspaceMode('editor')
      }
    } catch {
      localStorage.removeItem('shipyard:pending-editor-file')
    }
  }, [projectId, editor])

  const handleOpenInEditor = useCallback((path: string, name: string, extension: string) => {
    editor.openFile(path, name, extension, '')
    setWorkspaceMode('editor')
  }, [editor])

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
        {/* Main area */}
        <div className={cn(
          "flex-1 min-w-0 flex flex-col",
          workspaceMode === 'tasks' && 'overflow-y-auto p-4 lg:p-6 scrollbar-dark'
        )}>
          {/* Compact project info bar */}
          <div className={cn(
            "flex items-center gap-3 shrink-0",
            workspaceMode === 'tasks' ? 'mb-4' : 'px-4 py-2 border-b'
          )}>
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
            <div className="flex items-center gap-1 ml-auto">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setWorkspaceMode(workspaceMode === 'tasks' ? 'editor' : 'tasks')}
                    className={cn(
                      'shrink-0 p-1 rounded transition-colors',
                      workspaceMode === 'editor'
                        ? 'text-blue-400 bg-blue-500/10 hover:bg-blue-500/20'
                        : 'text-muted-foreground/30 hover:text-foreground'
                    )}
                  >
                    {workspaceMode === 'editor'
                      ? <LayoutList className="h-3.5 w-3.5" />
                      : <Code2 className="h-3.5 w-3.5" />
                    }
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {workspaceMode === 'editor' ? 'Switch to Tasks' : 'Switch to Editor'}
                </TooltipContent>
              </Tooltip>
              <button
                onClick={() => setSettingsOpen(true)}
                className="shrink-0 text-muted-foreground/30 hover:text-foreground transition-colors p-1"
                title="Project settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Content area */}
          {workspaceMode === 'tasks' ? (
            <TaskBoard projectId={project.id} projectName={project.name} projectPath={project.path} />
          ) : (
            <EditorPanel
              projectId={project.id}
              tabs={editor.tabs}
              activeTabPath={editor.activeTabPath}
              onSelectTab={editor.setActiveTab}
              onCloseTab={editor.closeTab}
              onContentChange={editor.setContent}
              onMarkSaved={editor.markSaved}
              onInitContent={editor.initContent}
            />
          )}
        </div>

        {/* Sidebar - 1/4 width */}
        <div className="w-64 lg:w-72 xl:w-80 2xl:w-[22rem] border-l overflow-y-auto p-4 space-y-6 shrink-0 bg-card/50 scrollbar-dark">
          <TerminalLauncher projectId={project.id} projectPath={project.path} projectName={project.name} />
          <FileExplorer projectId={project.id} projectPath={project.path} onOpenInEditor={handleOpenInEditor} />
          {project.isGitRepo && (
            <GitPanel projectId={project.id} onOpenInEditor={handleOpenInEditor} />
          )}
        </div>
      </div>

      <ProjectSettingsDialog project={project} open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
