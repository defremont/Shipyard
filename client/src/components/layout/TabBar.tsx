import { memo, useMemo, useState } from 'react'
import { Home, X, XSquare } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useTabs } from '@/hooks/useTabs'
import { useProjects, type Project } from '@/hooks/useProjects'
import { ProjectContextMenu } from '@/components/projects/ProjectContextMenu'
import { ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu'

const ProjectTab = memo(function ProjectTab({ tabId, project, isActive, isDragging, isDragOver, onSwitch, onClose, onCloseOthers, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }: {
  tabId: string
  project?: Project
  isActive: boolean
  isDragging: boolean
  isDragOver: boolean
  onSwitch: () => void
  onClose: () => void
  onCloseOthers: () => void
  onDragStart: (event: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (event: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (event: React.DragEvent) => void
}) {
  const label = project?.name || tabId
  const hasLocalChanges = (project?.gitStaged ?? 0) > 0
    || (project?.gitUnstaged ?? 0) > 0
    || (project?.gitUntracked ?? 0) > 0

  const tab = (
    <div
      draggable
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault()
          onClose()
        }
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'group relative flex h-7 min-w-0 max-w-[160px] basis-0 flex-1 items-center overflow-hidden transition-colors cursor-grab active:cursor-grabbing',
        isActive
          ? 'bg-background text-foreground shadow-sm ring-1 ring-border/80'
          : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
        isDragging && 'opacity-40',
        isDragOver && 'ring-2 ring-primary ring-inset'
      )}
    >
      <button
        className="flex h-full min-w-0 flex-1 items-center px-2 text-left text-[11px] font-medium leading-none"
        onClick={onSwitch}
        title={`${label} — ${project?.path || tabId}`}
      >
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <span className="ml-auto flex h-full shrink-0 items-center gap-0.5 pr-1">
        {hasLocalChanges && (
          <span
            className="flex h-4 w-3 items-center justify-center"
            title="Uncommitted changes"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
          </span>
        )}
        <button
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded transition-opacity hover:bg-accent hover:!opacity-100',
            isActive ? 'opacity-60' : 'opacity-0 group-hover:opacity-60 focus:opacity-100'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
          title={`Close ${label}`}
        >
          <X className="h-3 w-3" />
        </button>
      </span>
    </div>
  )

  // Without a project record (a tab for a project that was removed) there is
  // nothing to act on, so the plain tab is all we can offer.
  if (!project) return tab

  return (
    <ProjectContextMenu
      project={project}
      extra={
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onClose}>
            <X />
            Close Tab
          </ContextMenuItem>
          <ContextMenuItem onClick={onCloseOthers}>
            <XSquare />
            Close Other Tabs
          </ContextMenuItem>
        </>
      }
    >
      {tab}
    </ProjectContextMenu>
  )
})

export function TabBar() {
  const { tabs, activeTabId, switchTab, closeTab, closeOtherTabs, reorderTabs } = useTabs()
  const { data: projects } = useProjects()
  const location = useLocation()
  const navigate = useNavigate()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const projectById = useMemo(
    () => new Map((projects || []).map(project => [project.id, project])),
    [projects]
  )
  const isHome = ['/', '/tasks', '/settings', '/help', '/logs'].includes(location.pathname)

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 overflow-hidden border-b bg-card/70 px-1 backdrop-blur-sm">
      <button
        aria-label="Home"
        title="Home"
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors',
          isHome
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/80'
            : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
        )}
        onClick={() => navigate('/')}
      >
        <Home className="h-3.5 w-3.5" />
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-px overflow-hidden">
        {tabs.map(tab => (
          <ProjectTab
            key={tab.id}
            tabId={tab.id}
            project={projectById.get(tab.id)}
            isActive={tab.id === activeTabId}
            isDragging={draggingId === tab.id}
            isDragOver={dragOverId === tab.id && draggingId !== tab.id}
            onSwitch={() => switchTab(tab.id)}
            onClose={() => closeTab(tab.id)}
            onCloseOthers={() => closeOtherTabs(tab.id)}
            onDragStart={(event) => {
              setDraggingId(tab.id)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', tab.id)
            }}
            onDragEnd={() => {
              setDraggingId(null)
              setDragOverId(null)
            }}
            onDragOver={(event) => {
              if (draggingId && draggingId !== tab.id) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                setDragOverId(tab.id)
              }
            }}
            onDragLeave={() => setDragOverId(previous => previous === tab.id ? null : previous)}
            onDrop={(event) => {
              event.preventDefault()
              const fromId = event.dataTransfer.getData('text/plain') || draggingId
              if (fromId) reorderTabs(fromId, tab.id)
              setDraggingId(null)
              setDragOverId(null)
            }}
          />
        ))}
      </div>
    </div>
  )
}
