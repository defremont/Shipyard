import type { Task, Project } from '../types/index.js';

export function buildAiResolvePrompt(
  task: Task,
  project: Project,
  serverPort: number = 5420,
): string {
  const lines: string[] = [];

  lines.push(`# Task: ${task.title}`);
  lines.push('');
  lines.push('## Context');
  lines.push(`Project: ${project.name}`);
  lines.push(`Path: ${project.path}`);
  if (project.techStack.length > 0) {
    lines.push(`Stack: ${project.techStack.join(', ')}`);
  }
  if (project.gitBranch) {
    lines.push(`Branch: ${project.gitBranch}`);
  }
  lines.push('');

  if (task.description) {
    lines.push('## What to do');
    lines.push(task.description);
    lines.push('');
  }

  if (task.prompt) {
    lines.push('## Technical details');
    lines.push(task.prompt);
    lines.push('');
  }

  const priorityLabel: Record<string, string> = { urgent: 'URGENT', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };
  lines.push(`Priority: ${priorityLabel[task.priority] || task.priority}`);
  lines.push(`Task ID: ${task.id}`);
  lines.push(`Project ID: ${project.id}`);
  lines.push('');

  lines.push('## Instructions');
  lines.push('1. Read the task description and technical details above carefully');
  lines.push(`2. Explore the codebase at ${project.path} to understand the current state`);
  lines.push('3. Implement the required changes');
  lines.push('4. Test your implementation');
  lines.push('5. Create a git commit with your changes using a clear, concise commit message that describes what was done (do NOT use --no-verify or skip hooks)');
  lines.push('');

  lines.push('## IMPORTANT: When starting work on this task');
  lines.push('First, improve the task title and description if they are vague or unclear.');
  lines.push(`Call this API to update the task:`);
  lines.push('');
  lines.push('```');
  lines.push(`curl -X PUT http://localhost:${serverPort}/api/projects/${project.id}/tasks/${task.id} \\`);
  lines.push(`  -H "Content-Type: application/json" \\`);
  lines.push(`  -d '{"title": "<improved title>", "description": "<improved description>"}'`);
  lines.push('```');
  lines.push('');

  lines.push('## CRITICAL — YOU MUST DO THIS WHEN FINISHED:');
  lines.push('After committing your changes, you MUST update the task status to "done" via the Shipyard API.');
  lines.push('This is NOT optional — if you skip this step, the task will be stuck as in-progress.');
  lines.push('');
  lines.push('Run this curl command:');
  lines.push('```');
  lines.push(`curl -X PUT http://localhost:${serverPort}/api/projects/${project.id}/tasks/${task.id} \\`);
  lines.push(`  -H "Content-Type: application/json" \\`);
  lines.push(`  -d '{"description": "<original description>\\n\\n## What was done\\n<brief user-friendly summary of what was accomplished>", "prompt": "<technical summary: files changed, approach taken, key decisions>", "status": "done"}'`);
  lines.push('```');
  lines.push('');
  lines.push('Rules:');
  lines.push('- The "description" field MUST preserve the original description text and append a "## What was done" section with a brief, user-friendly summary of what was accomplished');
  lines.push('- The "prompt" field should contain a concise technical summary of the implementation (files changed, approach, key decisions)');
  lines.push('- Set status to "done" only when the task is fully complete');
  lines.push('- The server handles timestamps automatically, no need to set them');
  lines.push('- DO NOT skip this step — it is required for task tracking');

  return lines.join('\n');
}
