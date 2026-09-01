import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, Loader, PenLine } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAgents, agentLabel, DEFAULT_AGENT_ID, type Agent } from '@/hooks/useAgents'
import { buildActivityEvents, shortAgo, type ActivityEvent, type ActivityEventType } from '@/lib/activityFeed'
import type { Task } from '@/hooks/useTasks'

const WINDOW_MS = 24 * 60 * 60 * 1000
const COLLAPSED_ROWS = 6
/** Relative labels drift, so re-render them on the same beat the data polls. */
const TICK_MS = 30_000

const EVENT_VISUALS: Record<ActivityEventType, { icon: React.ElementType; color: string; label: string }> = {
  started: { icon: Loader, color: 'text-warning', label: 'Started' },
  note: { icon: PenLine, color: 'text-muted-foreground', label: 'Note' },
  done: { icon: CheckCircle2, color: 'text-success', label: 'Completed' },
}

interface ActivityFeedProps {
  tasks: Task[] | undefined
  projectNames: Map<string, string>
  onSelect: (task: Task) => void
}

/**
 * What the agents did in the last day, newest first. Everything is derived
 * from the task list the Dashboard already polls — no extra request, and no
 * second cadence on `['tasks','all']`, the app's most expensive query.
 */
export function ActivityFeed({ tasks, projectNames, onSelect }: ActivityFeedProps) {
  const [now, setNow] = useState(() => Date.now())
  const [expanded, setExpanded] = useState(false)
  const { data: agentData } = useAgents()

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  const events = useMemo(
    () => buildActivityEvents(tasks, { since: now - WINDOW_MS, now }),
    [tasks, now]
  )

  if (events.length === 0) return null

  const visible = expanded ? events : events.slice(0, COLLAPSED_ROWS)
  const hidden = events.length - visible.length

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-xs font-medium text-muted-foreground">Activity</h2>
        <span className="text-[11px] text-muted-foreground/40">last 24h</span>
      </div>

      <div className="rounded-lg border divide-y divide-border/50">
        {visible.map(event => (
          <ActivityRow
            key={event.id}
            event={event}
            now={now}
            projectName={projectNames.get(event.task.projectId) || event.task.projectId}
            agentName={resolveAgentName(agentData, event.task.agent)}
            onSelect={onSelect}
          />
        ))}
      </div>

      {(hidden > 0 || expanded) && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1 px-1 py-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
          {expanded ? 'Show less' : `Show ${hidden} more`}
        </button>
      )}
    </div>
  )
}

/**
 * The default agent runs almost everything, so naming it on every row would be
 * noise — the terminal tabs follow the same rule.
 */
function resolveAgentName(
  agentData: { agents: Agent[]; defaultAgent: string } | undefined,
  agent: string | undefined
): string | null {
  const id = agent || agentData?.defaultAgent || DEFAULT_AGENT_ID
  if (id === (agentData?.defaultAgent || DEFAULT_AGENT_ID)) return null
  return agentLabel(agentData?.agents, id)
}

interface ActivityRowProps {
  event: ActivityEvent
  now: number
  projectName: string
  agentName: string | null
  onSelect: (task: Task) => void
}

function ActivityRow({ event, now, projectName, agentName, onSelect }: ActivityRowProps) {
  const { icon: Icon, color, label } = EVENT_VISUALS[event.type]
  const { task } = event

  return (
    <button
      onClick={() => onSelect(task)}
      title={`${label} · ${new Date(event.at).toLocaleString()}`}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/40 transition-colors first:rounded-t-lg last:rounded-b-lg"
    >
      <Icon className={cn('h-3.5 w-3.5 shrink-0', color)} />
      <span className="shrink-0 max-w-[140px] truncate text-muted-foreground">{projectName}</span>
      <span className="shrink-0 text-muted-foreground/30">·</span>
      {task.number != null && (
        <span className="shrink-0 text-muted-foreground/50 tabular-nums">#{task.number}</span>
      )}
      <span className="truncate">{task.title}</span>
      {event.detail && (
        <span className="hidden xl:inline truncate text-muted-foreground/50">— {event.detail}</span>
      )}
      <span className="ml-auto shrink-0 flex items-center gap-2 text-muted-foreground/60">
        {agentName && <span className="hidden sm:inline">{agentName}</span>}
        <time dateTime={new Date(event.at).toISOString()}>{shortAgo(event.at, now)}</time>
      </span>
    </button>
  )
}
