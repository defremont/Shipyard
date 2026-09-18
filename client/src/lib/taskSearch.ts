import type { Task } from '@/hooks/useTasks'

/**
 * Free-text filter shared by the task views. Terms are ANDed, so typing
 * "sync trello" finds the task that mentions both — the usual way people
 * narrow a board without thinking about it.
 */
export function parseSearchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

/** `extra` carries fields that live outside the task (e.g. the project name). */
export function taskMatchesTerms(task: Task, terms: string[], extra?: string): boolean {
  if (terms.length === 0) return true
  const haystack = [task.title, task.description, task.prompt, extra]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  return terms.every(term => haystack.includes(term))
}
