import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useClaudeStatus, useSaveClaudeConfig, useDeleteClaudeConfig, useTestClaudeKey } from '@/hooks/useClaude'
import { Loader2, Check, X, Eye, EyeOff, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface ClaudeConfigDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const MODELS = [
  { value: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { value: 'claude-opus-4-5-20250514', label: 'Claude Opus 4.5' },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
]

export function ClaudeConfigDialog({ open, onOpenChange }: ClaudeConfigDialogProps) {
  const { data: status } = useClaudeStatus()
  const saveConfig = useSaveClaudeConfig()
  const deleteConfig = useDeleteClaudeConfig()
  const testKey = useTestClaudeKey()

  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('claude-sonnet-4-5-20250929')
  const [maxTokens, setMaxTokens] = useState(4096)
  const [showKey, setShowKey] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')

  useEffect(() => {
    if (open && status) {
      setModel(status.model || 'claude-sonnet-4-5-20250929')
      setMaxTokens(status.maxTokens || 4096)
      setApiKey('')
      setTestStatus('idle')
      setShowKey(false)
    }
  }, [open, status])

  const handleTest = async () => {
    if (!apiKey.trim()) return
    setTestStatus('testing')
    try {
      const result = await testKey.mutateAsync(apiKey.trim())
      setTestStatus(result.ok ? 'ok' : 'error')
      if (!result.ok) toast.error(result.error || 'Invalid API key')
    } catch {
      setTestStatus('error')
    }
  }

  const handleSave = async () => {
    if (!apiKey.trim() && !status?.configured) {
      toast.error('Enter an API key')
      return
    }
    try {
      await saveConfig.mutateAsync({
        apiKey: apiKey.trim() || '__keep__',
        model,
        maxTokens,
      })
      toast.success('Claude configuration saved')
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || 'Failed to save')
    }
  }

  const handleDelete = async () => {
    try {
      await deleteConfig.mutateAsync()
      toast.success('Claude API key removed')
      onOpenChange(false)
    } catch {
      toast.error('Failed to remove')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Claude AI Configuration</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">API Key</label>
            <p className="text-xs text-muted-foreground mb-2">
              Get your key from <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.anthropic.com</a>
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestStatus('idle') }}
                  placeholder={status?.configured ? 'Key saved (enter new to replace)' : 'sk-ant-...'}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={!apiKey.trim() || testStatus === 'testing'}
                className="shrink-0 gap-1.5"
              >
                {testStatus === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {testStatus === 'ok' && <Check className="h-3.5 w-3.5 text-success" />}
                {testStatus === 'error' && <X className="h-3.5 w-3.5 text-red-500" />}
                Test
              </Button>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Model</label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODELS.map(m => (
                  <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium">Max Tokens</label>
            <Input
              type="number"
              value={maxTokens}
              onChange={e => setMaxTokens(parseInt(e.target.value) || 4096)}
              min={256}
              max={8192}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">Maximum response length (256-8192)</p>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-1">
            <p>Your API key is stored encrypted on the server and never sent to the browser.</p>
            <p>Claude API uses pay-per-use billing via your Anthropic account.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          {status?.configured && (
            <Button variant="destructive" size="sm" onClick={handleDelete} className="mr-auto gap-1.5">
              <Trash2 className="h-3.5 w-3.5" />
              Remove Key
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saveConfig.isPending}>
            {saveConfig.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
