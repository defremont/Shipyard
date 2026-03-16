import type { Task, Project } from '../types/index.js';

export function buildAiManagePrompt(
  rawText: string,
  project: Project,
  existingTasks: Task[],
  serverPort: number = 5420,
): string {
  const lines: string[] = [];

  lines.push('# AI Task Manager');
  lines.push('');
  lines.push('## Context');
  lines.push(`Project: ${project.name}`);
  lines.push(`Project ID: ${project.id}`);
  lines.push(`Path: ${project.path}`);
  if (project.techStack.length > 0) {
    lines.push(`Stack: ${project.techStack.join(', ')}`);
  }
  lines.push('');

  // Existing tasks for deduplication
  if (existingTasks.length > 0) {
    lines.push('## Existing tasks in this project');
    for (const t of existingTasks) {
      const desc = t.description ? ` — ${t.description.substring(0, 100)}` : '';
      lines.push(`- [${t.id}] "${t.title}" (${t.status}, ${t.priority})${desc}`);
    }
    lines.push('');
  }

  lines.push('## User input to process');
  lines.push('```');
  lines.push(rawText);
  lines.push('```');
  lines.push('');

  lines.push('## Instructions');
  lines.push('Analyze the user input above and organize it into tasks for this project.');
  lines.push('The input could be: task lists, meeting notes, client emails, bug reports, or instructions like "mark all X as done".');
  lines.push('');
  lines.push('For each action, use the Shipyard API:');
  lines.push('');

  lines.push('### To CREATE a new task:');
  lines.push('```');
  lines.push(`curl -X POST http://localhost:${serverPort}/api/projects/${project.id}/tasks \\`);
  lines.push(`  -H "Content-Type: application/json" \\`);
  lines.push(`  -d '{"title": "...", "description": "...", "prompt": "...", "priority": "medium", "status": "todo"}'`);
  lines.push('```');
  lines.push('- description: user-facing what needs to be done');
  lines.push('- prompt: technical implementation details, files, approach');
  lines.push('- priority: urgent | high | medium | low');
  lines.push('- status: todo | in_progress | done');
  lines.push('');

  lines.push('### To UPDATE an existing task:');
  lines.push('```');
  lines.push(`curl -X PUT http://localhost:${serverPort}/api/projects/${project.id}/tasks/<TASK_ID> \\`);
  lines.push(`  -H "Content-Type: application/json" \\`);
  lines.push(`  -d '{"status": "done"}'`);
  lines.push('```');
  lines.push('Only include the fields that need to change.');
  lines.push('');

  lines.push('## Rules');
  lines.push('- Compare new items against existing tasks. Skip duplicates, update existing ones if needed.');
  lines.push('- For "mark as done" instructions, find matching tasks and update their status.');
  lines.push('- Set priorities based on urgency: ASAP/critical/urgent → urgent or high.');
  lines.push('- Generate clear descriptions (user-facing) and technical prompts (implementation details).');
  lines.push('- Interpret informal text: meeting notes, client emails, bug reports, etc.');
  lines.push('- Log each action you take (created, updated, skipped) so the user can see what happened.');
  lines.push('- The server handles timestamps automatically — do NOT set inboxAt, inProgressAt, doneAt.');

  return lines.join('\n');
}
