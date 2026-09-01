import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { FolderBrowser } from '@/components/ui/folder-browser'
import { GitBranch, FolderOpen, Loader2, Trash2, RotateCcw } from 'lucide-react'
import { useWorktrees, useSaveWorktreeConfig, useCleanWorktrees } from '@/hooks/useWorktrees'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/**
 * Worktree per task: each started task gets its own checkout of the repo, so
 * two agents can work on the same project at the same time.
 */
export function WorktreeSettingsCard() {
  const { data } = useWorktrees()
  const saveConfig = useSaveWorktreeConfig()
  const clean = useCleanWorktrees()
  const [browserOpen, setBrowserOpen] = useState(false)

  const enabled = !!data?.enabled
  const worktrees = data?.worktrees || []
  const stale = worktrees.filter(w => w.stale).length

  const toggle = async () => {
    try {
      await saveConfig.mutateAsync({ enabled: !enabled })
      toast.success(enabled ? 'Worktree per task off' : 'Worktree per task on')
    } catch (err: any) {
      toast.error(err.message || 'Could not save the setting')
    }
  }

  const setBasePath = async (path: string | null) => {
    try {
      await saveConfig.mutateAsync({ basePath: path })
      toast.success(path ? 'Worktree folder updated' : 'Back to the default folder')
    } catch (err: any) {
      toast.error(err.message || 'Could not save the folder')
    }
  }

  const handleClean = async () => {
    try {
      const result = await clean.mutateAsync(true)
      const parts: string[] = []
      if (result.removed) parts.push(`${result.removed} worktrees`)
      if (result.orphans) parts.push(`${result.orphans} leftover folders`)
      toast.success(parts.length ? `Removed ${parts.join(' and ')}` : 'Nothing to clean')
      if (result.errors) toast.warning(`${result.errors} could not be removed`)
    } catch (err: any) {
      toast.error(err.message || 'Cleanup failed')
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-primary" />
            Task worktrees
          </CardTitle>
          <CardDescription className="text-xs">
            Give every started task its own checkout of the repository, on its own branch, so several agents can work on the same project at once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <button
            onClick={toggle}
            disabled={saveConfig.isPending}
            className="flex items-center justify-between w-full px-3 py-2.5 rounded-md border hover:bg-accent/50 transition-colors"
          >
            <div className="text-left">
              <span className="text-sm font-medium">Run each task in its own worktree</span>
              <p className="text-xs text-muted-foreground">
                Off means every agent works straight in the project folder.
              </p>
            </div>
            <div className={cn('w-9 h-5 rounded-full transition-colors relative shrink-0', enabled ? 'bg-primary' : 'bg-muted')}>
              <div className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                enabled ? 'translate-x-4' : 'translate-x-0.5'
              )} />
            </div>
          </button>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Worktree folder</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-muted rounded px-2 py-1.5 text-[11px] font-mono">
                {data?.basePath || '...'}
              </code>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setBrowserOpen(true)}>
                <FolderOpen className="h-3.5 w-3.5" />
                Change
              </Button>
              {data?.custom && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  title="Back to the default folder"
                  onClick={() => setBasePath(null)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {!data?.custom && (
              <p className="text-[11px] text-muted-foreground/70">Default: {data?.defaultBasePath}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Active worktrees {worktrees.length > 0 && <span className="text-muted-foreground/60">({worktrees.length})</span>}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={handleClean}
                disabled={clean.isPending}
              >
                {clean.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Clean worktrees
              </Button>
            </div>

            {worktrees.length === 0 ? (
              <p className="text-xs text-muted-foreground/70">None yet.</p>
            ) : (
              <div className="border rounded-lg divide-y max-h-56 overflow-y-auto scrollbar-dark">
                {worktrees.map(w => (
                  <div key={w.taskId} className="px-3 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium truncate">
                          {w.taskNumber ? `#${w.taskNumber} ` : ''}{w.taskTitle}
                        </span>
                        {w.stale && <Badge variant="secondary" className="text-[9px] px-1 py-0">stale</Badge>}
                        {w.missing && <Badge variant="outline" className="text-[9px] px-1 py-0 text-muted-foreground">missing</Badge>}
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate font-mono">{w.branch || w.path}</p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{w.projectName || w.projectId}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[11px] text-muted-foreground/70">
              Worktrees of tasks finished more than {data?.ttlDays ?? 7} days ago are removed on their own
              {stale > 0 ? ` (${stale} waiting)` : ''}, unless they still hold uncommitted work.
              "Clean worktrees" removes every finished task's worktree now, committed or not — unfinished tasks keep theirs.
            </p>
          </div>
        </CardContent>
      </Card>

      <FolderBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={setBasePath}
        title="Select the folder that holds task worktrees"
      />
    </>
  )
}
