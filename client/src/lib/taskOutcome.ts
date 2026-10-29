import type { Task } from '@/hooks/useTasks'

export interface TaskOutcome {
  /** Why it happened — bugs and problems only. */
  rootCause?: string
  /** What was done. */
  resolution?: string
  /** True when read back from the old free-text places, not the fields. */
  legacy: boolean
}

/**
 * The outcome of a done task. Since v1.30 it lives in `rootCause` and
 * `resolution`. Before that, agents wrote it as a `— Summary` section at the
 * end of the prompt (MCP `complete_task`) or as a `## What was done` section
 * in the description ("Run with AI"), so older tasks are read from there.
 */
export function getTaskOutcome(task: Task): TaskOutcome {
  const rootCause = task.rootCause?.trim() || undefined
  const resolution = task.resolution?.trim() || undefined
  if (rootCause || resolution) return { rootCause, resolution, legacy: false }

  const legacy = lastPromptSummary(task.prompt) ?? markdownSection(task.description, 'What was done')
  return legacy ? { resolution: legacy, legacy: true } : { legacy: false }
}

/** Body of the last `— Summary` section (a re-run appends another one). */
function lastPromptSummary(prompt: string | undefined): string | undefined {
  if (!prompt?.includes('— Summary')) return undefined
  const lines = prompt.split('\n')
  let start = -1
  for (let i = 0; i < lines.length; i++) if (lines[i].trim() === '— Summary') start = i + 1
  if (start < 0) return undefined
  const body: string[] = []
  for (let i = start; i < lines.length && !/^— /.test(lines[i].trim()); i++) body.push(lines[i])
  return body.join('\n').trim() || undefined
}

function markdownSection(text: string | undefined, heading: string): string | undefined {
  if (!text) return undefined
  const match = new RegExp(`^##\\s+${heading}\\s*$`, 'mi').exec(text)
  if (!match) return undefined
  const rest = text.slice(match.index + match[0].length)
  const next = rest.search(/^##\s/m)
  return (next >= 0 ? rest.slice(0, next) : rest).trim() || undefined
}
