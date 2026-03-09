import type { Task } from '@/hooks/useTasks'

const CSV_COLUMNS = ['id', 'title', 'description', 'priority', 'status', 'prompt_template'] as const

export type CsvRow = {
  id: string
  title: string
  description: string
  priority: string
  status: string
  prompt_template: string
}

function escapeField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

export function tasksToCSV(tasks: Task[]): string {
  const BOM = '\uFEFF'
  const header = CSV_COLUMNS.join(',')
  const rows = tasks.map(task => {
    const row: CsvRow = {
      id: task.id,
      title: task.title,
      description: task.description || '',
      priority: task.priority,
      status: task.status,
      prompt_template: task.promptTemplate || '',
    }
    return CSV_COLUMNS.map(col => escapeField(row[col])).join(',')
  })
  return BOM + header + '\n' + rows.join('\n')
}

const VALID_PRIORITIES = ['urgent', 'high', 'medium', 'low']
const VALID_STATUSES = ['backlog', 'todo', 'in_progress', 'done']

export function parseCSV(text: string): CsvRow[] {
  const clean = text.replace(/^\uFEFF/, '').trim()
  if (!clean) return []

  const lines = parseCSVLines(clean)
  if (lines.length < 2) return []

  const header = lines[0].map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))

  return lines.slice(1)
    .filter(fields => fields.some(f => f.trim()))
    .map(fields => {
      const obj: Record<string, string> = {}
      header.forEach((h, i) => { obj[h] = fields[i]?.trim() || '' })
      return {
        id: obj.id || '',
        title: obj.title || '',
        description: obj.description || '',
        priority: VALID_PRIORITIES.includes(obj.priority) ? obj.priority : 'medium',
        status: VALID_STATUSES.includes(obj.status) ? obj.status : 'todo',
        prompt_template: obj.prompt_template || '',
      }
    })
    .filter(row => row.title)
}

function parseCSVLines(text: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const char = text[i]
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i++
        }
      } else {
        field += char
        i++
      }
    } else {
      if (char === '"') {
        inQuotes = true
        i++
      } else if (char === ',') {
        current.push(field)
        field = ''
        i++
      } else if (char === '\r') {
        current.push(field)
        field = ''
        rows.push(current)
        current = []
        i++
        if (text[i] === '\n') i++
      } else if (char === '\n') {
        current.push(field)
        field = ''
        rows.push(current)
        current = []
        i++
      } else {
        field += char
        i++
      }
    }
  }

  if (field || current.length > 0) {
    current.push(field)
    rows.push(current)
  }

  return rows
}

// --- Diff types ---

export interface FieldChange {
  field: string
  label: string
  oldValue: string
  newValue: string
}

export interface ModifiedTask {
  id: string
  current: Task
  incoming: CsvRow
  changes: FieldChange[]
}

export interface CsvDiff {
  modified: ModifiedTask[]
  added: CsvRow[]
  removed: Task[]
  unchanged: number
}

export function diffTasks(currentTasks: Task[], csvRows: CsvRow[]): CsvDiff {
  const currentMap = new Map(currentTasks.map(t => [t.id, t]))
  const csvIds = new Set(csvRows.filter(r => r.id).map(r => r.id))

  const modified: ModifiedTask[] = []
  const added: CsvRow[] = []
  let unchanged = 0

  for (const row of csvRows) {
    if (row.id && currentMap.has(row.id)) {
      const current = currentMap.get(row.id)!
      const changes: FieldChange[] = []

      if (row.title !== current.title)
        changes.push({ field: 'title', label: 'Title', oldValue: current.title, newValue: row.title })
      if (row.description !== (current.description || ''))
        changes.push({ field: 'description', label: 'Description', oldValue: current.description || '', newValue: row.description })
      if (row.priority !== current.priority)
        changes.push({ field: 'priority', label: 'Priority', oldValue: current.priority, newValue: row.priority })
      if (row.status !== current.status)
        changes.push({ field: 'status', label: 'Status', oldValue: current.status, newValue: row.status })
      if (row.prompt_template !== (current.promptTemplate || ''))
        changes.push({ field: 'prompt_template', label: 'Prompt', oldValue: current.promptTemplate || '', newValue: row.prompt_template })

      if (changes.length > 0) {
        modified.push({ id: row.id, current, incoming: row, changes })
      } else {
        unchanged++
      }
    } else {
      added.push(row)
    }
  }

  const removed = currentTasks.filter(t => !csvIds.has(t.id))

  return { modified, added, removed, unchanged }
}
