import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type CloudCredentials, type CloudStatus } from '@/lib/api'

/**
 * Shipyard Cloud state for this machine. Polled slowly while connected — the
 * sync itself runs on the server and needs nothing from the browser.
 */
export function useCloudStatus() {
  return useQuery({
    queryKey: ['cloud-status'],
    queryFn: () => api.getCloudStatus(),
    refetchInterval: (query) => (query.state.data?.syncing ? 3_000 : query.state.data?.connected ? 15_000 : false),
    staleTime: 5_000,
  })
}

function useCloudMutation<V>(fn: (vars: V) => Promise<CloudStatus>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (status) => {
      queryClient.setQueryData(['cloud-status'], status)
      // Data from other machines may have just landed.
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export const useCloudSignup = () => useCloudMutation((body: CloudCredentials) => api.cloudSignup(body))
export const useCloudLogin = () => useCloudMutation((body: CloudCredentials) => api.cloudLogin(body))
export const useCloudLogout = () => useCloudMutation((_: void) => api.cloudLogout())
export const useCloudSyncNow = () => useCloudMutation((_: void) => api.cloudSyncNow())
