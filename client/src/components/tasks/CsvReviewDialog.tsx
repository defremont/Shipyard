import { useState, useEffect, useMemo, useRef } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { ArrowRight, Edit3, Plus, Trash2, Minus, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useApplyCsvChanges } from '@/hooks/useTasks'
import { toast } from 'sonner'
import type { CsvDiff, CsvRow } from '@/lib/csv'

interface CsvReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  diff: CsvDiff
  projectId: string
}

// --- Helpers ---

function Checkbox({ checked, indeterminate, onChange, className }: {
  checked: boolean
  indeterminate?: boolean
  onChange: (checked: boolean) => void
  className?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      className={cn('h-4 w-4 rounded border-muted-foreground/50 accent-primary cursor-pointer', className)}
    />
  )
}

function FieldValueEditor({ field, value, onChange }: { field: string; value: string; onChange: (v: string) => void }) {
  if (field === 'priority') {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs w-[120px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="urgent">Urgent</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="low">Low</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  if (field === 'status') {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="backlog">Backlog</SelectItem>
          <SelectItem value="todo">To Do</SelectItem>
          <SelectItem value="in_progress">In Progress</SelectItem>
          <SelectItem value="done">Done</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  return (
    <Input
      value={value}
      onChange={e => onChange(e.target.value)}
      className="h-7 text-xs flex-1 min-w-0"
    />
  )
}

function StatusLabel(s: string) {
  const map: Record<string, string> = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', done: 'Done' }
  return map[s] || s
}

function PriorityLabel(p: string) {
  return p.charAt(0).toUpperCase() + p.slice(1)
}

// --- Main Component ---

export function CsvReviewDialog({ open, onOpenChange, diff, projectId }: CsvReviewDialogProps) {
  const applyCsv = useApplyCsvChanges()

  // Per-field selections for modified tasks: taskId → { field → boolean }
  const [modifiedSel, setModifiedSel] = useState<Record<string, Record<string, boolean>>>({})
  // Edited new values for modified tasks: taskId → { field → value }
  const [modifiedEdits, setModifiedEdits] = useState<Record<string, Record<string, string>>>({})
  // Selection for new tasks: index → boolean
  const [addedSel, setAddedSel] = useState<Record<number, boolean>>({})
  // Edited values for new tasks: index → { field → value }
  const [addedEdits, setAddedEdits] = useState<Record<number, Record<string, string>>>({})
  // Selection for removed tasks: taskId → boolean
  const [removedSel, setRemovedSel] = useState<Record<string, boolean>>({})

  // Initialize state when dialog opens
  useEffect(() => {
    if (!open) return
    const ms: Record<string, Record<string, boolean>> = {}
    for (const mod of diff.modified) {
      ms[mod.id] = {}
      for (const c of mod.changes) ms[mod.id][c.field] = true
    }
    setModifiedSel(ms)
    setModifiedEdits({})

    const as: Record<number, boolean> = {}
    diff.added.forEach((_, i) => { as[i] = true })
    setAddedSel(as)
    setAddedEdits({})

    const rs: Record<string, boolean> = {}
    diff.removed.forEach(t => { rs[t.id] = false })
    setRemovedSel(rs)
  }, [open, diff])

  // --- Modified helpers ---
  const toggleModifiedField = (taskId: string, field: string, val: boolean) => {
    setModifiedSel(prev => ({ ...prev, [taskId]: { ...prev[taskId], [field]: val } }))
  }
  const toggleModifiedTask = (taskId: string, val: boolean) => {
    setModifiedSel(prev => {
      const fields = { ...prev[taskId] }
      for (const k of Object.keys(fields)) fields[k] = val
      return { ...prev, [taskId]: fields }
    })
  }
  const toggleAllModified = (val: boolean) => {
    setModifiedSel(prev => {
      const next = { ...prev }
      for (const id of Object.keys(next)) {
        const fields = { ...next[id] }
        for (const k of Object.keys(fields)) fields[k] = val
        next[id] = fields
      }
      return next
    })
  }
  const setModifiedEdit = (taskId: string, field: string, value: string) => {
    setModifiedEdits(prev => ({
      ...prev,
      [taskId]: { ...prev[taskId], [field]: value },
    }))
  }
  const isModifiedTaskChecked = (taskId: string) => {
    const fields = modifiedSel[taskId]
    if (!fields) return false
    return Object.values(fields).every(v => v)
  }
  const isModifiedTaskIndeterminate = (taskId: string) => {
    const fields = modifiedSel[taskId]
    if (!fields) return false
    const vals = Object.values(fields)
    return vals.some(v => v) && !vals.every(v => v)
  }

  // --- Added helpers ---
  const toggleAdded = (idx: number, val: boolean) => {
    setAddedSel(prev => ({ ...prev, [idx]: val }))
  }
  const toggleAllAdded = (val: boolean) => {
    setAddedSel(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) next[Number(k)] = val
      return next
    })
  }
  const setAddedEdit = (idx: number, field: string, value: string) => {
    setAddedEdits(prev => ({
      ...prev,
      [idx]: { ...prev[idx], [field]: value },
    }))
  }

  // --- Removed helpers ---
  const toggleRemoved = (id: string, val: boolean) => {
    setRemovedSel(prev => ({ ...prev, [id]: val }))
  }
  const toggleAllRemoved = (val: boolean) => {
    setRemovedSel(prev => {
      const next = { ...prev }
      for (const k of Object.keys(next)) next[k] = val
      return next
    })
  }

  // --- Counts ---
  const counts = useMemo(() => {
    let modCount = 0
    for (const mod of diff.modified) {
      const fields = modifiedSel[mod.id]
      if (fields && Object.values(fields).some(v => v)) modCount++
    }
    const addCount = Object.values(addedSel).filter(v => v).length
    const remCount = Object.values(removedSel).filter(v => v).length
    return { modified: modCount, added: addCount, removed: remCount, total: modCount + addCount + remCount }
  }, [diff, modifiedSel, addedSel, removedSel])

  const allModifiedChecked = diff.modified.length > 0 && diff.modified.every(m => isModifiedTaskChecked(m.id))
  const someModifiedChecked = diff.modified.some(m => {
    const f = modifiedSel[m.id]
    return f && Object.values(f).some(v => v)
  })
  const allAddedChecked = diff.added.length > 0 && Object.values(addedSel).every(v => v)
  const someAddedChecked = Object.values(addedSel).some(v => v)
  const allRemovedChecked = diff.removed.length > 0 && Object.values(removedSel).every(v => v)
  const someRemovedChecked = Object.values(removedSel).some(v => v)

  // --- Apply ---
  const handleApply = () => {
    const update: any[] = []
    const create: any[] = []
    const remove: string[] = []

    for (const mod of diff.modified) {
      const fields = modifiedSel[mod.id]
      if (!fields) continue
      const selected = Object.entries(fields).filter(([_, sel]) => sel)
      if (selected.length === 0) continue

      const upd: Record<string, any> = { id: mod.id }
      for (const [field] of selected) {
        const edited = modifiedEdits[mod.id]?.[field]
        const csvVal = mod.incoming[field as keyof CsvRow]
        const value = edited ?? csvVal
        if (field === 'prompt_template') upd.promptTemplate = value
        else upd[field] = value
      }
      update.push(upd)
    }

    for (const [idx, selected] of Object.entries(addedSel)) {
      if (!selected) continue
      const row = diff.added[Number(idx)]
      const edits = addedEdits[Number(idx)] || {}
      create.push({
        title: edits.title ?? row.title,
        description: edits.description ?? row.description,
        priority: edits.priority ?? row.priority,
        status: edits.status ?? row.status,
        promptTemplate: (edits.prompt_template ?? row.prompt_template) || undefined,
      })
    }

    for (const [id, selected] of Object.entries(removedSel)) {
      if (selected) remove.push(id)
    }

    applyCsv.mutate(
      { projectId, changes: { update, create, remove } },
      {
        onSuccess: (result) => {
          const parts = []
          if (result.updated) parts.push(`${result.updated} updated`)
          if (result.created) parts.push(`${result.created} created`)
          if (result.removed) parts.push(`${result.removed} removed`)
          toast.success(`Applied: ${parts.join(', ')}`)
          onOpenChange(false)
        },
        onError: () => toast.error('Failed to apply changes'),
      }
    )
  }

  const isEmpty = diff.modified.length === 0 && diff.added.length === 0 && diff.removed.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>Review CSV Import</DialogTitle>
          <DialogDescription>
            {isEmpty ? (
              'No changes detected between the CSV and current tasks.'
            ) : (
              <span className="flex items-center gap-3 mt-1">
                {diff.modified.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    {diff.modified.length} modified
                  </span>
                )}
                {diff.added.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    {diff.added.length} new
                  </span>
                )}
                {diff.removed.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    {diff.removed.length} removed
                  </span>
                )}
                {diff.unchanged > 0 && (
                  <span className="text-muted-foreground">
                    {diff.unchanged} unchanged
                  </span>
                )}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {isEmpty ? (
          <div className="flex-1 flex items-center justify-center p-12">
            <div className="text-center space-y-2">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto" />
              <p className="text-sm text-muted-foreground">Everything is up to date.</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 scrollbar-dark">

            {/* MODIFIED SECTION */}
            {diff.modified.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <Checkbox
                    checked={allModifiedChecked}
                    indeterminate={someModifiedChecked && !allModifiedChecked}
                    onChange={v => toggleAllModified(v)}
                  />
                  <Edit3 className="h-4 w-4 text-amber-500" />
                  <h3 className="text-sm font-semibold">Modified</h3>
                  <Badge variant="secondary" className="text-xs">{diff.modified.length}</Badge>
                </div>
                <div className="space-y-2">
                  {diff.modified.map(mod => {
                    const taskChecked = isModifiedTaskChecked(mod.id)
                    const taskIndet = isModifiedTaskIndeterminate(mod.id)
                    return (
                      <div key={mod.id} className="border rounded-lg bg-card">
                        {/* Task header */}
                        <div className="flex items-center gap-3 px-4 py-3 border-b bg-amber-500/5">
                          <Checkbox
                            checked={taskChecked}
                            indeterminate={taskIndet}
                            onChange={v => toggleModifiedTask(mod.id, v)}
                          />
                          <span className="text-sm font-medium flex-1 min-w-0 truncate">{mod.current.title}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {mod.changes.length} {mod.changes.length === 1 ? 'change' : 'changes'}
                          </Badge>
                        </div>
                        {/* Field changes */}
                        <div className="px-4 py-2 space-y-2">
                          {mod.changes.map(change => {
                            const fieldChecked = modifiedSel[mod.id]?.[change.field] ?? false
                            const editedValue = modifiedEdits[mod.id]?.[change.field] ?? change.newValue
                            return (
                              <div key={change.field} className="flex items-start gap-3 py-1.5">
                                <Checkbox
                                  checked={fieldChecked}
                                  onChange={v => toggleModifiedField(mod.id, change.field, v)}
                                  className="mt-1.5"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
                                    {change.label}
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className={cn(
                                      'text-xs px-2 py-0.5 rounded max-w-[280px] truncate',
                                      'bg-red-500/10 text-red-400 line-through'
                                    )}>
                                      {change.oldValue || '(empty)'}
                                    </span>
                                    <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <div className={cn(
                                      'flex-1 min-w-[140px]',
                                      fieldChecked ? 'opacity-100' : 'opacity-40'
                                    )}>
                                      <FieldValueEditor
                                        field={change.field}
                                        value={editedValue}
                                        onChange={v => setModifiedEdit(mod.id, change.field, v)}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* ADDED SECTION */}
            {diff.added.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <Checkbox
                    checked={allAddedChecked}
                    indeterminate={someAddedChecked && !allAddedChecked}
                    onChange={v => toggleAllAdded(v)}
                  />
                  <Plus className="h-4 w-4 text-emerald-500" />
                  <h3 className="text-sm font-semibold">New Tasks</h3>
                  <Badge variant="secondary" className="text-xs">{diff.added.length}</Badge>
                </div>
                <div className="space-y-2">
                  {diff.added.map((row, idx) => {
                    const checked = addedSel[idx] ?? false
                    const edits = addedEdits[idx] || {}
                    return (
                      <div key={idx} className={cn(
                        'border rounded-lg bg-card',
                        checked ? 'border-emerald-500/30' : 'opacity-50'
                      )}>
                        <div className="px-4 py-3 space-y-2">
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={checked}
                              onChange={v => toggleAdded(idx, v)}
                              className="mt-0.5"
                            />
                            <div className="flex-1 min-w-0 space-y-2">
                              <div>
                                <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Title</div>
                                <Input
                                  value={edits.title ?? row.title}
                                  onChange={e => setAddedEdit(idx, 'title', e.target.value)}
                                  className="h-7 text-xs"
                                />
                              </div>
                              {(row.description || edits.description) && (
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Description</div>
                                  <Input
                                    value={edits.description ?? row.description}
                                    onChange={e => setAddedEdit(idx, 'description', e.target.value)}
                                    className="h-7 text-xs"
                                  />
                                </div>
                              )}
                              <div className="flex gap-3">
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Priority</div>
                                  <FieldValueEditor
                                    field="priority"
                                    value={edits.priority ?? row.priority}
                                    onChange={v => setAddedEdit(idx, 'priority', v)}
                                  />
                                </div>
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Status</div>
                                  <FieldValueEditor
                                    field="status"
                                    value={edits.status ?? row.status}
                                    onChange={v => setAddedEdit(idx, 'status', v)}
                                  />
                                </div>
                              </div>
                              {(row.prompt_template || edits.prompt_template) && (
                                <div>
                                  <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Prompt</div>
                                  <Input
                                    value={edits.prompt_template ?? row.prompt_template}
                                    onChange={e => setAddedEdit(idx, 'prompt_template', e.target.value)}
                                    className="h-7 text-xs font-mono"
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            {/* REMOVED SECTION */}
            {diff.removed.length > 0 && (
              <section>
                <div className="flex items-center gap-3 mb-3">
                  <Checkbox
                    checked={allRemovedChecked}
                    indeterminate={someRemovedChecked && !allRemovedChecked}
                    onChange={v => toggleAllRemoved(v)}
                  />
                  <Trash2 className="h-4 w-4 text-red-500" />
                  <h3 className="text-sm font-semibold">Removed</h3>
                  <Badge variant="secondary" className="text-xs">{diff.removed.length}</Badge>
                </div>
                <div className="p-3 rounded-lg border border-red-500/20 bg-red-500/5 mb-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                    <p className="text-xs text-red-400">
                      These tasks exist in the system but are missing from the CSV. Select to delete them.
                      Removed tasks are <strong>not selected by default</strong> for safety.
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  {diff.removed.map(task => {
                    const checked = removedSel[task.id] ?? false
                    return (
                      <div key={task.id} className={cn(
                        'flex items-start gap-3 px-4 py-3 border rounded-lg bg-card',
                        checked && 'border-red-500/30 bg-red-500/5'
                      )}>
                        <Checkbox
                          checked={checked}
                          onChange={v => toggleRemoved(task.id, v)}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{task.title}</div>
                          {task.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{task.description}</div>
                          )}
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-[10px]">
                              {PriorityLabel(task.priority)}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {StatusLabel(task.status)}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        )}

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!isEmpty && (
            <Button
              onClick={handleApply}
              disabled={counts.total === 0 || applyCsv.isPending}
            >
              {applyCsv.isPending ? 'Applying...' : `Apply ${counts.total} ${counts.total === 1 ? 'change' : 'changes'}`}
              {counts.modified > 0 && counts.added > 0 && (
                <span className="text-xs opacity-70 ml-1">
                  ({counts.modified}u {counts.added}n{counts.removed > 0 ? ` ${counts.removed}d` : ''})
                </span>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
