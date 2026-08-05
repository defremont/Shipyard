import type { Task } from '../types/index.js';

const MIN_DURATION_MS = 1_000;
const MAX_DURATION_MS = 180 * 24 * 60 * 60 * 1_000;

export type ForecastConfidence = 'low' | 'medium' | 'high';

export interface TaskForecastItem {
  taskId: string;
  estimatedDevelopmentMs: number;
  remainingDevelopmentMs: number;
  likelyLowMs: number;
  likelyHighMs: number;
  sampleSize: number;
  source: 'project-effort' | 'global-effort' | 'project-priority' | 'project' | 'global-priority' | 'global' | 'none';
}

export interface ForecastScopeSummary {
  taskCount: number;
  estimatedDevelopmentMs: number;
  likelyLowMs: number;
  likelyHighMs: number;
}

export interface TaskForecast {
  generatedAt: string;
  confidence: ForecastConfidence;
  history: {
    completedWithDevelopmentTime: number;
    completedWithQueueTime: number;
    medianDevelopmentMs: number | null;
    medianQueueMs: number | null;
    throughputLast30Days: number;
    completedWithEffort: number;
    unclassifiedTaskCount: number;
  };
  scope: {
    taskCount: number;
    inboxCount: number;
    inProgressCount: number;
    estimatedDevelopmentMs: number;
    likelyLowMs: number;
    likelyHighMs: number;
    estimatedQueueMs: number | null;
  };
  breakdown: {
    inbox: ForecastScopeSummary;
    backlog: ForecastScopeSummary;
    inboxAndBacklog: ForecastScopeSummary;
    inProgress: ForecastScopeSummary;
  };
  tasks: TaskForecastItem[];
}

interface HistoricalDuration {
  projectId: string;
  priority: Task['priority'];
  effort?: Task['effort'];
  developmentMs: number;
  queueMs?: number;
  doneAt: number;
}

function timestamp(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validDuration(start: number | null, end: number | null): number | null {
  if (start === null || end === null) return null;
  const duration = end - start;
  return duration >= MIN_DURATION_MS && duration <= MAX_DURATION_MS ? duration : null;
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function historyFrom(tasks: Task[]): HistoricalDuration[] {
  const rows: HistoricalDuration[] = [];
  for (const task of tasks) {
    if (task.status !== 'done') continue;
    const started = timestamp(task.inProgressAt);
    const completed = timestamp(task.doneAt);
    const developmentMs = validDuration(started, completed);
    if (developmentMs === null || completed === null) continue;
    const queued = validDuration(timestamp(task.inboxAt || task.createdAt), started);
    rows.push({
      projectId: task.projectId,
      priority: task.priority,
      effort: task.effort,
      developmentMs,
      ...(queued !== null ? { queueMs: queued } : {}),
      doneAt: completed,
    });
  }
  return rows;
}

function selectSample(history: HistoricalDuration[], task: Task): {
  rows: HistoricalDuration[];
  source: TaskForecastItem['source'];
} {
  if (task.effort) {
    const projectEffort = history.filter(row => row.projectId === task.projectId && row.effort === task.effort);
    if (projectEffort.length >= 3) return { rows: projectEffort, source: 'project-effort' };
    const globalEffort = history.filter(row => row.effort === task.effort);
    if (globalEffort.length >= 3) return { rows: globalEffort, source: 'global-effort' };
    if (globalEffort.length > 0) return { rows: globalEffort, source: 'global-effort' };
  }
  const projectPriority = history.filter(row => row.projectId === task.projectId && row.priority === task.priority);
  if (projectPriority.length >= 3) return { rows: projectPriority, source: 'project-priority' };

  const project = history.filter(row => row.projectId === task.projectId);
  if (project.length >= 3) return { rows: project, source: 'project' };

  const globalPriority = history.filter(row => row.priority === task.priority);
  if (globalPriority.length >= 3) return { rows: globalPriority, source: 'global-priority' };
  if (history.length > 0) return { rows: history, source: 'global' };
  return { rows: [], source: 'none' };
}

function summarizeScope(
  activeTasks: Task[],
  forecasts: TaskForecastItem[],
  includes: (task: Task) => boolean,
): ForecastScopeSummary {
  const taskIds = new Set(activeTasks.filter(includes).map(task => task.id));
  const items = forecasts.filter(item => taskIds.has(item.taskId));
  return {
    taskCount: taskIds.size,
    estimatedDevelopmentMs: items.reduce((sum, item) => sum + item.remainingDevelopmentMs, 0),
    likelyLowMs: items.reduce((sum, item) => sum + item.likelyLowMs, 0),
    likelyHighMs: items.reduce((sum, item) => sum + item.likelyHighMs, 0),
  };
}

export function buildTaskForecast(allTasks: Task[], projectId: string, scopedTasks: Task[], now = Date.now()): TaskForecast {
  const history = historyFrom(allTasks);
  const active = scopedTasks.filter(task => task.status !== 'done');
  const forecasts: TaskForecastItem[] = active.map(task => {
    const { rows, source } = selectSample(history, task);
    const values = rows.map(row => row.developmentMs);
    const estimate = quantile(values, 0.5);
    const low = quantile(values, 0.25);
    const high = quantile(values, 0.75);
    const started = task.status === 'in_progress' ? timestamp(task.inProgressAt) : null;
    const elapsed = started === null ? 0 : Math.max(0, now - started);
    const residuals = elapsed > 0 ? values.filter(value => value > elapsed).map(value => value - elapsed) : values;
    const remainingEstimate = residuals.length > 0 ? quantile(residuals, 0.5) : estimate * 0.25;
    const remainingLow = residuals.length > 0 ? quantile(residuals, 0.25) : estimate * 0.1;
    const remainingHigh = residuals.length > 0 ? quantile(residuals, 0.75) : estimate * 0.5;
    return {
      taskId: task.id,
      estimatedDevelopmentMs: Math.round(estimate),
      remainingDevelopmentMs: Math.round(remainingEstimate),
      likelyLowMs: Math.round(remainingLow),
      likelyHighMs: Math.round(remainingHigh),
      sampleSize: rows.length,
      source,
    };
  });

  const projectHistory = history.filter(row => row.projectId === projectId);
  const relevantHistory = projectHistory.length >= 3 ? projectHistory : history;
  const queueValues = relevantHistory.flatMap(row => row.queueMs === undefined ? [] : [row.queueMs]);
  const recentCutoff = now - 30 * 24 * 60 * 60 * 1_000;
  const effectiveSamples = forecasts.filter(item => item.sampleSize > 0).map(item => item.sampleSize);
  const minimumSample = effectiveSamples.length > 0 ? Math.min(...effectiveSamples) : 0;
  const inboxAndBacklog = summarizeScope(active, forecasts, task => task.status === 'todo' || task.status === 'backlog');
  const inProgress = summarizeScope(active, forecasts, task => task.status === 'in_progress');

  return {
    generatedAt: new Date(now).toISOString(),
    confidence: minimumSample >= 10 ? 'high' : minimumSample >= 5 ? 'medium' : 'low',
    history: {
      completedWithDevelopmentTime: relevantHistory.length,
      completedWithQueueTime: queueValues.length,
      medianDevelopmentMs: relevantHistory.length ? Math.round(quantile(relevantHistory.map(row => row.developmentMs), 0.5)) : null,
      medianQueueMs: queueValues.length ? Math.round(quantile(queueValues, 0.5)) : null,
      throughputLast30Days: projectHistory.filter(row => row.doneAt >= recentCutoff).length,
      completedWithEffort: projectHistory.filter(row => row.effort !== undefined).length,
      unclassifiedTaskCount: allTasks.filter(task => task.projectId === projectId && task.effort === undefined).length,
    },
    scope: {
      taskCount: active.length,
      inboxCount: inboxAndBacklog.taskCount,
      inProgressCount: inProgress.taskCount,
      estimatedDevelopmentMs: forecasts.reduce((sum, item) => sum + item.remainingDevelopmentMs, 0),
      likelyLowMs: forecasts.reduce((sum, item) => sum + item.likelyLowMs, 0),
      likelyHighMs: forecasts.reduce((sum, item) => sum + item.likelyHighMs, 0),
      estimatedQueueMs: queueValues.length ? Math.round(quantile(queueValues, 0.5)) : null,
    },
    breakdown: {
      inbox: summarizeScope(active, forecasts, task => task.status === 'todo'),
      backlog: summarizeScope(active, forecasts, task => task.status === 'backlog'),
      inboxAndBacklog,
      inProgress,
    },
    tasks: forecasts,
  };
}
