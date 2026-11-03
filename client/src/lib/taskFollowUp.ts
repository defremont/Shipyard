import type { Task } from '@/hooks/useTasks'

/**
 * When the last client follow-up (WhatsApp inbox) came in, if it is the most
 * recent thing that happened to the task. Reopening a done task moves
 * `inboxAt` a few ms after `followUpAt`, hence the slack.
 */
export function latestFollowUp(task: Pick<Task, 'followUpAt'>, columnDate: Date | null): Date | null {
  if (!task.followUpAt) return null
  const at = new Date(task.followUpAt)
  if (isNaN(at.getTime())) return null
  if (columnDate && at.getTime() < columnDate.getTime() - 60_000) return null
  return at
}
