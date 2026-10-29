import { lazy, Suspense, useEffect, useState } from 'react'
import { useProjects } from '@/hooks/useProjects'
import type { Task } from '@/hooks/useTasks'

const TaskViewer = lazy(() => import('@/components/tasks/TaskViewer').then(m => ({ default: m.TaskViewer })))
const TaskEditor = lazy(() => import('@/components/tasks/TaskEditor').then(m => ({ default: m.TaskEditor })))

/**
 * Opens a task from anywhere in the app. The command palette unmounts the
 * moment it dispatches, so the dialog lives here, mounted once by the Layout.
 * Fire `shipyard:open-task` with the task in `detail`.
 *
 * Both dialogs are lazy, like on the Dashboard: nothing of them loads until a
 * task is actually opened.
 */
export function TaskViewerHost() {
  const [viewing, setViewing] = useState<Task | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const { data: projects } = useProjects()

  useEffect(() => {
    const handler = (e: Event) => {
      const task = (e as CustomEvent<Task>).detail
      if (!task) return
      setViewing(task)
      setViewerOpen(true)
    }
    window.addEventListener('shipyard:open-task', handler)
    return () => window.removeEventListener('shipyard:open-task', handler)
  }, [])

  if (!viewing && !editing) return null
  const project = viewing ? projects?.find(p => p.id === viewing.projectId) : undefined

  return (
    <Suspense fallback={null}>
      {viewing && (
        <TaskViewer
          task={viewing}
          projectName={project?.name}
          projectPath={project?.path}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          onEdit={task => { setEditing(task); setEditorOpen(true) }}
        />
      )}
      {editing && (
        <TaskEditor
          projectId={editing.projectId}
          task={editing}
          open={editorOpen}
          onOpenChange={setEditorOpen}
        />
      )}
    </Suspense>
  )
}
