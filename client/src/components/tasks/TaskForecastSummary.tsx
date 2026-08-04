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
  return (
    <>
      {hasHistory ? (
        <Popover>
          <PopoverTrigger asChild>
            <button className="w-full rounded-md border bg-card/50 px-3 py-2 text-left transition-colors hover:bg-accent/40">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />Remaining work forecast
                </span>
                <span className="tabular-nums"><strong>{formatDuration(forecast.scope.estimatedDevelopmentMs)}</strong><span className="text-muted-foreground"> development time</span></span>
                <span className="text-muted-foreground tabular-nums">likely range {formatDuration(forecast.scope.likelyLowMs)} to {formatDuration(forecast.scope.likelyHighMs)}</span>
                <span className={cn(
                  'ml-auto rounded-full px-2 py-0.5 text-[10px]',
                  forecast.confidence === 'high' ? 'bg-success/10 text-success' :
                    forecast.confidence === 'medium' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'
                )}>confidence: {confidenceLabel[forecast.confidence]}</span>
              </div>
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 space-y-3">
            <div>
              <div className="text-sm font-medium">How this forecast is calculated</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Actual elapsed time from In Progress to Done, grouped by Fibonacci effort first. Project and priority history provide fallbacks when an effort bucket has too few samples.
              </p>
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
      ) : forecast.history.unclassifiedTaskCount > 0 ? (
        <button onClick={() => setBackfillOpen(true)} className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent/40">
          <Clock3 className="h-3.5 w-3.5" />No valid timing history yet. Classify missing effort now so future completions can calibrate the forecast.
        </button>
      ) : (
        <div className="flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <Clock3 className="h-3.5 w-3.5" />No valid timing history yet. Complete tasks after moving them to In Progress to calibrate the forecast.
        </div>
      )}
      <EffortBackfillDialog projectId={projectId} open={backfillOpen} onOpenChange={setBackfillOpen} />
    </>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md bg-muted/50 px-2.5 py-2"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-0.5 font-medium tabular-nums">{value}</div></div>
}