import { useState } from 'react'
import { GitBranch, RefreshCw, Upload, Download, ChevronDown, ChevronRight, GitCommit, ArrowUp, ArrowDown } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FileChange } from './FileChange'
import { CommitForm } from './CommitForm'
import { useGitStatus, useGitLog, useStageAll, useUnstageAll, useGitPush, useGitPull } from '@/hooks/useGit'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface GitPanelProps {
  projectId: string
}

export function GitPanel({ projectId }: GitPanelProps) {
  const { data: status, isLoading, refetch } = useGitStatus(projectId)
  const { data: logData } = useGitLog(projectId)
  const stageAll = useStageAll()
  const unstageAll = useUnstageAll()
  const gitPush = useGitPush()
  const gitPull = useGitPull()
  const [stagedOpen, setStagedOpen] = useState(false)
  const [unstagedOpen, setUnstagedOpen] = useState(true)

  if (isLoading || !status) {
    return <div className="text-sm text-muted-foreground p-4">Loading git status...</div>
  }

  const staged = status.staged || []
  const modified = status.modified || []
  const notAdded = status.not_added || []
  const deleted = status.deleted || []
  const created = status.created || []

  const stagedFiles = [
    ...staged.map((f: string) => ({ file: f, status: 'M' })),
  ]

  const unstagedFiles = [
    ...modified.filter((f: string) => !staged.includes(f)).map((f: string) => ({ file: f, status: 'M' })),
    ...deleted.filter((f: string) => !staged.includes(f)).map((f: string) => ({ file: f, status: 'D' })),
    ...notAdded.map((f: string) => ({ file: f, status: '?' })),
    ...created.filter((f: string) => !staged.includes(f)).map((f: string) => ({ file: f, status: 'A' })),
  ]

  const hasStagedChanges = stagedFiles.length > 0
  const ahead = status.ahead || 0
  const behind = status.behind || 0
  const commits = logData?.all || []

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Git</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => gitPull.mutate(projectId, {
              onSuccess: () => toast.success('Pulled'),
              onError: (err) => toast.error(`Pull failed: ${err.message}`),
            })}
            title="Pull"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => gitPush.mutate(projectId, {
              onSuccess: () => toast.success('Pushed'),
              onError: (err) => toast.error(`Push failed: ${err.message}`),
            })}
            title="Push"
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Branch + sync status */}
      <div className="flex items-center gap-2 flex-wrap">
        {status.current && (
          <Badge variant="outline" className="text-[10px] gap-1">
            <GitBranch className="h-3 w-3" />
            {status.current}
          </Badge>
        )}
        {ahead > 0 && (
          <Badge variant="secondary" className="text-[10px] gap-1">
            <ArrowUp className="h-2.5 w-2.5" />
            {ahead} to push
          </Badge>
        )}
        {behind > 0 && (
          <Badge variant="secondary" className="text-[10px] gap-1">
            <ArrowDown className="h-2.5 w-2.5" />
            {behind} to pull
          </Badge>
        )}
        {ahead === 0 && behind === 0 && status.tracking && (
          <span className="text-[10px] text-muted-foreground/60">in sync</span>
        )}
      </div>

      {/* Staged */}
      {stagedFiles.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-1 text-xs font-medium text-green-500 hover:text-green-400 transition-colors"
              onClick={() => setStagedOpen(!stagedOpen)}
            >
              {stagedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Staged ({stagedFiles.length})
            </button>
            <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => unstageAll.mutate(projectId)}>
              Unstage All
            </Button>
          </div>
          {stagedOpen && (
            <div className="space-y-1">
              {stagedFiles.map(({ file, status: s }) => (
                <FileChange key={`staged-${file}`} projectId={projectId} file={file} status={s} staged />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Unstaged */}
      {unstagedFiles.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setUnstagedOpen(!unstagedOpen)}
            >
              {unstagedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Changes ({unstagedFiles.length})
            </button>
            <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => stageAll.mutate(projectId)}>
              Stage All
            </Button>
          </div>
          {unstagedOpen && (
            <div className="space-y-1">
              {unstagedFiles.map(({ file, status: s }) => (
                <FileChange key={`unstaged-${file}`} projectId={projectId} file={file} status={s} staged={false} />
              ))}
            </div>
          )}
        </div>
      )}

      {stagedFiles.length === 0 && unstagedFiles.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-2">
          Working tree clean
        </div>
      )}

      {/* Commit form */}
      <CommitForm projectId={projectId} hasStagedChanges={hasStagedChanges} />

      {/* Recent commits */}
      {commits.length > 0 && (
        <div className="space-y-1 pt-2 border-t">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recent Commits</h3>
          {commits.slice(0, 10).map((commit: any, i: number) => {
            const unpushed = i < ahead
            return (
              <div key={commit.hash} className={cn(
                'flex items-start gap-1.5 py-1 rounded hover:bg-accent/30 transition-colors px-1',
                unpushed && 'border-l-2 border-yellow-500 pl-1.5'
              )}>
                <GitCommit className={cn('h-3 w-3 mt-0.5 shrink-0', unpushed ? 'text-yellow-500' : 'text-muted-foreground/50')} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] leading-tight truncate">{commit.message}</p>
                  <p className="text-[9px] text-muted-foreground/60">
                    {commit.author_name} &middot; {(() => {
                      try { return formatDistanceToNow(new Date(commit.date), { addSuffix: true }) }
                      catch { return '' }
                    })()}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0 mt-0.5">
                  {unpushed && (
                    <ArrowUp className="h-2.5 w-2.5 text-yellow-500" title="Not pushed" />
                  )}
                  <span className="text-[9px] font-mono text-muted-foreground/40">
                    {commit.hash.substring(0, 7)}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
