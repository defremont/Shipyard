import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileCode, Loader2, Eye, Code, GitCompareArrows } from 'lucide-react'
import { toast } from 'sonner'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { EditorTabBar } from './EditorTabBar'
import { CodeMirrorEditor } from './CodeMirrorEditor'
import { DiffEditor } from './DiffEditor'
import { useSaveFile } from '@/hooks/useFiles'
import { api } from '@/lib/api'
import { useGitFileAtRef } from '@/hooks/useGit'
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
  const queryClient = useQueryClient()
  const [isLoading, setIsLoading] = useState(tab.needsFetch)
  const [error, setError] = useState<Error | null>(null)

  // Always fetch fresh from disk, bypassing the react-query cache. Relying on
  // the cached query meant files edited externally (e.g. by Claude Code) kept
  // showing stale content even after closing and reopening the tab.
  useEffect(() => {
    if (!tab.needsFetch) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    api.getFileContent(projectId, tab.path)
      .then((data) => {
        if (cancelled) return
        queryClient.setQueryData(['files', 'content', projectId, tab.path], data)
        onInit(tab.path, data.content)
      })
      .catch((err) => {
        if (cancelled) return
        // For diff-mode tabs (staged/unstaged), a missing file just means "no
        // working tree content" — typically a deleted file. Treat the fetch as
        // empty so the diff view can still render the original side from git.
        if (tab.diffMode) {
          onInit(tab.path, '')
        } else {
          setError(err as Error)
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [projectId, tab.path, tab.needsFetch, tab.diffMode, onInit, queryClient])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && !tab.diffMode) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-red-400">
        Failed to load file: {(error as Error).message}
      </div>
    )
  }

  return null
}

function DiffTabContent({ projectId, tab }: { projectId: string; tab: EditorTab }) {
  const isStaged = tab.diffMode === 'staged'
  // Staged diff: HEAD (original) ↔ index "‌:0" (modified — what would be committed).
  // Unstaged diff: index "‌:0" (original — what's already staged, falls back to HEAD
  // when the file isn't staged) ↔ working tree content (modified — `tab.content`).
  const originalRef = isStaged ? 'HEAD' : ':0'
  const { data: originalData, isLoading: originalLoading } = useGitFileAtRef(
    projectId,
    tab.path,
    originalRef,
    tab.subrepo,
  )
  // For the staged view we also need to read what's in the index; for unstaged
  // we just compare against the working tree the editor already loaded.
  const { data: stagedData, isLoading: stagedLoading } = useGitFileAtRef(
    projectId,
    isStaged ? tab.path : undefined,
    ':0',
    tab.subrepo,
  )

  if ((isStaged ? stagedLoading : false) || originalLoading || tab.needsFetch) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const original = originalData?.content ?? ''
  const modified = isStaged ? (stagedData?.content ?? '') : tab.content

  return (
    <DiffEditor
      original={original}
      modified={modified}
      extension={tab.extension}
    />
  )
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

      {/* Toolbar: markdown preview toggle + diff mode indicator */}
      {activeTab && !activeTab.needsFetch && (isMarkdown || activeTab.diffMode) && (
        <div className="flex items-center gap-1 px-2 py-1 border-b bg-card/50 shrink-0">
          {isMarkdown && (
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
          )}
          {activeTab.diffMode && (
            <div className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              <GitCompareArrows className="h-3.5 w-3.5 text-blue-400" />
              <span>Diff: HEAD vs {activeTab.diffMode === 'staged' ? 'staged' : 'working tree'}</span>
            </div>
          )}
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
              ) : tab.diffMode ? (
                <DiffTabContent projectId={projectId} tab={tab} />
              ) : showPreview ? (
                <div className="h-full overflow-auto scrollbar-dark p-6">
                  <div className="prose prose-invert prose-sm max-w-none">
                    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>{tab.content}</Markdown>
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
