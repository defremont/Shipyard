import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Home, MoreHorizontal, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useTabs, type Tab } from '@/hooks/useTabs'
import { useProjects, type Project } from '@/hooks/useProjects'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

const HOME_WIDTH = 84
const OVERFLOW_WIDTH = 40
const TARGET_TAB_WIDTH = 132

const ProjectTab = memo(function ProjectTab({ tabId, project, isActive, isDragging, isDragOver, onSwitch, onClose, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }: {
  tabId: string
  project?: Project
  isActive: boolean
  isDragging: boolean
  isDragOver: boolean
  onSwitch: () => void
  onClose: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
}) {
  const label = project?.name || tabId
  const hasLocalChanges = (project?.gitStaged ?? 0) > 0
    || (project?.gitUnstaged ?? 0) > 0
    || (project?.gitUntracked ?? 0) > 0

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'group flex h-8 min-w-[92px] max-w-[200px] flex-1 items-center gap-1 rounded-md px-2 transition-all cursor-grab active:cursor-grabbing',
        isActive
          ? 'bg-background text-foreground shadow-sm ring-1 ring-border/80'
          : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
        isDragging && 'opacity-40',
        isDragOver && 'ring-2 ring-primary ring-inset'
      )}
    >
      <button
        className="min-w-0 flex-1 truncate text-left text-xs font-medium"
        onClick={onSwitch}
        title={project?.path || tabId}
      >
        {label}
      </button>
      {hasLocalChanges && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" title="Uncommitted changes" />
      )}
      <button
        className={cn(
          'ml-0.5 shrink-0 rounded p-0.5 transition-opacity hover:bg-accent',
          isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
        )}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        title="Close project"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
})

function selectVisibleTabs(tabs: Tab[], activeTabId: string | null, capacity: number) {
  if (tabs.length <= capacity) return { visible: tabs, hidden: [] as Tab[] }

  const visible = tabs.slice(0, capacity)
  if (activeTabId && !visible.some(tab => tab.id === activeTabId)) {
    const active = tabs.find(tab => tab.id === activeTabId)
    if (active) visible[visible.length - 1] = active
  }
  const visibleIds = new Set(visible.map(tab => tab.id))
  return { visible, hidden: tabs.filter(tab => !visibleIds.has(tab.id)) }
}

export function TabBar() {
  const { tabs, activeTabId, switchTab, closeTab, reorderTabs } = useTabs()
  const { data: projects } = useProjects()
  const location = useLocation()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = () => setAvailableWidth(container.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const projectById = useMemo(
    () => new Map((projects || []).map(project => [project.id, project])),
    [projects]
  )
  const capacity = Math.max(1, Math.floor((availableWidth - HOME_WIDTH - OVERFLOW_WIDTH - 20) / TARGET_TAB_WIDTH))
  const { visible, hidden } = useMemo(
    () => selectVisibleTabs(tabs, activeTabId, capacity),
    [tabs, activeTabId, capacity]
  )
  const isHome = ['/', '/tasks', '/settings', '/help', '/logs'].includes(location.pathname)

  return (
    <div ref={containerRef} className="flex h-10 shrink-0 items-center gap-1 overflow-hidden border-b bg-card/70 px-1.5 backdrop-blur-sm">
      <button
        className={cn(
          'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors',
          isHome
            ? 'bg-background text-foreground shadow-sm ring-1 ring-border/80 font-medium'
            : 'text-muted-foreground hover:bg-background/60 hover:text-foreground'
        )}
        onClick={() => navigate('/')}
      >
        <Home className="h-3.5 w-3.5" />
        Home
      </button>

      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
        {visible.map(tab => (
          <ProjectTab
            key={tab.id}
            tabId={tab.id}
            project={projectById.get(tab.id)}
            isActive={tab.id === activeTabId}
            isDragging={draggingId === tab.id}
            isDragOver={dragOverId === tab.id && draggingId !== tab.id}
            onSwitch={() => switchTab(tab.id)}
            onClose={() => closeTab(tab.id)}
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

      {hidden.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
              title={`${hidden.length} more open projects`}
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="tabular-nums">{hidden.length}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            {hidden.map(tab => {
              const project = projectById.get(tab.id)
              return (
                <DropdownMenuItem key={tab.id} onSelect={() => switchTab(tab.id)} className="group">
                  <span className="min-w-0 flex-1 truncate">{project?.name || tab.id}</span>
                  <button
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-70"
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(tab.id)
                    }}
                    title="Close project"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}
