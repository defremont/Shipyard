import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export function useClaudeStatus() {
  return useQuery({
    queryKey: ['claude', 'status'],
    queryFn: () => api.getClaudeStatus(),
    staleTime: 30000,
  })
}

/** The 5h window moves slowly; a minute of staleness is invisible to the user. */
export function useClaudeUsage() {
  return useQuery({
    queryKey: ['claude', 'usage'],
    queryFn: () => api.getClaudeUsage(),
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
  })
}

export function useSaveClaudeConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { apiKey: string; model?: string; maxTokens?: number }) =>
      api.saveClaudeConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claude', 'status'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'status'] })
    },
  })
}

export function useDeleteClaudeConfig() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.deleteClaudeConfig(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claude', 'status'] })
      queryClient.invalidateQueries({ queryKey: ['ai', 'status'] })
    },
  })
}

export function useTestClaudeKey() {
  return useMutation({
    mutationFn: (apiKey: string) => api.testClaudeKey(apiKey),
  })
}

export function useAnalyzeTask() {
  return useMutation({
    mutationFn: ({ projectId, title, taskId }: { projectId: string; title: string; taskId?: string }) =>
      api.analyzeTask(projectId, title, taskId),
  })
}

// SSE streaming chat
export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function streamChat(
  projectId: string | undefined,
  messages: ChatMessage[],
  onChunk: (text: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
) {
  try {
    const res = await fetch('/api/claude/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, messages }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }))
      onError(err.error || 'Request failed')
      return
    }

    const reader = res.body?.getReader()
    if (!reader) { onError('No response body'); return }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6)
        try {
          const parsed = JSON.parse(data)
          if (parsed.type === 'text') {
            onChunk(parsed.text)
          } else if (parsed.type === 'done') {
            onDone()
          } else if (parsed.type === 'error') {
            onError(parsed.error)
          }
        } catch {}
      }
    }

    onDone()
  } catch (err: any) {
    onError(err.message || 'Connection failed')
  }
}
