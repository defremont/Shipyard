import type { Task } from '@/hooks/useTasks'

export interface ReportCommit {
  hash: string
  shortHash: string
  message: string
  date: string
  author: string
}

export interface ReportMetrics {
  total: number
  byStatus: Record<Task['status'], number>
  byPriority: Record<Task['priority'], number>
  completionRate: number
  completedInPeriod: number
}

export interface ReportData {
  project: { id: string; name: string; category: string; techStack: string[]; gitBranch?: string }
  milestone?: { id: string; name: string; description?: string; status: string }
  generatedAt: string
  period?: { from?: string; to?: string }
  metrics: ReportMetrics
  tasks: Task[]
  commits: ReportCommit[]
}

export interface ReportSections {
  cover: boolean
  metrics: boolean
  kanban: boolean
  timeline: boolean
  commits: boolean
}

export interface ReportRenderOptions {
  sections: ReportSections
  includeTechnicalDetails: boolean
  title?: string
  clientName?: string
}

const STATUS_LABEL: Record<Task['status'], string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
}

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtDate(iso?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso.slice(0, 10)
  }
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US')
  } catch {
    return iso
  }
}

const PRINT_CSS = `
  :root {
    --fg: #0f172a;
    --fg-muted: #475569;
    --fg-subtle: #64748b;
    --bg: #ffffff;
    --bg-alt: #f8fafc;
    --border: #e2e8f0;
    --accent: #0f172a;
    --urgent: #dc2626;
    --high: #ea580c;
    --medium: #2563eb;
    --low: #64748b;
    --done: #16a34a;
    --in-progress: #2563eb;
    --todo: #64748b;
    --backlog: #94a3b8;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color: var(--fg);
    background: var(--bg);
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .report {
    max-width: 780px;
    margin: 0 auto;
    padding: 48px 56px;
  }
  h1, h2, h3 { color: var(--fg); font-weight: 600; line-height: 1.25; margin: 0; }
  h1 { font-size: 26pt; letter-spacing: -0.02em; }
  h2 { font-size: 16pt; margin-top: 28px; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
  h3 { font-size: 12pt; margin-top: 16px; margin-bottom: 4px; }
  p { margin: 8px 0; color: var(--fg-muted); }
  ul, ol { margin: 8px 0; padding-left: 22px; color: var(--fg-muted); }
  li { margin: 3px 0; }
  strong { color: var(--fg); }
  .cover { margin-bottom: 32px; }
  .cover .eyebrow { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.12em; color: var(--fg-subtle); font-weight: 600; }
  .cover h1 { margin-top: 6px; }
  .cover .meta { margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px 24px; font-size: 10pt; color: var(--fg-subtle); }
  .cover .meta span strong { color: var(--fg); font-weight: 600; }
  .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 12px 0 4px; }
  .metric { border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; background: var(--bg-alt); }
  .metric .label { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: var(--fg-subtle); font-weight: 600; }
  .metric .value { font-size: 20pt; font-weight: 700; color: var(--fg); margin-top: 2px; }
  .progress { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin: 4px 0 16px; }
  .progress > div { height: 100%; background: var(--done); }
  .board { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .column { border: 1px solid var(--border); border-radius: 6px; padding: 12px 14px; background: var(--bg-alt); break-inside: avoid; }
  .column h3 { display: flex; justify-content: space-between; align-items: baseline; }
  .column h3 .count { font-size: 9pt; color: var(--fg-subtle); font-weight: 500; }
  .task { padding: 8px 0; border-top: 1px solid var(--border); break-inside: avoid; }
  .task:first-of-type { border-top: none; }
  .task .head { display: flex; gap: 8px; align-items: baseline; }
  .task .num { font-size: 9pt; color: var(--fg-subtle); font-variant-numeric: tabular-nums; }
  .task .title { font-weight: 600; color: var(--fg); font-size: 10.5pt; flex: 1; }
  .task .pill { font-size: 8pt; padding: 1px 6px; border-radius: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: white; }
  .pill-urgent { background: var(--urgent); }
  .pill-high { background: var(--high); }
  .pill-medium { background: var(--medium); }
  .pill-low { background: var(--low); }
  .task .desc { font-size: 10pt; color: var(--fg-muted); margin: 4px 0 0; }
  .task .tech { font-size: 9.5pt; color: var(--fg-subtle); margin: 4px 0 0; padding-left: 8px; border-left: 2px solid var(--border); }
  .task .when { font-size: 9pt; color: var(--fg-subtle); margin-top: 4px; }
  .timeline .task { padding: 10px 0; }
  .commits { list-style: none; padding: 0; }
  .commits li { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 9.5pt; padding: 4px 0; border-top: 1px solid var(--border); color: var(--fg-muted); }
  .commits li:first-child { border-top: none; }
  .commits .hash { color: var(--in-progress); font-weight: 600; }
  .commits .when { color: var(--fg-subtle); }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 9pt; color: var(--fg-subtle); text-align: center; }
  @media print {
    @page { size: A4; margin: 18mm; }
    html, body { background: white; }
    .report { padding: 0; max-width: 100%; }
    h2 { break-after: avoid; }
    .column, .task { break-inside: avoid; }
  }
`

function renderCover(data: ReportData, opts: ReportRenderOptions): string {
  const title = opts.title || (data.milestone ? `${data.project.name} — ${data.milestone.name}` : `Report: ${data.project.name}`)
  const metaParts: string[] = []
  metaParts.push(`<span><strong>Generated:</strong> ${escapeHtml(fmtDateTime(data.generatedAt))}</span>`)
  if (data.period?.from || data.period?.to) {
    metaParts.push(`<span><strong>Period:</strong> ${fmtDate(data.period.from) || '—'} to ${fmtDate(data.period.to) || 'today'}</span>`)
  }
  if (opts.clientName) metaParts.push(`<span><strong>Client:</strong> ${escapeHtml(opts.clientName)}</span>`)
  if (data.project.gitBranch) metaParts.push(`<span><strong>Branch:</strong> ${escapeHtml(data.project.gitBranch)}</span>`)
  return `
    <header class="cover">
      <div class="eyebrow">${escapeHtml(data.project.category || 'Progress Report')}</div>
      <h1>${escapeHtml(title)}</h1>
      ${data.milestone?.description ? `<p>${escapeHtml(data.milestone.description)}</p>` : ''}
      <div class="meta">${metaParts.join('')}</div>
    </header>
  `
}

function renderMetrics(data: ReportData): string {
  const m = data.metrics
  return `
    <section class="metrics">
      <h2>Overview</h2>
      <div class="metrics-grid">
        <div class="metric"><div class="label">Total</div><div class="value">${m.total}</div></div>
        <div class="metric"><div class="label">Done</div><div class="value">${m.byStatus.done}</div></div>
        <div class="metric"><div class="label">In progress</div><div class="value">${m.byStatus.in_progress}</div></div>
        <div class="metric"><div class="label">Progress</div><div class="value">${m.completionRate}%</div></div>
      </div>
      <div class="progress"><div style="width:${m.completionRate}%"></div></div>
    </section>
  `
}

function renderTaskCard(t: Task, includeTech: boolean): string {
  const num = t.number ? `<span class="num">#${t.number}</span>` : ''
  const pill = `<span class="pill pill-${t.priority}">${PRIORITY_LABEL[t.priority]}</span>`
  const desc = t.description ? `<p class="desc">${escapeHtml(t.description)}</p>` : ''
  const tech = includeTech && t.prompt
    ? `<p class="tech">${escapeHtml(t.prompt.slice(0, 600))}${t.prompt.length > 600 ? '…' : ''}</p>`
    : ''
  const when = t.status === 'done' && t.doneAt
    ? `<div class="when">Completed on ${fmtDate(t.doneAt)}</div>`
    : ''
  return `
    <div class="task">
      <div class="head">${num}<div class="title">${escapeHtml(t.title)}</div>${pill}</div>
      ${desc}
      ${tech}
      ${when}
    </div>
  `
}

function renderKanban(data: ReportData, opts: ReportRenderOptions): string {
  const cols: Array<{ status: Task['status']; label: string }> = [
    { status: 'in_progress', label: STATUS_LABEL.in_progress },
    { status: 'todo', label: STATUS_LABEL.todo },
    { status: 'backlog', label: STATUS_LABEL.backlog },
    { status: 'done', label: STATUS_LABEL.done },
  ]
  const columns = cols
    .map(({ status, label }) => {
      const list = data.tasks.filter(t => t.status === status)
      if (list.length === 0) return ''
      return `
        <div class="column">
          <h3>${label} <span class="count">${list.length}</span></h3>
          ${list.map(t => renderTaskCard(t, opts.includeTechnicalDetails)).join('')}
        </div>
      `
    })
    .filter(Boolean)
    .join('')
  return `
    <section class="kanban">
      <h2>Tasks</h2>
      <div class="board">${columns}</div>
    </section>
  `
}

function renderTimeline(data: ReportData, opts: ReportRenderOptions): string {
  const done = data.tasks
    .filter(t => t.status === 'done' && t.doneAt)
    .sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''))
  if (done.length === 0) return ''
  return `
    <section class="timeline">
      <h2>Deliveries in Period</h2>
      ${done.map(t => renderTaskCard(t, opts.includeTechnicalDetails)).join('')}
    </section>
  `
}

function renderCommits(data: ReportData): string {
  if (data.commits.length === 0) return ''
  return `
    <section>
      <h2>Commits</h2>
      <ul class="commits">
        ${data.commits
          .map(c => `<li><span class="hash">${escapeHtml(c.shortHash)}</span> <span class="when">${fmtDate(c.date)}</span> — ${escapeHtml(c.message.split('\n')[0])}</li>`)
          .join('')}
      </ul>
    </section>
  `
}

export function renderReportHtml(data: ReportData, opts: ReportRenderOptions): string {
  const parts: string[] = []
  if (opts.sections.cover) parts.push(renderCover(data, opts))
  if (opts.sections.metrics) parts.push(renderMetrics(data))
  if (opts.sections.kanban) parts.push(renderKanban(data, opts))
  if (opts.sections.timeline) parts.push(renderTimeline(data, opts))
  if (opts.sections.commits) parts.push(renderCommits(data))
  parts.push(`<footer class="footer">Generated by Shipyard on ${escapeHtml(fmtDateTime(data.generatedAt))}</footer>`)

  const title = opts.title || `${data.project.name} — Report`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<article class="report">
${parts.join('\n')}
</article>
</body>
</html>`
}

export const DEFAULT_SECTIONS: ReportSections = {
  cover: true,
  metrics: true,
  kanban: true,
  timeline: false,
  commits: false,
}
