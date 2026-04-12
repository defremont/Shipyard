import { getProvider } from './registry'
import { api } from '@/lib/api'
import type { Task } from '@/hooks/useTasks'
import type { ProviderConfig } from './types'
import { listSyncConfigs, type SyncConfig } from '@/hooks/useSheetSync'
import { toast } from 'sonner'

// Import providers to ensure registration
import './providers'

// Task-mutation-triggered auto-push.
//
// Sync configs are milestone-scoped (see useSheetSync.ts). A single task
// mutation might affect one milestone, but consecutive mutations can touch
// several — and when a task is *moved* between milestones both the source and
// the destination need a push. Simplest correct behavior: debounce per
// project, then on fire push every milestone that has a sheet configured.

let lastPushAt = 0
const PUSH_GUARD_MS = 10_000
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function getLastPushAt() {
  return lastPushAt
}

export function setLastPushAt(ts: number) {
  lastPushAt = ts
}

export function scheduleAutoSync(projectId: string) {
  clearTimeout(pushTimers.get(projectId))
  pushTimers.set(projectId, setTimeout(async () => {
    await runAutoSync(projectId)
  }, 2000))
}

async function runAutoSync(projectId: string) {
  const entries = listSyncConfigs(projectId)
  if (entries.length === 0) return

  const provider = getProvider('google-sheets')
  if (!provider?.push) return

  for (const entry of entries) {
    await pushMilestone(projectId, entry.milestoneId, entry.config, provider.push)
  }
}

async function pushMilestone(
  projectId: string,
  milestoneId: string,
  sheetConfig: SyncConfig,
  push: NonNullable<ReturnType<typeof getProvider>>['push'],
) {
  if (!push) return
  try {
    // Push only tasks that belong to this milestone. Local state is the
    // source of truth here — the mutation that scheduled this push just
    // happened, so merging against the sheet would risk resurrecting
    // deleted tasks.
    const { tasks } = await api.getTasks(projectId, milestoneId)
    const providerConfig: ProviderConfig = {
      providerId: 'google-sheets',
      projectId,
      enabled: true,
      settings: {
        url: sheetConfig.url,
        autoSync: sheetConfig.autoSync,
        syncPrompt: sheetConfig.syncPrompt,
      },
      lastSyncAt: sheetConfig.lastSyncAt,
      lastSyncStatus: sheetConfig.lastSyncStatus,
      lastSyncError: sheetConfig.lastSyncError,
    }
    await push(providerConfig, tasks as Task[])

    lastPushAt = Date.now()
    writeMilestoneStatus(projectId, milestoneId, {
      ...sheetConfig,
      lastSyncAt: new Date().toISOString(),
      lastSyncStatus: 'ok',
      lastSyncError: null,
    })
  } catch (err: any) {
    writeMilestoneStatus(projectId, milestoneId, {
      ...sheetConfig,
      lastSyncStatus: 'error',
      lastSyncError: err?.message ?? 'unknown error',
    })
    toast.error(`Auto-sync failed: ${err?.message ?? 'unknown error'}`)
  }
}

function writeMilestoneStatus(projectId: string, milestoneId: string, config: SyncConfig) {
  try {
    localStorage.setItem(
      `shipyard:sync:m:${projectId}:${milestoneId}`,
      JSON.stringify(config),
    )
  } catch {
    // ignore
  }
}

// Re-export for backward compat
export { scheduleAutoSync as scheduleAutoSyncPush }
