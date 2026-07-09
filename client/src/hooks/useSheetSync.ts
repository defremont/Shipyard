import { useState, useEffect, useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { sheetRowsToTasks, tasksToSheetPayload, mergeTasks, diffSheetWithLocal, type SheetDiff, type SheetSyncOptions } from '@/lib/sheetsAdapter'
import { getLastPushAt as getAutoSyncLastPushAt } from '@/lib/sync/autoSync'
import type { Task } from './useTasks'
import { toast } from 'sonner'

// --- localStorage config (milestone-scoped) ---
//
// Each sync config is keyed by (projectId, milestoneId). The "General" /
// default milestone uses the literal id 'default'. Every milestone can target
// its own Apps Script URL; push/pull only touch tasks belonging to that
// milestone so configuring sync on one milestone never writes the tasks of
// another milestone to the same sheet.

export interface SyncConfig {
  url: string
  autoSync: boolean
  syncPrompt: boolean // whether to include the prompt/details column
  lastSyncAt: string | null
  lastSyncStatus: 'ok' | 'error' | null
  lastSyncError: string | null
}

const DEFAULT_MILESTONE = 'default'

function normalizeMilestone(milestoneId?: string): string {
  return milestoneId && milestoneId !== 'default' ? milestoneId : DEFAULT_MILESTONE
}

const SYNC_KEY = (projectId: string, milestoneId: string) =>
  `shipyard:sync:m:${projectId}:${milestoneId}`

const LEGACY_KEY = (projectId: string) => `shipyard:sync:${projectId}`

function migrateLegacy(projectId: string): SyncConfig | null {
  // One-time migration: pre-milestone project-wide config becomes the
  // "default" milestone config, matching the historical behavior that all
  // tasks without a milestone live in General.
  try {
    const raw = localStorage.getItem(LEGACY_KEY(projectId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as SyncConfig
    if (!parsed?.url) return null
    localStorage.setItem(SYNC_KEY(projectId, DEFAULT_MILESTONE), JSON.stringify(parsed))
    localStorage.removeItem(LEGACY_KEY(projectId))
    return parsed
  } catch {
    return null
  }
}

function readConfig(projectId: string, milestoneId?: string): SyncConfig | null {
  const mid = normalizeMilestone(milestoneId)
  try {
    const raw = localStorage.getItem(SYNC_KEY(projectId, mid))
    if (raw) return JSON.parse(raw)
    if (mid === DEFAULT_MILESTONE) return migrateLegacy(projectId)
    return null
  } catch {
    return null
  }
}

function writeConfig(projectId: string, milestoneId: string | undefined, config: SyncConfig) {
  const mid = normalizeMilestone(milestoneId)
  localStorage.setItem(SYNC_KEY(projectId, mid), JSON.stringify(config))
}

function removeConfig(projectId: string, milestoneId?: string) {
  const mid = normalizeMilestone(milestoneId)
  localStorage.removeItem(SYNC_KEY(projectId, mid))
  if (mid === DEFAULT_MILESTONE) {
    localStorage.removeItem(LEGACY_KEY(projectId))
  }
}

/** List every milestone that has sheet sync configured for this project. */
export function listSyncConfigs(projectId: string): Array<{ milestoneId: string; config: SyncConfig }> {
  const prefix = `shipyard:sync:m:${projectId}:`
  const out: Array<{ milestoneId: string; config: SyncConfig }> = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(prefix)) continue
      const milestoneId = key.slice(prefix.length)
      const raw = localStorage.getItem(key)
      if (!raw) continue
      try {
        const config = JSON.parse(raw) as SyncConfig
        if (config?.url) out.push({ milestoneId, config })
      } catch {
        // skip malformed
      }
    }
    // If the default slot is missing but a legacy key exists, migrate + include
    if (!out.some(e => e.milestoneId === DEFAULT_MILESTONE)) {
      const migrated = migrateLegacy(projectId)
      if (migrated) out.push({ milestoneId: DEFAULT_MILESTONE, config: migrated })
    }
  } catch {
    // ignore — localStorage unavailable
  }
  return out
}

/** Check if a project has any milestone configured with sheet sync. */
export function hasSyncConfig(projectId: string): boolean {
  return listSyncConfigs(projectId).length > 0
}

// --- Hook: sync config ---

export function useSyncConfig(projectId: string, milestoneId?: string) {
  const [config, setConfig] = useState<SyncConfig | null>(() => readConfig(projectId, milestoneId))

  // Re-read when project or milestone changes
  useEffect(() => {
    setConfig(readConfig(projectId, milestoneId))
  }, [projectId, milestoneId])

  const save = useCallback((newConfig: SyncConfig) => {
    writeConfig(projectId, milestoneId, newConfig)
    setConfig(newConfig)
  }, [projectId, milestoneId])

  const clear = useCallback(() => {
    removeConfig(projectId, milestoneId)
    setConfig(null)
  }, [projectId, milestoneId])

  return { config, save, clear }
}

// --- Hook: push to sheet ---

export function useSyncPush(projectId: string, milestoneId?: string) {
  return useMutation({
    mutationFn: async ({ url, tasks }: { url: string; tasks: Task[] }) => {
      const config = readConfig(projectId, milestoneId)
      const syncOpts: SheetSyncOptions = { includePrompt: config?.syncPrompt !== false }
      const payload = tasksToSheetPayload(tasks, syncOpts)
      const result = await api.syncProxy(url, 'POST', payload)
      if (result.error) throw new Error(result.error)
      return result.data as { success: boolean; updated: number }
    },
    onSuccess: (data) => {
      const config = readConfig(projectId, milestoneId)
      if (config) {
        writeConfig(projectId, milestoneId, {
          ...config,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'ok',
          lastSyncError: null,
        })
      }
      toast.success(`Pushed ${data.updated} tasks to Google Sheet`)
    },
    onError: (err: Error) => {
      const config = readConfig(projectId, milestoneId)
      if (config) {
        writeConfig(projectId, milestoneId, {
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

export function useSyncPull(projectId: string, milestoneId?: string) {
  const queryClient = useQueryClient()
  const mid = normalizeMilestone(milestoneId)

  return useMutation({
    mutationFn: async ({ url }: { url: string }) => {
      const config = readConfig(projectId, milestoneId)
      const syncOpts: SheetSyncOptions = { includePrompt: config?.syncPrompt !== false }
      const result = await api.syncProxy(url, 'GET')
      if (result.error) throw new Error(result.error)
      const data = result.data as { tasks: Array<Record<string, string>> }
      if (!data.tasks) throw new Error('No tasks data in response')
      const rows = sheetRowsToTasks(data.tasks, syncOpts)
      // If not syncing prompt, preserve local prompt values (within this milestone)
      if (!syncOpts.includePrompt) {
        const { tasks: localTasks } = await api.getTasks(projectId, mid)
        const localMap = new Map(localTasks.map((t: Task) => [t.id, t]))
        for (const row of rows) {
          const local = localMap.get(row.id)
          if (local) row.prompt = local.prompt || ''
        }
      }
      return rows
    },
    onSuccess: async (rows) => {
      // Replace only THIS milestone's tasks — other milestones stay intact.
      await api.replaceTasks(projectId, rows, mid)
      queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })

      const config = readConfig(projectId, milestoneId)
      if (config) {
        writeConfig(projectId, milestoneId, {
          ...config,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'ok',
          lastSyncError: null,
        })
      }
      toast.success(`Pulled ${rows.length} tasks from Google Sheet`)
    },
    onError: (err: Error) => {
      const config = readConfig(projectId, milestoneId)
      if (config) {
        writeConfig(projectId, milestoneId, {
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

export function useSyncPreview(projectId: string, milestoneId?: string) {
  const mid = normalizeMilestone(milestoneId)

  return useMutation({
    mutationFn: async ({ url }: { url: string }): Promise<SheetDiff> => {
      const config = readConfig(projectId, milestoneId)
      const syncOpts: SheetSyncOptions = { includePrompt: config?.syncPrompt !== false }
      const result = await api.syncProxy(url, 'GET')
      if (result.error) throw new Error(result.error)
      const data = result.data as { tasks: Array<Record<string, string>> }
      if (!data.tasks) throw new Error('No tasks data in response')

      const sheetRows = sheetRowsToTasks(data.tasks, syncOpts)
      // Diff against just this milestone's local tasks
      const { tasks: localTasks } = await api.getTasks(projectId, mid)

      return diffSheetWithLocal(sheetRows, localTasks as Task[], syncOpts)
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

export function useAutoSync(projectId: string, milestoneId?: string) {
  const queryClient = useQueryClient()
  const pullingRef = useRef(false)
  const mid = normalizeMilestone(milestoneId)

  useEffect(() => {
    const config = readConfig(projectId, mid)
    if (!config?.url) return

    const syncOpts: SheetSyncOptions = { includePrompt: config.syncPrompt !== false }

    const silentMerge = async () => {
      // Don't poll a hidden tab — the next tick after it's restored catches up.
      if (document.hidden) return
      const guardKey = `${projectId}:${mid}`
      if (Date.now() - (lastPushAt.get(guardKey) ?? 0) < PUSH_GUARD_MS) return
      if (Date.now() - getAutoSyncLastPushAt() < PUSH_GUARD_MS) return
      if (pullingRef.current) return

      pullingRef.current = true
      try {
        const result = await api.syncProxy(config.url, 'GET')
        if (result.error) return
        const data = result.data as { tasks: Array<Record<string, string>> }
        if (!data.tasks) return

        const sheetRows = sheetRowsToTasks(data.tasks, syncOpts)
        // Read only THIS milestone's tasks so the merge stays milestone-scoped
        const freshLocal = await api.getTasks(projectId, mid)
        const localTasks = (freshLocal?.tasks as Task[]) ?? []

        if (!syncOpts.includePrompt) {
          const localMap = new Map(localTasks.map((t: Task) => [t.id, t]))
          for (const row of sheetRows) {
            const local = localMap.get(row.id)
            if (local) row.prompt = local.prompt || ''
          }
        }

        const { merged, localChanged, sheetChanged } = mergeTasks(localTasks, sheetRows, syncOpts)
        if (!localChanged && !sheetChanged) return

        if (localChanged) {
          await api.replaceTasks(projectId, merged, mid)
          queryClient.invalidateQueries({ queryKey: ['tasks', projectId] })
          queryClient.invalidateQueries({ queryKey: ['tasks', 'all'] })
        }

        if (sheetChanged) {
          lastPushAt.set(guardKey, Date.now())
          const payload = tasksToSheetPayload(merged as any, syncOpts)
          await api.syncProxy(config.url, 'POST', payload)
        }

        writeConfig(projectId, mid, {
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

    silentMerge()
    const interval = setInterval(silentMerge, POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [projectId, mid, queryClient])

  return { isSyncing: pullingRef.current }
}

// --- Auto-push: module-level debounced function (milestone-scoped) ---

const lastPushAt = new Map<string, number>()
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function getMilestonePushAt(projectId: string, milestoneId?: string): number {
  return lastPushAt.get(`${projectId}:${normalizeMilestone(milestoneId)}`) ?? 0
}

export function scheduleAutoSyncPush(projectId: string, milestoneId?: string) {
  const mid = normalizeMilestone(milestoneId)
  const config = readConfig(projectId, mid)
  if (!config?.url) return

  const syncOpts: SheetSyncOptions = { includePrompt: config.syncPrompt !== false }
  const timerKey = `${projectId}:${mid}`

  clearTimeout(pushTimers.get(timerKey))
  pushTimers.set(timerKey, setTimeout(async () => {
    try {
      // Only this milestone's tasks participate in the merge + push.
      const { tasks: localTasks } = await api.getTasks(projectId, mid)
      const sheetResult = await api.syncProxy(config.url, 'GET')

      let sheetRows: import('@/lib/sheetsAdapter').SheetRow[] = []
      if (!sheetResult.error) {
        const data = sheetResult.data as { tasks?: Array<Record<string, string>> }
        if (data.tasks) sheetRows = sheetRowsToTasks(data.tasks, syncOpts)
      }

      if (!syncOpts.includePrompt) {
        const localMap = new Map((localTasks as Task[]).map(t => [t.id, t]))
        for (const row of sheetRows) {
          const local = localMap.get(row.id)
          if (local) row.prompt = local.prompt || ''
        }
      }

      const { merged, localChanged } = mergeTasks(localTasks as Task[], sheetRows, syncOpts)

      // Always push merged to sheet (local just changed, so sheet needs at least that)
      const payload = tasksToSheetPayload(merged as any, syncOpts)
      const result = await api.syncProxy(config.url, 'POST', payload)
      if (result.error) throw new Error(result.error)

      if (localChanged) {
        await api.replaceTasks(projectId, merged, mid)
      }

      lastPushAt.set(timerKey, Date.now())
      const freshConfig = readConfig(projectId, mid)
      if (freshConfig) {
        writeConfig(projectId, mid, {
          ...freshConfig,
          lastSyncAt: new Date().toISOString(),
          lastSyncStatus: 'ok',
          lastSyncError: null,
        })
      }
    } catch (err: any) {
      const freshConfig = readConfig(projectId, mid)
      if (freshConfig) {
        writeConfig(projectId, mid, {
          ...freshConfig,
          lastSyncStatus: 'error',
          lastSyncError: err.message,
        })
      }
      toast.error(`Auto-sync failed: ${err.message}`)
    }
  }, 2000))
}
