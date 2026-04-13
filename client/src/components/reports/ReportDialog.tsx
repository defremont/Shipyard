import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import CodeMirror from '@uiw/react-codemirror'
import { html as cmHtml } from '@codemirror/lang-html'
import { EditorView } from '@codemirror/view'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import type { Task } from '@/hooks/useTasks'
import {
  DEFAULT_SECTIONS,
  renderReportHtml,
  type ReportData,
  type ReportRenderOptions,
  type ReportSections,
} from './reportTemplates'
import { downloadHtml, downloadTxt, printAsPdf } from './reportExport'
import {
  FileText,
  FileDown,
  FileType2,
  Printer,
  Loader2,
  RefreshCw,
  Eye,
  Code2,
  ArrowLeft,
  ArrowRight,
  CheckSquare,
  Square,
  Search,
  Settings2,
  ListChecks,
  LayoutTemplate,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  GitCommit,
  BarChart3,
  Kanban,
  Clock,
  FileCheck2,
  X,
  Filter,
  AlertCircle,
} from 'lucide-react'

interface ReportDialogProps {
  projectId: string
  projectName: string
  milestoneId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface TaskDraft {
  id: string
  include: boolean
  includeDescription: boolean
  title: string
  description: string
  original: Task
}

type Step = 'config' | 'tasks' | 'editor'
type StatusFilter = 'all' | Task['status']
type PriorityFilter = 'all' | Task['priority']
type DescriptionFilter = 'all' | 'with' | 'without'

const STATUS_ORDER: Task['status'][] = ['in_progress', 'todo', 'backlog', 'done']

const STATUS_META: Record<Task['status'], { label: string; dot: string; accentBorder: string; accentBg: string; accentText: string }> = {
  in_progress: {
    label: 'In progress',
    dot: 'bg-blue-500',
    accentBorder: 'border-l-blue-500',
    accentBg: 'bg-blue-500/5',
    accentText: 'text-blue-700 dark:text-blue-300',
  },
  todo: {
    label: 'To do',
    dot: 'bg-amber-500',
    accentBorder: 'border-l-amber-500',
    accentBg: 'bg-amber-500/5',
    accentText: 'text-amber-700 dark:text-amber-300',
  },
  backlog: {
    label: 'Backlog',
    dot: 'bg-slate-400',
    accentBorder: 'border-l-slate-400',
    accentBg: 'bg-slate-400/5',
    accentText: 'text-slate-600 dark:text-slate-400',
  },
  done: {
    label: 'Done',
    dot: 'bg-emerald-500',
    accentBorder: 'border-l-emerald-500',
    accentBg: 'bg-emerald-500/5',
    accentText: 'text-emerald-700 dark:text-emerald-300',
  },
}

const PRIORITY_META: Record<Task['priority'], { label: string; className: string }> = {
  urgent: { label: 'Urgent', className: 'border-red-500/30 text-red-700 dark:text-red-300 bg-red-500/10' },
  high: { label: 'High', className: 'border-orange-500/30 text-orange-700 dark:text-orange-300 bg-orange-500/10' },
  medium: { label: 'Medium', className: 'border-blue-500/30 text-blue-700 dark:text-blue-300 bg-blue-500/10' },
  low: { label: 'Low', className: 'border-slate-500/30 text-slate-600 dark:text-slate-400 bg-slate-500/10' },
}

const SECTION_OPTIONS: Array<{
  key: keyof ReportSections
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { key: 'cover', label: 'Cover', description: 'Title, client and metadata', icon: FileText },
  { key: 'metrics', label: 'Metrics', description: 'Overview and progress', icon: BarChart3 },
  { key: 'kanban', label: 'Kanban', description: 'Tasks grouped by status', icon: Kanban },
  { key: 'timeline', label: 'Timeline', description: 'Deliveries completed in period', icon: Clock },
  { key: 'commits', label: 'Commits', description: 'Git commit history', icon: GitCommit },
]

function todayIso(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'report'
}

// --- Small presentational helpers ---

function Stepper({ current }: { current: Step }) {
  const steps: Array<{ key: Step; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'config', label: 'Configure', icon: Settings2 },
    { key: 'tasks', label: 'Tasks', icon: ListChecks },
    { key: 'editor', label: 'Editor', icon: LayoutTemplate },
  ]
  const currentIdx = steps.findIndex(s => s.key === current)
  return (
    <div className="flex items-center gap-2">
      {steps.map((s, i) => {
        const state: 'done' | 'current' | 'upcoming' =
          i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'upcoming'
        const Icon = s.icon
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                state === 'current' && 'bg-primary text-primary-foreground',
                state === 'done' && 'bg-primary/10 text-primary',
                state === 'upcoming' && 'text-muted-foreground'
              )}
            >
              <div
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
                  state === 'current' && 'bg-primary-foreground/20',
                  state === 'done' && 'bg-primary/20',
                  state === 'upcoming' && 'border border-muted-foreground/30'
                )}
              >
                {state === 'done' ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              </div>
              <span>{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={cn(
                  'h-px w-6 transition-colors',
                  state === 'done' ? 'bg-primary/40' : 'bg-border'
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-semibold leading-tight">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Checkbox({
  checked,
  onChange,
  disabled,
  className,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
        checked
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background hover:border-primary/50',
        disabled && 'cursor-not-allowed opacity-50',
        className
      )}
    >
      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  )
}

function SectionToggleCard({
  active,
  onClick,
  icon: Icon,
  label,
  description,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
  description: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex items-start gap-3 rounded-md border p-3 text-left transition-all',
        active
          ? 'border-primary/50 bg-primary/5 shadow-sm'
          : 'border-border bg-background hover:border-primary/30 hover:bg-muted/30'
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors',
          active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{label}</span>
          <Checkbox checked={active} onChange={onClick} />
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</p>
      </div>
    </button>
  )
}

function FilterPill({
  active,
  onClick,
  dot,
  children,
  count,
}: {
  active: boolean
  onClick: () => void
  dot?: string
  children: React.ReactNode
  count?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-primary bg-primary text-primary-foreground shadow-sm'
          : 'border-border bg-background text-foreground hover:border-primary/40 hover:bg-muted/50'
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />}
      <span>{children}</span>
      {count != null && (
        <span
          className={cn(
            'tabular-nums',
            active ? 'text-primary-foreground/80' : 'text-muted-foreground'
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
}

// --- Main component ---

export function ReportDialog({ projectId, projectName, milestoneId, open, onOpenChange }: ReportDialogProps) {
  const [step, setStep] = useState<Step>('config')

  // Config state
  const [title, setTitle] = useState('')
  const [clientName, setClientName] = useState('')
  const [from, setFrom] = useState(todayIso(-30))
  const [to, setTo] = useState(todayIso(0))
  const [usePeriod, setUsePeriod] = useState(false)
  const [sections, setSections] = useState<ReportSections>(DEFAULT_SECTIONS)
  const [includeCommits, setIncludeCommits] = useState(false)
  const [includeTech, setIncludeTech] = useState(false)
  const [loading, setLoading] = useState(false)

  // Task selection/edit state
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [drafts, setDrafts] = useState<TaskDraft[]>([])
  const [taskSearch, setTaskSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [descriptionFilter, setDescriptionFilter] = useState<DescriptionFilter>('all')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<Task['status']>>(new Set())

  // Editor state
  const [html, setHtmlValue] = useState('')
  const [view, setView] = useState<'preview' | 'html'>('preview')

  useEffect(() => {
    if (!open) {
      setStep('config')
      setReportData(null)
      setDrafts([])
      setHtmlValue('')
      setTaskSearch('')
      setStatusFilter('all')
      setPriorityFilter('all')
      setDescriptionFilter('all')
      setCollapsedGroups(new Set())
    }
  }, [open])

  const renderOptions: ReportRenderOptions = useMemo(
    () => ({
      sections,
      includeTechnicalDetails: includeTech,
      title: title.trim() || undefined,
      clientName: clientName.trim() || undefined,
    }),
    [sections, includeTech, title, clientName]
  )

  const handleLoadTasks = async () => {
    setLoading(true)
    try {
      const data = (await api.getReportData(projectId, {
        milestoneId,
        from: usePeriod ? from : undefined,
        to: usePeriod ? to : undefined,
        includeCommits: sections.commits || includeCommits,
      })) as ReportData
      setReportData(data)
      setDrafts(
        data.tasks.map(t => ({
          id: t.id,
          include: true,
          includeDescription: !!t.description,
          title: t.title,
          description: t.description || '',
          original: t,
        }))
      )
      setStep('tasks')
    } catch (err: any) {
      toast.error(err.message || 'Failed to load tasks')
    } finally {
      setLoading(false)
    }
  }

  const buildEditedData = (): ReportData | null => {
    if (!reportData) return null
    const editedTasks: Task[] = drafts
      .filter(d => d.include)
      .map(d => ({
        ...d.original,
        title: d.title.trim() || d.original.title,
        description: d.includeDescription ? d.description : '',
      }))
    return { ...reportData, tasks: editedTasks }
  }

  const handleGenerate = () => {
    const edited = buildEditedData()
    if (!edited) return
    const rendered = renderReportHtml(edited, renderOptions)
    setHtmlValue(rendered)
    setStep('editor')
  }

  const handleRerender = () => {
    const edited = buildEditedData()
    if (!edited) return
    const rendered = renderReportHtml(edited, renderOptions)
    setHtmlValue(rendered)
    toast.success('Report regenerated', { description: 'Any manual HTML edits were discarded.' })
  }

  const filename = useMemo(() => {
    const base = slugify(title || `${projectName}-report`)
    return `${base}-${todayIso(0)}`
  }, [title, projectName])

  const toggleSection = (key: keyof ReportSections) => {
    setSections(s => ({ ...s, [key]: !s[key] }))
  }

  const updateDraft = (id: string, patch: Partial<TaskDraft>) => {
    setDrafts(ds => ds.map(d => (d.id === id ? { ...d, ...patch } : d)))
  }

  const selectedCount = drafts.filter(d => d.include).length
  const anyDescriptionIncluded = drafts.some(d => d.include && d.includeDescription)

  const statusCounts = useMemo(() => {
    const counts: Record<Task['status'], number> = { in_progress: 0, todo: 0, backlog: 0, done: 0 }
    for (const d of drafts) counts[d.original.status]++
    return counts
  }, [drafts])

  const matchesFilters = (d: TaskDraft): boolean => {
    if (statusFilter !== 'all' && d.original.status !== statusFilter) return false
    if (priorityFilter !== 'all' && d.original.priority !== priorityFilter) return false
    if (descriptionFilter === 'with' && !d.description.trim()) return false
    if (descriptionFilter === 'without' && d.description.trim()) return false
    if (taskSearch.trim()) {
      const q = taskSearch.trim().toLowerCase()
      if (
        !d.title.toLowerCase().includes(q) &&
        !d.description.toLowerCase().includes(q) &&
        !(d.original.number != null && `#${d.original.number}`.includes(q))
      ) {
        return false
      }
    }
    return true
  }

  const filteredDrafts = useMemo(
    () => drafts.filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drafts, taskSearch, statusFilter, priorityFilter, descriptionFilter]
  )

  const groupedDrafts = useMemo(() => {
    const groups = new Map<Task['status'], TaskDraft[]>()
    for (const status of STATUS_ORDER) groups.set(status, [])
    for (const d of filteredDrafts) {
      groups.get(d.original.status)?.push(d)
    }
    return groups
  }, [filteredDrafts])

  const selectFiltered = (include: boolean) => {
    const ids = new Set(filteredDrafts.map(d => d.id))
    setDrafts(ds => ds.map(d => (ids.has(d.id) ? { ...d, include } : d)))
  }

  const invertFilteredSelection = () => {
    const ids = new Set(filteredDrafts.map(d => d.id))
    setDrafts(ds => ds.map(d => (ids.has(d.id) ? { ...d, include: !d.include } : d)))
  }

  const toggleDescriptionsFiltered = (includeDescription: boolean) => {
    const ids = new Set(filteredDrafts.map(d => d.id))
    setDrafts(ds => ds.map(d => (ids.has(d.id) ? { ...d, includeDescription } : d)))
  }

  const toggleGroupCollapsed = (status: Task['status']) => {
    setCollapsedGroups(s => {
      const next = new Set(s)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  const toggleGroupSelection = (status: Task['status'], include: boolean) => {
    setDrafts(ds => ds.map(d => (d.original.status === status ? { ...d, include } : d)))
  }

  const clearFilters = () => {
    setTaskSearch('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setDescriptionFilter('all')
  }

  const hasActiveFilters =
    taskSearch.trim() !== '' ||
    statusFilter !== 'all' ||
    priorityFilter !== 'all' ||
    descriptionFilter !== 'all'

  const titleOfStep: Record<Step, string> = {
    config: 'New Report',
    tasks: 'Select and Edit Tasks',
    editor: 'Report Editor',
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-3">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {titleOfStep[step]}
            </DialogTitle>
            <Stepper current={step} />
          </div>
        </DialogHeader>

        {step === 'config' && (
          <TooltipProvider delayDuration={300}>
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl space-y-8 px-8 py-8">
                {/* Identification */}
                <section className="space-y-4">
                  <SectionHeader
                    icon={FileText}
                    title="Identification"
                    description="Information that appears in the report header"
                  />
                  <div className="grid grid-cols-2 gap-4 pl-11">
                    <Field label="Title">
                      <Input
                        value={title}
                        onChange={e => setTitle(e.target.value)}
                        placeholder={`${projectName} — Report`}
                      />
                    </Field>
                    <Field label="Client (optional)">
                      <Input
                        value={clientName}
                        onChange={e => setClientName(e.target.value)}
                        placeholder="Client name..."
                      />
                    </Field>
                  </div>
                </section>

                {/* Period */}
                <section className="space-y-4">
                  <SectionHeader
                    icon={Calendar}
                    title="Period"
                    description="Filter completed tasks and commits by date range"
                  />
                  <div className="space-y-3 pl-11">
                    <label className="flex cursor-pointer items-center gap-2 text-sm">
                      <Checkbox checked={usePeriod} onChange={setUsePeriod} />
                      <span>Filter by date range</span>
                    </label>
                    {usePeriod && (
                      <div className="grid grid-cols-2 gap-4">
                        <Field label="From">
                          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} />
                        </Field>
                        <Field label="To">
                          <Input type="date" value={to} onChange={e => setTo(e.target.value)} />
                        </Field>
                      </div>
                    )}
                  </div>
                </section>

                {/* Sections */}
                <section className="space-y-4">
                  <SectionHeader
                    icon={LayoutTemplate}
                    title="Report sections"
                    description="Choose which blocks will be generated"
                  />
                  <div className="grid grid-cols-2 gap-3 pl-11">
                    {SECTION_OPTIONS.map(opt => (
                      <SectionToggleCard
                        key={opt.key}
                        active={sections[opt.key]}
                        onClick={() => toggleSection(opt.key)}
                        icon={opt.icon}
                        label={opt.label}
                        description={opt.description}
                      />
                    ))}
                  </div>
                </section>

                {/* Advanced */}
                <section className="space-y-4">
                  <SectionHeader
                    icon={Settings2}
                    title="Advanced options"
                    description="Fine-tune what gets included in task content"
                  />
                  <div className="space-y-2 pl-11">
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors hover:bg-muted/30">
                      <Checkbox
                        checked={includeCommits}
                        onChange={setIncludeCommits}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">Fetch git commits</div>
                        <div className="text-[11px] text-muted-foreground">
                          Loads repository commits (used by the Commits section)
                        </div>
                      </div>
                    </label>
                    <label className="flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors hover:bg-muted/30">
                      <Checkbox checked={includeTech} onChange={setIncludeTech} className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">Include technical notes</div>
                        <div className="text-[11px] text-muted-foreground">
                          Adds each task's "prompt" field to the report
                        </div>
                      </div>
                    </label>
                  </div>
                </section>
              </div>
            </div>

            <div className="shrink-0 border-t bg-muted/20 px-6 py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  Step 1 of 3 · Configure general parameters
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleLoadTasks} disabled={loading}>
                    {loading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowRight className="mr-2 h-4 w-4" />
                    )}
                    Next: select tasks
                  </Button>
                </div>
              </div>
            </div>
          </TooltipProvider>
        )}

        {step === 'tasks' && (
          <TooltipProvider delayDuration={300}>
            <div className="flex min-h-0 flex-1 flex-col">
              {/* Sticky toolbar */}
              <div className="shrink-0 space-y-3 border-b bg-muted/20 px-6 py-3">
                {/* Row 1: Search + bulk actions on filtered set */}
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={taskSearch}
                      onChange={e => setTaskSearch(e.target.value)}
                      placeholder="Search by title, description or number..."
                      className="h-9 pl-9 pr-9"
                    />
                    {taskSearch && (
                      <button
                        type="button"
                        onClick={() => setTaskSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => selectFiltered(true)}>
                          <CheckSquare className="mr-1.5 h-3.5 w-3.5" /> Select
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Select all visible tasks</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" onClick={() => selectFiltered(false)}>
                          <Square className="mr-1.5 h-3.5 w-3.5" /> Deselect
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Deselect all visible tasks</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="outline" onClick={invertFilteredSelection}>
                          Invert
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Invert selection for visible tasks</TooltipContent>
                    </Tooltip>
                    <div className="mx-1 h-5 w-px bg-border" />
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleDescriptionsFiltered(!anyDescriptionIncluded)}
                        >
                          <FileText className="mr-1.5 h-3.5 w-3.5" />
                          {anyDescriptionIncluded ? 'No descriptions' : 'With descriptions'}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {anyDescriptionIncluded
                          ? 'Hide descriptions on all visible tasks'
                          : 'Include descriptions on all visible tasks'}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Row 2: Status filters */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="mr-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    <Filter className="h-3 w-3" />
                    Status
                  </div>
                  <FilterPill
                    active={statusFilter === 'all'}
                    onClick={() => setStatusFilter('all')}
                    count={drafts.length}
                  >
                    All
                  </FilterPill>
                  {STATUS_ORDER.map(s => (
                    <FilterPill
                      key={s}
                      active={statusFilter === s}
                      onClick={() => setStatusFilter(s)}
                      dot={STATUS_META[s].dot}
                      count={statusCounts[s]}
                    >
                      {STATUS_META[s].label}
                    </FilterPill>
                  ))}
                </div>

                {/* Row 3: Priority + description filters */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="mr-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Priority
                  </div>
                  <FilterPill active={priorityFilter === 'all'} onClick={() => setPriorityFilter('all')}>
                    All
                  </FilterPill>
                  {(['urgent', 'high', 'medium', 'low'] as const).map(p => (
                    <FilterPill
                      key={p}
                      active={priorityFilter === p}
                      onClick={() => setPriorityFilter(p)}
                    >
                      {PRIORITY_META[p].label}
                    </FilterPill>
                  ))}
                  <div className="mx-1 h-5 w-px bg-border" />
                  <div className="mr-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Description
                  </div>
                  <FilterPill
                    active={descriptionFilter === 'all'}
                    onClick={() => setDescriptionFilter('all')}
                  >
                    Any
                  </FilterPill>
                  <FilterPill
                    active={descriptionFilter === 'with'}
                    onClick={() => setDescriptionFilter('with')}
                  >
                    With
                  </FilterPill>
                  <FilterPill
                    active={descriptionFilter === 'without'}
                    onClick={() => setDescriptionFilter('without')}
                  >
                    Without
                  </FilterPill>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" /> Clear filters
                    </button>
                  )}
                </div>

                {/* Counters */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    <span className="font-semibold text-foreground">{selectedCount}</span> of{' '}
                    {drafts.length} tasks selected
                    {hasActiveFilters && ` · ${filteredDrafts.length} visible`}
                  </span>
                  <span className="text-[11px]">
                    Click a group header to collapse or expand
                  </span>
                </div>
              </div>

              {/* Task groups */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {filteredDrafts.length === 0 && (
                  <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                    {drafts.length === 0 ? (
                      <>
                        <AlertCircle className="mb-3 h-10 w-10 opacity-30" />
                        <p className="text-sm">No tasks found for this configuration.</p>
                      </>
                    ) : (
                      <>
                        <Search className="mb-3 h-10 w-10 opacity-30" />
                        <p className="text-sm">No tasks match the current filters.</p>
                        <Button variant="link" size="sm" onClick={clearFilters} className="mt-1">
                          Clear filters
                        </Button>
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-5">
                  {STATUS_ORDER.map(status => {
                    const list = groupedDrafts.get(status) || []
                    if (list.length === 0) return null
                    const meta = STATUS_META[status]
                    const groupSelected = list.filter(d => d.include).length
                    const collapsed = collapsedGroups.has(status)
                    const allSelected = groupSelected === list.length
                    const partiallySelected = groupSelected > 0 && groupSelected < list.length
                    return (
                      <section
                        key={status}
                        className={cn(
                          'overflow-hidden rounded-lg border-l-4 border border-border bg-card shadow-sm',
                          meta.accentBorder
                        )}
                      >
                        {/* Group header */}
                        <header
                          className={cn(
                            'flex items-center gap-3 border-b px-4 py-2.5',
                            meta.accentBg
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => toggleGroupCollapsed(status)}
                            className="flex flex-1 items-center gap-2 text-left"
                          >
                            {collapsed ? (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                            <span className={cn('h-2 w-2 rounded-full', meta.dot)} />
                            <span className={cn('text-sm font-semibold', meta.accentText)}>
                              {meta.label}
                            </span>
                            <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                              {groupSelected}/{list.length}
                            </Badge>
                            {partiallySelected && (
                              <span className="text-[10px] italic text-muted-foreground">
                                partial
                              </span>
                            )}
                          </button>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => toggleGroupSelection(status, true)}
                            >
                              All
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => toggleGroupSelection(status, false)}
                            >
                              None
                            </Button>
                          </div>
                        </header>

                        {/* Group body */}
                        {!collapsed && (
                          <div className="divide-y divide-border">
                            {list.map(d => {
                              const pmeta = PRIORITY_META[d.original.priority]
                              return (
                                <div
                                  key={d.id}
                                  className={cn(
                                    'px-4 py-3 transition-colors',
                                    d.include ? 'bg-background' : 'bg-muted/30 opacity-60'
                                  )}
                                >
                                  <div className="flex items-start gap-3">
                                    <Checkbox
                                      checked={d.include}
                                      onChange={v => updateDraft(d.id, { include: v })}
                                      className="mt-1.5"
                                    />
                                    <div className="min-w-0 flex-1 space-y-2">
                                      <div className="flex flex-wrap items-center gap-1.5">
                                        {d.original.number != null && (
                                          <span className="font-mono text-[10px] text-muted-foreground">
                                            #{d.original.number}
                                          </span>
                                        )}
                                        <Badge
                                          variant="outline"
                                          className={cn('h-5 px-1.5 text-[10px] font-medium', pmeta.className)}
                                        >
                                          {pmeta.label}
                                        </Badge>
                                      </div>
                                      <Input
                                        value={d.title}
                                        onChange={e => updateDraft(d.id, { title: e.target.value })}
                                        disabled={!d.include}
                                        placeholder="Task title"
                                        className="h-8 text-sm font-medium"
                                      />
                                      <div className="flex items-center justify-between">
                                        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                                          <Checkbox
                                            checked={d.includeDescription}
                                            onChange={v =>
                                              updateDraft(d.id, { includeDescription: v })
                                            }
                                            disabled={!d.include}
                                          />
                                          Include description
                                        </label>
                                        {d.includeDescription && (
                                          <span className="text-[10px] text-muted-foreground">
                                            {d.description.length} chars
                                          </span>
                                        )}
                                      </div>
                                      {d.includeDescription && (
                                        <Textarea
                                          value={d.description}
                                          onChange={e =>
                                            updateDraft(d.id, { description: e.target.value })
                                          }
                                          disabled={!d.include}
                                          placeholder="Task description..."
                                          rows={3}
                                          className="resize-y text-xs"
                                        />
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </section>
                    )
                  })}
                </div>
              </div>

              {/* Footer actions */}
              <div className="shrink-0 border-t bg-muted/20 px-6 py-3">
                <div className="flex items-center justify-between gap-2">
                  <Button variant="outline" onClick={() => setStep('config')}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Back
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    Step 2 of 3 · Refine tasks, titles and descriptions
                  </div>
                  <Button onClick={handleGenerate} disabled={selectedCount === 0}>
                    <FileCheck2 className="mr-2 h-4 w-4" /> Generate report
                  </Button>
                </div>
              </div>
            </div>
          </TooltipProvider>
        )}

        {step === 'editor' && (
          <div className="flex min-h-0 flex-1">
            <aside className="flex w-64 shrink-0 flex-col border-r bg-muted/20">
              {/* Summary */}
              <div className="border-b px-4 py-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Document
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Tasks included</span>
                    <span className="font-medium tabular-nums">{selectedCount}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Commits</span>
                    <span className="font-medium tabular-nums">{reportData?.commits.length ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium tabular-nums">
                      {reportData?.metrics.completionRate ?? 0}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Size</span>
                    <span className="font-medium tabular-nums">
                      {(html.length / 1024).toFixed(1)} KB
                    </span>
                  </div>
                </div>
              </div>

              {/* Export */}
              <div className="border-b px-4 py-3">
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Export
                </div>
                <div className="space-y-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => printAsPdf(html)}
                  >
                    <Printer className="mr-2 h-3.5 w-3.5" /> PDF (print)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => downloadHtml(html, filename)}
                  >
                    <FileDown className="mr-2 h-3.5 w-3.5" /> Download HTML
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => downloadTxt(html, filename)}
                  >
                    <FileType2 className="mr-2 h-3.5 w-3.5" /> Download TXT
                  </Button>
                </div>
                <div className="mt-2 truncate font-mono text-[10px] text-muted-foreground">
                  {filename}
                </div>
              </div>

              {/* Navigation */}
              <div className="mt-auto border-t p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-muted-foreground"
                  onClick={handleRerender}
                >
                  <RefreshCw className="mr-2 h-3.5 w-3.5" /> Regenerate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-muted-foreground"
                  onClick={() => setStep('tasks')}
                >
                  <ListChecks className="mr-2 h-3.5 w-3.5" /> Edit tasks
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-muted-foreground"
                  onClick={() => setStep('config')}
                >
                  <Settings2 className="mr-2 h-3.5 w-3.5" /> Configuration
                </Button>
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col">
              <Tabs
                value={view}
                onValueChange={v => setView(v as 'preview' | 'html')}
                className="flex min-h-0 flex-1 flex-col"
              >
                <div className="flex items-center justify-between border-b px-4 py-2">
                  <TabsList className="h-8">
                    <TabsTrigger value="preview" className="h-6 text-xs">
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      Preview
                    </TabsTrigger>
                    <TabsTrigger value="html" className="h-6 text-xs">
                      <Code2 className="mr-1.5 h-3.5 w-3.5" />
                      HTML
                    </TabsTrigger>
                  </TabsList>
                  <div className="text-[11px] text-muted-foreground">
                    {view === 'preview' ? 'A4 preview' : 'Manual HTML editing'}
                  </div>
                </div>
                <TabsContent
                  value="preview"
                  className="m-0 flex-1 overflow-auto bg-muted/40 p-6"
                >
                  <div className="mx-auto max-w-[820px] rounded-sm bg-white shadow-md ring-1 ring-border">
                    <iframe
                      title="report-preview"
                      srcDoc={html}
                      className="h-[1120px] w-full rounded-sm bg-white"
                      sandbox="allow-same-origin"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="html" className="m-0 flex-1 overflow-auto">
                  <CodeMirror
                    value={html}
                    height="100%"
                    extensions={[cmHtml(), EditorView.lineWrapping]}
                    onChange={setHtmlValue}
                    theme="light"
                    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
