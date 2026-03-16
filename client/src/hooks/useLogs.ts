import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useLogs(filters?: { level?: string; category?: string; projectId?: string; limit?: number }) {
  return useQuery({
    queryKey: ['logs', filters],
    queryFn: () => api.getLogs(filters),
    refetchInterval: 5000,
  })
}

export function useLogStats() {
  return useQuery({
    queryKey: ['logs', 'stats'],
    queryFn: () => api.getLogStats(),
    refetchInterval: 10000,
  })
}

export function useClearLogs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.clearLogs(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs'] })
    },
  })
}
