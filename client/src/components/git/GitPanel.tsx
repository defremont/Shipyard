import { useState } from 'react'
import { GitBranch, RefreshCw, Upload, Download, ChevronDown, ChevronRight, GitCommit, ArrowUp, ArrowDown, Trash2, Undo2, Loader2, Check, FolderGit2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { FileTree } from './FileTree'
import { CommitForm } from './CommitForm'
import { CommitDetailDialog } from './CommitDetailDialog'
import { useGitStatus, useGitLog, useGitMainCommit, useGitBranches, useCheckoutBranch, useStageAll, useUnstageAll, useGitPush, useGitPull, useDiscardAll, useUndoCommit } from '@/hooks/useGit'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface GitPanelProps {
  projectId: string
  subRepos?: string[]
  isGitRepo?: boolean
  onOpenInEditor?: (path: string, name: string, extension: string) => void
  onOpenDiffInEditor?: (path: string, name: string, extension: string, diffMode: 'staged' | 'unstaged', subrepo?: string) => void
  activeFilePath?: string | null
}

function SingleRepoPanel({ projectId, subrepo, onOpenInEditor, onOpenDiffInEditor, activeFilePath }: { projectId: string; subrepo?: string; onOpenInEditor?: (path: string, name: string, extension: string) => void; onOpenDiffInEditor?: (path: string, name: string, extension: string, diffMode: 'staged' | 'unstaged', subrepo?: string) => void; activeFilePath?: string | null }) {
  const { data: status, isLoading, isFetching, refetch } = useGitStatus(projectId, subrepo)
  const { data: logData } = useGitLog(projectId, subrepo)
  const { data: mainCommitData } = useGitMainCommit(projectId, status?.current, subrepo)
  const { data: branchData } = useGitBranches(projectId, subrepo)
  const checkoutBranch = useCheckoutBranch()
  const [branchOpen, setBranchOpen] = useState(false)
  const stageAll = useStageAll()
  const unstageAll = useUnstageAll()
  const gitPush = useGitPush()
  const gitPull = useGitPull()
  const discardAll = useDiscardAll()
  const [stagedOpen, setStagedOpen] = useState(false)
  const [unstagedOpen, setUnstagedOpen] = useState(false)
  const undoCommit = useUndoCommit()
  const [confirmDiscard, setConfirmDiscard] = useState<'staged' | 'unstaged' | null>(null)
  const [confirmUndo, setConfirmUndo] = useState(false)
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [selectedCommit, setSelectedCommit] = useState<{ hash: string; message: string; author_name: string; date: string } | null>(null)

  if (isLoading || !status) {
    return <div className="text-sm text-muted-foreground p-4">Loading git status...</div>
  }

  // Derive both lists from the porcelain XY codes (index char = staging area,
  // working_dir char = working tree). A file can legitimately appear in both —
  // e.g. staged then deleted on disk ('AD') shows as staged 'A' AND unstaged 'D',
  // matching VS Code. Deriving unstaged from the legacy arrays hid those files.
  const files = (status.files || []) as Array<{ path: string; index?: string; working_dir?: string }>

  const stagedFiles = files
    .filter(f => f.index && f.index !== ' ' && f.index !== '?')
    .map(f => ({ file: f.path, status: f.index as string }))

  const unstagedFiles = files
    .filter(f => f.working_dir && f.working_dir !== ' ')
    .map(f => ({ file: f.path, status: f.working_dir as string }))

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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} title="Refresh" disabled={isFetching}>
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={gitPull.isPending || gitPush.isPending}
            onClick={() => gitPull.mutate({ projectId, subrepo }, {
              onSuccess: () => toast.success('Pulled'),
              onError: (err) => toast.error(`Pull failed: ${err.message}`),
            })}
            title="Pull"
          >
            {gitPull.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={gitPush.isPending || gitPull.isPending}
            onClick={() => gitPush.mutate({ projectId, subrepo }, {
              onSuccess: () => toast.success('Pushed'),
              onError: (err) => toast.error(`Push failed: ${err.message}`),
            })}
            title="Push"
          >
            {gitPush.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {/* Branch + sync status */}
      <div className="flex items-center gap-2 flex-wrap">
        {status.current && (
          <Popover open={branchOpen} onOpenChange={setBranchOpen}>
            <PopoverTrigger asChild>
              <button className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium hover:bg-accent transition-colors cursor-pointer">
                {checkoutBranch.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitBranch className="h-3 w-3" />}
                {status.current}
                <ChevronDown className="h-2.5 w-2.5 opacity-50" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-1 max-h-64 overflow-y-auto" align="start">
              {branchData?.all
                ?.filter((b: string) => !b.startsWith('remotes/'))
                .map((branch: string) => (
                  <button
                    key={branch}
                    className={cn(
                      'flex items-center gap-2 w-full rounded px-2 py-1.5 text-xs text-left hover:bg-accent transition-colors',
                      branch === status.current && 'text-primary font-medium'
                    )}
                    disabled={branch === status.current || checkoutBranch.isPending}
                    onClick={() => {
                      checkoutBranch.mutate({ projectId, branch, subrepo }, {
                        onSuccess: () => { setBranchOpen(false); toast.success(`Switched to ${branch}`) },
                        onError: (err) => toast.error(`Checkout failed: ${err.message}`),
                      })
                    }}
                  >
                    {branch === status.current ? <Check className="h-3 w-3" /> : <span className="w-3" />}
                    <span className="truncate">{branch}</span>
                  </button>
                ))}
              {(!branchData?.all || branchData.all.filter((b: string) => !b.startsWith('remotes/')).length === 0) && (
                <div className="text-xs text-muted-foreground px-2 py-1.5">No branches found</div>
              )}
            </PopoverContent>
          </Popover>
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

      {/* Main branch info */}
      {mainCommitData?.commit && !mainCommitData.commit.isMerged && status?.current && status.current !== 'main' && status.current !== 'master' && (
        <div className="rounded border border-dashed border-muted-foreground/20 p-2 space-y-1">
          <div className="flex items-center gap-1.5">
            <GitBranch className="h-3 w-3 text-muted-foreground/50" />
            <span className="text-[10px] font-medium text-muted-foreground">main</span>
          </div>
          <p className="text-[10px] text-muted-foreground/70 truncate pl-[18px]">
            <span className="font-mono">{mainCommitData.commit.hash.substring(0, 7)}</span>
            {' '}{mainCommitData.commit.message}
          </p>
          <p className="text-[9px] text-muted-foreground/50 pl-[18px]">
            {(() => {
              try { return formatDistanceToNow(new Date(mainCommitData.commit.date), { addSuffix: true }) }
              catch { return '' }
            })()}
          </p>
        </div>
      )}

      {/* Staged */}
      {stagedFiles.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <button
              className="flex items-center gap-1 text-xs font-medium text-success hover:text-success/80 transition-colors"
              onClick={() => setStagedOpen(!stagedOpen)}
            >
              {stagedOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Staged ({stagedFiles.length})
            </button>
            {confirmDiscard === 'staged' ? (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-red-400">Discard all?</span>
                <Button variant="ghost" size="sm" className="h-5 text-[9px] text-red-400 hover:text-red-300 px-1.5 gap-1"
                  disabled={discardAll.isPending}
                  onClick={() => discardAll.mutate({ projectId, section: 'staged', subrepo }, {
                    onSuccess: () => { setConfirmDiscard(null); toast.success('Staged changes discarded') },
                    onError: (err) => { setConfirmDiscard(null); toast.error(err.message) },
                  })}>
                  {discardAll.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
                </Button>
                <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1.5" onClick={() => setConfirmDiscard(null)}>
                  No
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" disabled={unstageAll.isPending} onClick={() => unstageAll.mutate({ projectId, subrepo })}>
                  {unstageAll.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Unstage All
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground/50 hover:text-red-400"
                  title="Discard all staged changes" onClick={() => setConfirmDiscard('staged')}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
          {stagedOpen && (
            <FileTree
              projectId={projectId}
              files={stagedFiles}
              staged
              subrepo={subrepo}
              onOpenInEditor={onOpenInEditor}
              onOpenDiffInEditor={onOpenDiffInEditor}
              activeFilePath={activeFilePath}
            />
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
            {confirmDiscard === 'unstaged' ? (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-red-400">Discard all?</span>
                <Button variant="ghost" size="sm" className="h-5 text-[9px] text-red-400 hover:text-red-300 px-1.5 gap-1"
                  disabled={discardAll.isPending}
                  onClick={() => discardAll.mutate({ projectId, section: 'unstaged', subrepo }, {
                    onSuccess: () => { setConfirmDiscard(null); toast.success('Changes discarded') },
                    onError: (err) => { setConfirmDiscard(null); toast.error(err.message) },
                  })}>
                  {discardAll.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
                </Button>
                <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1.5" onClick={() => setConfirmDiscard(null)}>
                  No
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" disabled={stageAll.isPending} onClick={() => stageAll.mutate({ projectId, subrepo })}>
                  {stageAll.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Stage All
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground/50 hover:text-red-400"
                  title="Discard all unstaged changes" onClick={() => setConfirmDiscard('unstaged')}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
          {unstagedOpen && (
            <FileTree
              projectId={projectId}
              files={unstagedFiles}
              staged={false}
              subrepo={subrepo}
              onOpenInEditor={onOpenInEditor}
              onOpenDiffInEditor={onOpenDiffInEditor}
              activeFilePath={activeFilePath}
            />
          )}
        </div>
      )}

      {stagedFiles.length === 0 && unstagedFiles.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-2">
          Working tree clean
        </div>
      )}

      {/* Commit form */}
      <CommitForm key={`${projectId}-${subrepo || ''}`} projectId={projectId} hasStagedChanges={hasStagedChanges} subrepo={subrepo} />

      {/* Commit detail dialog */}
      <CommitDetailDialog
        open={!!selectedCommit}
        onOpenChange={(open) => { if (!open) setSelectedCommit(null) }}
        projectId={projectId}
        commit={selectedCommit}
        subrepo={subrepo}
      />

      {/* Recent commits */}
      {commits.length > 0 && (
        <div className="space-y-1 pt-2 border-t">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent Commits</h3>
            {confirmUndo ? (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-orange-400">Undo commit?</span>
                <Button variant="ghost" size="sm" className="h-5 text-[9px] text-orange-400 hover:text-orange-300 px-1.5 gap-1"
                  disabled={undoCommit.isPending}
                  onClick={() => undoCommit.mutate({ projectId, subrepo }, {
                    onSuccess: () => { setConfirmUndo(false); toast.success('Commit undone — changes are back in staging') },
                    onError: (err) => { setConfirmUndo(false); toast.error(err.message) },
                  })}>
                  {undoCommit.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Yes'}
                </Button>
                <Button variant="ghost" size="sm" className="h-5 text-[9px] px-1.5" onClick={() => setConfirmUndo(false)}>
                  No
                </Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground/60 hover:text-orange-400"
                title="Undo last commit (keeps changes staged)" onClick={() => setConfirmUndo(true)}>
                <Undo2 className="h-3 w-3" />
                Undo
              </Button>
            )}
          </div>
          {commits.slice(0, 10).map((commit: any, i: number) => {
            const unpushed = i < ahead
            return (
              <div
                key={commit.hash}
                className={cn(
                  'flex items-start gap-1.5 py-1 rounded hover:bg-accent/30 transition-colors px-1 cursor-pointer',
                  unpushed && 'border-l-2 border-warning pl-1.5'
                )}
                onClick={() => setSelectedCommit({ hash: commit.hash, message: commit.message, author_name: commit.author_name, date: commit.date })}
              >
                <GitCommit className={cn('h-3 w-3 mt-0.5 shrink-0', unpushed ? 'text-warning' : 'text-muted-foreground/50')} />
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
                    <ArrowUp className="h-2.5 w-2.5 text-warning" />
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

export function GitPanel({ projectId, subRepos, isGitRepo, onOpenInEditor, onOpenDiffInEditor, activeFilePath }: GitPanelProps) {
  const hasSubRepos = subRepos && subRepos.length > 0

  // Build list of repo tabs
  const repoTabs: { key: string | undefined; label: string }[] = []
  if (isGitRepo) {
    repoTabs.push({ key: undefined, label: 'root' })
  }
  if (hasSubRepos) {
    for (const sr of subRepos) {
      repoTabs.push({ key: sr, label: sr })
    }
  }

  const [activeRepo, setActiveRepo] = useState<string | undefined>(repoTabs[0]?.key)

  // If only one repo (root or single sub-repo), render directly without tabs
  if (repoTabs.length <= 1) {
    return <SingleRepoPanel projectId={projectId} subrepo={repoTabs[0]?.key} onOpenInEditor={onOpenInEditor} onOpenDiffInEditor={onOpenDiffInEditor} activeFilePath={activeFilePath} />
  }

  return (
    <div className="space-y-2">
      {/* Sub-repo tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        {repoTabs.map(tab => (
          <button
            key={tab.key ?? '__root__'}
            className={cn(
              'px-2 py-1 text-[10px] font-medium rounded-md border transition-colors whitespace-nowrap',
              activeRepo === tab.key
                ? 'bg-accent border-accent-foreground/20 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'
            )}
            onClick={() => setActiveRepo(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Active repo panel */}
      <SingleRepoPanel
        key={activeRepo ?? '__root__'}
        projectId={projectId}
        subrepo={activeRepo}
        onOpenInEditor={onOpenInEditor}
        onOpenDiffInEditor={onOpenDiffInEditor}
        activeFilePath={activeFilePath}
      />
    </div>
  )
}
