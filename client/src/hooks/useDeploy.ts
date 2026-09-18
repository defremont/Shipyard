import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type DeployLinkInput } from '@/lib/api'

/**
 * Deploy status per project. The server caches the Railway call (60s settled,
 * 15s while a build is running), so this poll is cheap; it only asks while the
 * page is in front.
 */
export function useDeployStatus(projectId: string | undefined) {
  return useQuery({
    queryKey: ['deploy-status', projectId],
    queryFn: () => api.getDeployStatus(projectId!),
    enabled: !!projectId,
    refetchInterval: (query) => (query.state.data?.state === 'building' ? 20_000 : 60_000),
    staleTime: 15_000,
  })
}

/**
 * Deploy status of every linked project, in one request. The dashboard shows a
 * dot per card, and a query per card would open a dozen requests a minute.
 */
export function useAllDeployStatus() {
  return useQuery({
    queryKey: ['deploy-status', 'all'],
    queryFn: api.getAllDeployStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

export function useDeployProviders() {
  return useQuery({
    queryKey: ['deploy-providers'],
    queryFn: api.getDeployProviders,
    staleTime: 60_000,
  })
}

/** Railway projects the saved token can see — only fetched when a picker opens. */
export function useRailwayProjects(enabled: boolean) {
  return useQuery({
    queryKey: ['railway-projects'],
    queryFn: api.getRailwayProjects,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  })
}

export function useConnectRailway() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => api.connectRailway(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deploy-providers'] })
      queryClient.invalidateQueries({ queryKey: ['railway-projects'] })
      queryClient.invalidateQueries({ queryKey: ['deploy-status'] })
    },
  })
}

export function useDisconnectRailway() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.disconnectRailway(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deploy-providers'] })
      queryClient.removeQueries({ queryKey: ['railway-projects'] })
      queryClient.invalidateQueries({ queryKey: ['deploy-status'] })
    },
  })
}

export function useLinkDeploy(projectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: DeployLinkInput) => api.linkDeploy(projectId!, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deploy-status', projectId] })
    },
  })
}

export function useUnlinkDeploy(projectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.unlinkDeploy(projectId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deploy-status', projectId] })
    },
  })
}
