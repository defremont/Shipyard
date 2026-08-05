import { useState, useCallback, useEffect, useRef, lazy, Suspense } from 'react'
import { useParams } from 'react-router-dom'
import { TaskBoard } from '@/components/tasks/TaskBoard'
import { useProjects, useUpdateProject, useLaunchTerminal, useOpenFolder } from '@/hooks/useProjects'
import { Badge } from '@/components/ui/badge'
import {
  GitBranch, Star, ExternalLink, Link2, Settings, Code2, LayoutList,
  Play, Monitor, FolderOpen, Sparkles, MoreHorizontal,
} from 'lucide-react'
// CodeMirror and its language modes only matter once the user opens a file.
const EditorPanel = lazy(() =>
  import('@/components/editor/EditorPanel').then(m => ({ default: m.EditorPanel }))
)
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useEditorTabsContext } from '@/hooks/useEditorTabsContext'
import { useActiveMilestone } from '@/hooks/useMilestones'
import { useTerminalStatus } from '@/hooks/useTerminal'
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
  // Shared with TerminalLauncher via the same localStorage key — the launcher
  // sidebar and the toolbar agree on whether `--dangerously-skip-permissions`
  // is on for Claude Code launches in this project.
  const [skipPermissions, setSkipPermissions] = useState(() => {
    try { return localStorage.getItem('shipyard:skipPermissions') === 'true' } catch { return false }
  })
  const [claudePopoverOpen, setClaudePopoverOpen] = useState(false)

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

  // Auto-switch to editor mode only when a file tab is opened *after* mount
  // (e.g. clicking a file in the file tree or git diff). We must NOT switch on
  // the initial activeTabPath value, since it can come from persisted tabs and
  // would override the user's last-selected workspace mode for this project.
  const activeTabPath = editor.activeTabPath
  // `undefined` = baseline not yet captured for the current project. After a
  // project change, useEditorTabs lags one render before activeTabPath reflects
  // the new project's persisted value, so we discard that first observation
  // instead of treating it as a user file-open.
  const lastSeenTabPath = useRef<string | null | undefined>(undefined)
  const lastSeenProjectId = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (lastSeenProjectId.current !== projectId) {
      lastSeenProjectId.current = projectId
      lastSeenTabPath.current = undefined
      return
    }
    if (lastSeenTabPath.current === undefined) {
      lastSeenTabPath.current = activeTabPath
      return
    }
    if (
      activeTabPath &&
      activeTabPath !== lastSeenTabPath.current &&
      workspaceMode !== 'editor'
    ) {
      setWorkspaceMode('editor')
    }
    lastSeenTabPath.current = activeTabPath
    // intentionally only react to activeTabPath / projectId changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabPath, projectId])

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

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Project not found. Try refreshing projects.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      {/* ── Project toolbar ── */}
      <div className="h-10 px-4 flex items-center gap-2 border-b shrink-0 bg-card/30">
        {/* Identity */}
        <button
          onClick={() => updateProject.mutate({ id: project.id, favorite: !project.favorite })}
          className="shrink-0"
        >
          <Star className={cn(
            'h-3.5 w-3.5 transition-colors',
            project.favorite ? 'fill-warning text-warning' : 'text-muted-foreground/20 hover:text-warning'
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

        {/* Claude is the core workflow — the only always-visible action */}
        <div className="flex items-center gap-0.5 shrink-0 ml-2">
          <Popover open={claudePopoverOpen} onOpenChange={setClaudePopoverOpen}>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <button
                    className={cn(
                      'p-1.5 rounded-md hover:bg-accent transition-colors relative',
                      skipPermissions
                        ? 'text-warning/90 hover:text-warning'
                        : 'text-muted-foreground/40 hover:text-primary',
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {skipPermissions && (
                      <span className="absolute -top-0.5 -right-0.5 text-[8px] font-bold text-warning leading-none">Y</span>
                    )}
                  </button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent>{skipPermissions ? 'Claude Code (YOLO)' : 'Claude Code'}</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-56 p-2" align="end">
              <button
                onClick={() => {
                  setClaudePopoverOpen(false)
                  handleLaunch(skipPermissions ? 'claude-yolo' : 'claude', 'Claude Code')
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
              >
                <Sparkles className={cn('h-3.5 w-3.5', skipPermissions ? 'text-warning' : 'text-primary')} />
                <span className="font-medium">Open Claude Code{skipPermissions ? ' (YOLO)' : ''}</span>
              </button>
              <div className="border-t my-1" />
              <label className="flex items-start gap-2 px-2 py-1.5 text-xs rounded-md hover:bg-accent cursor-pointer">
                <input
                  type="checkbox"
                  checked={skipPermissions}
                  onChange={(e) => {
                    const next = e.target.checked
                    setSkipPermissions(next)
                    try { localStorage.setItem('shipyard:skipPermissions', String(next)) } catch { /* ignore */ }
                  }}
                  className="mt-0.5 h-3.5 w-3.5"
                />
                <div className="flex-1">
                  <div className="font-medium">YOLO mode</div>
                  <div className="text-[10px] text-muted-foreground">
                    Launches Claude with <code>--dangerously-skip-permissions</code>.
                  </div>
                </div>
              </label>
            </PopoverContent>
          </Popover>
        </div>

        {/* Everything secondary lives in one overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1.5 rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-accent transition-colors shrink-0">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
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
      <div className="flex-1 overflow-hidden flex min-h-0">
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
