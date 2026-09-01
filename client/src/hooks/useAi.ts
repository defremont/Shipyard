import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type AiProvider } from '@/lib/api'

/** Status of every AI provider: CLI detected, key stored, which one answers. */
export function useAiStatus() {
  return useQuery({
    queryKey: ['ai', 'status'],
    queryFn: () => api.getAiStatus(),
    staleTime: 30_000,
  })
}

function useAiInvalidate() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['ai', 'status'] })
    // The Claude card and usage badge read the older claude-shaped status.
    queryClient.invalidateQueries({ queryKey: ['claude', 'status'] })
  }
}

export function useSetPreferredAiProvider() {
  const invalidate = useAiInvalidate()
  return useMutation({
    mutationFn: (provider: AiProvider) => api.setPreferredAiProvider(provider),
    onSuccess: invalidate,
  })
}

export function useSaveAiConfig() {
  const invalidate = useAiInvalidate()
  return useMutation({
    mutationFn: ({ provider, ...data }: { provider: AiProvider; apiKey: string; model?: string; maxTokens?: number }) =>
      api.saveAiConfig(provider, data),
    onSuccess: invalidate,
  })
}

export function useDeleteAiConfig() {
  const invalidate = useAiInvalidate()
  return useMutation({
    mutationFn: (provider: AiProvider) => api.deleteAiConfig(provider),
    onSuccess: invalidate,
  })
}

export function useTestAiKey() {
  return useMutation({
    mutationFn: ({ provider, apiKey }: { provider: AiProvider; apiKey: string }) =>
      api.testAiKey(provider, apiKey),
  })
}
