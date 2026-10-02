import { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { TaskBoard } from '@/components/tasks/TaskBoard'
import { useProjects, useUpdateProject, useLaunchTerminal, useOpenFolder } from '@/hooks/useProjects'
import {
  GitBranch, Star, ExternalLink, Link2, Settings, Code2, LayoutList,
  Play, Monitor, FolderOpen, Sparkles, MoreHorizontal, PanelLeft, SquareTerminal,
} from 'lucide-react'
// CodeMirror and its language modes only matter once the user opens a file.
const EditorPanel = lazy(() =>
  import('@/components/editor/EditorPanel').then(m => ({ default: m.EditorPanel }))
)
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProjectContextMenu } from '@/components/projects/ProjectContextMenu'
import { useProjectLaunch } from '@/hooks/useProjectLaunch'
import { useEditorTabsContext } from '@/hooks/useEditorTabsContext'
import { useActiveMilestone } from '@/hooks/useMilestones'
import { useTerminalStatus } from '@/hooks/useTerminal'
import { layoutStore, useLayoutMode } from '@/hooks/useLayoutMode'
import { ExplorerView } from '@/components/layout/views/ExplorerView'
import { useActivity } from '@/hooks/useActivity'
import { DeployBadge } from '@/components/deploy/DeployBadge'
import { toast } from 'sonner'

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
  // Launching lives in one hook so the toolbar, the dashboard cards, the
  // sidebar and the context menus all behave the same way — including the
  // shared `--dangerously-skip-permissions` preference.
  const { skipPermissions, setSkipPermissions, launchClaude } = useProjectLaunch()

  const setWorkspaceMode = useCallback((mode: 'tasks' | 'editor') => {
    _setWorkspaceMode(mode)
    if (projectId) localStorage.setItem(`shipyard:workspace-mode:${projectId}`, mode)
    // Asking for Tasks or Editor means wanting to see it: in focus layout the
    // terminal gives the space back (TerminalPanel listens).
    window.dispatchEvent(new CustomEvent('shipyard:focus-workspace'))
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

  const launchTerminal = useLaunchTerminal()
  const openFolder = useOpenFolder()
  const { data: terminalStatus } = useTerminalStatus()
  const hasIntegrated = terminalStatus?.available ?? false

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

  const openSettings = useCallback((tab?: string) => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])

  const handleLaunch = useCallback((type: string, label: string) => {
    if (!projectId) return
    if (hasIntegrated) {
      window.dispatchEvent(new CustomEvent('shipyard:open-terminal', { detail: { projectId, type } }))
      return
    }
    launchTerminal.mutate(
      { projectId, type },
      { onSuccess: () => toast.success(`Launched ${label}`) }
    )
  }, [projectId, launchTerminal, hasIntegrated])

  const handleOpenFolder = useCallback(() => {
    if (!projectId) return
    openFolder.mutate(projectId, { onSuccess: () => toast.success('Opened folder') })
  }, [projectId, openFolder])

  // Focus layout: an open terminal has the work area. Only the toolbar stays,
  // with neither mode lit — clicking one brings the workspace back.
  const { terminalFull, taskRail } = useLayoutMode()
  const { activity, panelOpen, selectActivity } = useActivity()
  const gitOpen = panelOpen && activity === 'git'

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Project not found. Try refreshing projects.
      </div>
    )
  }

  const hasGit = project.isGitRepo || (project.subRepos?.length ?? 0) > 0
  const gitChanges = (project.gitStaged ?? 0) + (project.gitUnstaged ?? 0) + (project.gitUntracked ?? 0)

  return (
    <div className={cn('overflow-hidden flex flex-col', !terminalFull && 'flex-1')}>
      {/* ── Project toolbar ──
          One row for the project and its sessions: the task rail toggle, the
          session tabs (TerminalPanel draws them into the slot), the two full
          views and the project state. The project name is not repeated here —
          the project tab already says it. */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b bg-card/30 px-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => layoutStore.setTaskRail(!taskRail)}
              aria-pressed={taskRail}
              className={cn(
                'flex h-6 shrink-0 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors',
                taskRail
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/80'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <PanelLeft className="h-3 w-3" />
              Tasks
            </button>
          </TooltipTrigger>
          <TooltipContent>Task list beside the agents</TooltipContent>
        </Tooltip>

        <div className="h-4 w-px shrink-0 bg-border" />

        {/* Session tabs land here */}
        <div ref={layoutStore.setTabSlot} className="flex min-w-0 flex-1 items-center" />

        {/* Full views */}
        <div className="flex shrink-0 items-center">
          <div className="flex h-7 items-center rounded-md border bg-muted/30 p-0.5">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent('shipyard:show-terminal'))}
              className={cn(
                'flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors',
                terminalFull
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <SquareTerminal className="h-3 w-3" />
              Agents
            </button>
            <button
              onClick={() => setWorkspaceMode('tasks')}
              className={cn(
                'flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors',
                workspaceMode === 'tasks' && !terminalFull
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <LayoutList className="h-3 w-3" />
              Board
            </button>
            <button
              onClick={() => setWorkspaceMode('editor')}
              className={cn(
                'flex h-6 items-center gap-1.5 rounded px-2.5 text-[11px] font-medium transition-colors',
                workspaceMode === 'editor' && !terminalFull
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Code2 className="h-3 w-3" />
              Editor
            </button>
          </div>
        </div>

        {/* Git is a chip, not a column: branch and what is uncommitted at a
            glance, the whole panel one click away as a drawer. */}
        {hasGit && (
          <button
            onClick={() => selectActivity('git')}
            title="Source control"
            className={cn(
              'hidden h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors hover:bg-accent min-[1000px]:flex',
              gitOpen ? 'bg-accent text-foreground' : 'text-muted-foreground'
            )}
          >
            <GitBranch className="h-3 w-3" />
            <span className="max-w-[120px] truncate font-mono text-[10px]">
              {project.gitBranch || `${project.subRepos?.length ?? 0} repos`}
            </span>
            {project.isGitRepo && (gitChanges > 0
              ? <span className="tabular-nums text-warning">{gitChanges} changed</span>
              : <span className="text-muted-foreground/70">clean</span>)}
          </button>
        )}

        {/* Nothing is drawn when the project has no deploy linked */}
        <DeployBadge projectId={project.id} />

        {/* Claude is the core workflow — one click, no popover in the way.
            Right-click offers the YOLO variant and the rest of the project
            actions. */}
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Both triggers clone their child, so each needs a real DOM node to
              attach to — the span is what the context menu binds to. */}
          <ProjectContextMenu project={project} onOpenSettings={() => openSettings()}>
            <span className="inline-flex">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => launchClaude(project)}
                    className="flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    <Sparkles className="h-3 w-3 text-muted-foreground" />
                    {skipPermissions ? 'Claude YOLO' : 'Claude'}
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {skipPermissions ? 'Open Claude Code, skipping permissions' : 'Open Claude Code'} · right-click for more
                </TooltipContent>
              </Tooltip>
            </span>
          </ProjectContextMenu>
        </div>

        {/* Everything secondary lives in one overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-accent transition-colors shrink-0">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuCheckboxItem
              checked={skipPermissions}
              onCheckedChange={setSkipPermissions}
            >
              Skip permissions (YOLO)
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem onClick={() => updateProject.mutate({ id: project.id, favorite: !project.favorite })}>
              <Star className={cn(project.favorite && 'fill-warning text-warning')} />
              {project.favorite ? 'Remove from favorites' : 'Add to favorites'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => handleLaunch('dev', 'Dev Server')}>
              <Play />
              Dev Server
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleLaunch('shell', 'Shell')}>
              <Monitor />
              Shell
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleOpenFolder}>
              <FolderOpen />
              Open Folder
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {project.gitRemoteUrl && (
              <DropdownMenuItem onClick={() => window.open(project.gitRemoteUrl, '_blank', 'noopener,noreferrer')}>
                <ExternalLink />
                Repository
              </DropdownMenuItem>
            )}
            {project.externalLink ? (
              <DropdownMenuItem onClick={() => window.open(project.externalLink, '_blank', 'noopener,noreferrer')}>
                <Link2 />
                Open Cloud
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => openSettings('links')}>
                <Link2 />
                Set cloud link…
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openSettings()}>
              <Settings />
              Project settings…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* ── Main content ── */}
      <div className={cn('flex-1 overflow-hidden min-h-0', terminalFull ? 'hidden' : 'flex')}>
        {/* The editor brings its own left column: the file tree. (The task
            rail belongs to the agents view — Layout puts it there.) */}
        {workspaceMode === 'editor' && !terminalFull && (
          <aside className="anim-slide flex w-[260px] shrink-0 flex-col overflow-hidden border-r bg-card/40">
            <ExplorerView />
          </aside>
        )}
        <div className={cn(
          'flex-1 min-w-0 flex flex-col',
          workspaceMode === 'tasks' && 'overflow-y-auto px-3 py-2 scrollbar-dark'
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
            <Suspense fallback={null}>
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
            </Suspense>
          )}
        </div>
      </div>

      <ProjectSettingsDialog project={project} open={settingsOpen} onOpenChange={setSettingsOpen} defaultTab={settingsTab} />
    </div>
  )
}
