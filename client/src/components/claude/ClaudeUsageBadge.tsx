import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useClaudeUsage } from '@/hooks/useClaude'
import { cn } from '@/lib/utils'
import type { ClaudeUsage, UsageSeverity, UsageWindow } from '@/lib/api'

const RING_COLOR: Record<UsageSeverity, string> = {
  normal: 'text-muted-foreground/70',
  warning: 'text-warning',
  critical: 'text-destructive',
}

const BAR_COLOR: Record<UsageSeverity, string> = {
  normal: 'bg-primary',
  warning: 'bg-warning',
  critical: 'bg-destructive',
}

function severityFor(percent: number): UsageSeverity {
  if (percent >= 90) return 'critical'
  if (percent >= 75) return 'warning'
  return 'normal'
}

const RADIUS = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function Ring({ percent, severity }: { percent: number; severity: UsageSeverity }) {
  const filled = (Math.min(percent, 100) / 100) * CIRCUMFERENCE
  return (
    <svg viewBox="0 0 24 24" className={cn('h-5 w-5 -rotate-90', RING_COLOR[severity])}>
      <circle cx="12" cy="12" r={RADIUS} fill="none" strokeWidth="2.5" className="stroke-border" />
      <circle
        cx="12" cy="12" r={RADIUS} fill="none" strokeWidth="2.5" strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
      />
    </svg>
  )
}

/** "in 3h 12m" while the reset is near, a weekday once it is further out. */
function formatReset(resetsAt: string | null): string | null {
  if (!resetsAt) return null
  const target = new Date(resetsAt).getTime()
  if (Number.isNaN(target)) return null

  const ms = target - Date.now()
  if (ms <= 0) return 'resetting now'

  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `resets in ${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    const rem = minutes % 60
    return rem ? `resets in ${hours}h ${rem}m` : `resets in ${hours}h`
  }

  // Fixed locale: the rest of the UI is in English, so a pt-BR "dom., 12 de jul."
  // next to "Weekly" reads like a bug.
  const date = new Date(target)
  const day = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return `resets ${day}, ${time}`
}

function Meter({ label, window }: { label: string; window: UsageWindow }) {
  const severity = severityFor(window.percent)
  const reset = formatReset(window.resetsAt)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{Math.round(window.percent)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all', BAR_COLOR[severity])}
          style={{ width: `${Math.min(window.percent, 100)}%` }}
        />
      </div>
      {reset && <p className="text-[11px] text-muted-foreground">{reset}</p>}
    </div>
  )
}

function UsageDetails({ usage }: { usage: Extract<ClaudeUsage, { available: true }> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">Plan usage</h4>
        {usage.plan && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {usage.plan}
          </span>
        )}
      </div>

      {usage.session && <Meter label="Session (5h)" window={usage.session} />}
      {usage.weekly && <Meter label="Weekly" window={usage.weekly} />}
      {usage.scoped.map(w => (
        <Meter key={w.label} label={`Weekly · ${w.label}`} window={w} />
      ))}

      {usage.extraCredits?.enabled && usage.extraCredits.percent !== null && (
        <Meter
          label="Extra credits"
          window={{ percent: usage.extraCredits.percent, resetsAt: null }}
        />
      )}

      {usage.stale && (
        <p className="text-[11px] text-muted-foreground">
          Showing the last reading — the usage service is unreachable.
        </p>
      )}
    </div>
  )
}

/**
 * Compact meter for the ActivityBar footer. The ring tracks the 5-hour window,
 * which is the one that actually throttles a long working session.
 *
 * Renders nothing when the meter is unavailable (no OAuth token, or the
 * undocumented usage endpoint changed) — a missing widget beats a broken one.
 */
export function ClaudeUsageBadge() {
  const { data: usage } = useClaudeUsage()

  if (!usage?.available) return null

  const primary = usage.session ?? usage.weekly
  if (!primary) return null

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          aria-label={`Plan usage: ${Math.round(primary.percent)}% of the 5-hour window`}
          className="flex h-11 w-12 flex-col items-center justify-center gap-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
        >
          <Ring percent={primary.percent} severity={usage.severity} />
          <span className="text-[9px] leading-none tabular-nums">{Math.round(primary.percent)}%</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-64">
        <UsageDetails usage={usage} />
      </PopoverContent>
    </Popover>
  )
}
