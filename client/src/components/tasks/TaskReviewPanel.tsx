import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  GitBranch, GitCommit, ChevronDown, ChevronRight, Plus, Minus,
  Loader2, AlertTriangle, RotateCcw, X,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { toast } from 'sonner'
import { useTaskGitReview, useCommitDiff } from '@/hooks/useGit'
import { useAddTaskNote, type Task } from '@/hooks/useTasks'
import { DiffFileEntry, parseDiffByFile } from '@/components/git/DiffView'
import type { TaskCommit } from '@/lib/api'

// A finished task is bounded at doneAt so unrelated later work stays out. The
// grace covers the agent that commits right after marking the task done.
const DONE_GRACE_MS = 15 * 60 * 1000

function relative(date?: string) {
  if (!date) return ''
  try { return formatDistanceToNow(new Date(date), { addSuffix: true }) }
  catch { return '' }
}

function CommitEntry({ projectId, commit }: { projectId: string; commit: TaskCommit }) {
  const [expanded, setExpanded] = useState(false)
  // Only fetch the diff once the user asks for it
  const { data, isLoading } = useCommitDiff(expanded ? projectId : undefined, expanded ? commit.hash : undefined)

  const fileDiffs = useMemo(() => {
    if (!data?.diff) return new Map<string, string>()
    return parseDiffByFile(data.diff)
  }, [data?.diff])

  const statusByFile = useMemo(() => {
    const map = new Map<string, string>()
    for (const f of data?.files || []) map.set(f.file, f.status)
    return map
  }, [data?.files])

  return (
    <div className="relative pl-6">
      {/* timeline rail + dot */}
      <span className="absolute left-[5px] top-4 bottom-0 w-px bg-border" aria-hidden />
      <span className="absolute left-0 top-[9px] h-2.5 w-2.5 rounded-full border-2 border-primary bg-background" aria-hidden />

      <button
        className="flex items-start gap-2 w-full text-left rounded px-2 py-1.5 -ml-1 hover:bg-accent/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 mt-0.5 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs leading-snug break-words">{commit.message}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {commit.author_name} &middot; {relative(commit.date)} &middot;{' '}
            <span className="font-mono">{commit.hash.substring(0, 7)}</span>
            {commit.files.length > 0 && <> &middot; {commit.files.length} file{commit.files.length !== 1 ? 's' : ''}</>}
          </p>
        </div>
        {commit.additions > 0 && (
          <span className="text-[10px] text-success flex items-center gap-0.5 shrink-0 mt-0.5">
            <Plus className="h-2.5 w-2.5" />{commit.additions}
          </span>
        )}
        {commit.deletions > 0 && (
          <span className="text-[10px] text-destructive flex items-center gap-0.5 shrink-0 mt-0.5">
            <Minus className="h-2.5 w-2.5" />{commit.deletions}
          </span>
        )}
      </button>

      {expanded && (
        <div className="space-y-1.5 mt-1 mb-3">
          {isLoading && (
            <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading diff...
            </div>
          )}
          {commit.files.map(file => (
            <DiffFileEntry
              key={file.file}
              compact
              file={file.file}
              status={statusByFile.get(file.file)}
              additions={file.additions}
              deletions={file.deletions}
              diff={fileDiffs.get(file.file)}
              defaultExpanded={commit.files.length <= 4}
            />
          ))}
          {!isLoading && commit.files.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">Merge commit &mdash; no file changes of its own.</p>
          )}
        </div>
      )}
    </div>
  )
}

interface TaskReviewPanelProps {
  task: Task
  onDone: () => void
}

export function TaskReviewPanel({ task, onDone }: TaskReviewPanelProps) {
  const until = task.doneAt
    ? new Date(new Date(task.doneAt).getTime() + DONE_GRACE_MS).toISOString()
    : undefined
  const { data, isLoading } = useTaskGitReview(task.projectId, task.inProgressAt, until)
  const addNote = useAddTaskNote()
  const [reasonOpen, setReasonOpen] = useState(false)
  const [reason, setReason] = useState('')

  const dirty = data?.working
    ? data.working.staged + data.working.unstaged + data.working.untracked
    : 0

  const handleNeedsChanges = async () => {
    const text = reason.trim()
    if (!text) return
    try {
      await addNote.mutateAsync({
        projectId: task.projectId,
        taskId: task.id,
        note: `Needs changes: ${text}`,
        status: 'in_progress',
      })
      toast.success('Sent back to In Progress')
      onDone()
    } catch (err: any) {
      toast.error(err.message || 'Could not save the note')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading git history...
      </div>
    )
  }

  if (data && !data.available) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">
        This project is not a git repository, so there is nothing to review here.
      </p>
    )
  }

  const commits = data?.commits || []

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
        {data?.branch && (
          <Badge variant="outline" className="gap-1 text-[10px] font-mono">
            <GitBranch className="h-2.5 w-2.5" />
            {data.branch}
          </Badge>
        )}
        <span>
          {commits.length} commit{commits.length !== 1 ? 's' : ''} since started {relative(task.inProgressAt)}
        </span>
        {(data?.files.length ?? 0) > 0 && (
          <>
            <span className="text-muted-foreground/50">&middot;</span>
            <span>{data!.files.length} file{data!.files.length !== 1 ? 's' : ''}</span>
          </>
        )}
        {(data?.additions ?? 0) > 0 && (
          <span className="text-success flex items-center gap-0.5">
            <Plus className="h-2.5 w-2.5" />{data!.additions}
          </span>
        )}
        {(data?.deletions ?? 0) > 0 && (
          <span className="text-destructive flex items-center gap-0.5">
            <Minus className="h-2.5 w-2.5" />{data!.deletions}
          </span>
        )}
      </div>

      {dirty > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2">
          <AlertTriangle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed">
            {dirty} change{dirty !== 1 ? 's' : ''} left uncommitted in the working tree
            {data?.working && (
              <span className="text-muted-foreground">
                {' '}({data.working.staged} staged, {data.working.unstaged} modified, {data.working.untracked} untracked)
              </span>
            )}
            . Check the Git panel before signing this off.
          </p>
        </div>
      )}

      {commits.length === 0 ? (
        <div className="text-center py-6 space-y-1">
          <GitCommit className="h-5 w-5 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">No commits since task started</p>
          <p className="text-[11px] text-muted-foreground/70 max-w-sm mx-auto leading-relaxed">
            The work may still be uncommitted, may live on another branch
            {data?.branch && <> (this one is <span className="font-mono">{data.branch}</span>)</>}
            , or in a sub-repository.
          </p>
        </div>
      ) : (
        <div>
          {commits.map(commit => (
            <CommitEntry key={commit.hash} projectId={task.projectId} commit={commit} />
          ))}
        </div>
      )}

      {/* Files touched across the whole window */}
      {(data?.files.length ?? 0) > 0 && (
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Files touched ({data!.files.length})
          </label>
          <div className="mt-1.5 space-y-0.5">
            {data!.files.map(f => (
              <div key={f.file} className="flex items-center gap-2 text-[11px]">
                <span className="font-mono truncate flex-1">{f.file}</span>
                {f.additions > 0 && <span className="text-success shrink-0">+{f.additions}</span>}
                {f.deletions > 0 && <span className="text-destructive shrink-0">-{f.deletions}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Needs changes */}
      <div className="pt-2 border-t">
        {reasonOpen ? (
          <div className="space-y-2">
            <Textarea
              autoFocus
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="What still needs to change?"
              className="text-xs min-h-[70px]"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="gap-1.5 text-xs"
                onClick={handleNeedsChanges}
                disabled={!reason.trim() || addNote.isPending}
              >
                {addNote.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                Send back to In Progress
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => setReasonOpen(false)}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setReasonOpen(true)}>
            <RotateCcw className="h-3.5 w-3.5" />
            Needs changes
          </Button>
        )}
      </div>
    </div>
  )
}
