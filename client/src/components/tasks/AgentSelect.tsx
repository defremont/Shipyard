import { Bot } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAgents, DEFAULT_AGENT_ID } from '@/hooks/useAgents'
import { cn } from '@/lib/utils'

interface AgentSelectProps {
  value?: string
  onChange: (agentId: string) => void
  className?: string
  disabled?: boolean
}

/** Picks which CLI runs a task. Unset means the configured default. */
export function AgentSelect({ value, onChange, className, disabled }: AgentSelectProps) {
  const { data } = useAgents()
  const agents = data?.agents || []
  const selected = value || data?.defaultAgent || DEFAULT_AGENT_ID

  return (
    <Select value={selected} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={cn('h-7 text-xs gap-1.5 w-auto', className)}>
        <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {agents.map(agent => (
          <SelectItem key={agent.id} value={agent.id} className="text-xs">
            <span className="flex items-center gap-2">
              {agent.name}
              {agent.available === false && (
                <span className="text-[10px] text-muted-foreground/70">not installed</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
