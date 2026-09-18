import type { QueryClient } from '@tanstack/react-query'
import { api } from './api'

/**
 * Warm the queries a project opens with, on hover.
 *
 * Opening a project used to start its task list and its git status from cold,
 * so the workspace painted a spinner first. A pointer resting on a tab or a
 * sidebar row is a good half second of warning — enough for both requests to
 * be in flight (or already answered) by the time the click lands.
 *
 * Keys and fetchers mirror useTasks / useGitStatus exactly; a mismatch would
 * fill a cache entry nobody reads.
 */

const IN_FLIGHT = new Map<string, number>()
const COOLDOWN_MS = 10_000

export function prefetchProject(queryClient: QueryClient, projectId: string): void {
  if (!projectId) return

  const last = IN_FLIGHT.get(projectId) || 0
  if (Date.now() - last < COOLDOWN_MS) return
  IN_FLIGHT.set(projectId, Date.now())

  const milestoneId = localStorage.getItem(`shipyard:milestone:${projectId}`) || 'default'
  queryClient.prefetchQuery({
    queryKey: ['tasks', projectId, milestoneId],
    queryFn: async () => (await api.getTasks(projectId, milestoneId)).tasks,
    staleTime: COOLDOWN_MS,
  })

  const savedRepo = localStorage.getItem(`shipyard:git-repo:${projectId}`)
  const subrepo = !savedRepo || savedRepo === '__root__' ? undefined : savedRepo
  queryClient.prefetchQuery({
    queryKey: ['git-status', projectId, subrepo],
    queryFn: () => api.getGitStatus(projectId, subrepo),
    staleTime: COOLDOWN_MS,
  })
}
