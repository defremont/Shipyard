import { useState, useEffect, useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { sheetRowsToTasks, tasksToSheetPayload, mergeTasks, diffSheetWithLocal, type SheetDiff, type SheetSyncOptions } from '@/lib/sheetsAdapter'
import { getLastPushAt as getAutoSyncLastPushAt } from '@/lib/sync/autoSync'
import { writeProviderConfig, readProviderConfig } from '@/lib/sync/configStore'
import type { Task } from './useTasks'
import { toast } from 'sonner'

// --- localStorage config ---

export interface SyncConfig {
  url: string
  autoSync: boolean
  syncPrompt: boolean // whether to include the prompt/details column
  lastSyncAt: string | null
  lastSyncStatus: 'ok' | 'error' | null
  lastSyncError: string | null
}

const SYNC_KEY = (projectId: string) => `shipyard:sync:${projectId}`

function readConfig(projectId: string): SyncConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY(projectId))
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function writeConfig(projectId: string, config: SyncConfig) {
  localStorage.setItem(SYNC_KEY(projectId), JSON.stringify(config))
}

function removeConfig(projectId: string) {
  localStorage.removeItem(SYNC_KEY(projectId))
}

/** Check if a project has sheet sync configured (lightweight, no hook) */
export function hasSyncConfig(projectId: string): boolean {
  try {
    const raw = localStorage.getItem(SYNC_KEY(projectId))
    if (!raw) return false
    const c = JSON.parse(raw)
    return !!c.url
  } catch {
    return false
  }
}

// --- Hook: sync config ---

export function useSyncConfig(projectId: string) {
  const [config, setConfig] = useState<SyncConfig | null>(() => readConfig(projectId))

  // Re-read when projectId changes
  useEffect(() => {
    setConfig(readConfig(projectId))
  }, [projectId])

  const save = useCallback((newConfig: SyncConfig) => {
    writeConfig(projectId, newConfig)
    setConfig(newConfig)
    // Keep provider config in sync so autoSync reads the latest settings
    const existing = readProviderConfig(projectId, 'google-sheets')
    if (existing || newConfig.url) {
      writeProviderConfig(projectId, 'google-sheets', {
        providerId: 'google-sheets',
        projectId,
        enabled: !!newConfig.url,
        settings: { url: newConfig.url, autoSync: newConfig.autoSync, syncPrompt: newConfig.syncPrompt },
        lastSyncAt: newConfig.lastSyncAt,
        lastSyncStatus: newConfig.lastSyncStatus,
        lastSyncError: newConfig.lastSyncError,
      })
    }
  }, [projectId])

  const clear = useCallback(() => {
    removeConfig(projectId)
    setConfig(null)
  }, [projectId])

  return { config, save, clear }
}

// --- Hook: push to sheet ---

export function useSyncPush(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ url, tasks }: { url: string; tasks: Task[] }) => {
      const config = readConfig(projectId)
      const syncOpts: SheetSyncOptions = { includePrompt: config?.syncPrompt !== false }
      const payload = tasksToSheetPayload(tasks, syncOpts)
      const result = await api.syncProxy(url, 'POST', payload)
      if (result.error) throw new Error(result.error)
      return result.data as { success: boolean; updated: number }
    },
    onSuccess: (data) => {
      // Update config with success status
      const config = readConfig(projectId)
      if (config) {
        writeConfig(projectId, {
          ...config,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'ok',
          lastSyncError: null,
        })
      }
      toast.success(`Pushed ${data.updated} tasks to Google Sheet`)
    },
    onError: (err: Error) => {
      const config = readConfig(projectId)
      if (config) {
        writeConfig(projectId, {
          ...config,
          lastSyncStatus: 'error',
          lastSyncError: err.message,
        })
      }
      toast.error(`Push failed: ${err.message}`)
    },
  })
}

// --- Hook: pull from sheet ---

export function useSyncPull(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ url }: { url: string }) => {
      const config = readConfig(projectId)
      const syncOpts: SheetSyncOptions = { includePrompt: config?.syncPrompt !== false }
      const result = await api.syncProxy(url, 'GET')
      if (result.error) throw new Error(result.error)
      const data = result.data as { tasks: Array<Record<string, string>> }
      if (!data.tasks) throw new Error('No tasks data in response')
      const rows = sheetRowsToTasks(data.tasks, syncOpts)
      // If not syncing prompt, preserve local prompt values
      if (!syncOpts.includePrompt) {
        const { tasks: localTasks } = await api.getTasks(projectId)
        const localMap = new Map(localTasks.map((t: Task) => [t.id, t]))
        for (const row of rows) {
          const local = localMap.get(row.id)
          if (local) row.prompt = local.prompt || ''
        }
      }
      return rows
    },
    onSuccess: async (rows) => {
      // Replace local tasks with sheet data
      await api.replaceTasks(projectId, rows)
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })

      const config = readConfig(projectId)
      if (config) {
        writeConfig(projectId, {
          ...config,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'ok',
          lastSyncError: null,
        })
      }
      toast.success(`Pulled ${rows.length} tasks from Google Sheet`)
    },
    onError: (err: Error) => {
      const config = readConfig(projectId)
      if (config) {
        writeConfig(projectId, {
          ...config,
          lastSyncStatus: 'error',
          lastSyncError: err.message,
        })
      }
      toast.error(`Pull failed: ${err.message}`)
    },
  })
}

// --- Hook: preview pull diff (without applying) ---

export function useSyncPreview(projectId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ url }: { url: string }): Promise<SheetDiff> => {
      const config = readConfig(projectId)
      const syncOpts: SheetSyncOptions = { includePrompt: config?.syncPrompt !== false }
      const result = await api.syncProxy(url, 'GET')
      if (result.error) throw new Error(result.error)
      const data = result.data as { tasks: Array<Record<string, string>> }
      if (!data.tasks) throw new Error('No tasks data in response')

      const sheetRows = sheetRowsToTasks(data.tasks, syncOpts)
      const localTasks = (queryClient.getQueryData(['tasks', projectId]) as Task[]) || []

      return diffSheetWithLocal(sheetRows, localTasks, syncOpts)
    },
  })
}

// --- Hook: test connection ---

export function useSyncTest() {
  return useMutation({
    mutationFn: async (url: string) => {
      const result = await api.syncTest(url)
      if (!result.ok) throw new Error(result.error || 'Connection failed')
      return result
    },
  })
}

// --- Hook: setup Dashboard sheet ---

export function useSyncSetup() {
  return useMutation({
    mutationFn: async (url: string) => {
      const result = await api.syncProxy(url, 'GET', undefined, 'setup')
      if (result.data?.error) throw new Error(result.data.error)
      return result.data as { ok: boolean; message: string }
    },
  })
}

// --- Hook: auto-sync (pull on mount + periodic polling every 30s) ---

const POLL_INTERVAL = 30_000 // 30 seconds
const PUSH_GUARD_MS = 10_000 // skip pull if push happened in last 10s

export function useAutoSync(projectId: string) {
  const queryClient = useQueryClient()
  const pullingRef = useRef(false)

  useEffect(() => {
    const config = readConfig(projectId)
    if (!config?.url) return

    const syncOpts: SheetSyncOptions = { includePrompt: config.syncPrompt !== false }

    const silentMerge = async () => {
      // Guard: skip if a push just happened (prevent loop / resurrecting deleted tasks)
      if (Date.now() - lastPushAt < PUSH_GUARD_MS) return
      if (Date.now() - getAutoSyncLastPushAt() < PUSH_GUARD_MS) return
      if (pullingRef.current) return

      pullingRef.current = true
      try {
        const result = await api.syncProxy(config.url, 'GET')
        if (result.error) return
        const data = result.data as { tasks: Array<Record<string, string>> }
        if (!data.tasks) return

        const sheetRows = sheetRowsToTasks(data.tasks, syncOpts)
        // Read from API (file) instead of React Query cache to include MCP-created tasks
        const freshLocal = await api.getTasks(projectId)
        const localTasks = (freshLocal?.tasks as Task[]) ?? (queryClient.getQueryData(['tasks', projectId]) as Task[]) ?? []

        // If not syncing prompt, preserve local prompts in sheet rows
        if (!syncOpts.includePrompt) {
          const localMap = new Map(localTasks.map((t: Task) => [t.id, t]))
          for (const row of sheetRows) {
            const local = localMap.get(row.id)
            if (local) row.prompt = local.prompt || ''
          }
        }

        // Merge: per-task last-write-wins, preserves both sides
        const { merged, localChanged, sheetChanged } = mergeTasks(localTasks, sheetRows, syncOpts)

        if (!localChanged && !sheetChanged) return // nothing to do

        // Update local if sheet had newer data or new tasks
        if (localChanged) {
          await api.replaceTasks(projectId, merged)
          queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
          queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
        }

        // Update sheet if local had newer data or new tasks
        if (sheetChanged) {
          lastPushAt = Date.now()
          const payload = tasksToSheetPayload(merged as any, syncOpts)
          await api.syncProxy(config.url, 'POST', payload)
        }

        writeConfig(projectId, {
          ...config,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'ok',
          lastSyncError: null,
        })
      } catch {
        // Silent fail — don't spam errors on polling
      } finally {
        pullingRef.current = false
      }
    }

    // Merge immediately on mount
    silentMerge()

    // Then poll every 30s
    const interval = setInterval(silentMerge, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [projectId, queryClient])

  return { isSyncing: pullingRef.current }
}

// --- Auto-push: module-level debounced function ---
// Called from useTasks.ts mutation onSuccess callbacks.
// Works from any page (Workspace, TasksPage, Dashboard).

let lastPushAt = 0 // timestamp of last push, used by auto-pull guard
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function scheduleAutoSyncPush(projectId: string) {
  const config = readConfig(projectId)
  if (!config?.url) return

  const syncOpts: SheetSyncOptions = { includePrompt: config.syncPrompt !== false }

  clearTimeout(pushTimers.get(projectId))
  pushTimers.set(projectId, setTimeout(async () => {
    try {
      // Read both sides
      const { tasks: localTasks } = await api.getTasks(projectId)
      const sheetResult = await api.syncProxy(config.url, 'GET')

      let sheetRows: import('@/lib/sheetsAdapter').SheetRow[] = []
      if (!sheetResult.error) {
        const data = sheetResult.data as { tasks?: Array<Record<string, string>> }
        if (data.tasks) sheetRows = sheetRowsToTasks(data.tasks, syncOpts)
      }

      // If not syncing prompt, preserve local prompts
      if (!syncOpts.includePrompt) {
        const localMap = new Map((localTasks as Task[]).map(t => [t.id, t]))
        for (const row of sheetRows) {
          const local = localMap.get(row.id)
          if (local) row.prompt = local.prompt || ''
        }
      }

      // Merge: preserves changes from both sides
      const { merged, localChanged, sheetChanged } = mergeTasks(localTasks as Task[], sheetRows, syncOpts)

      // Always push merged to sheet (local just changed, so sheet needs at least that)
      const payload = tasksToSheetPayload(merged as any, syncOpts)
      const result = await api.syncProxy(config.url, 'POST', payload)
      if (result.error) throw new Error(result.error)

      // If sheet had newer data, update local too
      if (localChanged) {
        await api.replaceTasks(projectId, merged)
      }

      lastPushAt = Date.now()
      const freshConfig = readConfig(projectId)
      if (freshConfig) {
        writeConfig(projectId, {
          ...freshConfig,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'ok',
          lastSyncError: null,
        })
      }
    } catch (err: any) {
      const freshConfig = readConfig(projectId)
      if (freshConfig) {
        writeConfig(projectId, {
          ...freshConfig,
          lastSyncStatus: 'error',
          lastSyncError: err.message,
        })
      }
      toast.error(`Auto-sync failed: ${err.message}`)
    }
  }, 2000))
}
