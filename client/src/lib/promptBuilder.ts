import type { Task } from '@/hooks/useTasks'

const priorityLabel: Record<string, string> = { urgent: 'URGENT', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' }

function formatTaskBlock(t: Task, index?: number): string[] {
  const lines: string[] = []
  const prefix = index != null ? `## ${index + 1}. ` : '## '
  lines.push(`${prefix}${t.title} [${priorityLabel[t.priority]}]`)
  lines.push(`Effort: ${t.effort ? `${t.effort} points` : 'unclassified'}`)
  if (t.description) {
    lines.push('')
    lines.push(t.description)
  }
  if (t.prompt) {
    lines.push('')
    lines.push('### Details')
    lines.push(t.prompt)
  }
  lines.push('')
  return lines
}

export function buildInProgressPrompt(
  tasks: Task[],
  projectName: string,
  projectPath: string,
  projectId: string,
  tasksDir: string,
): string | null {
  const inProgress = tasks
    .filter(t => t.status === 'in_progress')
    .sort((a, b) => {
      const po: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
      return (po[a.priority] ?? 2) - (po[b.priority] ?? 2)
    })

  if (inProgress.length === 0) return null

  const sep = tasksDir.includes('\\') ? '\\' : '/'
  const tasksFilePath = `${tasksDir}${sep}${projectId}.json`

  const lines: string[] = []

  lines.push(`# In Progress Tasks — ${projectName}`)
  lines.push('')
  lines.push(`Project path: ${projectPath}`)
  lines.push(`Tasks file: ${tasksFilePath}`)
  lines.push('')
  lines.push(`You have ${inProgress.length} task${inProgress.length > 1 ? 's' : ''} to resolve:`)
  lines.push('')

  for (let i = 0; i < inProgress.length; i++) {
    lines.push(...formatTaskBlock(inProgress[i], i))
  }

  lines.push('## Instructions')
  lines.push(`Resolve each task in order of priority listed above.`)
  lines.push('For each task:')
  lines.push('1. Confirm or assign Fibonacci effort (1/2/3/5/8) from implementation size; never infer it from priority')
  lines.push('2. Investigate the codebase to understand the context')
  lines.push('3. Plan and implement the solution')
  lines.push('4. Test that your changes work correctly')
  lines.push('5. Create a git commit with your changes using a clear, concise commit message that describes what was done')
  lines.push(`6. Update the tasks file (${tasksFilePath}) to mark the task as done:`)
  lines.push(`   - Set "effort" to the chosen Fibonacci value (1/2/3/5/8)`)
  lines.push(`   - Set "status": "done"`)
  lines.push(`   - Set "doneAt" and "updatedAt" to the current ISO timestamp`)
  lines.push(`   - PRESERVE existing "inboxAt" and "inProgressAt" timestamps — never remove them`)

  const ids = inProgress.map(t => `"${t.id}"`).join(', ')
  lines.push('')
  lines.push(`Task IDs to update: ${ids}`)

  return lines.join('\n')
}

export function buildColumnPrompt(
  columnKey: 'inbox' | 'in_progress' | 'done',
  tasks: Task[],
  projectName: string,
  projectPath: string,
  projectId: string,
  tasksDir: string,
): string | null {
  if (tasks.length === 0) return null

  const sep = tasksDir.includes('\\') ? '\\' : '/'
  const tasksFilePath = `${tasksDir}${sep}${projectId}.json`

  const lines: string[] = []

  const sorted = [...tasks].sort((a, b) => {
    const po: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
    return (po[a.priority] ?? 2) - (po[b.priority] ?? 2)
  })

  if (columnKey === 'inbox') {
    lines.push(`# Inbox Tasks — ${projectName}`)
    lines.push('')
    lines.push(`Project path: ${projectPath}`)
    lines.push(`Tasks file: ${tasksFilePath}`)
    lines.push('')
    lines.push(`${sorted.length} task${sorted.length > 1 ? 's' : ''} in the inbox:`)
    lines.push('')
    for (const t of sorted) {
      lines.push(`- [${t.status === 'backlog' ? 'BACKLOG' : 'TODO'}] ${t.title} (${priorityLabel[t.priority]})${t.description ? ` — ${t.description}` : ''}`)
      if (t.prompt) lines.push(`  Details: ${t.prompt.split('\n')[0]}...`)
    }
    lines.push('')
    lines.push('## Instructions')
    lines.push('Review and organize these inbox tasks:')
    lines.push('1. Read each task and understand its scope')
    lines.push('2. Add or improve descriptions where they are missing or vague')
    lines.push('3. Adjust priorities if needed based on impact and urgency')
    lines.push('4. ALWAYS assign Fibonacci effort to every task: 1 trivial, 2 small, 3 medium, 5 large/cross-layer, 8 very large or uncertain. Effort is size, not priority.')
    lines.push('5. Break down 8-point tasks into smaller, actionable ones when practical')
    lines.push(`6. Update the tasks file (${tasksFilePath}) with your changes`)
    lines.push('7. PRESERVE all existing timestamp fields (inboxAt, inProgressAt, doneAt) — never remove them')
  } else if (columnKey === 'in_progress') {
    lines.push(`# In Progress Tasks — ${projectName}`)
    lines.push('')
    lines.push(`Project path: ${projectPath}`)
    lines.push(`Tasks file: ${tasksFilePath}`)
    lines.push('')
    lines.push(`You have ${sorted.length} task${sorted.length > 1 ? 's' : ''} to resolve:`)
    lines.push('')
    for (let i = 0; i < sorted.length; i++) {
      lines.push(...formatTaskBlock(sorted[i], i))
    }
    lines.push('## Instructions')
    lines.push('Resolve each task in order of priority listed above.')
    lines.push('For each task:')
    lines.push('1. Confirm or assign Fibonacci effort (1/2/3/5/8) from implementation size; never infer it from priority')
    lines.push('2. Investigate the codebase to understand the context')
    lines.push('3. Plan and implement the solution')
    lines.push('4. Test that your changes work correctly')
    lines.push('5. Create a git commit with your changes using a clear, concise commit message that describes what was done')
    lines.push(`6. Update the tasks file (${tasksFilePath}) to mark the task as done:`)
    lines.push('   - Set "effort" to the chosen Fibonacci value (1/2/3/5/8)')
    lines.push('   - Set "status": "done"')
    lines.push('   - Set "doneAt" and "updatedAt" to the current ISO timestamp')
    lines.push('   - PRESERVE existing "inboxAt" and "inProgressAt" timestamps — never remove them')
    const ids = sorted.map(t => `"${t.id}"`).join(', ')
    lines.push('')
    lines.push(`Task IDs to update: ${ids}`)
  } else {
    lines.push(`# Done Tasks — ${projectName}`)
    lines.push('')
    lines.push(`Project path: ${projectPath}`)
    lines.push(`Tasks file: ${tasksFilePath}`)
    lines.push('')
    lines.push(`${sorted.length} task${sorted.length > 1 ? 's' : ''} marked as done:`)
    lines.push('')
    for (let i = 0; i < sorted.length; i++) {
      lines.push(...formatTaskBlock(sorted[i], i))
    }
    lines.push('## Instructions')
    lines.push('Verify that each task above is truly complete:')
    lines.push('1. Confirm or assign Fibonacci effort (1/2/3/5/8) for every task and persist missing values')
    lines.push('2. Check the codebase for each task — is the feature/fix actually implemented?')
    lines.push('3. Look for partial implementations, TODOs, or missing edge cases')
    lines.push('4. If a task is NOT actually done, move it back to in_progress in the tasks file:')
    lines.push(`   - File: ${tasksFilePath}`)
    lines.push('   - Set "status": "in_progress", set "inProgressAt" to current timestamp, clear "doneAt", update "updatedAt"')
    lines.push('   - PRESERVE existing "inboxAt" timestamp — never remove it')
    lines.push('5. If all tasks are properly done, confirm with a summary of what was verified')
  }

  return lines.join('\n')
}

export function buildTaskPrompt(
  task: Task,
  projectName: string | undefined,
  projectPath: string | undefined,
  tasksDir: string | undefined,
): string {
  const sep = tasksDir?.includes('\\') ? '\\' : '/'
  const tasksFilePath = tasksDir ? `${tasksDir}${sep}${task.projectId}.json` : null

  const lines: string[] = []

  // Task instruction
  lines.push(`# Task: ${task.title}`)
  lines.push('')
  if (task.description) {
    lines.push(task.description)
    lines.push('')
  }
  if (task.prompt) {
    lines.push('## Details')
    lines.push(task.prompt)
    lines.push('')
  }
  lines.push(`Priority: ${priorityLabel[task.priority]}`)
  lines.push(`Effort: ${task.effort ? `${task.effort} points` : 'unclassified'}`)
  if (projectName) lines.push(`Project: ${projectName}`)
  if (projectPath) lines.push(`Project path: ${projectPath}`)
  lines.push('')

  // AI instructions
  lines.push('## Instructions')
  lines.push('1. Confirm or assign Fibonacci effort (1/2/3/5/8) from implementation size, independently of priority')
  lines.push('2. Investigate the codebase to understand the context of this task')
  lines.push('3. Plan and implement the solution')
  lines.push('4. Test that your changes work correctly')
  lines.push('5. Create a git commit with your changes using a clear, concise commit message that describes what was done')

  // Shipyard task update instructions
  if (tasksFilePath) {
    lines.push(`6. After completing the task, update the Shipyard tasks file to mark this task as done:`)
    lines.push(`   - File: ${tasksFilePath}`)
    lines.push(`   - Find the task with id "${task.id}" and set:`)
    lines.push(`     - "effort": <chosen Fibonacci value 1|2|3|5|8>`)
    lines.push(`     - "status": "done"`)
    lines.push(`     - "doneAt": "<current ISO timestamp>"`)
    lines.push(`     - "updatedAt": "<current ISO timestamp>"`)
    lines.push(`     - PRESERVE existing "inboxAt" and "inProgressAt" — never remove them`)
  }

  return lines.join('\n')
}
