import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { scheduleAutoSync as scheduleAutoSyncPush } from '@/lib/sync/autoSync'

export interface Task {
  id: string
  number?: number
  projectId: string
  milestoneId?: string
  title: string
  description: string
  priority: 'urgent' | 'high' | 'medium' | 'low'
  status: 'backlog' | 'todo' | 'in_progress' | 'done'
  prompt?: string
  createdAt: string
  updatedAt: string
  order: number
  inboxAt?: string
  inProgressAt?: string
  doneAt?: string
  needsReview?: boolean
  subtasks?: { id: string; title: string; done: boolean }[]
}

/**
 * Cross-project task list. This is the most expensive endpoint (it reads every
 * project's task file) and it has many consumers, including components that
 * stay mounted on every page — so it polls slowly. The board's own
 * `useTasks(projectId)` is what stays at 5s. Mutations invalidate this key, so
 * anything the user does still shows up immediately.
 *
 * Pass `enabled: false` from components that only need the data while open.
 */
export function useAllTasks(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['tasks', 'all'],
    queryFn: async () => {
      const data = await api.getAllTasks()
      return data.tasks as Task[]
    },
    enabled: options?.enabled ?? true,
    refetchInterval: 30000,
  })
}

export function useTasks(projectId: string | undefined, milestoneId?: string) {
  return useQuery({
    queryKey: ['tasks', projectId, milestoneId || 'all'],
    queryFn: async () => {
      if (!projectId) return []
      const data = await api.getTasks(projectId, milestoneId)
      return data.tasks as Task[]
    },
    enabled: !!projectId,
    refetchInterval: 5000,
  })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, ...data }: { projectId: string; title: string; description?: string; priority?: string; status?: string; prompt?: string; milestoneId?: string; subtasks?: { id: string; title: string; done: boolean }[] }) =>
      api.createTask(projectId, data),
    onSuccess: (_, variables) => {
      // Invalidate all task queries for this project (including milestone-scoped)
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      scheduleAutoSyncPush(variables.projectId)
    },
  })
}

export function useUpdateTask() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, taskId, ...data }: { projectId: string; taskId: string; [key: string]: any }) =>
      api.updateTask(projectId, taskId, data),
    onMutate: async (variables) => {
      const { projectId, taskId, ...data } = variables

      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['tasks', projectId] })
      await queryClient.cancelQueries({ queryKey: ['tasks', 'all'] })

      // Snapshot current data for rollback
      const previousTasks = queryClient.getQueryData<Task[]>(['tasks', projectId])
      const previousAllTasks = queryClient.getQueryData<Task[]>(['tasks', 'all'])

      // Optimistically update project tasks
      const updater = (old: Task[] | undefined) => {
        if (!old) return old
        return old.map(t => t.id === taskId ? { ...t, ...data, updatedAt: new Date().toISOString() } : t)
      }
      queryClient.setQueryData<Task[]>(['tasks', projectId], updater)
      queryClient.setQueryData<Task[]>(['tasks', 'all'], updater)

      return { previousTasks, previousAllTasks, projectId }
    },
    onError: (_err, _variables, context) => {
      // Rollback on error
      if (context) {
        queryClient.setQueryData(['tasks', context.projectId], context.previousTasks)
        queryClient.setQueryData(['tasks', 'all'], context.previousAllTasks)
      }
    },
    onSettled: (_, __, variables) => {
      // Always refetch to sync with server state
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      scheduleAutoSyncPush(variables.projectId)
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
      scheduleAutoSyncPush(variables.projectId)
    },
  })
}

export function useBulkUpdateTasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, taskIds, data }: { projectId: string; taskIds: string[]; data: Record<string, any> }) =>
      api.bulkUpdateTasks(projectId, taskIds, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      scheduleAutoSyncPush(variables.projectId)
    },
  })
}

export function useBulkDeleteTasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, taskIds }: { projectId: string; taskIds: string[] }) =>
      api.bulkDeleteTasks(projectId, taskIds),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      scheduleAutoSyncPush(variables.projectId)
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
      scheduleAutoSyncPush(variables.projectId)
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

export function useApplyCsvChanges() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, changes }: { projectId: string; changes: { update: any[]; create: any[]; remove: string[] } }) =>
      api.applyCsvChanges(projectId, changes),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      scheduleAutoSyncPush(variables.projectId)
    },
  })
}

export function useReorderTasks() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, taskIds }: { projectId: string; taskIds: string[] }) =>
      api.reorderTasks(projectId, taskIds),
    onMutate: async (variables) => {
      const { projectId, taskIds } = variables

      await queryClient.cancelQueries({ queryKey: ['tasks', projectId] })

      const previousTasks = queryClient.getQueryData<Task[]>(['tasks', projectId])

      // Optimistically reorder
      queryClient.setQueryData<Task[]>(['tasks', projectId], (old) => {
        if (!old) return old
        return old.map(t => {
          const idx = taskIds.indexOf(t.id)
          return idx !== -1 ? { ...t, order: idx } : t
        })
      })

      return { previousTasks, projectId }
    },
    onError: (_err, _variables, context) => {
      if (context) {
        queryClient.setQueryData(['tasks', context.projectId], context.previousTasks)
      }
    },
    onSettled: (_, __, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tasks', variables.projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
      scheduleAutoSyncPush(variables.projectId)
    },
  })
}
