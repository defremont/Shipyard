import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

/**
 * WhatsApp inbox. The server polls it every minute; these hooks only show the
 * result and let the user connect or force a round. A round can create tasks
 * in any project, so it invalidates every task list.
 */

export function useInboxStatus() {
  return useQuery({
    queryKey: ['inbox-status'],
    queryFn: api.getInboxStatus,
    refetchInterval: 60_000,
  })
}

function useInvalidateAfterSync() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['inbox-status'] })
    queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }
}

export function useConfigureInbox() {
  const invalidate = useInvalidateAfterSync()
  return useMutation({
    mutationFn: ({ url, token }: { url: string; token: string }) => api.configureInbox(url, token),
    onSettled: invalidate,
  })
}

export function useSyncInbox() {
  const invalidate = useInvalidateAfterSync()
  return useMutation({ mutationFn: api.syncInbox, onSettled: invalidate })
}

export function useDisconnectInbox() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: api.disconnectInbox,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inbox-status'] }),
  })
}
