import { useEffect, useState, useCallback } from 'react'
import { Command } from 'cmdk'
import { useNavigate } from 'react-router-dom'
import {
  FolderOpen,
  ClipboardList,
  Settings,
  HelpCircle,
  LayoutDashboard,
  Search,
  ArrowRight,
  AlertTriangle,
  ArrowUp,
  Minus,
  ArrowDown as ArrowDownIcon,
} from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { useAllTasks, type Task } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'

const priorityConfig: Record<string, { icon: typeof AlertTriangle; color: string; label: string }> = {
  urgent: { icon: AlertTriangle, color: 'text-red-400', label: 'Urgent' },
  high: { icon: ArrowUp, color: 'text-orange-400', label: 'High' },
  medium: { icon: Minus, color: 'text-yellow-400', label: 'Medium' },
  low: { icon: ArrowDownIcon, color: 'text-blue-400', label: 'Low' },
}

const statusLabels: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
}

export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const { openTab } = useTabs()
  const { data: projects } = useProjects()
  // Same as GlobalSearch: always mounted, only needs data while open.
  const { data: tasks } = useAllTasks({ enabled: open })

  // Listen for Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const runAction = useCallback((action: () => void) => {
    action()
    setOpen(false)
  }, [])

  // Build project name lookup for tasks
  const projectNameMap = new Map<string, string>()
  projects?.forEach(p => {
    projectNameMap.set(p.id, p.name)
  })

  // Filter active tasks (not done) for display, limited for performance
  const activeTasks = (tasks || []).filter((t: Task) => t.status !== 'done')

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Command dialog */}
      <div className="fixed left-1/2 top-[20%] -translate-x-1/2 w-full max-w-lg">
        <Command
          className="rounded-lg border bg-popover text-popover-foreground shadow-2xl overflow-hidden"
          loop
        >
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Command.Input
              placeholder="Search projects, tasks, or type a command..."
              className="flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              autoFocus
            />
            <kbd className="ml-2 pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground shrink-0">
              Esc
            </kbd>
          </div>

          <Command.List className="max-h-[300px] overflow-y-auto p-1 scrollbar-dark">
            <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {/* Quick Actions */}
            <Command.Group heading="Quick Actions" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
              <Command.Item
                value="Dashboard Home"
                onSelect={() => runAction(() => navigate('/'))}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
              >
                <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
                <span>Go to Dashboard</span>
              </Command.Item>

              <Command.Item
                value="All Tasks Kanban"
                onSelect={() => runAction(() => navigate('/tasks'))}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
              >
                <ClipboardList className="h-4 w-4 text-muted-foreground" />
                <span>All Tasks</span>
                {activeTasks.length > 0 && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    {activeTasks.length} active
                  </span>
                )}
              </Command.Item>

              <Command.Item
                value="Settings Configuration"
                onSelect={() => runAction(() => navigate('/settings'))}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span>Open Settings</span>
              </Command.Item>

              <Command.Item
                value="Help Manual Documentation"
                onSelect={() => runAction(() => navigate('/help'))}
                className="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
              >
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
                <span>Open Help</span>
              </Command.Item>
            </Command.Group>

            {/* Projects */}
            {projects && projects.length > 0 && (
              <Command.Group heading="Projects" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                {projects.map(project => (
                  <Command.Item
                    key={project.id}
                    value={`project ${project.name} ${project.category} ${project.techStack.join(' ')}`}
                    onSelect={() => runAction(() => openTab(project.id))}
                    className="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                  >
                    <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{project.name}</span>
                    {project.gitBranch && (
                      <span className="ml-auto text-xs text-muted-foreground truncate max-w-[120px]">
                        {project.gitBranch}
                      </span>
                    )}
                    <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {/* Tasks */}
            {activeTasks.length > 0 && (
              <Command.Group heading="Tasks" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground">
                {activeTasks.slice(0, 20).map((task: Task) => {
                  const pConfig = priorityConfig[task.priority]
                  const PriorityIcon = pConfig?.icon || Minus
                  const projectName = projectNameMap.get(task.projectId) || task.projectId

                  return (
                    <Command.Item
                      key={task.id}
                      value={`task ${task.title} ${projectName} ${task.priority} ${statusLabels[task.status] || task.status}`}
                      onSelect={() => runAction(() => openTab(task.projectId))}
                      className="relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50"
                    >
                      <PriorityIcon className={`h-3.5 w-3.5 shrink-0 ${pConfig?.color || 'text-muted-foreground'}`} />
                      <span className="truncate flex-1">{task.title}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0 max-w-[100px] truncate">
                        {projectName}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        {statusLabels[task.status] || task.status}
                      </span>
                    </Command.Item>
                  )
                })}
              </Command.Group>
            )}
          </Command.List>

          {/* Footer */}
          <div className="border-t px-3 py-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px]">&uarr;&darr;</kbd>
                navigate
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px]">&crarr;</kbd>
                select
              </span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex h-4 items-center rounded border bg-muted px-1 font-mono text-[10px]">Esc</kbd>
                close
              </span>
            </div>
          </div>
        </Command>
      </div>
    </div>
  )
}
