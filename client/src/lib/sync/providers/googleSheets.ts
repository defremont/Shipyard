import type { SyncProvider, ProviderConfig, SyncResult } from '../types'
import type { Task } from '@/hooks/useTasks'
import { api } from '@/lib/api'
import {
  sheetRowsToTasks,
  tasksToSheetPayload,
  mergeTasks,
} from '@/lib/sheetsAdapter'

export const googleSheetsProvider: SyncProvider = {
  definition: {
    id: 'google-sheets',
    name: 'Google Sheets',
    description: 'Sync tasks bidirectionally with a Google Sheet via Apps Script',
    icon: 'Sheet',
    direction: 'bidirectional',
    requiresServer: true,
    phase: 1,
    available: true,
    configFields: [
      {
        key: 'url',
        label: 'Apps Script URL',
        type: 'url',
        placeholder: 'https://script.google.com/macros/s/...',
        required: true,
        helpText: 'Deploy your Google Apps Script as a Web App and paste the URL here.',
      },
      {
        key: 'autoSync',
        label: 'Auto-sync on task changes',
        type: 'checkbox',
        required: false,
        helpText: 'Automatically push/pull when tasks are modified.',
      },
    ],
  },

  async testConnection(config: ProviderConfig) {
    const url = config.settings.url
    if (!url) return { ok: false, message: 'No URL configured' }

    try {
      const result = await api.syncTest(url)
      if (result.ok) {
        return { ok: true, message: `Connected! Sheet has ${result.data?.rows ?? '?'} task rows.` }
      }
      return { ok: false, message: result.error || 'Connection failed' }
    } catch (err: any) {
      return { ok: false, message: err.message || 'Connection failed' }
    }
  },

  async push(config: ProviderConfig, tasks: Task[]): Promise<SyncResult> {
    const url = config.settings.url
    if (!url) return { success: false, message: 'No URL configured' }

    const syncOpts = { includePrompt: config.settings.syncPrompt !== false }
    const payload = tasksToSheetPayload(tasks, syncOpts)
    const result = await api.syncProxy(url, 'POST', payload)
    if (result.error) throw new Error(result.error)

    const data = result.data as { success: boolean; updated: number }
    return { success: true, pushed: data.updated, message: `Pushed ${data.updated} tasks` }
  },

  async pull(config: ProviderConfig) {
    const url = config.settings.url
    if (!url) throw new Error('No URL configured')

    const syncOpts = { includePrompt: config.settings.syncPrompt !== false }
    const result = await api.syncProxy(url, 'GET')
    if (result.error) throw new Error(result.error)

    const data = result.data as { tasks: Array<Record<string, string>> }
    if (!data.tasks) throw new Error('No tasks data in response')

    const rows = sheetRowsToTasks(data.tasks, syncOpts)
    return { tasks: rows as Partial<Task>[] }
  },

  async merge(config: ProviderConfig, localTasks: Task[]): Promise<SyncResult> {
    const url = config.settings.url
    if (!url) return { success: false, message: 'No URL configured' }

    const syncOpts = { includePrompt: config.settings.syncPrompt !== false }

    // Fetch sheet data
    const result = await api.syncProxy(url, 'GET')
    if (result.error) throw new Error(result.error)

    const data = result.data as { tasks?: Array<Record<string, string>> }
    const sheetRows = data.tasks ? sheetRowsToTasks(data.tasks, syncOpts) : []

    // Merge
    const { merged, localChanged, sheetChanged } = mergeTasks(localTasks, sheetRows, syncOpts)

    if (!localChanged && !sheetChanged) {
      return { success: true, message: 'Already in sync' }
    }

    // Push merged to sheet if local had changes
    if (sheetChanged) {
      const payload = tasksToSheetPayload(merged as any, syncOpts)
      await api.syncProxy(url, 'POST', payload)
    }

    // Update local if sheet had newer data
    if (localChanged) {
      await api.replaceTasks(config.projectId, merged)
    }

    return {
      success: true,
      pushed: sheetChanged ? merged.length : 0,
      pulled: localChanged ? merged.length : 0,
      message: `Merged: ${sheetChanged ? 'pushed' : ''}${sheetChanged && localChanged ? ' + ' : ''}${localChanged ? 'pulled' : ''} changes`,
    }
  },
}
