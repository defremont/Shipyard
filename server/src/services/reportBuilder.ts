import * as taskStore from './taskStore.js';
import * as gitService from './gitService.js';
import { getProjects } from './projectDiscovery.js';
import type { Task, Project, Milestone } from '../types/index.js';

export interface ReportCommit {
  hash: string;
  shortHash: string;
  message: string;
  date: string;
  author: string;
}

export interface ReportMetrics {
  total: number;
  byStatus: Record<Task['status'], number>;
  byPriority: Record<Task['priority'], number>;
  completionRate: number;
  completedInPeriod: number;
}

export interface ReportData {
  project: Pick<Project, 'id' | 'name' | 'category' | 'techStack' | 'gitBranch'>;
  milestone?: Pick<Milestone, 'id' | 'name' | 'description' | 'status'>;
  generatedAt: string;
  period?: { from?: string; to?: string };
  metrics: ReportMetrics;
  tasks: Task[];
  commits: ReportCommit[];
}

export interface BuildReportOptions {
  projectId: string;
  milestoneId?: string;
  from?: string;
  to?: string;
  includeCommits?: boolean;
  statusFilter?: Task['status'][];
}

function emptyMetrics(): ReportMetrics {
  return {
    total: 0,
    byStatus: { backlog: 0, todo: 0, in_progress: 0, done: 0 },
    byPriority: { urgent: 0, high: 0, medium: 0, low: 0 },
    completionRate: 0,
    completedInPeriod: 0,
  };
}

function computeMetrics(tasks: Task[], from?: Date, to?: Date): ReportMetrics {
  const m = emptyMetrics();
  m.total = tasks.length;
  for (const t of tasks) {
    m.byStatus[t.status]++;
    m.byPriority[t.priority]++;
    if (t.status === 'done' && t.doneAt) {
      const d = new Date(t.doneAt);
      if ((!from || d >= from) && (!to || d <= to)) {
        m.completedInPeriod++;
      }
    }
  }
  m.completionRate = m.total > 0 ? Math.round((m.byStatus.done / m.total) * 100) : 0;
  return m;
}

function withinPeriod(iso: string | undefined, from?: Date, to?: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export async function buildReport(options: BuildReportOptions): Promise<ReportData> {
  const projects = await getProjects();
  const project = projects.find(p => p.id === options.projectId);
  if (!project) throw new Error('Project not found');

  const from = options.from ? new Date(options.from) : undefined;
  const to = options.to ? new Date(options.to) : undefined;

  let tasks = await taskStore.getTasks(options.projectId, options.milestoneId);

  if (options.statusFilter && options.statusFilter.length > 0) {
    const allowed = new Set(options.statusFilter);
    tasks = tasks.filter(t => allowed.has(t.status));
  }

  // Sort: in_progress first, then todo, backlog, done; within group by priority, then by number
  const statusOrder: Record<Task['status'], number> = { in_progress: 0, todo: 1, backlog: 2, done: 3 };
  const priorityOrder: Record<Task['priority'], number> = { urgent: 0, high: 1, medium: 2, low: 3 };
  tasks.sort((a, b) => {
    const s = statusOrder[a.status] - statusOrder[b.status];
    if (s !== 0) return s;
    const p = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (p !== 0) return p;
    return (a.number || 0) - (b.number || 0);
  });

  let milestone: ReportData['milestone'];
  if (options.milestoneId) {
    const milestones = await taskStore.getMilestones(options.projectId);
    const found = milestones.find(m => m.id === options.milestoneId);
    if (found) {
      milestone = { id: found.id, name: found.name, description: found.description, status: found.status };
    }
  }

  let commits: ReportCommit[] = [];
  if (options.includeCommits && project.isGitRepo) {
    try {
      const log = await gitService.getLog(project.path, 200);
      commits = log.all
        .filter(c => withinPeriod(c.date, from, to))
        .map(c => ({
          hash: c.hash,
          shortHash: c.hash.slice(0, 7),
          message: c.message,
          date: c.date,
          author: c.author_name,
        }));
    } catch {
      commits = [];
    }
  }

  return {
    project: {
      id: project.id,
      name: project.name,
      category: project.category,
      techStack: project.techStack,
      gitBranch: project.gitBranch,
    },
    milestone,
    generatedAt: new Date().toISOString(),
    period: from || to ? { from: options.from, to: options.to } : undefined,
    metrics: computeMetrics(tasks, from, to),
    tasks,
    commits,
  };
}
