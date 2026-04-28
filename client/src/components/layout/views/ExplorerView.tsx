import { useCallback } from 'react'
import { Files } from 'lucide-react'
import { useTabs } from '@/hooks/useTabs'
import { useProjects } from '@/hooks/useProjects'
import { FileExplorer } from '@/components/files/FileExplorer'
import { useEditorTabsContext } from '@/hooks/useEditorTabsContext'

export function ExplorerView() {
  const { activeTabId } = useTabs()
  const { data: projects } = useProjects()
  const project = projects?.find(p => p.id === activeTabId)
  const editor = useEditorTabsContext()

  const handleOpenInEditor = useCallback((path: string, name: string, extension: string) => {
    if (!activeTabId) return
    editor.openFileForProject(activeTabId, path, name, extension)
  }, [activeTabId, editor])

  if (!project) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center">
        <Files className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">
          Open a project to browse its files.
        </p>
      </div>
    )
  }

  return (
    <div className="h-full px-2 py-2">
      <FileExplorer
        projectId={project.id}
        projectPath={project.path}
        onOpenInEditor={handleOpenInEditor}
        activeFilePath={editor.activeTabPath}
      />
    </div>
  )
}
