import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Bot, Plus, Trash2, Loader2, Check } from 'lucide-react'
import { useAgents, useSaveAgents, DEFAULT_AGENT_ID, type Agent } from '@/hooks/useAgents'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** Slug an agent name into an id the server will accept. */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
}

export function AgentSettingsCard() {
  const { data } = useAgents()
  const saveAgents = useSaveAgents()

  const builtins = (data?.agents || []).filter(a => a.builtin)
  const [custom, setCustom] = useState<Agent[]>([])
  const [dirty, setDirty] = useState(false)

  // The server owns the list; only adopt it while the form is untouched, or a
  // background refetch would throw away what the user is typing.
  useEffect(() => {
    if (!dirty && data) setCustom((data.agents || []).filter(a => !a.builtin))
  }, [data, dirty])

  const update = (index: number, patch: Partial<Agent>) => {
    setDirty(true)
    setCustom(prev => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)))
  }

  const addAgent = () => {
    setDirty(true)
    setCustom(prev => [...prev, { id: '', name: '', command: '', args: '' }])
  }

  const removeAgent = (index: number) => {
    setDirty(true)
    setCustom(prev => prev.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    const agents = custom
      .filter(a => a.name.trim() || a.command.trim())
      .map(a => ({
        ...a,
        id: a.id.trim() || slugify(a.name),
        name: a.name.trim(),
        command: a.command.trim(),
        args: a.args.trim(),
      }))
    try {
      await saveAgents.mutateAsync({ agents })
      setDirty(false)
      toast.success('Agents saved')
    } catch (err: any) {
      toast.error(err.message || 'Could not save agents')
    }
  }

  const handleDefaultChange = async (id: string) => {
    try {
      await saveAgents.mutateAsync({ defaultAgent: id })
      toast.success('Default agent updated')
    } catch (err: any) {
      toast.error(err.message || 'Could not set the default agent')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          Coding agents
        </CardTitle>
        <CardDescription className="text-xs">
          Which CLI runs a task. Pick one per task in the task viewer, or register your own below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Default agent</p>
          <Select value={data?.defaultAgent || DEFAULT_AGENT_ID} onValueChange={handleDefaultChange}>
            <SelectTrigger className="h-8 text-xs w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(data?.agents || []).map(a => (
                <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Built in</p>
          <div className="flex flex-wrap gap-1.5">
            {builtins.map(a => (
              <Badge
                key={a.id}
                variant="outline"
                className={cn('text-[10px] gap-1.5 font-normal', a.available === false && 'text-muted-foreground/60')}
              >
                {a.available !== false && <Check className="h-2.5 w-2.5 text-success" />}
                {a.name}
                <span className="font-mono text-muted-foreground/60">{a.command}</span>
              </Badge>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground/70">
            Greyed out means the binary was not found on PATH.
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Your agents</p>
          {custom.length === 0 && (
            <p className="text-xs text-muted-foreground/70">None yet.</p>
          )}
          {custom.map((agent, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr_auto] gap-2 items-center">
              <Input
                value={agent.name}
                onChange={e => update(i, { name: e.target.value })}
                placeholder="Name"
                className="h-8 text-xs"
              />
              <Input
                value={agent.command}
                onChange={e => update(i, { command: e.target.value })}
                placeholder="Binary (e.g. my-agent)"
                className="h-8 text-xs font-mono"
              />
              <Input
                value={agent.args}
                onChange={e => update(i, { args: e.target.value })}
                placeholder="Arguments (optional)"
                className="h-8 text-xs font-mono"
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                onClick={() => removeAgent(i)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={addAgent}>
              <Plus className="h-3.5 w-3.5" />
              Add agent
            </Button>
            <Button size="sm" className="gap-1.5 text-xs" onClick={handleSave} disabled={!dirty || saveAgents.isPending}>
              {saveAgents.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground/70 space-y-0.5 pt-1">
            <p>Placeholders in the arguments:</p>
            <p><span className="font-mono">{'{cwd}'}</span> — the project folder.</p>
            <p><span className="font-mono">{'{taskFile}'}</span> — a file holding the full task prompt.</p>
            <p><span className="font-mono">{'{task}'}</span> — the prompt as a single-line argument (line breaks collapse to spaces).</p>
            <p>Leave both prompt placeholders out and Shipyard types the prompt into the CLI once it starts — that keeps the formatting.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
