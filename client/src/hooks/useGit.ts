import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useGitStatus(projectId: string | undefined) {
  return useQuery({
    queryKey: ['git-status', projectId],
    queryFn: () => api.getGitStatus(projectId!),
    enabled: !!projectId,
    refetchInterval: 5000,
  })
}

export function useGitDiff(projectId: string | undefined, file?: string) {
  return useQuery({
    queryKey: ['git-diff', projectId, file],
    queryFn: () => api.getGitDiff(projectId!, file),
    enabled: !!projectId,
  })
}

export function useGitLog(projectId: string | undefined) {
  return useQuery({
    queryKey: ['git-log', projectId],
    queryFn: () => api.getGitLog(projectId!),
    enabled: !!projectId,
  })
}

export function useGitBranches(projectId: string | undefined) {
  return useQuery({
    queryKey: ['git-branches', projectId],
    queryFn: () => api.getGitBranches(projectId!),
    enabled: !!projectId,
  })
}

export function useStageFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, file }: { projectId: string; file: string }) =>
      api.stageFile(projectId, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['git-status', variables.projectId] })
    },
  })
}

export function useStageAll() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => api.stageAll(projectId),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['git-status', projectId] })
    },
  })
}

export function useUnstageAll() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => api.unstageAll(projectId),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['git-status', projectId] })
    },
  })
}

export function useUnstageFile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, file }: { projectId: string; file: string }) =>
      api.unstageFile(projectId, file),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['git-status', variables.projectId] })
    },
  })
}

export function useGitCommit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, message }: { projectId: string; message: string }) =>
      api.gitCommit(projectId, message),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['git-status', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['git-log', variables.projectId] })
    },
  })
}

export function useGitPush() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => api.gitPush(projectId),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['git-status', projectId] })
    },
  })
}

export function useGitPull() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => api.gitPull(projectId),
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: ['git-status', projectId] })
      queryClient.invalidateQueries({ queryKey: ['git-log', projectId] })
    },
  })
}
