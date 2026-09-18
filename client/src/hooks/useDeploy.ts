import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type DeployLinkInput, type DeployStatus } from '@/lib/api'

/**
 * Deploy status per checkout. A project deploys from its root, from each of its
 * sub-repositories, or from several at once — a client folder holding a dozen
 * repos has a dozen possible deploys — so the unit here is a checkout, and a
 * project's badge speaks for all of them.
 *
 * The server caches the Railway call (60s settled, 15s mid-build), so these
 * polls are cheap.
 */

function anyBuilding(statuses: DeployStatus[] | undefined): boolean {
  return !!statuses?.some(status => status.state === 'building')
}

/** Every linked checkout of one project. */
export function useDeployStatuses(projectId: string | undefined) {
  return useQuery({
    queryKey: ['deploy-status', projectId],
    queryFn: async () => (await api.getDeployStatus(projectId!)).statuses,
    enabled: !!projectId,
    refetchInterval: (query) => (anyBuilding(query.state.data) ? 20_000 : 60_000),
    staleTime: 15_000,
  })
}

/** One checkout — the git panel asks for the sub-repository it is showing. */
export function useDeployStatus(projectId: string | undefined, subrepo?: string) {
  return useQuery({
    queryKey: ['deploy-status', projectId, subrepo ?? '__root__'],
    queryFn: async () => (await api.getDeployStatus(projectId!, subrepo ?? '')).statuses[0] ?? null,
    enabled: !!projectId,
    refetchInterval: (query) => (query.state.data?.state === 'building' ? 20_000 : 60_000),
    staleTime: 15_000,
  })
}

/**
 * Every linked checkout of every project, in one request. The dashboard shows a
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

/** What links to what by GitHub repo — only asked for when the panel is open. */
export function useDeployMatches(enabled: boolean) {
  return useQuery({
    queryKey: ['deploy-matches'],
    queryFn: api.getDeployMatches,
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

export function useAutoLinkDeploys() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body?: { only?: string[]; relink?: boolean }) => api.autoLinkDeploys(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deploy-status'] })
      queryClient.invalidateQueries({ queryKey: ['deploy-matches'] })
    },
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
      queryClient.invalidateQueries({ queryKey: ['deploy-matches'] })
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
      queryClient.invalidateQueries({ queryKey: ['deploy-status'] })
      queryClient.invalidateQueries({ queryKey: ['deploy-matches'] })
    },
  })
}

export function useUnlinkDeploy(projectId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (subrepo?: string) => api.unlinkDeploy(projectId!, subrepo),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deploy-status'] })
      queryClient.invalidateQueries({ queryKey: ['deploy-matches'] })
    },
  })
}
