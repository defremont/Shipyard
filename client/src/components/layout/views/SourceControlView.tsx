import { useCallback } from 'react'
import { GitBranch } from 'lucide-react'
import { useTabs } from '@/hooks/useTabs'
import { useProjects } from '@/hooks/useProjects'
import { GitPanel } from '@/components/git/GitPanel'
import { useEditorTabsContext } from '@/hooks/useEditorTabsContext'

export function SourceControlView() {
  const { activeTabId } = useTabs()
  const { data: projects } = useProjects()
  const project = projects?.find(p => p.id === activeTabId)
  const editor = useEditorTabsContext()

  const handleOpenInEditor = useCallback((path: string, name: string, extension: string) => {
    if (!activeTabId) return
    editor.openFileForProject(activeTabId, path, name, extension)
  }, [activeTabId, editor])

  const handleOpenDiffInEditor = useCallback(
    (path: string, name: string, extension: string, diffMode: 'staged' | 'unstaged', subrepo?: string) => {
      if (!activeTabId) return
      editor.openFileForProject(activeTabId, path, name, extension, { diffMode, subrepo })
    },
    [activeTabId, editor]
  )

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">
          Open a project to see its git status, stage and commit changes.
        </p>
      </div>
    )
  }

  const hasGit = project.isGitRepo || (project.subRepos && project.subRepos.length > 0)
  if (!hasGit) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <GitBranch className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{project.name}</span> isn't a git repository.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-dark px-3 py-2">
      <GitPanel
        projectId={project.id}
        subRepos={project.subRepos}
        isGitRepo={project.isGitRepo}
        onOpenInEditor={handleOpenInEditor}
        onOpenDiffInEditor={handleOpenDiffInEditor}
        activeFilePath={editor.activeTabPath}
      />
    </div>
  )
}
