import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Search, Loader, AlertTriangle, ArrowUp, ArrowDown, Minus, Circle, ArrowRight, Star, GitBranch, Clock, Terminal, Code2, FolderOpen } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Header } from '@/components/layout/Header'
import { useProjects, useLaunchTerminal, useLaunchVSCode, type Project } from '@/hooks/useProjects'
import { useAllTasks, type Task } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'
import { toast } from 'sonner'

const priorityConfig = {
  urgent: { icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-500/10' },
  high: { icon: ArrowUp, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  medium: { icon: Minus, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  low: { icon: ArrowDown, color: 'text-red-500', bg: 'bg-red-500/10' },
}

function ActiveProjectGroup({ project, tasks }: { project: Project; tasks: Task[] }) {
  const launchTerminal = useLaunchTerminal()
  const launchVSCode = useLaunchVSCode()
  const { openTab } = useTabs()

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => openTab(project.id)}
            className="flex items-center gap-2 font-semibold text-sm hover:text-primary transition-colors"
          >
            {project.name}
            <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />
          </button>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => launchTerminal.mutate({ projectId: project.id, type: 'claude' }, { onSuccess: () => toast.success('Launched Claude') })}
              title="Claude Code"
            >
              <Terminal className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => launchVSCode.mutate(project.id, { onSuccess: () => toast.success('Opened VS Code') })}
              title="VS Code"
            >
              <Code2 className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-6 w-6"
              onClick={() => openTab(project.id)}
              title="Open workspace"
            >
              <ArrowRight className="h-3 w-3" />
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          {tasks.map(task => {
            const pri = priorityConfig[task.priority]
            const PriIcon = pri.icon
            return (
              <button
                key={task.id}
                onClick={() => openTab(task.projectId)}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 transition-colors w-full text-left"
              >
                <PriIcon className={cn('h-3 w-3 shrink-0', pri.color)} />
                <span className="text-sm flex-1 truncate">{task.title}</span>
                {task.inProgressAt && (
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">
                    {formatDistanceToNow(new Date(task.inProgressAt), { addSuffix: true })}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function CompactProjectRow({ project }: { project: Project }) {
  const { openTab } = useTabs()

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent/50 transition-colors cursor-pointer"
      onClick={() => openTab(project.id)}
    >
      {project.favorite && <Star className="h-3 w-3 fill-yellow-500 text-yellow-500 shrink-0" />}
      <span className="text-sm font-medium flex-1 truncate">{project.name}</span>
      {project.isGitRepo && project.gitBranch && (
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
          <GitBranch className="h-2.5 w-2.5" />
          {project.gitBranch}
        </span>
      )}
      {project.techStack.length > 0 && (
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
          {project.techStack[0]}
        </Badge>
      )}
      {project.lastCommitDate && (
        <span className="text-[10px] text-muted-foreground/50 shrink-0">
          {formatDistanceToNow(new Date(project.lastCommitDate), { addSuffix: true })}
        </span>
      )}
    </div>
  )
}

export function Dashboard() {
  const { data: projects, isLoading } = useProjects()
  const { data: tasks } = useAllTasks()
  const { openTab } = useTabs()
  const [search, setSearch] = useState('')

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>()
    for (const p of projects || []) m.set(p.id, p)
    return m
  }, [projects])

  // In-progress tasks grouped by project
  const activeWork = useMemo(() => {
    if (!tasks) return []
    const byProject = new Map<string, Task[]>()
    const inProgress = tasks
      .filter(t => t.status === 'in_progress')
      .sort((a, b) => {
        const po = { urgent: 0, high: 1, medium: 2, low: 3 }
        return po[a.priority] - po[b.priority]
      })

    for (const t of inProgress) {
      if (!byProject.has(t.projectId)) byProject.set(t.projectId, [])
      byProject.get(t.projectId)!.push(t)
    }

    return Array.from(byProject.entries())
      .map(([projectId, tasks]) => ({
        project: projectMap.get(projectId),
        tasks,
      }))
      .filter(g => g.project)
  }, [tasks, projectMap])

  // Urgent/high priority inbox tasks
  const needsAttention = useMemo(() => {
    if (!tasks) return []
    return tasks
      .filter(t => t.status !== 'done' && t.status !== 'in_progress' && (t.priority === 'urgent' || t.priority === 'high'))
      .sort((a, b) => {
        const po = { urgent: 0, high: 1, medium: 2, low: 3 }
        return po[a.priority] - po[b.priority]
      })
      .slice(0, 8)
  }, [tasks])

  // Filtered projects for search
  const filteredProjects = useMemo(() => {
    if (!projects) return []
    if (!search) return []
    const q = search.toLowerCase()
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.techStack.some(t => t.toLowerCase().includes(q)) ||
      p.category.toLowerCase().includes(q)
    ).slice(0, 8)
  }, [projects, search])

  // Recent/favorite projects for quick access (when not searching)
  const quickProjects = useMemo(() => {
    if (!projects || search) return []
    return [...projects]
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
        const da = a.lastCommitDate ? new Date(a.lastCommitDate).getTime() : 0
        const db = b.lastCommitDate ? new Date(b.lastCommitDate).getTime() : 0
        return db - da
      })
      .slice(0, 12)
  }, [projects, search])

  const totalInProgress = tasks?.filter(t => t.status === 'in_progress').length || 0
  const totalInbox = tasks?.filter(t => t.status !== 'done' && t.status !== 'in_progress').length || 0

  return (
    <>
      <Header title="DevDash" />
      <div className="flex-1 overflow-y-auto">
        {/* Search bar */}
        <div className="px-6 pt-6 pb-4">
          <div className="relative max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search projects..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 h-10"
              autoFocus
            />
          </div>
        </div>

        {/* Search results */}
        {search && (
          <div className="px-6 pb-4">
            {filteredProjects.length > 0 ? (
              <div className="border rounded-lg divide-y">
                {filteredProjects.map(p => (
                  <CompactProjectRow key={p.id} project={p} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No projects matching "{search}"</p>
            )}
          </div>
        )}

        {/* Main content when not searching */}
        {!search && (
          <div className="px-6 pb-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Active work (2/3) */}
            <div className="lg:col-span-2 space-y-6">
              {/* In Progress */}
              {activeWork.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Loader className="h-4 w-4 text-yellow-500" />
                    <h2 className="text-sm font-semibold">Working On</h2>
                    <span className="text-xs text-muted-foreground">({totalInProgress})</span>
                  </div>
                  <div className="space-y-3">
                    {activeWork.map(({ project, tasks }) => (
                      <ActiveProjectGroup key={project!.id} project={project!} tasks={tasks} />
                    ))}
                  </div>
                </div>
              )}

              {/* Needs attention */}
              {needsAttention.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-4 w-4 text-red-500" />
                    <h2 className="text-sm font-semibold">Needs Attention</h2>
                    <span className="text-xs text-muted-foreground">({needsAttention.length})</span>
                  </div>
                  <Card>
                    <CardContent className="p-3 space-y-1">
                      {needsAttention.map(task => {
                        const pri = priorityConfig[task.priority]
                        const PriIcon = pri.icon
                        const project = projectMap.get(task.projectId)
                        return (
                          <button
                            key={task.id}
                            onClick={() => openTab(task.projectId)}
                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 transition-colors w-full text-left"
                          >
                            <PriIcon className={cn('h-3.5 w-3.5 shrink-0', pri.color)} />
                            <span className="text-sm flex-1 truncate">{task.title}</span>
                            {project && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                                {project.name}
                              </Badge>
                            )}
                          </button>
                        )
                      })}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Empty state */}
              {activeWork.length === 0 && needsAttention.length === 0 && (
                <div className="text-center py-16 text-muted-foreground">
                  <Loader className="h-8 w-8 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No tasks in progress.</p>
                  <p className="text-xs mt-1">Open a project to start working.</p>
                </div>
              )}
            </div>

            {/* Right: Quick access projects (1/3) */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Projects</h2>
                <Link to="/tasks" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
                  All Tasks →
                </Link>
              </div>
              <div className="border rounded-lg divide-y">
                {quickProjects.map(p => (
                  <CompactProjectRow key={p.id} project={p} />
                ))}
              </div>
              {projects && projects.length > 12 && (
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  {projects.length - 12} more — use search to find them
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
