import { useState, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useCommitDiff } from '@/hooks/useGit'
import { Loader2, FileText, ChevronDown, ChevronRight, Plus, Minus, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

interface CommitDetailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  commit: {
    hash: string
    message: string
    author_name: string
    date: string
  } | null
  subrepo?: string
}

const statusLabel: Record<string, { text: string; color: string }> = {
  M: { text: 'Modified', color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20' },
  A: { text: 'Added', color: 'text-green-500 bg-green-500/10 border-green-500/20' },
  D: { text: 'Deleted', color: 'text-red-500 bg-red-500/10 border-red-500/20' },
  R: { text: 'Renamed', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20' },
  C: { text: 'Copied', color: 'text-cyan-500 bg-cyan-500/10 border-cyan-500/20' },
}

function parseDiffByFile(diff: string): Map<string, string> {
  const fileMap = new Map<string, string>()
  const parts = diff.split(/^diff --git /m)
  for (const part of parts) {
    if (!part.trim()) continue
    // Extract file path from the diff header: "a/path b/path"
    const headerMatch = part.match(/^a\/(.+?) b\/(.+?)[\n\r]/)
    if (headerMatch) {
      const filePath = headerMatch[2]
      fileMap.set(filePath, 'diff --git ' + part)
    }
  }
  return fileMap
}

function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <pre className="text-[11px] leading-relaxed font-mono overflow-x-auto">
      {lines.map((line, i) => {
        let className = 'px-3 min-h-[20px] whitespace-pre '
        if (line.startsWith('+++') || line.startsWith('---')) {
          className += 'text-muted-foreground/70 bg-muted/30'
        } else if (line.startsWith('+')) {
          className += 'text-green-400 bg-green-500/10'
        } else if (line.startsWith('-')) {
          className += 'text-red-400 bg-red-500/10'
        } else if (line.startsWith('@@')) {
          className += 'text-blue-400 bg-blue-500/10'
        } else if (line.startsWith('diff ')) {
          className += 'text-muted-foreground/50 bg-muted/20'
        } else {
          className += 'text-muted-foreground/80'
        }
        return (
          <div key={i} className={className}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

function FileEntry({ file, status, additions, deletions, diff, defaultExpanded }: {
  file: string
  status: string
  additions: number
  deletions: number
  diff: string | undefined
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const label = statusLabel[status] || { text: status, color: 'text-muted-foreground' }

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-accent/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <span className="text-xs font-mono truncate flex-1">{file}</span>
        <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0', label.color)}>
          {label.text}
        </Badge>
        {additions > 0 && (
          <span className="text-[10px] text-green-500 flex items-center gap-0.5">
            <Plus className="h-2.5 w-2.5" />{additions}
          </span>
        )}
        {deletions > 0 && (
          <span className="text-[10px] text-red-500 flex items-center gap-0.5">
            <Minus className="h-2.5 w-2.5" />{deletions}
          </span>
        )}
      </button>
      {expanded && diff && (
        <div className="border-t bg-background overflow-auto max-h-[500px]">
          <DiffBlock diff={diff} />
        </div>
      )}
    </div>
  )
}

export function CommitDetailDialog({ open, onOpenChange, projectId, commit, subrepo }: CommitDetailDialogProps) {
  const { data, isLoading } = useCommitDiff(
    open ? projectId : undefined,
    open ? commit?.hash : undefined,
    subrepo
  )
  const [copied, setCopied] = useState(false)

  const fileDiffs = useMemo(() => {
    if (!data?.diff) return new Map<string, string>()
    return parseDiffByFile(data.diff)
  }, [data?.diff])

  const totalAdditions = data?.files?.reduce((s, f) => s + f.additions, 0) || 0
  const totalDeletions = data?.files?.reduce((s, f) => s + f.deletions, 0) || 0

  const copyHash = () => {
    if (commit?.hash) {
      navigator.clipboard.writeText(commit.hash)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!commit) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[1200px] max-h-[90vh] flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <div className="flex items-start gap-3 pr-8">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-sm font-semibold leading-snug whitespace-pre-wrap break-words">
                {commit.message}
              </DialogTitle>
              <DialogDescription className="mt-1.5 flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">
                  {commit.author_name}
                </span>
                <span className="text-xs text-muted-foreground/50">&middot;</span>
                <span className="text-xs text-muted-foreground/70">
                  {(() => { try { return formatDistanceToNow(new Date(commit.date), { addSuffix: true }) } catch { return '' } })()}
                </span>
                <span className="text-xs text-muted-foreground/50">&middot;</span>
                <button
                  onClick={copyHash}
                  className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground/60 hover:text-foreground transition-colors"
                  title="Copy full hash"
                >
                  {commit.hash.substring(0, 7)}
                  {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                </button>
              </DialogDescription>
            </div>
          </div>

          {/* Stats bar */}
          {data?.files && (
            <div className="flex items-center gap-3 mt-2 pt-2">
              <span className="text-[11px] text-muted-foreground">
                {data.files.length} file{data.files.length !== 1 ? 's' : ''} changed
              </span>
              {totalAdditions > 0 && (
                <span className="text-[11px] text-green-500 flex items-center gap-0.5">
                  <Plus className="h-3 w-3" />{totalAdditions} addition{totalAdditions !== 1 ? 's' : ''}
                </span>
              )}
              {totalDeletions > 0 && (
                <span className="text-[11px] text-red-500 flex items-center gap-0.5">
                  <Minus className="h-3 w-3" />{totalDeletions} deletion{totalDeletions !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          )}
        </DialogHeader>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading diff...</span>
            </div>
          )}

          {data?.files?.map((file) => (
            <FileEntry
              key={file.file}
              file={file.file}
              status={file.status}
              additions={file.additions}
              deletions={file.deletions}
              diff={fileDiffs.get(file.file)}
              defaultExpanded={data.files.length <= 8}
            />
          ))}

          {data?.files?.length === 0 && !isLoading && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No changes in this commit
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
