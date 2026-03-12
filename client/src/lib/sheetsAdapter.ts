import type { Task } from '@/hooks/useTasks'

export interface SheetSyncOptions {
  includePrompt?: boolean // default true
}

// Columns synced with Google Sheets
const SHEET_COLUMNS = ['id', 'title', 'description', 'priority', 'status', 'prompt', 'updatedAt'] as const

const VALID_PRIORITIES = ['urgent', 'high', 'medium', 'low']
const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'done']

const STATUS_ALIASES: Record<string, string> = {
  'inbox': 'todo',
  'to do': 'todo',
  'to_do': 'todo',
  'in progress': 'in_progress',
  'inprogress': 'in_progress',
}

function normalizeStatus(raw: string): Task['status'] {
  const s = raw.toLowerCase().trim()
  if (VALID_STATUSES.includes(s)) return s as Task['status']
  if (STATUS_ALIASES[s]) return STATUS_ALIASES[s] as Task['status']
  const underscored = s.replace(/\s+/g, '_')
  if (VALID_STATUSES.includes(underscored)) return underscored as Task['status']
  return 'todo'
}

function normalizePriority(raw: string): Task['priority'] {
  const p = raw.toLowerCase().trim()
  if (VALID_PRIORITIES.includes(p)) return p as Task['priority']
  return 'medium'
}

export interface SheetRow {
  id: string
  title: string
  description: string
  priority: string
  status: string
  prompt: string
  updatedAt: string
}

/** Convert Apps Script response rows to partial tasks for import */
export function sheetRowsToTasks(rows: Array<Record<string, string>>, options?: SheetSyncOptions): SheetRow[] {
  const includePrompt = options?.includePrompt !== false
  return rows
    .filter(row => row.title?.trim())
    .map(row => ({
      id: row.id || '',
      title: row.title?.trim() || '',
      description: row.description?.trim() || '',
      priority: normalizePriority(row.priority || ''),
      status: normalizeStatus(row.status || ''),
      prompt: includePrompt ? (row.prompt?.trim() || '') : '',
      updatedAt: row.updatedat || row.updatedAt || '',
    }))
}

/** Convert local tasks to payload for pushing to sheet */
export function tasksToSheetPayload(tasks: Task[], options?: SheetSyncOptions): { action: string; tasks: SheetRow[] } {
  const includePrompt = options?.includePrompt !== false
  return {
    action: 'write',
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description || '',
      priority: t.priority,
      status: t.status,
      prompt: includePrompt ? (t.prompt || '') : '',
      updatedAt: t.updatedAt || '',
    })),
  }
}

function taskToRow(t: Task): SheetRow {
  return {
    id: t.id,
    title: t.title,
    description: t.description || '',
    priority: t.priority,
    status: t.status,
    prompt: t.prompt || '',
    updatedAt: t.updatedAt || '',
  }
}

function contentEquals(local: Task, sheet: SheetRow, options?: SheetSyncOptions): boolean {
  const includePrompt = options?.includePrompt !== false
  return local.title === sheet.title
    && (local.description || '') === sheet.description
    && local.priority === sheet.priority
    && local.status === sheet.status
    && (includePrompt ? (local.prompt || '') === sheet.prompt : true)
}

/**
 * Merge local tasks with sheet tasks.
 * - Same id, different content: newer updatedAt wins.
 *   If timestamps are equal or sheet has no timestamp, but content differs
 *   → sheet wins (user edited manually in the spreadsheet).
 * - Only in local: keep (will be pushed to sheet)
 * - Only in sheet: keep (new from sheet)
 * No data is lost from either side.
 */
export function mergeTasks(localTasks: Task[], sheetRows: SheetRow[], options?: SheetSyncOptions): {
  merged: SheetRow[]
  localChanged: boolean
  sheetChanged: boolean
} {
  const localMap = new Map(localTasks.map(t => [t.id, t]))
  const sheetWithId = sheetRows.filter(r => r.id)
  const sheetWithoutId = sheetRows.filter(r => !r.id)
  const sheetMap = new Map(sheetWithId.map(r => [r.id, r]))
  const allIds = new Set([...localMap.keys(), ...sheetMap.keys()])

  const merged: SheetRow[] = []
  let localChanged = false
  let sheetChanged = false

  for (const id of allIds) {
    const local = localMap.get(id)
    const sheet = sheetMap.get(id)

    if (local && sheet) {
      if (contentEquals(local, sheet, options)) {
        // Content identical — no conflict, keep local (canonical)
        merged.push(taskToRow(local))
      } else {
        // Content differs — decide by timestamp
        const localTime = new Date(local.updatedAt || 0).getTime()
        const sheetTime = new Date(sheet.updatedAt || 0).getTime()

        if (sheetTime > localTime) {
          // Sheet explicitly newer
          merged.push(sheet)
          localChanged = true
        } else if (localTime > sheetTime) {
          // Local explicitly newer
          merged.push(taskToRow(local))
          sheetChanged = true
        } else {
          // Same timestamp (or both missing) but content differs
          // → sheet was edited manually (Shipyard always updates updatedAt on mutations)
          merged.push(sheet)
          localChanged = true
        }
      }
    } else if (local && !sheet) {
      merged.push(taskToRow(local))
      sheetChanged = true
    } else if (sheet && !local) {
      merged.push(sheet)
      localChanged = true
    }
  }

  // Sheet rows without id are new tasks added directly in the spreadsheet
  for (const row of sheetWithoutId) {
    merged.push(row)
    localChanged = true
  }

  return { merged, localChanged, sheetChanged }
}

/** Diff sheet rows against local tasks */
export interface SheetDiff {
  toCreate: SheetRow[]   // In sheet but not local (no matching id)
  toUpdate: Array<{ id: string; sheet: SheetRow; local: Task; changes: string[] }>
  toRemove: Task[]       // In local but not in sheet
  unchanged: number
}

export function diffSheetWithLocal(sheetRows: SheetRow[], localTasks: Task[], options?: SheetSyncOptions): SheetDiff {
  const includePrompt = options?.includePrompt !== false
  const localMap = new Map(localTasks.map(t => [t.id, t]))
  const sheetIds = new Set(sheetRows.filter(r => r.id).map(r => r.id))

  const toCreate: SheetRow[] = []
  const toUpdate: SheetDiff['toUpdate'] = []
  let unchanged = 0

  for (const row of sheetRows) {
    if (row.id && localMap.has(row.id)) {
      const local = localMap.get(row.id)!
      const changes: string[] = []
      if (row.title !== local.title) changes.push('title')
      if (row.description !== (local.description || '')) changes.push('description')
      if (row.priority !== local.priority) changes.push('priority')
      if (row.status !== local.status) changes.push('status')
      if (includePrompt && row.prompt !== (local.prompt || '')) changes.push('prompt')

      if (changes.length > 0) {
        toUpdate.push({ id: row.id, sheet: row, local, changes })
      } else {
        unchanged++
      }
    } else {
      toCreate.push(row)
    }
  }

  const toRemove = localTasks.filter(t => !sheetIds.has(t.id))

  return { toCreate, toUpdate, toRemove, unchanged }
}
