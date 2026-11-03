import { memo, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ExternalLink, Link2, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import { api, type InboxReviewDemand } from '@/lib/api'
import { useProjects } from '@/hooks/useProjects'
import { useInboxStatus } from '@/hooks/useInbox'
import type { Task } from '@/hooks/useTasks'
import { cn } from '@/lib/utils'

/**
 * The WhatsApp inbox's review, inside Shipyard: read what the client said,
 * pick the project and where it lands (new task or a note on one that exists),
 * then send or discard. The web area stays for the phone; the token never
 * leaves the server (it relays through /api/inbox/review).
 */

const PRIORITIES = [['urgent', 'Urgent'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] as const
const EFFORTS = [1, 2, 3, 5, 8]
const STATUS = { backlog: 'backlog', todo: 'inbox', in_progress: 'in progress', done: 'done' } as Record<string, string>

const select = 'h-7 rounded border bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring'

function useProjectTasks(projectId: string | null) {
  // Same key the task viewer uses for a project's full list.
  return useQuery({
    queryKey: ['tasks', projectId ?? '', 'all'],
    queryFn: () => api.getTasks(projectId!).then(r => r.tasks as Task[]),
    enabled: !!projectId,
    staleTime: 30_000,
  })
}

const DemandCard = memo(function DemandCard({ d, projects, webUrl }: {
  d: InboxReviewDemand
  projects: { id: string; name: string }[]
  webUrl: string
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(d.title)
  const [description, setDescription] = useState(d.description)
  const { data: tasks } = useProjectTasks(d.project_id)
  const options = useMemo(() => {
    const list = tasks || []
    return [...list.filter(t => t.status !== 'done'), ...list.filter(t => t.status === 'done').slice(0, 30)]
  }, [tasks])
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['inbox-review'] })
    queryClient.invalidateQueries({ queryKey: ['inbox-review-count'] })
  }

  const update = useMutation({
    mutationFn: (body: Parameters<typeof api.updateInboxDemand>[1]) => api.updateInboxDemand(d.id, body),
    onSuccess: refresh,
    onError: (err: any) => toast.error(err.message),
  })
  const approve = useMutation({
    mutationFn: async () => {
      // Text edited and not yet saved goes along.
      if (title !== d.title || description !== d.description) await api.updateInboxDemand(d.id, { title, description })
      return api.approveInboxDemand(d.id)
    },
    onSuccess: () => { toast.success(`#${d.seq} sent to Shipyard`); refresh() },
    onError: (err: any) => toast.error(err.message),
  })
  const discard = useMutation({
    mutationFn: () => api.discardInboxDemand(d.id),
    onSuccess: () => { toast(`#${d.seq} discarded`); refresh() },
    onError: (err: any) => toast.error(err.message),
  })

  const openDoubts = d.doubts.filter(x => !x.answer && !x.dismissed)
  const busy = update.isPending || approve.isPending || discard.isPending

  return (
    <article className={cn('anim-rise rounded-lg border bg-card', d.duplicate_of && 'border-warning/40')}>
      <div className="flex items-start gap-2 border-b px-3 py-2">
        <span className="mt-1 font-mono text-[10px] text-muted-foreground/60">#{d.seq}</span>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={() => { if (title.trim() && title !== d.title) update.mutate({ title }) }}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none"
          aria-label="Title"
        />
        <span className="shrink-0 text-[10px] text-muted-foreground/60" title={d.created_at}>
          {formatDistanceToNow(new Date(d.created_at), { addSuffix: true })}
        </span>
      </div>

      <div className="grid gap-3 p-3 md:grid-cols-[1fr_minmax(260px,38%)]">
        <div className="min-w-0 space-y-2">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            onBlur={() => { if (description !== d.description) update.mutate({ description }) }}
            rows={3}
            className="w-full resize-y rounded border bg-background px-2 py-1.5 text-xs leading-relaxed outline-none focus:ring-1 focus:ring-ring"
            aria-label="What to do"
          />
          {d.duplicate_of && (
            <p className="flex items-center gap-1.5 text-[11px] text-warning">
              <AlertTriangle className="h-3 w-3" />
              Repeats #{d.duplicate_of.seq}, sent to the same task in the last 24 h. Discard it if nothing is new.
            </p>
          )}
          {openDoubts.length > 0 && (
            <div className="rounded border border-warning/30 px-2 py-1.5 text-[11px]">
              <div className="mb-0.5 text-warning">{openDoubts.length} open question{openDoubts.length > 1 ? 's' : ''} — answer them in the web area</div>
              {openDoubts.map((x, i) => <div key={i} className="text-muted-foreground">• {x.q}</div>)}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            <select className={select} value={d.project_id ?? ''} disabled={busy}
              onChange={e => update.mutate({ projectId: e.target.value || null, targetTaskId: null })} aria-label="Project">
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className={select} value={d.priority} disabled={busy}
              onChange={e => update.mutate({ priority: e.target.value })} aria-label="Priority">
              {PRIORITIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className={select} value={d.effort ?? ''} disabled={busy}
              onChange={e => update.mutate({ effort: e.target.value ? Number(e.target.value) : null })} aria-label="Effort">
              <option value="">Effort —</option>
              {EFFORTS.map(n => <option key={n} value={n}>{n} pt{n > 1 ? 's' : ''}</option>)}
            </select>
            <button
              disabled={busy}
              onClick={() => update.mutate({ kind: d.kind === 'admin' ? 'code' : 'admin' })}
              className="h-7 rounded border px-2 text-[11px] text-muted-foreground hover:text-foreground"
              title="Code changes the system; admin is a quote, a payment, a meeting, an access"
            >
              {d.kind === 'admin' ? 'admin' : 'code'}
            </button>
          </div>
          {d.project_id && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Link2 className="h-3 w-3 shrink-0" />
              <span className="shrink-0">Lands as</span>
              <select className={cn(select, 'min-w-0 flex-1')} value={d.target?.taskId ?? ''} disabled={busy}
                onChange={e => update.mutate({ targetTaskId: e.target.value || null })} aria-label="Destination">
                <option value="">a new task</option>
                {/* The current target may be outside the list (an older done task). */}
                {d.target?.taskId && !options.some(t => t.id === d.target!.taskId) && (
                  <option value={d.target.taskId}>a note on #{d.target.number ?? '?'} {d.target.title ?? ''}</option>
                )}
                {options.map(t => (
                  <option key={t.id} value={t.id}>a note on #{t.number ?? '?'} {t.title.slice(0, 70)} ({STATUS[t.status] || t.status})</option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="min-w-0 space-y-1.5 rounded border bg-background/50 p-2">
          <div className="text-[11px] font-medium text-muted-foreground">{d.contact_name} said</div>
          {d.messages.length === 0 && <div className="text-[11px] text-muted-foreground/60">No message linked</div>}
          {d.messages.map(m => (
            <div key={m.id} className={cn('text-[11px] leading-relaxed', m.from_me ? 'text-muted-foreground/70' : 'text-foreground/90')}>
              <span className="mr-1 text-[10px] uppercase text-muted-foreground/50">{m.from_me ? 'you' : m.kind}</span>
              {m.body || <span className="italic text-muted-foreground/50">(not read yet)</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-2">
        <a href={`${webUrl}/#/demanda/${d.id}`} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ExternalLink className="h-3 w-3" />Web area
        </a>
        <span className="flex-1" />
        <button disabled={busy} onClick={() => discard.mutate()}
          className="inline-flex h-7 items-center gap-1 rounded border px-2 text-xs text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />Discard
        </button>
        <button disabled={busy || !d.project_id} onClick={() => approve.mutate()}
          title={d.project_id ? 'Send to Shipyard' : 'Pick a project first'}
          className="inline-flex h-7 items-center gap-1 rounded bg-primary px-2.5 text-xs font-medium text-primary-foreground disabled:opacity-50">
          <Send className="h-3.5 w-3.5" />Send
        </button>
      </div>
    </article>
  )
})

export function InboxReviewPage() {
  const { data: status } = useInboxStatus()
  const { data: projects } = useProjects()
  const { data, error, isLoading } = useQuery({
    queryKey: ['inbox-review'],
    queryFn: api.getInboxReview,
    enabled: !!status?.configured,
    refetchInterval: 30_000,
  })
  const [kind, setKind] = useState<'all' | 'code' | 'admin'>('all')
  const projectList = useMemo(() => (projects || []).map(p => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name)), [projects])

  const groups = useMemo(() => {
    const map = new Map<string, InboxReviewDemand[]>()
    for (const d of data?.demands || []) {
      if (kind !== 'all' && (d.kind === 'admin' ? 'admin' : 'code') !== kind) continue
      const list = map.get(d.contact_name) || []
      list.push(d)
      map.set(d.contact_name, list)
    }
    return [...map.entries()]
  }, [data, kind])
  const adminCount = (data?.demands || []).filter(d => d.kind === 'admin').length

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] px-6 py-5">
        <div className="mb-4 flex flex-wrap items-baseline gap-3">
          <h1 className="text-lg font-semibold">WhatsApp review</h1>
          <span className="text-xs text-muted-foreground">{data ? `${data.count} waiting` : ''}</span>
          {adminCount > 0 && (
            <div className="ml-auto flex rounded border p-0.5 text-[11px]">
              {(['all', 'code', 'admin'] as const).map(k => (
                <button key={k} onClick={() => setKind(k)}
                  className={cn('rounded px-2 py-0.5', kind === k ? 'bg-accent text-foreground' : 'text-muted-foreground')}>
                  {k === 'all' ? 'All' : k === 'code' ? 'Code' : `Admin ${adminCount}`}
                </button>
              ))}
            </div>
          )}
        </div>
        {!status?.configured && <p className="text-sm text-muted-foreground">Connect the WhatsApp inbox in Settings → AI &amp; Integrations.</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {data && data.demands.length === 0 && <p className="text-sm text-muted-foreground">Nothing to review.</p>}
        {groups.map(([client, list]) => (
          <section key={client} className="mb-6">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {client} <span className="tabular-nums text-muted-foreground/50">{list.length}</span>
            </h2>
            <div className="space-y-3">
              {list.map(d => <DemandCard key={`${d.id}:${d.merged_at ?? ''}`} d={d} projects={projectList} webUrl={data!.url} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
