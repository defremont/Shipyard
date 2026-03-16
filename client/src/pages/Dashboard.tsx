import { useMemo } from 'react'
import { Loader, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Header } from '@/components/layout/Header'
import { ProjectList } from '@/components/projects/ProjectList'
import { useProjects, type Project } from '@/hooks/useProjects'
import { useAllTasks } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'
import { WelcomeWizard, useOnboarding } from '@/components/onboarding/WelcomeWizard'
import type { TaskCounts } from '@/components/projects/ProjectCard'

export function Dashboard() {
  const { data: projects } = useProjects()
  const { data: tasks } = useAllTasks()
  const { openTab } = useTabs()
  const onboarding = useOnboarding()

  const projectMap = useMemo(() => {
    const m = new Map<string, Project>()
    for (const p of projects || []) m.set(p.id, p)
    return m
  }, [projects])

  // Compute task counts per project
  const taskCountsByProject = useMemo(() => {
    const counts = new Map<string, TaskCounts>()
    if (!tasks) return counts

    for (const t of tasks) {
      if (!counts.has(t.projectId)) {
        counts.set(t.projectId, { inbox: 0, inProgress: 0, done: 0, total: 0, hasUrgent: false })
      }
      const c = counts.get(t.projectId)!
      c.total++
      if (t.status === 'done') {
        c.done++
      } else if (t.status === 'in_progress') {
        c.inProgress++
      } else {
        c.inbox++
        if (t.priority === 'urgent') c.hasUrgent = true
      }
    }
    return counts
  }, [tasks])

  // In-progress tasks for the banner
  const workingOn = useMemo(() => {
    if (!tasks) return []
    return tasks
      .filter(t => t.status === 'in_progress')
      .map(t => ({
        ...t,
        projectName: projectMap.get(t.projectId)?.name || t.projectId,
      }))
      .slice(0, 6)
  }, [tasks, projectMap])

  if (onboarding.shouldShow) {
    return <WelcomeWizard onComplete={onboarding.complete} />
  }

  return (
    <>
      <Header title="Shipyard" />
      <div className="flex-1 overflow-y-auto scrollbar-dark">
        {/* Working On banner */}
        {workingOn.length > 0 && (
          <div className="px-4 lg:px-6 2xl:px-8 pt-4 pb-2">
            <div className="flex items-center gap-3 overflow-x-auto scrollbar-dark pb-1">
              <div className="flex items-center gap-1.5 shrink-0 text-xs text-yellow-500 font-medium">
                <Loader className="h-3.5 w-3.5" />
                Working On
              </div>
              {workingOn.map(task => (
                <button
                  key={task.id}
                  onClick={() => openTab(task.projectId)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-yellow-500/10 hover:bg-yellow-500/20 transition-colors text-xs shrink-0 group"
                >
                  <span className="text-muted-foreground">{task.projectName}:</span>
                  <span className="font-mono text-muted-foreground/60">{task.id}</span>
                  <span className="truncate max-w-[200px] 2xl:max-w-[300px]">{task.title}</span>
                  <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main content: ProjectList */}
        <div className="px-4 lg:px-6 2xl:px-8 py-4">
          {projects && (
            <ProjectList
              projects={projects}
              taskCounts={taskCountsByProject}
            />
          )}
        </div>
      </div>
    </>
  )
}
