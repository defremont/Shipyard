import type { Task } from '@/hooks/useTasks'

export type ProviderId =
  | 'google-sheets'
  | 'github-issues'
  | 'json-export'
  | 'markdown-export'
  | 'webhook'
  | 'linear'
  | 'trello'
  | 'clickup'
  | 'notion'

export type SyncDirection = 'push' | 'pull' | 'bidirectional' | 'export-only' | 'notify-only'

export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'url' | 'password' | 'select' | 'checkbox' | 'textarea'
  placeholder?: string
  required: boolean
  helpText?: string
  options?: { value: string; label: string }[]
}

export interface ProviderDefinition {
  id: ProviderId
  name: string
  description: string
  icon: string // Lucide icon name
  direction: SyncDirection
  configFields: ConfigField[]
  requiresServer: boolean
  phase: 1 | 2 | 3 // implementation phase
  available: boolean // is it implemented?
}

export interface ProviderConfig {
  providerId: ProviderId
  projectId: string
  enabled: boolean
  settings: Record<string, any>
  lastSyncAt: string | null
  lastSyncStatus: 'ok' | 'error' | null
  lastSyncError: string | null
}

export interface SyncResult {
  success: boolean
  pushed?: number
  pulled?: number
  errors?: string[]
  message: string
}

export interface TaskEvent {
  type: 'created' | 'updated' | 'deleted' | 'status_changed'
  task: Task
  previousStatus?: Task['status']
  projectId: string
  projectName?: string
}

export interface SyncProvider {
  definition: ProviderDefinition

  testConnection?(config: ProviderConfig): Promise<{ ok: boolean; message: string }>
  push?(config: ProviderConfig, tasks: Task[]): Promise<SyncResult>
  pull?(config: ProviderConfig): Promise<{ tasks: Partial<Task>[]; raw?: any }>
  merge?(config: ProviderConfig, localTasks: Task[]): Promise<SyncResult>
  export?(config: ProviderConfig, tasks: Task[]): Promise<{ data: string | Blob; filename: string; mimeType: string }>
  notify?(config: ProviderConfig, event: TaskEvent): Promise<void>
}
