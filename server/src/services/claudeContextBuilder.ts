import { readdir } from 'fs/promises';
import { getProjects } from './projectDiscovery.js';
import * as taskStore from './taskStore.js';
import * as gitService from './gitService.js';

export async function buildProjectContext(projectId: string): Promise<string> {
  const projects = await getProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return 'Project not found.';

  const parts: string[] = [];

  // Project info
  parts.push(`Project: ${project.name}`);
  parts.push(`Path: ${project.path}`);
  if (project.techStack.length > 0) {
    parts.push(`Tech Stack: ${project.techStack.join(', ')}`);
  }

  // Git info
  if (project.isGitRepo) {
    parts.push(`Git Branch: ${project.gitBranch || 'unknown'}`);
    try {
      const status = await gitService.getStatus(project.path);
      if (status) {
        const staged = status.staged?.length || 0;
        const modified = status.modified?.length || 0;
        const untracked = status.not_added?.length || 0;
        parts.push(`Git Status: ${staged} staged, ${modified} modified, ${untracked} untracked`);
      }
    } catch {}
  }

  // Tasks — only active tasks (skip done to save tokens)
  const tasks = await taskStore.getTasks(projectId);
  const activeTasks = tasks.filter(t => t.status !== 'done');
  if (activeTasks.length > 0) {
    parts.push('\nActive Tasks:');
    const inProgress = activeTasks.filter(t => t.status === 'in_progress');
    const inbox = activeTasks.filter(t => t.status === 'todo' || t.status === 'backlog');

    if (inProgress.length > 0) {
      parts.push('  In Progress:');
      for (const t of inProgress) {
        parts.push(`    - [${t.priority}; effort ${t.effort ?? 'unclassified'}] ${t.title}`);
        if (t.description) parts.push(`      ${t.description.slice(0, 200)}`);
      }
    }
    if (inbox.length > 0) {
      parts.push('  Inbox:');
      for (const t of inbox.slice(0, 10)) {
        parts.push(`    - [${t.priority}; effort ${t.effort ?? 'unclassified'}] ${t.title}`);
      }
    }
  }

  // File structure (top-level only, limit to avoid flooding)
  try {
    const entries = await readdir(project.path, { withFileTypes: true });
    const files = entries.slice(0, 30).map(e => (e.isDirectory() ? `${e.name}/` : e.name));
    parts.push(`\nProject Files (top-level): ${files.join(', ')}`);
  } catch {}

  return parts.join('\n');
}

export async function buildTaskContext(projectId: string, taskId: string): Promise<string> {
  const projectContext = await buildProjectContext(projectId);
  const task = await taskStore.getTask(projectId, taskId);

  if (!task) return projectContext;

  return `${projectContext}\n\nFocused Task:\n  Title: ${task.title}\n  Status: ${task.status}\n  Priority: ${task.priority}\n  Effort: ${task.effort ? task.effort + ' points' : 'unclassified'}\n  Description: ${task.description || 'None'}\n  Technical Details: ${task.prompt || 'None'}`;
}
