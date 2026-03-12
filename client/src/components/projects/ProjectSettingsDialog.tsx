import { useState, useRef, useEffect } from 'react'
import { Star, Link2, Plus, Trash2, FolderOpen, Copy } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { useUpdateProject, type Project } from '@/hooks/useProjects'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ProjectSettingsDialogProps {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProjectSettingsDialog({ project, open, onOpenChange }: ProjectSettingsDialogProps) {
  const updateProject = useUpdateProject()

  // General
  const [name, setName] = useState(project.name)

  // Notes
  const [notes, setNotes] = useState(project.notes || '')
  const [editingNotes, setEditingNotes] = useState(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  // Links
  const [addingLink, setAddingLink] = useState(false)
  const [linkLabel, setLinkLabel] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const linkLabelRef = useRef<HTMLInputElement>(null)

  // External link
  const [externalLink, setExternalLink] = useState(project.externalLink || '')

  // Sync state when project changes
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

        <Tabs defaultValue="general" className="mt-2">
          <TabsList className="h-8">
            <TabsTrigger value="general" className="text-xs h-7">General</TabsTrigger>
            <TabsTrigger value="links" className="text-xs h-7">Links & Notes</TabsTrigger>
          </TabsList>

          {/* General */}
          <TabsContent value="general" className="space-y-4 mt-3">
            {/* Name */}
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
                    project.favorite ? 'fill-yellow-500 text-yellow-500' : 'text-muted-foreground'
                  )} />
                </Button>
              </div>
            </div>

            {/* Path */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Path</label>
              <div className="flex items-center gap-2 rounded border px-3 py-1.5 bg-muted/30">
                <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                <span className="text-xs text-muted-foreground truncate flex-1">{project.path}</span>
                <button onClick={copyPath} className="text-muted-foreground/40 hover:text-foreground shrink-0" title="Copy path">
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Tech Stack */}
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

            {/* Category */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Category</label>
              <span className="text-xs text-muted-foreground block">{project.category}</span>
            </div>
          </TabsContent>

          {/* Links & Notes */}
          <TabsContent value="links" className="space-y-4 mt-3">
            {/* External link */}
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

            {/* Notes */}
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
                <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words leading-relaxed border rounded p-2 bg-muted/20">
                  {project.notes}
                </p>
              ) : null}
            </div>

            {/* Links list */}
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
                <div className="space-y-1.5 rounded border p-2 bg-muted/30">
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
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
