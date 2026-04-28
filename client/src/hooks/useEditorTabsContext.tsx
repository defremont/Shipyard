import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { useTabs } from './useTabs'
import { useEditorTabs, type EditorTab } from './useEditorTabs'

interface EditorTabsContextValue {
  projectId: string
  tabs: EditorTab[]
  activeTabPath: string | null
  openFile: (path: string, name: string, extension: string, content: string, options?: { diffMode?: 'staged' | 'unstaged'; subrepo?: string }) => void
  initContent: (path: string, content: string) => void
  closeTab: (path: string) => void
  setContent: (path: string, content: string) => void
  markSaved: (path: string, content: string) => void
  setActiveTab: (path: string) => void
  hasDirtyTabs: boolean
  /** Open a file in the editor; if a different project is active, navigate to it first. */
  openFileForProject: (projectId: string, path: string, name: string, extension: string, options?: { diffMode?: 'staged' | 'unstaged'; subrepo?: string }) => void
}

const EditorTabsContext = createContext<EditorTabsContextValue | null>(null)

export function EditorTabsProvider({ children }: { children: ReactNode }) {
  const { activeTabId, openTab } = useTabs()
  const projectId = activeTabId || ''
  const editor = useEditorTabs(projectId)

  const openFileForProject = useCallback(
    (targetProjectId: string, path: string, name: string, extension: string, options?: { diffMode?: 'staged' | 'unstaged'; subrepo?: string }) => {
      if (targetProjectId === projectId) {
        editor.openFile(path, name, extension, '', options)
      } else {
        // Defer the open until the target project mounts
        localStorage.setItem('shipyard:pending-editor-file', JSON.stringify({
          projectId: targetProjectId, path, name, extension, ...options,
        }))
        openTab(targetProjectId)
      }
    },
    [projectId, editor, openTab]
  )

  return (
    <EditorTabsContext.Provider value={{ ...editor, projectId, openFileForProject }}>
      {children}
    </EditorTabsContext.Provider>
  )
}

export function useEditorTabsContext() {
  const ctx = useContext(EditorTabsContext)
  if (!ctx) throw new Error('useEditorTabsContext must be used within EditorTabsProvider')
  return ctx
}
