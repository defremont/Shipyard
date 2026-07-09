import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, Plus, Minus, Trash2, Eye, FileEdit } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useStageFile, useUnstageFile, useDiscardFile } from '@/hooks/useGit'
import { FileIcon } from '@/components/files/FileIcon'
import { LazyFilePreviewDialog as FilePreviewDialog } from '@/components/files/LazyFilePreviewDialog'

export interface ChangeEntry {
  file: string
  status: string
}

interface FileTreeProps {
  projectId: string
  files: ChangeEntry[]
  staged: boolean
  subrepo?: string
  onOpenInEditor?: (path: string, name: string, extension: string) => void
  onOpenDiffInEditor?: (path: string, name: string, extension: string, diffMode: 'staged' | 'unstaged', subrepo?: string) => void
  activeFilePath?: string | null
}

// ── Tree model ────────────────────────────────────────────────────────────
interface TreeFolder {
  type: 'folder'
  name: string
  path: string
  children: TreeNode[]
}
interface TreeFile {
  type: 'file'
  name: string
  path: string
  status: string
}
type TreeNode = TreeFolder | TreeFile

function buildTree(files: ChangeEntry[]): TreeNode[] {
  const root: TreeFolder = { type: 'folder', name: '', path: '', children: [] }

  for (const entry of files) {
    const parts = entry.file.split(/[\\/]/).filter(Boolean)
    let current = root
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]
      const segPath = parts.slice(0, i + 1).join('/')
      let next = current.children.find(c => c.type === 'folder' && c.name === segment) as TreeFolder | undefined
      if (!next) {
        next = { type: 'folder', name: segment, path: segPath, children: [] }
        current.children.push(next)
      }
      current = next
    }
    const fileName = parts[parts.length - 1]
    current.children.push({
      type: 'file',
      name: fileName,
      path: entry.file,
      status: entry.status,
    })
  }

  // Collapse single-child folder chains: src/components/foo → src/components/foo
  // (VS Code does this — keeps the tree shallow when there's only one path).
  const collapseChain = (node: TreeFolder): void => {
    while (node.children.length === 1 && node.children[0].type === 'folder') {
      const only = node.children[0] as TreeFolder
      node.name = node.name ? `${node.name}/${only.name}` : only.name
      node.path = only.path
      node.children = only.children
    }
    for (const c of node.children) {
      if (c.type === 'folder') collapseChain(c)
    }
  }
  for (const c of root.children) {
    if (c.type === 'folder') collapseChain(c)
  }

  // Sort: folders first, then files; alphabetical within each group.
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const n of nodes) if (n.type === 'folder') sortNodes(n.children)
  }
  sortNodes(root.children)

  return root.children
}

// ── Status helpers ────────────────────────────────────────────────────────
const PREVIEW_ONLY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.flv', '.webm', '.ogg',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.pyc', '.class', '.o', '.obj', '.bin', '.dat',
])

const STATUS_COLOR: Record<string, string> = {
  M: 'text-yellow-500',
  A: 'text-green-500',
  D: 'text-red-500',
  R: 'text-blue-500',
  '?': 'text-green-400',
}

function statusLabel(s: string): string {
  return s === '?' ? 'U' : s
}

// ── Folder row ────────────────────────────────────────────────────────────
function FolderRow({
  node, depth, expanded, onToggle, children,
}: {
  node: TreeFolder
  depth: number
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full py-0.5 px-1 rounded hover:bg-accent/40 transition-colors text-xs"
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        {expanded
          ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
        {expanded
          ? <FolderOpen className="h-3.5 w-3.5 text-blue-400/80 shrink-0" />
          : <Folder className="h-3.5 w-3.5 text-blue-400/80 shrink-0" />}
        <span className="truncate text-muted-foreground/90">{node.name}</span>
      </button>
      {expanded && <div>{children}</div>}
    </div>
  )
}

// ── File leaf row ─────────────────────────────────────────────────────────
function FileRow({
  projectId, node, depth, staged, subrepo, isActive,
  onOpenInEditor, onOpenDiffInEditor,
}: {
  projectId: string
  node: TreeFile
  depth: number
  staged: boolean
  subrepo?: string
  isActive?: boolean
  onOpenInEditor?: (path: string, name: string, extension: string) => void
  onOpenDiffInEditor?: (path: string, name: string, extension: string, diffMode: 'staged' | 'unstaged', subrepo?: string) => void
}) {
  const stageFile = useStageFile()
  const unstageFile = useUnstageFile()
  const discardFile = useDiscardFile()
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const ext = node.name.lastIndexOf('.') > 0 ? node.name.slice(node.name.lastIndexOf('.')) : ''
  const isPreviewOnly = PREVIEW_ONLY_EXTENSIONS.has(ext.toLowerCase())

  const handleClick = () => {
    // Untracked files have no diff to show — open the actual file in the editor
    // so the user can read/edit it.
    if (node.status === '?') {
      if (onOpenInEditor) onOpenInEditor(node.path, node.name, ext)
      else setPreviewPath(node.path)
      return
    }
    // Binary/preview-only files (images, PDFs, ...) open in the preview dialog
    // — diffing them as text would be useless.
    if (isPreviewOnly) {
      setPreviewPath(node.path)
      return
    }
    // Tracked files (modified, added, deleted, renamed) → diff view.
    if (onOpenDiffInEditor) {
      onOpenDiffInEditor(node.path, node.name, ext, staged ? 'staged' : 'unstaged', subrepo)
    } else if (onOpenInEditor) {
      onOpenInEditor(node.path, node.name, ext)
    }
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 py-0.5 px-1 rounded group cursor-pointer transition-colors text-xs',
          isActive ? 'bg-blue-500/15 text-blue-300' : 'hover:bg-accent/50'
        )}
        style={{ paddingLeft: `${depth * 12 + 18}px` }}
        onClick={handleClick}
        title={node.path}
      >
        <FileIcon name={node.name} extension={ext} type="file" className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate flex-1 min-w-0">{node.name}</span>
        {/* Hover actions */}
        <div className="opacity-0 group-hover:opacity-100 flex items-center transition-opacity">
          {node.status !== 'D' && isPreviewOnly && (
            <Button
              variant="ghost" size="icon" className="h-5 w-5 shrink-0"
              onClick={(e) => { e.stopPropagation(); setPreviewPath(node.path) }}
              title="Preview"
            >
              <Eye className="h-3 w-3" />
            </Button>
          )}
          {node.status !== 'D' && !isPreviewOnly && onOpenInEditor && (
            <Button
              variant="ghost" size="icon" className="h-5 w-5 shrink-0"
              onClick={(e) => { e.stopPropagation(); onOpenInEditor(node.path, node.name, ext) }}
              title="Open file"
            >
              <FileEdit className="h-3 w-3" />
            </Button>
          )}
          {staged ? (
            <Button
              variant="ghost" size="icon" className="h-5 w-5 shrink-0"
              onClick={(e) => { e.stopPropagation(); unstageFile.mutate({ projectId, file: node.path, subrepo }) }}
              title="Unstage"
            >
              <Minus className="h-3 w-3" />
            </Button>
          ) : (
            <Button
              variant="ghost" size="icon" className="h-5 w-5 shrink-0"
              onClick={(e) => { e.stopPropagation(); stageFile.mutate({ projectId, file: node.path, subrepo }) }}
              title="Stage"
            >
              <Plus className="h-3 w-3" />
            </Button>
          )}
          <Button
            variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-muted-foreground/50 hover:text-red-400"
            title={node.status === '?' ? 'Delete file' : 'Discard changes'}
            onClick={(e) => {
              e.stopPropagation()
              const type = staged ? 'staged' : node.status === '?' ? 'untracked' : 'unstaged'
              if (type === 'untracked' && !window.confirm(`Delete untracked file "${node.path}"?\nThis cannot be undone.`)) return
              discardFile.mutate({ projectId, file: node.path, type, subrepo })
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
        <span className={cn('text-[10px] font-bold shrink-0 ml-1 w-3 text-center', STATUS_COLOR[node.status] || 'text-muted-foreground')}>
          {statusLabel(node.status)}
        </span>
      </div>
      <FilePreviewDialog projectId={projectId} filePath={previewPath} onClose={() => setPreviewPath(null)} />
    </>
  )
}

// ── Recursive renderer ────────────────────────────────────────────────────
function renderNodes(
  nodes: TreeNode[],
  depth: number,
  expanded: Set<string>,
  toggle: (p: string) => void,
  shared: Omit<FileTreeProps, 'files'>,
): React.ReactNode {
  return nodes.map(node => {
    if (node.type === 'folder') {
      const isOpen = !expanded.has(node.path) // default open; collapse adds to set
      return (
        <FolderRow
          key={`f:${node.path}`}
          node={node}
          depth={depth}
          expanded={isOpen}
          onToggle={() => toggle(node.path)}
        >
          {renderNodes(node.children, depth + 1, expanded, toggle, shared)}
        </FolderRow>
      )
    }
    return (
      <FileRow
        key={`l:${node.path}`}
        node={node}
        depth={depth}
        projectId={shared.projectId}
        staged={shared.staged}
        subrepo={shared.subrepo}
        isActive={node.path === shared.activeFilePath}
        onOpenInEditor={shared.onOpenInEditor}
        onOpenDiffInEditor={shared.onOpenDiffInEditor}
      />
    )
  })
}

// ── Public component ──────────────────────────────────────────────────────
export function FileTree({ files, ...rest }: FileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggle = (path: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      return next
    })
  }

  if (files.length === 0) return null
  return <div className="space-y-px">{renderNodes(tree, 0, collapsed, toggle, rest)}</div>
}
