import { useState, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useCommitDiff } from '@/hooks/useGit'
import { Loader2, Plus, Minus, Copy, Check } from 'lucide-react'
import { DiffFileEntry, parseDiffByFile } from './DiffView'
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
            <DiffFileEntry
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
