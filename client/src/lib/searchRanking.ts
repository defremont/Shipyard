import type { Project } from '@/hooks/useProjects'
import type { Task } from '@/hooks/useTasks'
import { parseSearchTerms, scoreTask } from '@/lib/taskSearch'

/**
 * Ranking shared by the command palette (Ctrl+K) and the side-panel search.
 *
 * Context first: the project the user has open, then the other projects of
 * the same client (discovery stores a project's parent folder — the client
 * folder — as `category`), then everyone else. The server ranks file results
 * the same way when it gets `prefer` (services/fileSearch.ts).
 */
export type ContextRank = 0 | 1 | 2

export function makeContextRank(projects: Project[] | undefined, activeProjectId: string | null | undefined) {
  const active = activeProjectId ? projects?.find(p => p.id === activeProjectId) : undefined
  const categoryOf = new Map(projects?.map(p => [p.id, p.category]) ?? [])
  return (projectId: string): ContextRank => {
    if (!active) return 2
    if (projectId === active.id) return 0
    return categoryOf.get(projectId) === active.category ? 1 : 2
  }
}

const CONTEXT_BOOST: Record<ContextRank, number> = { 0: 150, 1: 70, 2: 0 }
const STATUS_BOOST: Record<Task['status'], number> = { in_progress: 30, todo: 25, backlog: 10, done: 0 }

function updatedAt(task: Task): number {
  const t = Date.parse(task.updatedAt)
  return Number.isNaN(t) ? 0 : t
}

/**
 * With no query: open work (not done) from the current context, freshest
 * first. With a query: every status, done included — finding last month's fix
 * is half of why people search — ordered by relevance, then context, then how
 * live the task is.
 */
export function rankTasks(
  tasks: Task[] | undefined,
  query: string,
  opts: { projectName: (id: string) => string; contextRank: (id: string) => ContextRank; limit: number },
): Task[] {
  if (!tasks) return []
  const terms = parseSearchTerms(query)
  const scored: { task: Task; score: number; at: number }[] = []
  for (const task of tasks) {
    if (terms.length === 0 && task.status === 'done') continue
    const match = scoreTask(task, terms, opts.projectName(task.projectId))
    if (match === 0) continue
    scored.push({
      task,
      score: match + CONTEXT_BOOST[opts.contextRank(task.projectId)] + STATUS_BOOST[task.status],
      at: updatedAt(task),
    })
  }
  scored.sort((a, b) => b.score - a.score || b.at - a.at)
  return scored.slice(0, opts.limit).map(s => s.task)
}

function scoreProject(project: Project, q: string): number {
  const name = project.name.toLowerCase()
  if (name === q) return 100
  if (name.startsWith(q)) return 80
  if (name.includes(q)) return 60
  if (project.category?.toLowerCase().includes(q)) return 40
  if (project.techStack?.some(t => t.toLowerCase().includes(q))) return 20
  return 0
}

/** Name matches first, then context; without a query, context then recency. */
export function rankProjects(
  projects: Project[] | undefined,
  query: string,
  contextRank: (id: string) => ContextRank,
): Project[] {
  if (!projects) return []
  const q = query.trim().toLowerCase()
  const scored: { project: Project; score: number }[] = []
  for (const project of projects) {
    const match = q ? scoreProject(project, q) : 1
    if (match === 0) continue
    scored.push({ project, score: match + CONTEXT_BOOST[contextRank(project.id)] / 3 })
  }
  scored.sort((a, b) =>
    b.score - a.score
    || (Date.parse(b.project.lastOpenedAt || '') || 0) - (Date.parse(a.project.lastOpenedAt || '') || 0)
    || a.project.name.localeCompare(b.project.name))
  return scored.map(s => s.project)
}
