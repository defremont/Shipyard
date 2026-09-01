import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type WorktreeInfo, type WorktreeSettings } from '@/lib/api'

export type { WorktreeInfo, WorktreeSettings }

/**
 * Worktree-per-task settings and the checkouts Shipyard currently tracks.
 * Only the settings screen asks for this, so it is not polled.
 */
export function useWorktrees() {
  return useQuery({
    queryKey: ['worktrees'],
    queryFn: api.getWorktrees,
    staleTime: 30_000,
  })
}

export function useSaveWorktreeConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { enabled?: boolean; basePath?: string | null }) => api.saveWorktreeConfig(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['worktrees'] }),
  })
}

export function useCleanWorktrees() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (all?: boolean) => api.cleanWorktrees(all),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['worktrees'] })
      // The sweep clears worktreePath on the tasks it touched.
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}
