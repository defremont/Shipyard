import { useCallback, useEffect, useState } from 'react'
import { FileCode, Loader2, Eye, Code } from 'lucide-react'
import { toast } from 'sonner'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { EditorTabBar } from './EditorTabBar'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { useFileContent, useSaveFile } from '@/hooks/useFiles'
import type { EditorTab } from '@/hooks/useEditorTabs'

const MARKDOWN_EXTENSIONS = new Set(['.md', '.mdx'])

interface EditorPanelProps {
  projectId: string
  tabs: EditorTab[]
  activeTabPath: string | null
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
  onContentChange: (path: string, content: string) => void
  onMarkSaved: (path: string, content: string) => void
  onInitContent: (path: string, content: string) => void
}

function TabContentLoader({ projectId, tab, onInit }: { projectId: string; tab: EditorTab; onInit: (path: string, content: string) => void }) {
  const { data, isLoading, error } = useFileContent(projectId, tab.needsFetch ? tab.path : null)

  useEffect(() => {
    if (data && tab.needsFetch) {
      onInit(tab.path, data.content)
    }
  }, [data, tab.needsFetch, tab.path, onInit])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-red-400">
        Failed to load file: {(error as Error).message}
      </div>
    )
  }

  return null
}

export function EditorPanel({
  projectId,
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onContentChange,
  onMarkSaved,
  onInitContent,
}: EditorPanelProps) {
  const saveFile = useSaveFile()
  const [confirmClose, setConfirmClose] = useState<string | null>(null)
  const [previewPaths, setPreviewPaths] = useState<Set<string>>(new Set())
  const activeTab = tabs.find(t => t.path === activeTabPath)
  const isMarkdown = activeTab ? MARKDOWN_EXTENSIONS.has(activeTab.extension) : false
  const isPreview = activeTab ? previewPaths.has(activeTab.path) : false

  const togglePreview = useCallback(() => {
    if (!activeTab) return
    setPreviewPaths(prev => {
      const next = new Set(prev)
      if (next.has(activeTab.path)) {
        next.delete(activeTab.path)
      } else {
        next.add(activeTab.path)
      }
      return next
    })
  }, [activeTab])

  const handleSave = useCallback(() => {
    if (!activeTab || !activeTab.isDirty) return
    saveFile.mutate(
      { projectId, relPath: activeTab.path, content: activeTab.content },
      {
        onSuccess: () => {
          onMarkSaved(activeTab.path, activeTab.content)
          toast.success(`Saved ${activeTab.name}`)
        },
        onError: (err) => {
          toast.error(`Save failed: ${(err as Error).message}`)
        },
      }
    )
  }, [activeTab, projectId, saveFile, onMarkSaved])

  // Global Ctrl+S handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  const handleCloseTab = useCallback((path: string) => {
    const tab = tabs.find(t => t.path === path)
    if (tab?.isDirty) {
      setConfirmClose(path)
    } else {
      onCloseTab(path)
    }
  }, [tabs, onCloseTab])

  if (tabs.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <FileCode className="h-12 w-12 opacity-20" />
        <div className="text-sm">Open a file from the Files explorer to start editing</div>
        <div className="text-xs text-muted-foreground/60">Click any file in the tree to open it here</div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <EditorTabBar
        tabs={tabs}
        activeTabPath={activeTabPath}
        onSelectTab={onSelectTab}
        onCloseTab={handleCloseTab}
      />

      {/* Markdown preview toggle bar */}
      {isMarkdown && activeTab && !activeTab.needsFetch && (
        <div className="flex items-center gap-1 px-2 py-1 border-b bg-card/50 shrink-0">
          <button
            onClick={togglePreview}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-accent/50 transition-colors text-muted-foreground hover:text-foreground"
            title={isPreview ? 'Show code' : 'Show preview'}
          >
            {isPreview ? (
              <>
                <Code className="h-3.5 w-3.5" />
                <span>Code</span>
              </>
            ) : (
              <>
                <Eye className="h-3.5 w-3.5" />
                <span>Preview</span>
              </>
            )}
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {tabs.map(tab => {
          const showPreview = previewPaths.has(tab.path) && MARKDOWN_EXTENSIONS.has(tab.extension)
          return (
            <div
              key={tab.path}
              className={tab.path === activeTabPath ? 'h-full' : 'hidden'}
            >
              {tab.needsFetch ? (
                <TabContentLoader projectId={projectId} tab={tab} onInit={onInitContent} />
              ) : showPreview ? (
                <div className="h-full overflow-auto scrollbar-dark p-6">
                  <div className="prose prose-invert prose-sm max-w-none">
                    <Markdown remarkPlugins={[remarkGfm]}>{tab.content}</Markdown>
                  </div>
                </div>
              ) : (
                <CodeMirrorEditor
                  value={tab.content}
                  extension={tab.extension}
                  onChange={(val) => onContentChange(tab.path, val)}
                  onSave={handleSave}
                  readOnly={tab.extension ? ['application/octet-stream'].includes(tab.extension) : false}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Unsaved changes confirmation */}
      {confirmClose && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-card border rounded-lg p-4 max-w-sm space-y-3 shadow-lg">
            <p className="text-sm font-medium">Unsaved changes</p>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">{tabs.find(t => t.path === confirmClose)?.name}</span> has unsaved changes. Discard them?
            </p>
            <div className="flex gap-2 justify-end">
              <button
                className="px-3 py-1.5 text-xs rounded bg-accent hover:bg-accent/80 transition-colors"
                onClick={() => setConfirmClose(null)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-700 text-white transition-colors"
                onClick={() => {
                  onCloseTab(confirmClose)
                  setConfirmClose(null)
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
