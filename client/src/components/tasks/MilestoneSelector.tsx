import { useState } from 'react'
import { ChevronDown, Plus, Pencil, Trash2, Archive, RotateCcw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMilestones, useDeleteMilestone, useUpdateMilestone, type Milestone } from '@/hooks/useMilestones'
import { MilestoneDialog } from './MilestoneDialog'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface MilestoneSelectorProps {
  projectId: string
  milestoneId: string
  onMilestoneChange: (milestoneId: string) => void
}

export function MilestoneSelector({ projectId, milestoneId, onMilestoneChange }: MilestoneSelectorProps) {
  const { data: milestones } = useMilestones(projectId)
  const deleteMilestone = useDeleteMilestone()
  const updateMilestone = useUpdateMilestone()
  const [open, setOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingMilestone, setEditingMilestone] = useState<Milestone | null>(null)

  const active = milestones?.find(m => m.id === milestoneId) || milestones?.[0]
  const hasCustomMilestones = milestones && milestones.length > 1

  const handleSelect = (id: string) => {
    onMilestoneChange(id)
    setOpen(false)
  }

  const handleNew = () => {
    setEditingMilestone(null)
    setDialogOpen(true)
    setOpen(false)
  }

  const handleEdit = (m: Milestone, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingMilestone(m)
    setDialogOpen(true)
    setOpen(false)
  }

  const handleDelete = (m: Milestone, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete milestone "${m.name}"? Tasks will be moved to General.`)) return
    deleteMilestone.mutate(
      { projectId, milestoneId: m.id },
      {
        onSuccess: () => {
          if (milestoneId === m.id) onMilestoneChange('default')
          toast.success(`Deleted milestone "${m.name}"`)
        },
      }
    )
  }

  const handleToggleStatus = (m: Milestone, e: React.MouseEvent) => {
    e.stopPropagation()
    const newStatus = m.status === 'active' ? 'closed' : 'active'
    updateMilestone.mutate(
      { projectId, milestoneId: m.id, status: newStatus },
      { onSuccess: () => toast.success(`Milestone ${newStatus === 'closed' ? 'closed' : 'reopened'}`) }
    )
  }

  // Only show the selector if there are custom milestones
  if (!hasCustomMilestones) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground" onClick={handleNew}>
              <Plus className="h-3 w-3" />
              Milestone
            </Button>
          </TooltipTrigger>
          <TooltipContent>Create a milestone to organize tasks into phases</TooltipContent>
        </Tooltip>
        <MilestoneDialog
          projectId={projectId}
          milestone={editingMilestone}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onCreated={(id) => onMilestoneChange(id)}
        />
      </>
    )
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-1.5 py-0.5 rounded hover:bg-accent">
            <span className={cn(
              'w-1.5 h-1.5 rounded-full',
              active?.status === 'active' ? 'bg-success' : 'bg-muted-foreground/40'
            )} />
            {active?.name || 'General'}
            <ChevronDown className="h-3 w-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-56 p-1">
          <div className="space-y-0.5">
            {milestones?.filter(m => m.status === 'active').map(m => (
              <div
                key={m.id}
                onClick={() => handleSelect(m.id)}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs group',
                  m.id === milestoneId
                    ? 'bg-accent text-foreground'
                    : 'hover:bg-accent/50 text-muted-foreground'
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                <span className="flex-1 truncate">{m.name}</span>
                {m.id !== 'default' && (
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                    <button onClick={(e) => handleToggleStatus(m, e)} className="p-0.5 hover:text-foreground">
                      <Archive className="h-3 w-3" />
                    </button>
                    <button onClick={(e) => handleEdit(m, e)} className="p-0.5 hover:text-foreground">
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button onClick={(e) => handleDelete(m, e)} className="p-0.5 hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            ))}
            {milestones?.some(m => m.status === 'closed') && (
              <>
                <div className="border-t my-1" />
                <div className="px-2 py-1 text-[10px] text-muted-foreground/50 uppercase tracking-wider">Closed</div>
                {milestones.filter(m => m.status === 'closed').map(m => (
                  <div
                    key={m.id}
                    onClick={() => handleSelect(m.id)}
                    className={cn(
                      'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-xs group',
                      m.id === milestoneId
                        ? 'bg-accent text-foreground'
                        : 'hover:bg-accent/50 text-muted-foreground/60'
                    )}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
                    <span className="flex-1 truncate">{m.name}</span>
                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5">
                      <button onClick={(e) => handleToggleStatus(m, e)} className="p-0.5 hover:text-foreground">
                        <RotateCcw className="h-3 w-3" />
                      </button>
                      <button onClick={(e) => handleEdit(m, e)} className="p-0.5 hover:text-foreground">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={(e) => handleDelete(m, e)} className="p-0.5 hover:text-destructive">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
            <div className="border-t my-1" />
            <button
              onClick={handleNew}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50"
            >
              <Plus className="h-3 w-3" />
              New milestone
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <MilestoneDialog
        projectId={projectId}
        milestone={editingMilestone}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(id) => onMilestoneChange(id)}
      />
    </>
  )
}
