import { useState, useCallback, useRef, useEffect } from 'react'
import { ChevronDown, ChevronRight, MoreHorizontal, Eye, Pencil, Trash2, FolderOpen, Loader2, Copy, FolderTree, PenLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useFileTree, useDeleteFile, useOpenFileFolder, useRenameFile, type FileEntry } from '@/hooks/useFiles'
import { FileIcon } from './FileIcon'
import { FilePreviewDialog } from './FilePreviewDialog'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface FileExplorerProps {
  projectId: string
  projectPath: string
  onOpenInEditor?: (path: string, name: string, extension: string) => void
}

interface TreeNodeProps {
  entry: FileEntry
  projectId: string
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  onPreview: (path: string) => void
  onContextAction: (entry: FileEntry, action: 'delete' | 'open-folder' | 'copy-path' | 'rename') => void
  onOpenInEditor?: (path: string, name: string, extension: string) => void
  renamingPath: string | null
  onStartRename: (path: string) => void
  onFinishRename: (entry: FileEntry, newName: string) => void
  onCancelRename: () => void
}

function TreeNode({ entry, projectId, depth, expanded, onToggle, onPreview, onContextAction, onOpenInEditor, renamingPath, onStartRename, onFinishRename, onCancelRename }: TreeNodeProps) {
  const isOpen = expanded.has(entry.path)
  const { data, isLoading } = useFileTree(projectId, entry.path, entry.type === 'dir' && isOpen)
  const [contextOpen, setContextOpen] = useState(false)
  const isRenaming = renamingPath === entry.path
  const [renameValue, setRenameValue] = useState(entry.name)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isRenaming) {
      setRenameValue(entry.name)
      setTimeout(() => {
        if (renameInputRef.current) {
          renameInputRef.current.focus()
          // Select name without extension for files
          const dotIndex = entry.type === 'file' ? entry.name.lastIndexOf('.') : -1
          if (dotIndex > 0) {
            renameInputRef.current.setSelectionRange(0, dotIndex)
          } else {
            renameInputRef.current.select()
          }
        }
      }, 0)
    }
  }, [isRenaming, entry.name, entry.type])

  const handleRenameSubmit = () => {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === entry.name) {
      onCancelRename()
      return
    }
    onFinishRename(entry, trimmed)
  }

  const handleClick = () => {
    if (entry.type === 'dir') {
      onToggle(entry.path)
    } else if (onOpenInEditor && entry.mimeHint !== 'application/octet-stream' && !entry.mimeHint?.startsWith('image/')) {
      onOpenInEditor(entry.path, entry.name, entry.extension || '')
    } else {
      onPreview(entry.path)
    }
  }

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer group',
          'hover:bg-accent/50 transition-colors text-xs'
        )}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {/* Expand arrow (dirs only) */}
        <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0" onClick={handleClick}>
          {entry.type === 'dir' ? (
            isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />
          ) : null}
        </span>

        {/* Icon + Name */}
        {isRenaming ? (
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <FileIcon name={entry.name} extension={entry.extension} type={entry.type} isOpen={isOpen} className="h-3.5 w-3.5 shrink-0" />
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleRenameSubmit()
                if (e.key === 'Escape') onCancelRename()
                e.stopPropagation()
              }}
              onBlur={handleRenameSubmit}
              onClick={e => e.stopPropagation()}
              className="flex-1 min-w-0 bg-background border border-primary/50 rounded px-1 py-0 text-xs outline-none focus:border-primary"
            />
          </div>
        ) : (
          <button
            className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
            onClick={handleClick}
          >
            <FileIcon name={entry.name} extension={entry.extension} type={entry.type} isOpen={isOpen} className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{entry.name}</span>
            {entry.type === 'file' && entry.size !== undefined && entry.size > 100_000 && (
              <span className="text-[9px] text-muted-foreground/50 shrink-0">
                {entry.size > 1_048_576 ? `${(entry.size / 1_048_576).toFixed(1)}M` : `${Math.round(entry.size / 1024)}K`}
              </span>
            )}
          </button>
        )}

        {/* Context menu */}
        <Popover open={contextOpen} onOpenChange={setContextOpen}>
          <PopoverTrigger asChild>
            <button
              className="h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-all shrink-0"
              onClick={e => e.stopPropagation()}
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" side="right" align="start">
            {entry.type === 'file' && onOpenInEditor && entry.mimeHint !== 'application/octet-stream' && !entry.mimeHint?.startsWith('image/') && (
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors"
                onClick={() => { setContextOpen(false); onOpenInEditor(entry.path, entry.name, entry.extension || '') }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
            {entry.type === 'file' && (
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors"
                onClick={() => { setContextOpen(false); onPreview(entry.path) }}
              >
                <Eye className="h-3.5 w-3.5" /> Preview
              </button>
            )}
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors"
              onClick={() => { setContextOpen(false); onContextAction(entry, 'open-folder') }}
            >
              <FolderOpen className="h-3.5 w-3.5" /> Open in Explorer
            </button>
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors"
              onClick={() => { setContextOpen(false); onContextAction(entry, 'copy-path') }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy Path
            </button>
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors"
              onClick={() => { setContextOpen(false); onStartRename(entry.path) }}
            >
              <PenLine className="h-3.5 w-3.5" /> Rename
            </button>
            <div className="h-px bg-border my-1" />
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-red-500/10 text-red-400 transition-colors"
              onClick={() => { setContextOpen(false); onContextAction(entry, 'delete') }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </PopoverContent>
        </Popover>
      </div>

      {/* Children */}
      {entry.type === 'dir' && isOpen && (
        <div>
          {isLoading ? (
            <div className="flex items-center gap-1 py-1 text-xs text-muted-foreground" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Loading...</span>
            </div>
          ) : (
            data?.entries.map(child => (
              <TreeNode
                key={child.path}
                entry={child}
                projectId={projectId}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                onPreview={onPreview}
                onContextAction={onContextAction}
                onOpenInEditor={onOpenInEditor}
                renamingPath={renamingPath}
                onStartRename={onStartRename}
                onFinishRename={onFinishRename}
                onCancelRename={onCancelRename}
              />
            ))
          )}
          {!isLoading && data?.entries.length === 0 && (
            <div className="text-[10px] text-muted-foreground/40 py-0.5" style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}>
              empty
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function FileExplorer({ projectId, projectPath, onOpenInEditor }: FileExplorerProps) {
  const [sectionOpen, setSectionOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string; type: string } | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)

  const { data, isLoading } = useFileTree(projectId, '', sectionOpen)
  const deleteFile = useDeleteFile()
  const openFileFolder = useOpenFileFolder()
  const renameFile = useRenameFile()

  const handleToggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleFinishRename = useCallback((entry: FileEntry, newName: string) => {
    renameFile.mutate(
      { projectId, relPath: entry.path, newName },
      {
        onSuccess: () => {
          toast.success(`Renamed to ${newName}`)
          setRenamingPath(null)
        },
        onError: (err) => {
          toast.error(`Rename failed: ${(err as Error).message}`)
          setRenamingPath(null)
        },
      }
    )
  }, [projectId, renameFile])

  const handleContextAction = useCallback((entry: FileEntry, action: 'delete' | 'open-folder' | 'copy-path' | 'rename') => {
    switch (action) {
      case 'delete':
        setDeleteTarget({ path: entry.path, name: entry.name, type: entry.type })
        break
      case 'open-folder':
        openFileFolder.mutate({ projectId, relPath: entry.type === 'dir' ? entry.path : entry.path.replace(/[/\\][^/\\]+$/, '') || '' })
        break
      case 'copy-path':
        navigator.clipboard.writeText(entry.path)
        toast.success('Path copied')
        break
      case 'rename':
        setRenamingPath(entry.path)
        break
    }
  }, [projectId, openFileFolder])

  const confirmDelete = () => {
    if (!deleteTarget) return
    deleteFile.mutate(
      { projectId, relPath: deleteTarget.path },
      {
        onSuccess: () => {
          toast.success(`Deleted ${deleteTarget.name}`)
          setDeleteTarget(null)
        },
        onError: (err) => {
          toast.error(`Delete failed: ${(err as Error).message}`)
          setDeleteTarget(null)
        },
      }
    )
  }

  return (
    <div className="space-y-2">
      {/* Section header */}
      <button
        className="flex items-center justify-between w-full group"
        onClick={() => setSectionOpen(!sectionOpen)}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <FolderTree className="h-3.5 w-3.5" />
          Files
        </h2>
        <div className="flex items-center gap-1">
          {sectionOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
      </button>

      {/* Tree */}
      {sectionOpen && (
        <div className="max-h-72 overflow-y-auto scrollbar-dark rounded border border-border/50 bg-background/50">
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : data?.entries.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-4">No files found</div>
          ) : (
            <div className="py-1">
              {data?.entries.map(entry => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  projectId={projectId}
                  depth={0}
                  expanded={expanded}
                  onToggle={handleToggle}
                  onPreview={setPreviewPath}
                  onContextAction={handleContextAction}
                  onOpenInEditor={onOpenInEditor}
                  renamingPath={renamingPath}
                  onStartRename={setRenamingPath}
                  onFinishRename={handleFinishRename}
                  onCancelRename={() => setRenamingPath(null)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview dialog */}
      <FilePreviewDialog
        projectId={projectId}
        filePath={previewPath}
        onClose={() => setPreviewPath(null)}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type === 'dir' ? 'folder' : 'file'}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <span className="font-mono font-medium text-foreground">{deleteTarget?.name}</span>
              {deleteTarget?.type === 'dir' && ' and all its contents'}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
