import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Inbox, Loader, CheckCircle2, AlertTriangle, ArrowUp, ArrowDown, Minus, Circle, Clock, Plus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { useAllTasks, type Task } from '@/hooks/useTasks'
import { useProjects, type Project } from '@/hooks/useProjects'

const priorityConfig = {
  urgent: { icon: AlertTriangle, color: 'text-red-500' },
  high: { icon: ArrowUp, color: 'text-orange-500' },
  medium: { icon: Minus, color: 'text-blue-500' },
  low: { icon: ArrowDown, color: 'text-red-500' },
}

const statusColors: Record<string, string> = {
  backlog: 'text-muted-foreground',
  todo: 'text-blue-500',
  in_progress: 'text-yellow-500',
  done: 'text-green-500',
}

const statusLabels: Record<string, string> = {
  backlog: 'Inbox',
  todo: 'Inbox',
  in_progress: 'In Progress',
  done: 'Done',
}

function TaskRow({ task, project }: { task: Task; project?: Project }) {
  const pri = priorityConfig[task.priority]
  const PriIcon = pri.icon

  return (
    <Link
      to={`/project/${task.projectId}`}
      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 transition-colors"
    >
      <PriIcon className={cn('h-3.5 w-3.5 shrink-0', pri.color)} />
      <span className={cn('text-sm flex-1 truncate', task.status === 'done' && 'line-through opacity-60')}>
        {task.title}
      </span>
      <span className={cn('text-[10px] shrink-0', statusColors[task.status])}>
        {statusLabels[task.status]}
      </span>
      {project && (
        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
          {project.name}
        </Badge>
      )}
    </Link>
  )
}

export function TaskSummary() {
  const { data: tasks } = useAllTasks()
  const { data: projects } = useProjects()

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>()
    for (const p of projects || []) m.set(p.id, p)
    return m
  }, [projects])

  const counts = useMemo(() => {
    if (!tasks) return { inbox: 0, inProgress: 0, done: 0, total: 0 }
    let inbox = 0, inProgress = 0, done = 0
    for (const t of tasks) {
      if (t.status === 'done') done++
      else if (t.status === 'in_progress') inProgress++
      else inbox++
    }
    return { inbox, inProgress, done, total: tasks.length }
  }, [tasks])

  const inProgressTasks = useMemo(() => {
    if (!tasks) return []
    return tasks
      .filter(t => t.status === 'in_progress')
      .sort((a, b) => {
        const po = { urgent: 0, high: 1, medium: 2, low: 3 }
        return po[a.priority] - po[b.priority]
      })
  }, [tasks])

  const urgentInbox = useMemo(() => {
    if (!tasks) return []
    return tasks
      .filter(t => t.status !== 'done' && t.status !== 'in_progress' && (t.priority === 'urgent' || t.priority === 'high'))
      .sort((a, b) => {
        const po = { urgent: 0, high: 1, medium: 2, low: 3 }
        return po[a.priority] - po[b.priority]
      })
      .slice(0, 5)
  }, [tasks])

  // Recent tasks: last 10 created across all projects, sorted by createdAt desc
  const recentTasks = useMemo(() => {
    if (!tasks) return []
    return [...tasks]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
  }, [tasks])

  // Recent tasks grouped by project
  const recentByProject = useMemo(() => {
    if (!tasks) return []
    const byProject = new Map<string, Task[]>()
    // Sort all tasks by createdAt desc
    const sorted = [...tasks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    for (const t of sorted) {
      if (!byProject.has(t.projectId)) byProject.set(t.projectId, [])
      const list = byProject.get(t.projectId)!
      if (list.length < 3) list.push(t) // max 3 per project
    }
    // Return projects sorted by their most recent task
    return Array.from(byProject.entries())
      .map(([projectId, pTasks]) => ({ projectId, tasks: pTasks }))
      .slice(0, 6) // max 6 projects
  }, [tasks])

  if (!tasks || tasks.length === 0) return null

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold">Task Overview</h2>

      {/* Counters */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Inbox className="h-5 w-5 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">{counts.inbox}</p>
              <p className="text-xs text-muted-foreground">Inbox</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Loader className="h-5 w-5 text-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{counts.inProgress}</p>
              <p className="text-xs text-muted-foreground">In Progress</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            <div>
              <p className="text-2xl font-bold">{counts.done}</p>
              <p className="text-xs text-muted-foreground">Done</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* In Progress tasks */}
      {inProgressTasks.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Loader className="h-3.5 w-3.5 text-yellow-500" />
              In Progress ({inProgressTasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-1">
              {inProgressTasks.map(task => (
                <TaskRow key={task.id} task={task} project={projectMap.get(task.projectId)} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Urgent/High inbox */}
      {urgentInbox.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              Needs Attention
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="space-y-1">
              {urgentInbox.map(task => (
                <TaskRow key={task.id} task={task} project={projectMap.get(task.projectId)} />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent tasks by project */}
      {recentByProject.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Plus className="h-3.5 w-3.5" />
              Recent Tasks by Project
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {recentByProject.map(({ projectId, tasks: pTasks }) => {
              const project = projectMap.get(projectId)
              return (
                <div key={projectId}>
                  <Link
                    to={`/project/${projectId}`}
                    className="text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors mb-1 inline-block"
                  >
                    {project?.name || projectId}
                  </Link>
                  <div className="space-y-0.5">
                    {pTasks.map(task => {
                      const pri = priorityConfig[task.priority]
                      const PriIcon = pri.icon
                      return (
                        <Link
                          key={task.id}
                          to={`/project/${task.projectId}`}
                          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/50 transition-colors"
                        >
                          <PriIcon className={cn('h-3 w-3 shrink-0', pri.color)} />
                          <span className={cn(
                            'text-sm flex-1 truncate',
                            task.status === 'done' && 'line-through opacity-60'
                          )}>
                            {task.title}
                          </span>
                          <span className={cn('text-[10px] shrink-0', statusColors[task.status])}>
                            {statusLabels[task.status]}
                          </span>
                          <span className="text-[10px] text-muted-foreground/60 shrink-0">
                            {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}
                          </span>
                        </Link>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
