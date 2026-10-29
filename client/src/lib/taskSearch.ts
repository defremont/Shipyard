import type { Task } from '@/hooks/useTasks'

/**
 * Free-text filter shared by the task views. Terms are ANDed, so typing
 * "sync trello" finds the task that mentions both — the usual way people
 * narrow a board without thinking about it.
 *
 * Numbers are the other way people name a task: "#378" matches task 378 and
 * nothing else; a bare "378" matches the number or the text.
 */
export function parseSearchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

const HASH_NUMBER = /^#(\d+)$/
const BARE_NUMBER = /^\d+$/

interface LowerFields {
  title: string
  body: string    // description + root cause + resolution
  notes: string   // prompt + private context
}

// Lowercasing every prompt on every keystroke dominated the filter on big
// boards. The query cache keeps task objects stable between polls, so the
// lowercase copy is computed once per version of a task.
const lowerCache = new WeakMap<Task, LowerFields>()

function lower(task: Task): LowerFields {
  let fields = lowerCache.get(task)
  if (!fields) {
    fields = {
      title: task.title.toLowerCase(),
      body: [task.description, task.rootCause, task.resolution].filter(Boolean).join('\n').toLowerCase(),
      notes: [task.prompt, task.context].filter(Boolean).join('\n').toLowerCase(),
    }
    lowerCache.set(task, fields)
  }
  return fields
}

function numberMatch(task: Task, term: string): boolean | null {
  const hash = HASH_NUMBER.exec(term)
  if (hash) return task.number === Number(hash[1])
  if (BARE_NUMBER.test(term) && task.number === Number(term)) return true
  return null
}

/** `extra` carries fields that live outside the task (e.g. the project name). */
export function taskMatchesTerms(task: Task, terms: string[], extra?: string): boolean {
  if (terms.length === 0) return true
  const f = lower(task)
  const extraLower = extra?.toLowerCase()
  return terms.every(term => {
    const byNumber = numberMatch(task, term)
    if (byNumber !== null) return byNumber
    return f.title.includes(term) || f.body.includes(term) || f.notes.includes(term)
      || (!!extraLower && extraLower.includes(term))
  })
}

/**
 * Relevance for the command palette: 0 = no match, higher = better. Same AND
 * rule as `taskMatchesTerms`; a hit in the title outweighs one buried in the
 * prompt, and a task number beats everything.
 */
export function scoreTask(task: Task, terms: string[], extra?: string): number {
  if (terms.length === 0) return 1
  const f = lower(task)
  const extraLower = extra?.toLowerCase()
  let score = 0
  for (const term of terms) {
    const byNumber = numberMatch(task, term)
    if (byNumber === false) return 0
    if (byNumber) { score += 1000; continue }
    if (f.title.includes(term)) score += f.title.startsWith(term) ? 60 : 40
    else if (f.body.includes(term)) score += 15
    else if (extraLower?.includes(term)) score += 12
    else if (f.notes.includes(term)) score += 5
    else return 0
  }
  const phrase = terms.join(' ')
  if (terms.length > 1 && f.title.includes(phrase)) score += 30
  if (f.title === phrase) score += 50
  return score
}
