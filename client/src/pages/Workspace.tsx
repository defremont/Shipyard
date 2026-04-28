import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { TaskBoard } from '@/components/tasks/TaskBoard'
import { useProjects, useUpdateProject } from '@/hooks/useProjects'
import { Badge } from '@/components/ui/badge'
import {
  GitBranch, Star, ExternalLink, Link2, Settings, Code2, LayoutList
} from 'lucide-react'
import { EditorPanel } from '@/components/editor/EditorPanel'
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditorTabsContext } from '@/hooks/useEditorTabsContext'
import { useActiveMilestone } from '@/hooks/useMilestones'

export function Workspace() {
  const { projectId } = useParams<{ projectId: string }>()
  const { data: projects } = useProjects()
  const updateProject = useUpdateProject()
  const project = projects?.find(p => p.id === projectId)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<string | undefined>()
  const [workspaceMode, _setWorkspaceMode] = useState<'tasks' | 'editor'>(() => {
    const saved = localStorage.getItem(`shipyard:workspace-mode:${projectId}`)
    return saved === 'editor' ? 'editor' : 'tasks'
  })

  const setWorkspaceMode = useCallback((mode: 'tasks' | 'editor') => {
    _setWorkspaceMode(mode)
    if (projectId) localStorage.setItem(`shipyard:workspace-mode:${projectId}`, mode)
  }, [projectId])

  useEffect(() => {
    if (!projectId) return
    const saved = localStorage.getItem(`shipyard:workspace-mode:${projectId}`)
    _setWorkspaceMode(saved === 'editor' ? 'editor' : 'tasks')
  }, [projectId])

  // Allow other parts of the app (the activity-bar Project Tasks shortcut) to
  // flip the workspace mode without going through the header toggle.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: 'tasks' | 'editor' }>).detail
      if (detail?.mode === 'tasks' || detail?.mode === 'editor') {
        setWorkspaceMode(detail.mode)
      }
    }
    window.addEventListener('shipyard:workspace-mode', handler)
    return () => window.removeEventListener('shipyard:workspace-mode', handler)
  }, [setWorkspaceMode])

  const { milestoneId, setMilestoneId } = useActiveMilestone(projectId || '')

  const editor = useEditorTabsContext()

  // Pick up cross-route file-open intents (e.g. clicking a file in Search while on another project)
  useEffect(() => {
    const raw = localStorage.getItem('shipyard:pending-editor-file')
    if (!raw || !projectId) return
    try {
      const pending = JSON.parse(raw)
      if (pending.projectId === projectId) {
        localStorage.removeItem('shipyard:pending-editor-file')
        editor.openFile(pending.path, pending.name, pending.extension, '', {
          diffMode: pending.diffMode,
          subrepo: pending.subrepo,
        })
        setWorkspaceMode('editor')
      }
    } catch {
      localStorage.removeItem('shipyard:pending-editor-file')
    }
  }, [projectId, editor, setWorkspaceMode])

  // Auto-switch to editor mode whenever a file tab is opened from elsewhere
  const activeTabPath = editor.activeTabPath
  useEffect(() => {
    if (activeTabPath && workspaceMode !== 'editor') {
      setWorkspaceMode('editor')
    }
    // intentionally only react to activeTabPath changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabPath])

  const openSettings = useCallback((tab?: string) => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Project not found. Try refreshing projects.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* ── Header bar ── */}
      <div className="h-10 px-4 flex items-center gap-2 border-b shrink-0 bg-card/30">
        <button
          onClick={() => updateProject.mutate({ id: project.id, favorite: !project.favorite })}
          className="shrink-0"
        >
          <Star className={cn(
            'h-3.5 w-3.5 transition-colors',
            project.favorite ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground/20 hover:text-yellow-500'
          )} />
        </button>
        <span className="text-[13px] font-medium text-foreground shrink-0">{project.name}</span>

        {project.isGitRepo && project.gitBranch && (
          <Badge variant="outline" className="text-[10px] gap-1 font-mono h-5">
            <GitBranch className="h-2.5 w-2.5" />
            {project.gitBranch}
            {project.gitDirty && ' *'}
          </Badge>
        )}

        {project.category !== 'root' && (
          <span className="text-[10px] text-muted-foreground/30 shrink-0 hidden lg:block">{project.category}</span>
        )}

        <span className="text-[10px] text-muted-foreground/20 truncate hidden xl:block">{project.path}</span>

        {/* Mode toggle */}
        <div className="flex items-center ml-auto shrink-0">
          <div className="flex items-center h-7 rounded-md border bg-muted/30 p-0.5">
            <button
              onClick={() => setWorkspaceMode('tasks')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 h-6 rounded text-[11px] font-medium transition-colors',
                workspaceMode === 'tasks'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <LayoutList className="h-3 w-3" />
              Tasks
            </button>
            <button
              onClick={() => setWorkspaceMode('editor')}
              className={cn(
                'flex items-center gap-1.5 px-2.5 h-6 rounded text-[11px] font-medium transition-colors',
                workspaceMode === 'editor'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Code2 className="h-3 w-3" />
              Editor
            </button>
          </div>
        </div>

        {/* Right: links + settings */}
        <div className="flex items-center gap-0.5 shrink-0 ml-3">
          {project.gitRemoteUrl && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a href={project.gitRemoteUrl} target="_blank" rel="noopener noreferrer"
                  className="p-1.5 rounded-md text-muted-foreground/30 hover:text-foreground hover:bg-accent transition-colors">
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </TooltipTrigger>
              <TooltipContent>Repository</TooltipContent>
            </Tooltip>
          )}
          {project.externalLink && (
            <Tooltip>
              <TooltipTrigger asChild>
                <a href={project.externalLink} target="_blank" rel="noopener noreferrer"
                  className="p-1.5 rounded-md text-blue-500/40 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
                  <Link2 className="h-3.5 w-3.5" />
                </a>
              </TooltipTrigger>
              <TooltipContent>{project.externalLink}</TooltipContent>
            </Tooltip>
          )}

          {(project.gitRemoteUrl || project.externalLink) && <div className="w-px h-4 bg-border mx-0.5" />}

          <button
            onClick={() => openSettings()}
            className="p-1.5 rounded-md text-muted-foreground/30 hover:text-foreground hover:bg-accent transition-colors"
            title="Project settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-hidden flex min-h-0">
        <div className={cn(
          'flex-1 min-w-0 flex flex-col',
          workspaceMode === 'tasks' && 'overflow-y-auto px-4 py-4 lg:px-6 scrollbar-dark'
        )}>
          {workspaceMode === 'tasks' ? (
            <TaskBoard
              projectId={project.id}
              projectName={project.name}
              projectPath={project.path}
              milestoneId={milestoneId}
              onMilestoneChange={setMilestoneId}
              onOpenSettings={openSettings}
            />
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
      </div>

      <ProjectSettingsDialog project={project} open={settingsOpen} onOpenChange={setSettingsOpen} defaultTab={settingsTab} />
    </div>
  )
}
