import { useState, type ReactNode } from 'react'
import {
  LayoutList, Code2, Sparkles, Zap, Play, Monitor, FolderOpen, ExternalLink, Link2, Star, Settings,
} from 'lucide-react'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { ProjectSettingsDialog } from '@/components/projects/ProjectSettingsDialog'
import { useUpdateProject, type Project } from '@/hooks/useProjects'
import { useTabs } from '@/hooks/useTabs'
import { useProjectLaunch } from '@/hooks/useProjectLaunch'

interface ProjectContextMenuProps {
  project: Project
  children: ReactNode
  onOpenSettings?: () => void
  extra?: ReactNode
}

export function ProjectContextMenu({ project, children, onOpenSettings, extra }: ProjectContextMenuProps) {
  const { openTab, activeTabId } = useTabs()
  const { skipPermissions, launchClaude, launchDev, launchShell, openFolder } = useProjectLaunch()
  const updateProject = useUpdateProject()
  const [settingsOpen, setSettingsOpen] = useState(false)

  const openInEditor = () => {
    localStorage.setItem(`shipyard:workspace-mode:${project.id}`, 'editor')
    openTab(project.id)
    if (activeTabId === project.id) {
      window.dispatchEvent(new CustomEvent('shipyard:workspace-mode', { detail: { mode: 'editor' } }))
    }
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onClick={() => openTab(project.id)}>
            <LayoutList />
            Open Workspace
          </ContextMenuItem>
          <ContextMenuItem onClick={openInEditor}>
            <Code2 />
            Open in Editor
          </ContextMenuItem>
          <ContextMenuSeparator />
          {/* Spelling out both variants: with the shared YOLO preference on, a
              plain "Open Claude Code" would quietly skip permissions. */}
          <ContextMenuItem onClick={() => launchClaude(project, { skipPermissions: false })}>
            <Sparkles />
            Open Claude Code
          </ContextMenuItem>
          <ContextMenuItem onClick={() => launchClaude(project, { skipPermissions: true })}>
            <Zap />
            Open Claude Code (skip permissions){skipPermissions ? ' · default' : ''}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => launchDev(project)}>
            <Play />
            Dev Server
          </ContextMenuItem>
          <ContextMenuItem onClick={() => launchShell(project)}>
            <Monitor />
            Shell
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => openFolder(project)}>
            <FolderOpen />
            Open Folder
          </ContextMenuItem>
          {project.gitRemoteUrl && (
            <ContextMenuItem onClick={() => window.open(project.gitRemoteUrl, '_blank', 'noopener,noreferrer')}>
              <ExternalLink />
              Repository
            </ContextMenuItem>
          )}
          {project.externalLink && (
            <ContextMenuItem onClick={() => window.open(project.externalLink, '_blank', 'noopener,noreferrer')}>
              <Link2 />
              Open Cloud Link
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => updateProject.mutate({ id: project.id, favorite: !project.favorite })}>
            <Star />
            {project.favorite ? 'Remove from Favorites' : 'Add to Favorites'}
          </ContextMenuItem>
          <ContextMenuItem onClick={() => (onOpenSettings ? onOpenSettings() : setSettingsOpen(true))}>
            <Settings />
            Project Settings…
          </ContextMenuItem>
          {extra}
        </ContextMenuContent>
      </ContextMenu>
      {/* Mounted only once opened: this component renders once per project card,
          sidebar row and tab, and the dialog runs a polling tasks query. */}
      {!onOpenSettings && settingsOpen && (
        <ProjectSettingsDialog project={project} open onOpenChange={setSettingsOpen} />
      )}
    </>
  )
}
