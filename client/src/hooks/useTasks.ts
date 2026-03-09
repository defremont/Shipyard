import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface Task {
  id: string
  projectId: string
  title: string
  description: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  status: 'backlog' | 'todo' | 'in_progress' | 'done'
  promptTemplate?: string
  createdAt: string
  updatedAt: string
  order: number
  inboxAt?: string
  inProgressAt?: string
  doneAt?: string
}

export function useAllTasks() {
  return useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: async () => {
      const data = await api.getAllTasks()
      return data.tasks as Task[]
    },
    refetchInterval: 15000,
  })
}

export function useTasks(projectId: string | undefined) {
  return useQuery({
    queryKey: ['tasks', projectId],
    queryFn: async () => {
      if (!projectId) return []
      const data = await api.getTasks(projectId)
      return data.tasks as Task[]
    },
    enabled: !!projectId,
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, ...data }: { projectId: string; title: string; description?: string; priority?: string; status?: string; promptTemplate?: string }) =>
      api.createTask(projectId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
    },
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, taskId, ...data }: { projectId: string; taskId: string; [key: string]: any }) =>
      api.updateTask(projectId, taskId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
    },
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, taskId }: { projectId: string; taskId: string }) =>
      api.deleteTask(projectId, taskId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
    },
  })
}

export function useImportTasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, tasks }: { projectId: string; tasks: any[] }) =>
      api.importTasks(projectId, tasks),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
    },
  })
}

export function useImportAllTasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (tasks: any[]) => api.importAllTasks(tasks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useReorderTasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, taskIds }: { projectId: string; taskIds: string[] }) =>
      api.reorderTasks(projectId, taskIds),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
    },
  })
}
