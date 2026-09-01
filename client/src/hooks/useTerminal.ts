import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface TerminalSessionInfo {
  id: string
  projectId: string
  type: string
  title: string
  createdAt: string
}

export function useTerminalStatus() {
  return useQuery({
    queryKey: ['terminal', 'status'],
    queryFn: api.getTerminalStatus,
    staleTime: Infinity,
  })
}

export function useTerminalSessions(projectId?: string) {
  return useQuery({
    queryKey: ['terminal', 'sessions', projectId],
    queryFn: () => api.getTerminalSessions(projectId),
    refetchInterval: 5000,
    enabled: !!projectId,
  })
}

export function useCreateTerminalSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, type, cols, rows, taskId, prompt, agent }: { projectId: string; type?: string; cols?: number; rows?: number; taskId?: string; prompt?: string; agent?: string }) =>
      api.createTerminalSession(projectId, type, cols, rows, taskId, prompt, agent),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['terminal', 'sessions', variables.projectId] })
    },
  })
}

export function useKillTerminalSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sessionId: string) => api.killTerminalSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminal', 'sessions'] })
    },
  })
}

export function getWebSocketUrl(sessionId: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const host = window.location.host
  return `${protocol}//${host}/ws/terminal/${sessionId}`
}
