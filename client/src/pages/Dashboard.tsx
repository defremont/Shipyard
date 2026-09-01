import { useState, useMemo, useCallback, lazy, Suspense } from 'react'
import { Loader, ArrowRight, FolderSearch, FolderPlus, Rocket } from 'lucide-react'
import { ProjectList } from '@/components/projects/ProjectList'
import { ActivityFeed } from '@/components/tasks/ActivityFeed'
import { useProjects, type Project } from '@/hooks/useProjects'
import { useAllTasks, type Task } from '@/hooks/useTasks'
import { useTabs } from '@/hooks/useTabs'
import { WelcomeWizard, useOnboarding } from '@/components/onboarding/WelcomeWizard'
import { FolderBrowser } from '@/components/ui/folder-browser'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { TaskCounts } from '@/components/projects/ProjectCard'

// Dashboard is the landing route and stays eager, so the task dialogs — which
// drag in the review panel and the diff renderer — load only once a feed row
// is clicked.
const TaskViewer = lazy(() => import('@/components/tasks/TaskViewer').then(m => ({ default: m.TaskViewer })))
const TaskEditor = lazy(() => import('@/components/tasks/TaskEditor').then(m => ({ default: m.TaskEditor })))

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

  const projectNames = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of projects || []) m.set(p.id, p.name)
    return m
  }, [projects])

  // Feed rows open the task in place. The dialogs keep their task after
  // closing so the exit animation has something to render.
  const [viewingTask, setViewingTask] = useState<Task | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  const handleViewTask = useCallback((task: Task) => {
    setViewingTask(task)
    setViewerOpen(true)
  }, [])

  const handleEditTask = useCallback((task: Task) => {
    setEditingTask(task)
    setEditorOpen(true)
  }, [])

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

  const [scanBrowserOpen, setScanBrowserOpen] = useState(false)
  const [addBrowserOpen, setAddBrowserOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scannedProjects, setScannedProjects] = useState<{ path: string; name: string; techStack: string[]; isGitRepo: boolean }[]>([])
  const queryClient = useQueryClient()

  const handleScanFolder = async (path: string) => {
    setScanBrowserOpen(false)
    setScanning(true)
    try {
      const { projects: found } = await api.scanDirectory(path)
      if (found.length === 0) {
        toast.info('No projects found in that folder')
      } else {
        setScannedProjects(found)
      }
    } catch {
      toast.error('Failed to scan folder')
    } finally {
      setScanning(false)
    }
  }

  const handleAddScanned = async () => {
    const paths = scannedProjects.map(p => p.path)
    try {
      const { projects: added } = await api.addProjects(paths)
      queryClient.setQueryData(['projects'], added)
      toast.success(`Added ${added.length} project${added.length > 1 ? 's' : ''}!`)
      setScannedProjects([])
    } catch {
      toast.error('Failed to add projects')
    }
  }

  const handleAddFolders = async (paths: string[]) => {
    setAddBrowserOpen(false)
    try {
      const { projects: added } = await api.addProjects(paths)
      queryClient.setQueryData(['projects'], added)
      toast.success(`Added ${added.length} project${added.length > 1 ? 's' : ''}!`)
    } catch {
      toast.error('Failed to add projects')
    }
  }

  if (onboarding.shouldShow) {
    return <WelcomeWizard onComplete={onboarding.complete} />
  }

  const hasNoProjects = projects && projects.length === 0

  // Quick stats
  const totalInbox = tasks?.filter(t => t.status === 'backlog' || t.status === 'todo').length || 0
  const totalInProgress = tasks?.filter(t => t.status === 'in_progress').length || 0
  const totalDone = tasks?.filter(t => t.status === 'done').length || 0

  return (
    <>
      <div className="flex-1 overflow-y-auto scrollbar-dark">
        <div className="px-6 py-5 space-y-4">
          {/* Header + stats */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-semibold">Dashboard</h1>
              {projects && projects.length > 0 && (
                <span className="text-[11px] text-muted-foreground/40">{projects.length} projects</span>
              )}
            </div>
            {tasks && tasks.length > 0 && (
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {totalInbox} inbox
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                  {totalInProgress} active
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-success" />
                  {totalDone} done
                </span>
              </div>
            )}
          </div>

          {/* Working On banner */}
          {workingOn.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-dark pb-0.5">
              <div className="flex items-center gap-1.5 shrink-0 text-xs text-warning font-medium">
                <Loader className="h-3 w-3" />
                Working On
              </div>
              {workingOn.map(task => (
                <button
                  key={task.id}
                  onClick={() => openTab(task.projectId)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-warning/10 hover:bg-warning/15 transition-colors text-xs shrink-0 group"
                >
                  <span className="text-muted-foreground">{task.projectName}</span>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="truncate max-w-[200px] 2xl:max-w-[300px]">{task.title}</span>
                  <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {/* Agent activity — hides itself when the last day was quiet */}
          {!hasNoProjects && (
            <ActivityFeed
              tasks={tasks}
              projectNames={projectNames}
              onSelect={handleViewTask}
            />
          )}

          {/* Empty state when no projects */}
          {hasNoProjects ? (
          <div className="flex items-center justify-center min-h-[50vh]">
            <div className="flex flex-col items-center gap-6 max-w-md text-center">
              <div className="p-4 rounded-full bg-muted">
                <Rocket className="h-10 w-10 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-xl font-semibold mb-2">No projects yet</h2>
                <p className="text-sm text-muted-foreground">
                  Add your project folders to start tracking tasks, git status, and more.
                </p>
              </div>

              {/* Scanned results */}
              {scannedProjects.length > 0 && (
                <div className="w-full space-y-2">
                  <p className="text-sm text-muted-foreground">Found {scannedProjects.length} project{scannedProjects.length > 1 ? 's' : ''}:</p>
                  <div className="rounded-md border divide-y max-h-48 overflow-y-auto text-left">
                    {scannedProjects.map(p => (
                      <div key={p.path} className="px-3 py-2 text-sm">
                        <span className="font-medium">{p.name}</span>
                        {p.techStack.length > 0 && (
                          <span className="ml-2 text-xs text-muted-foreground">{p.techStack.join(', ')}</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 justify-center">
                    <Button variant="outline" size="sm" onClick={() => setScannedProjects([])}>Cancel</Button>
                    <Button size="sm" onClick={handleAddScanned}>Add all</Button>
                  </div>
                </div>
              )}

              {/* Action buttons */}
              {scannedProjects.length === 0 && (
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => setScanBrowserOpen(true)}
                    disabled={scanning}
                  >
                    <FolderSearch className="h-4 w-4" />
                    {scanning ? 'Scanning...' : 'Scan a folder'}
                  </Button>
                  <Button
                    className="gap-2"
                    onClick={() => setAddBrowserOpen(true)}
                  >
                    <FolderPlus className="h-4 w-4" />
                    Add project folders
                  </Button>
                </div>
              )}
            </div>
          </div>
          ) : (
            /* Main content: ProjectList */
            projects && (
              <ProjectList
                projects={projects}
                taskCounts={taskCountsByProject}
              />
            )
          )}
        </div>
      </div>

      {(viewingTask || editingTask) && (
        <Suspense fallback={null}>
          {viewingTask && (
            <TaskViewer
              task={viewingTask}
              projectName={projectMap.get(viewingTask.projectId)?.name}
              projectPath={projectMap.get(viewingTask.projectId)?.path}
              open={viewerOpen}
              onOpenChange={setViewerOpen}
              onEdit={handleEditTask}
            />
          )}
          {editingTask && (
            <TaskEditor
              projectId={editingTask.projectId}
              task={editingTask}
              open={editorOpen}
              onOpenChange={setEditorOpen}
            />
          )}
        </Suspense>
      )}

      <FolderBrowser
        open={scanBrowserOpen}
        onOpenChange={setScanBrowserOpen}
        onSelect={handleScanFolder}
        title="Select folder to scan for projects"
      />
      <FolderBrowser
        open={addBrowserOpen}
        onOpenChange={setAddBrowserOpen}
        onSelectMultiple={handleAddFolders}
        multiSelect
        title="Select project folders"
      />
    </>
  )
}
