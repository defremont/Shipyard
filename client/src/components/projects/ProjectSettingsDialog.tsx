import { useState, useRef, useEffect, useCallback } from 'react'
import { Star, Link2, Plus, Trash2, FolderOpen, Copy, Zap, FileSpreadsheet, FileJson, FileText, Download, Import, Loader2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useUpdateProject, type Project } from '@/hooks/useProjects'
import { useProjectLaunch } from '@/hooks/useProjectLaunch'
import { useTasks, type Task } from '@/hooks/useTasks'
import { tasksToCSV, parseCSV, diffTasks, type CsvDiff } from '@/lib/csv'
import { getProvider } from '@/lib/sync/registry'
import type { ProviderConfig } from '@/lib/sync/types'
import '@/lib/sync/providers'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

function downloadFile(data: string | Blob, filename: string, mimeType: string) {
  const blob = typeof data === 'string' ? new Blob([data], { type: mimeType }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

interface ProjectSettingsDialogProps {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultTab?: string
}

export function ProjectSettingsDialog({ project, open, onOpenChange, defaultTab }: ProjectSettingsDialogProps) {
  const updateProject = useUpdateProject()

  const [name, setName] = useState(project.name)
  const [notes, setNotes] = useState(project.notes || '')
  const [editingNotes, setEditingNotes] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)
  const [addingLink, setAddingLink] = useState(false)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const linkLabelRef = useRef<HTMLInputElement>(null)
  const [externalLink, setExternalLink] = useState(project.externalLink || '')
  // One shared preference across every surface that launches Claude.
  const { skipPermissions, setSkipPermissions } = useProjectLaunch()
  const [activeTab, setActiveTab] = useState(defaultTab || 'general')
  const { data: tasks } = useTasks(project.id)
  const [exporting, setExporting] = useState<string | null>(null)
  const [mdPopoverOpen, setMdPopoverOpen] = useState(false)
  const csvInputRef = useRef<HTMLInputElement>(null)

  // Sync defaultTab when dialog opens
  useEffect(() => {
    if (open && defaultTab) setActiveTab(defaultTab)
  }, [open, defaultTab])

  useEffect(() => {
    setName(project.name)
    setNotes(project.notes || '')
    setExternalLink(project.externalLink || '')
  }, [project.name, project.notes, project.externalLink])

  const saveName = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== project.name) {
      updateProject.mutate({ id: project.id, name: trimmed }, {
        onSuccess: () => toast.success('Name updated'),
      })
    }
  }

  const toggleFavorite = () => {
    updateProject.mutate({ id: project.id, favorite: !project.favorite })
  }

  const saveNotes = () => {
    const trimmed = notes.trim()
    updateProject.mutate(
      { id: project.id, notes: trimmed || undefined },
      { onSuccess: () => { setEditingNotes(false); toast.success('Notes saved') } }
    )
  }

  const saveExternalLink = () => {
    const trimmed = externalLink.trim()
    updateProject.mutate(
      { id: project.id, externalLink: trimmed || undefined },
      { onSuccess: () => toast.success(trimmed ? 'Link saved' : 'Link removed') }
    )
  }

  const addLink = () => {
    if (!linkLabel.trim() || !linkUrl.trim()) return
    const newLinks = [...(project.links || []), { label: linkLabel.trim(), url: linkUrl.trim() }]
    updateProject.mutate(
      { id: project.id, links: newLinks },
      {
        onSuccess: () => {
          setLinkLabel('')
          setLinkUrl('')
          setAddingLink(false)
          toast.success('Link added')
        },
      }
    )
  }

  const removeLink = (index: number) => {
    const newLinks = (project.links || []).filter((_, i) => i !== index)
    updateProject.mutate(
      { id: project.id, links: newLinks.length > 0 ? newLinks : undefined },
      { onSuccess: () => toast.success('Link removed') }
    )
  }

  const copyPath = () => {
    navigator.clipboard.writeText(project.path)
    toast.success('Path copied')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">Project Settings</DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
          <TabsList className="h-8">
            <TabsTrigger value="general" className="text-xs h-7">General</TabsTrigger>
            <TabsTrigger value="links" className="text-xs h-7">Links & Notes</TabsTrigger>
            <TabsTrigger value="launch" className="text-xs h-7">Launch</TabsTrigger>
            <TabsTrigger value="data" className="text-xs h-7">Data</TabsTrigger>
          </TabsList>

          {/* General */}
          <TabsContent value="general" className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Name</label>
              <div className="flex gap-2">
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="h-8 text-sm"
                  onKeyDown={e => { if (e.key === 'Enter') saveName() }}
                  onBlur={saveName}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={toggleFavorite}
                  title={project.favorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Star className={cn(
                    'h-4 w-4',
                    project.favorite ? 'fill-warning text-warning' : 'text-muted-foreground'
                  )} />
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Path</label>
              <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 bg-muted/30">
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                <span className="text-xs text-muted-foreground truncate flex-1">{project.path}</span>
                <button onClick={copyPath} className="text-muted-foreground/40 hover:text-foreground shrink-0" title="Copy path">
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>

            {project.techStack.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Tech Stack</label>
                <div className="flex flex-wrap gap-1">
                  {project.techStack.map(tech => (
                    <Badge key={tech} variant="secondary" className="text-[10px]">{tech}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <span className="text-xs text-muted-foreground block">{project.category}</span>
            </div>
          </TabsContent>

          {/* Links & Notes */}
          <TabsContent value="links" className="space-y-4 mt-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Quick Link</label>
              <div className="flex gap-2">
                <Input
                  value={externalLink}
                  onChange={e => setExternalLink(e.target.value)}
                  placeholder="https://notion.so/... or any URL"
                  className="h-8 text-xs"
                  onKeyDown={e => { if (e.key === 'Enter') saveExternalLink() }}
                  onBlur={saveExternalLink}
                />
                {externalLink && (
                  <a href={externalLink} target="_blank" rel="noopener noreferrer" className="shrink-0 flex items-center">
                    <Link2 className="h-3.5 w-3.5 text-blue-500" />
                  </a>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground/50">Shown as icon in workspace header. Notion, Sheets, Figma, etc.</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Notes</label>
                {!editingNotes && (
                  <button
                    onClick={() => { setEditingNotes(true); setTimeout(() => notesRef.current?.focus(), 50) }}
                    className="text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors"
                  >
                    {project.notes ? 'edit' : '+ add'}
                  </button>
                )}
              </div>
              {editingNotes ? (
                <div className="space-y-1.5">
                  <Textarea
                    ref={notesRef}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Project notes, context, reminders..."
                    className="text-xs min-h-[80px] resize-none"
                    rows={4}
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setEditingNotes(false); setNotes(project.notes || '') }
                    }}
                  />
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                      onClick={() => { setEditingNotes(false); setNotes(project.notes || '') }}>
                      Cancel
                    </Button>
                    <Button size="sm" className="h-6 text-[10px] px-2" onClick={saveNotes}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : project.notes ? (
                <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed border rounded-md p-2 bg-muted/20">
                  {project.notes}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Links</label>
                <button
                  onClick={() => { setAddingLink(true); setTimeout(() => linkLabelRef.current?.focus(), 50) }}
                  className="text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors flex items-center gap-0.5"
                >
                  <Plus className="h-3 w-3" /> add
                </button>
              </div>

              {project.links && project.links.length > 0 && (
                <div className="space-y-1">
                  {project.links.map((link, i) => (
                    <div key={i} className="flex items-center gap-1.5 group">
                      <Link2 className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-500 hover:text-blue-400 truncate flex-1 transition-colors"
                        title={link.url}
                      >
                        {link.label}
                      </a>
                      <button
                        onClick={() => removeLink(i)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {addingLink && (
                <div className="space-y-1.5 rounded-md border p-2 bg-muted/30">
                  <Input
                    ref={linkLabelRef}
                    value={linkLabel}
                    onChange={e => setLinkLabel(e.target.value)}
                    placeholder="Label (e.g. Figma, Notion)"
                    className="h-7 text-xs"
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setAddingLink(false); setLinkLabel(''); setLinkUrl('') }
                    }}
                  />
                  <Input
                    value={linkUrl}
                    onChange={e => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="h-7 text-xs"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && linkLabel.trim() && linkUrl.trim()) addLink()
                      if (e.key === 'Escape') { setAddingLink(false); setLinkLabel(''); setLinkUrl('') }
                    }}
                  />
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                      onClick={() => { setAddingLink(false); setLinkLabel(''); setLinkUrl('') }}>
                      Cancel
                    </Button>
                    <Button size="sm" className="h-6 text-[10px] px-2" onClick={addLink}
                      disabled={!linkLabel.trim() || !linkUrl.trim()}>
                      Add
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Launch preferences */}
          <TabsContent value="launch" className="space-y-4 mt-3">
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Launch shortcuts are available in the workspace header bar: Claude, Dev Server, Shell, and Open Folder.
              </p>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Claude Code</label>
                <button
                  onClick={() => setSkipPermissions(!skipPermissions)}
                  className="flex items-center justify-between w-full px-3 py-2.5 rounded-md border hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Zap className={cn('h-4 w-4', skipPermissions ? 'text-warning' : 'text-muted-foreground/50')} />
                    <div className="text-left">
                      <span className="text-xs font-medium">Skip permissions (YOLO mode)</span>
                      <p className="text-[10px] text-muted-foreground">Uses --dangerously-skip-permissions flag</p>
                    </div>
                  </div>
                  <div className={cn(
                    'w-8 h-4.5 rounded-full transition-colors relative',
                    skipPermissions ? 'bg-warning' : 'bg-muted'
                  )}>
                    <div className={cn(
                      'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform',
                      skipPermissions ? 'translate-x-3.5' : 'translate-x-0.5'
                    )} />
                  </div>
                </button>
              </div>
            </div>
          </TabsContent>

          {/* Task Data - Import / Export */}
          <TabsContent value="data" className="space-y-4 mt-3">
            <p className="text-xs text-muted-foreground">
              Import and export tasks in different formats. {tasks?.length || 0} tasks in this project.
            </p>

            {/* Export section */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Export</label>
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 justify-start"
                  onClick={() => {
                    if (!tasks?.length) { toast.info('No tasks'); return }
                    const csv = tasksToCSV(tasks)
                    downloadFile(csv, `tasks-${project.id}.csv`, 'text/csv')
                    toast.success('CSV exported')
                  }}>
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 justify-start"
                  disabled={exporting === 'json'}
                  onClick={async () => {
                    const provider = getProvider('json-export')
                    if (!provider?.export || !tasks?.length) { toast.info('No tasks'); return }
                    setExporting('json')
                    try {
                      const config: ProviderConfig = { providerId: 'json-export', projectId: project.id, enabled: true, settings: { includeCompleted: true, prettyPrint: true }, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null }
                      const result = await provider.export(config, tasks)
                      downloadFile(result.data, result.filename, result.mimeType)
                      toast.success('JSON exported')
                    } catch { toast.error('Export failed') }
                    finally { setExporting(null) }
                  }}>
                  {exporting === 'json' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />}
                  JSON
                </Button>
                <Popover open={mdPopoverOpen} onOpenChange={setMdPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 justify-start"
                      disabled={exporting === 'md'}>
                      {exporting === 'md' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                      Markdown
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-56" align="start">
                    <div className="space-y-1">
                      <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Copy to clipboard</p>
                      {[
                        { label: 'Checklist (by status)', format: 'checklist', groupBy: 'status' },
                        { label: 'Checklist (by priority)', format: 'checklist', groupBy: 'priority' },
                        { label: 'Table', format: 'table', groupBy: 'status' },
                        { label: 'Detailed', format: 'detailed', groupBy: 'status' },
                      ].map(opt => (
                        <button key={opt.label}
                          className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors"
                          onClick={async () => {
                            const provider = getProvider('markdown-export')
                            if (!provider?.export || !tasks?.length) return
                            setExporting('md')
                            try {
                              const config: ProviderConfig = { providerId: 'markdown-export', projectId: project.id, enabled: true, settings: { format: opt.format, groupBy: opt.groupBy, includeDone: opt.format === 'detailed' }, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null }
                              const result = await provider.export(config, tasks)
                              if (typeof result.data === 'string') { await navigator.clipboard.writeText(result.data); toast.success('Copied') }
                            } catch { toast.error('Failed') }
                            finally { setExporting(null); setMdPopoverOpen(false) }
                          }}>
                          {opt.label}
                        </button>
                      ))}
                      <div className="border-t my-1" />
                      <button className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-accent transition-colors flex items-center gap-1.5 text-muted-foreground"
                        onClick={async () => {
                          const provider = getProvider('markdown-export')
                          if (!provider?.export || !tasks?.length) return
                          setExporting('md')
                          try {
                            const config: ProviderConfig = { providerId: 'markdown-export', projectId: project.id, enabled: true, settings: { format: 'checklist', groupBy: 'status', includeDone: false }, lastSyncAt: null, lastSyncStatus: null, lastSyncError: null }
                            const result = await provider.export(config, tasks)
                            downloadFile(result.data, result.filename, result.mimeType)
                            toast.success('Downloaded')
                          } catch { toast.error('Failed') }
                          finally { setExporting(null); setMdPopoverOpen(false) }
                        }}>
                        <Download className="h-3 w-3" />
                        Download .md
                      </button>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Import section */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Import</label>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5"
                  onClick={() => csvInputRef.current?.click()}>
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  Import CSV
                </Button>
                <input ref={csvInputRef} type="file" accept=".csv" className="hidden"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (!file || !tasks) return
                    const reader = new FileReader()
                    reader.onload = ev => {
                      try {
                        const imported = parseCSV(ev.target?.result as string)
                        const diff = diffTasks(tasks, imported)
                        // Dispatch event for CsvReviewDialog in TaskBoard
                        window.dispatchEvent(new CustomEvent('shipyard:csv-import', { detail: { diff } }))
                        onOpenChange(false)
                      } catch (err: any) { toast.error(err.message || 'Failed to parse CSV') }
                    }
                    reader.readAsText(file)
                    e.target.value = ''
                  }} />
              </div>
              <p className="text-[10px] text-muted-foreground/60">
                CSV import opens a diff review before applying changes. Use the Bulk Import (AI) button in the TaskBoard toolbar for free-form text.
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
