import { useState } from 'react'
import { Clock3, TrendingUp } from 'lucide-react'
import { useTaskForecast } from '@/hooks/useTasks'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EffortBackfillDialog } from './EffortBackfillDialog'

function formatDuration(ms: number | null): string {
  if (ms === null) return '-'
  if (ms < 60_000) return '< 1 min'
  const hours = ms / 3_600_000
  if (hours < 1) return `${Math.max(1, Math.round(ms / 60_000))} min`
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`
  const days = hours / 24
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} d`
}

const confidenceLabel = { low: 'low', medium: 'medium', high: 'high' } as const

export function TaskForecastSummary({ projectId, milestoneId }: { projectId: string; milestoneId?: string }) {
  const { data: forecast, isLoading } = useTaskForecast(projectId, milestoneId)
  const [backfillOpen, setBackfillOpen] = useState(false)

  if (isLoading || !forecast || (forecast.scope.taskCount === 0 && forecast.history.unclassifiedTaskCount === 0)) return null

  const hasHistory = forecast.history.completedWithDevelopmentTime > 0 && forecast.scope.taskCount > 0
  if (!hasHistory && forecast.history.unclassifiedTaskCount === 0) return null

  return (
    <>
      {hasHistory ? (
        <Popover>
          <PopoverTrigger asChild>
            <button
              aria-label="Open work forecast"
              title="Open work forecast"
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border bg-card/50 px-2 text-xs transition-colors hover:bg-accent/40"
            >
              <TrendingUp className="h-3.5 w-3.5 text-primary" />
              <span className="font-medium tabular-nums">{formatDuration(forecast.scope.estimatedDevelopmentMs)}</span>
              <span className="hidden text-muted-foreground 2xl:inline">
                {formatDuration(forecast.scope.likelyLowMs)} to {formatDuration(forecast.scope.likelyHighMs)}
              </span>
              <span
                title={`Confidence: ${confidenceLabel[forecast.confidence]}`}
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  forecast.confidence === 'high' ? 'bg-success' :
                    forecast.confidence === 'medium' ? 'bg-warning' : 'bg-muted-foreground/50'
                )}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-3">
            <div>
              <div className="text-sm font-medium">Remaining work forecast</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Actual elapsed time from In Progress to Done, grouped by Fibonacci effort first. Project and priority history provide fallbacks when an effort bucket has too few samples.
              </p>
            </div>
            <div className="rounded-md bg-primary/5 px-3 py-2">
              <div className="text-[10px] text-muted-foreground">Estimated development time</div>
              <div className="mt-0.5 text-lg font-semibold tabular-nums">{formatDuration(forecast.scope.estimatedDevelopmentMs)}</div>
              <div className="text-[10px] text-muted-foreground">Likely {formatDuration(forecast.scope.likelyLowMs)} to {formatDuration(forecast.scope.likelyHighMs)} - {confidenceLabel[forecast.confidence]} confidence</div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Metric label="Remaining tasks" value={String(forecast.scope.taskCount)} />
              <Metric label="History used" value={`${forecast.history.completedWithDevelopmentTime} tasks`} />
              <Metric label="History with effort" value={String(forecast.history.completedWithEffort)} />
              <Metric label="Median per task" value={formatDuration(forecast.history.medianDevelopmentMs)} />
              <Metric label="Typical queue time" value={formatDuration(forecast.history.medianQueueMs)} />
              <Metric label="Completed in 30 days" value={String(forecast.history.throughputLast30Days)} />
            </div>
            {forecast.history.unclassifiedTaskCount > 0 && (
              <Button variant="outline" size="sm" className="w-full gap-2 text-xs" onClick={() => setBackfillOpen(true)}>
                Classify effort for {forecast.history.unclassifiedTaskCount} tasks
              </Button>
            )}
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Times are elapsed wall-clock time, including nights and pauses. Invalid, instant, or over-180-day values are ignored. The total assumes sequential work.
            </p>
          </PopoverContent>
        </Popover>
      ) : (
        <button
          onClick={() => setBackfillOpen(true)}
          aria-label={`Classify effort for ${forecast.history.unclassifiedTaskCount} tasks`}
          title="Classify missing effort to calibrate future forecasts"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-dashed px-2 text-xs text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
        >
          <Clock3 className="h-3.5 w-3.5" />
          <span className="hidden xl:inline">Set effort</span>
          <span className="tabular-nums">{forecast.history.unclassifiedTaskCount}</span>
        </button>
      )}
      <EffortBackfillDialog projectId={projectId} open={backfillOpen} onOpenChange={setBackfillOpen} />
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-muted/50 px-2.5 py-2"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-0.5 font-medium tabular-nums">{value}</div></div>
}