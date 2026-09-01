import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type Agent } from '@/lib/api'

export type { Agent }

export const DEFAULT_AGENT_ID = 'claude'

/**
 * Registered coding agents. Availability comes from a PATH probe on the
 * server, so this is refetched rarely — installing a CLI mid-session is not
 * something the dashboard has to notice within seconds.
 */
export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: api.getAgents,
    staleTime: 60_000,
  })
}

export function useSaveAgents() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { agents?: Agent[]; defaultAgent?: string }) => api.saveAgents(body),
    onSuccess: (data) => queryClient.setQueryData(['agents'], data),
  })
}

/** Display name for a task's agent id, falling back to the id itself. */
export function agentLabel(agents: Agent[] | undefined, id?: string): string {
  const wanted = id || DEFAULT_AGENT_ID
  return agents?.find(a => a.id === wanted)?.name || wanted
}
