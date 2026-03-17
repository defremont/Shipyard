import { useState } from 'react'
import { Plus, Minus, Eye, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStageFile, useUnstageFile, useGitDiff, useDiscardFile } from '@/hooks/useGit'
import { FileIcon } from '@/components/files/FileIcon'
import { FilePreviewDialog } from '@/components/files/FilePreviewDialog'

const PREVIEW_ONLY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp', '.tiff', '.avif',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.exe', '.dll', '.so', '.dylib',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.mp3', '.mp4', '.wav', '.avi', '.mov', '.flv', '.webm', '.ogg',
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.pyc', '.class', '.o', '.obj', '.bin', '.dat',
])

interface FileChangeProps {
  projectId: string
  file: string
  status: string
  staged: boolean
  onOpenInEditor?: (path: string, name: string, extension: string) => void
}

export function FileChange({ projectId, file, status, staged, onOpenInEditor }: FileChangeProps) {
  const [showDiff, setShowDiff] = useState(false)
  const [expandDiff, setExpandDiff] = useState(false)
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  const stageFile = useStageFile()
  const unstageFile = useUnstageFile()
  const discardFile = useDiscardFile()
  const { data: diffData } = useGitDiff(showDiff ? projectId : undefined, file, staged)

  const statusColors: Record<string, string> = {
    M: 'text-yellow-500',
    A: 'text-green-500',
    D: 'text-red-500',
    '?': 'text-muted-foreground',
  }

  const statusLabel = status === '?' ? 'U' : status
  const fileName = file.split(/[/\\]/).pop() || file
  const ext = fileName.lastIndexOf('.') > 0 ? fileName.slice(fileName.lastIndexOf('.')) : ''
  const isPreviewOnly = PREVIEW_ONLY_EXTENSIONS.has(ext.toLowerCase())

  const handleFileClick = () => {
    if (status === 'D') return
    if (isPreviewOnly || !onOpenInEditor) {
      setPreviewPath(file)
    } else {
      onOpenInEditor(file, fileName, ext)
    }
  }

  return (
    <div className="border rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent/50 transition-colors">
        <button onClick={() => setShowDiff(!showDiff)} className="shrink-0" title="Toggle diff">
          {showDiff ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <FileIcon name={fileName} extension={ext} type="file" className="h-3.5 w-3.5 shrink-0" />
        <button
          className="text-xs flex-1 truncate font-mono text-left hover:text-primary transition-colors"
          onClick={handleFileClick}
          title={status === 'D' ? 'File deleted' : isPreviewOnly ? 'Click to preview' : 'Click to open in editor'}
        >
          {file}
        </button>
        <span className={cn('text-xs font-bold shrink-0', statusColors[status] || 'text-muted-foreground')}>
          {statusLabel}
        </span>
        {status !== 'D' && isPreviewOnly && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => setPreviewPath(file)}
            title="Preview file"
          >
            <Eye className="h-3 w-3" />
          </Button>
        )}
        {staged ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => unstageFile.mutate({ projectId, file })}
            title="Unstage"
          >
            <Minus className="h-3 w-3" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => stageFile.mutate({ projectId, file })}
            title="Stage"
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6 shrink-0 text-muted-foreground/50 hover:text-red-400', status === '?' && 'hover:text-red-500')}
          title={status === '?' ? 'Delete file' : 'Discard changes'}
          onClick={() => {
            const type = staged ? 'staged' : status === '?' ? 'untracked' : 'unstaged'
            if (type === 'untracked' && !window.confirm(`Delete untracked file "${file}"?\nThis cannot be undone.`)) return
            discardFile.mutate({ projectId, file, type })
          }}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      <FilePreviewDialog projectId={projectId} filePath={previewPath} onClose={() => setPreviewPath(null)} />
      {showDiff && diffData?.diff && (
        <div className="relative border-t">
          <pre className={cn(
            "text-[11px] leading-relaxed p-3 bg-muted/50 overflow-x-auto overflow-y-auto",
            !expandDiff && 'max-h-64'
          )}>
            {diffData.diff.split('\n').map((line, i) => (
              <div
                key={i}
                className={cn(
                  line.startsWith('+') && !line.startsWith('+++') && 'text-green-400 bg-green-500/10',
                  line.startsWith('-') && !line.startsWith('---') && 'text-red-400 bg-red-500/10',
                  line.startsWith('@@') && 'text-blue-400'
                )}
              >
                {line}
              </div>
            ))}
          </pre>
          {diffData.diff.split('\n').length > 15 && (
            <button
              onClick={() => setExpandDiff(!expandDiff)}
              className="w-full text-[10px] text-muted-foreground hover:text-foreground bg-muted/80 hover:bg-muted py-0.5 transition-colors border-t"
            >
              {expandDiff ? 'Collapse' : `Expand (${diffData.diff.split('\n').length} lines)`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
