import type { Task } from '@/hooks/useTasks'

export type ActivityEventType = 'started' | 'note' | 'done'

export interface ActivityEvent {
  /** Stable across polls: same task + same type + same instant = same row. */
  id: string
  type: ActivityEventType
  /** Epoch ms. */
  at: number
  task: Task
  /** One-line preview of the note or the completion summary. */
  detail?: string
}

/**
 * Sections an agent appends to a task prompt. `log_task_progress` (MCP) and
 * the "Needs changes" route both write `— Note YYYY-MM-DD HH:MM` in UTC;
 * `complete_task` writes an undated `— Summary`. See
 * taskStore.appendPromptSection — both ends must keep the same shape.
 *
 * Parsing them back is the only way to see a note as its own event: the task
 * record itself keeps a single `updatedAt`, which any edit overwrites.
 */
const NOTE_HEADER = /^— Note (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})$/
const SUMMARY_HEADER = /^— Summary$/
const SECTION_HEADER = /^— /

/** First non-empty line of the section that starts at `start`. */
function sectionPreview(lines: string[], start: number): string {
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim()
    if (SECTION_HEADER.test(line)) break
    if (line) return line
  }
  return ''
}

interface PromptSections {
  notes: { at: number; detail: string }[]
  summary?: string
}

const EMPTY_SECTIONS: PromptSections = { notes: [] }

export function parsePromptSections(prompt: string | undefined): PromptSections {
  const out: PromptSections = { notes: [] }
  if (!prompt || !prompt.includes('— ')) return out

  const lines = prompt.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    const note = NOTE_HEADER.exec(line)
    if (note) {
      const at = Date.parse(`${note[1]}T${note[2]}:00Z`)
      if (!Number.isNaN(at)) out.notes.push({ at, detail: sectionPreview(lines, i + 1) })
      continue
    }

    // Only the last summary matters — a re-run appends another one.
    if (SUMMARY_HEADER.test(line)) out.summary = sectionPreview(lines, i + 1)
  }
  return out
}

function time(iso: string | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

export interface BuildOptions {
  /** Oldest instant to keep, epoch ms. */
  since: number
  /** Clock skew guard — events dated past this are dropped. Defaults to now. */
  now?: number
}

/**
 * Turn the cross-project task list into a timeline of what agents did:
 * a task moved to in_progress, a progress note landed, a task was completed.
 * Newest first.
 */
export function buildActivityEvents(
  tasks: Task[] | undefined,
  { since, now = Date.now() }: BuildOptions
): ActivityEvent[] {
  if (!tasks?.length) return []
  const horizon = now + 60_000
  const events: ActivityEvent[] = []
  // A task file can carry the same id twice (it has happened) — a repeated
  // row key would break React's list, so the first copy wins.
  const seen = new Set<string>()

  const keep = (at: number | null) => at !== null && at >= since && at <= horizon
  const push = (event: ActivityEvent) => {
    if (seen.has(event.id)) return
    seen.add(event.id)
    events.push(event)
  }

  for (const task of tasks) {
    // Notes are appended through updateTask, so a task untouched since the
    // window opened cannot hold one — that skips the prompt scan for the
    // whole archive, which is most of the list.
    const touchedAt = time(task.updatedAt)
    const sections = touchedAt !== null && touchedAt < since
      ? EMPTY_SECTIONS
      : parsePromptSections(task.prompt)

    const doneAt = time(task.doneAt)
    if (keep(doneAt)) {
      push({ id: `${task.projectId}:${task.id}:done`, type: 'done', at: doneAt!, task, detail: sections.summary })
    }

    const startedAt = time(task.inProgressAt)
    if (keep(startedAt)) {
      push({ id: `${task.projectId}:${task.id}:started`, type: 'started', at: startedAt!, task })
    }

    // Two notes can land in the same minute, and the header only carries
    // minutes — the index keeps the row key unique. Prompts are append-only,
    // so it stays stable across polls.
    sections.notes.forEach((note, index) => {
      if (!keep(note.at)) return
      push({
        id: `${task.projectId}:${task.id}:note:${index}:${note.at}`,
        type: 'note',
        at: note.at,
        task,
        detail: note.detail,
      })
    })
  }

  events.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
  return events
}

/** "4m ago" — a feed row has no width for "about 4 minutes ago". */
export function shortAgo(at: number, now: number): string {
  const seconds = Math.round((now - at) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
