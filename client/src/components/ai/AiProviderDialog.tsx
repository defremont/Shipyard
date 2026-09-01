import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useSaveAiConfig, useDeleteAiConfig, useTestAiKey } from '@/hooks/useAi'
import { AI_PROVIDERS } from '@/lib/aiProviders'
import type { AiProvider, AiProviderStatus } from '@/lib/api'
import { Loader2, Check, X, Eye, EyeOff, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface AiProviderDialogProps {
  provider: AiProvider
  status?: AiProviderStatus
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function AiProviderDialog({ provider, status, open, onOpenChange }: AiProviderDialogProps) {
  const meta = AI_PROVIDERS[provider]
  const saveConfig = useSaveAiConfig()
  const deleteConfig = useDeleteAiConfig()
  const testKey = useTestAiKey()

  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(meta.models[0].value)
  const [maxTokens, setMaxTokens] = useState(4096)
  const [showKey, setShowKey] = useState(false)
  const [testState, setTestState] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')

  useEffect(() => {
    if (!open) return
    setModel(status?.model || meta.models[0].value)
    setMaxTokens(status?.maxTokens || 4096)
    setApiKey('')
    setTestState('idle')
    setShowKey(false)
  }, [open, status, meta])

  const handleTest = async () => {
    if (!apiKey.trim()) return
    setTestState('testing')
    try {
      const result = await testKey.mutateAsync({ provider, apiKey: apiKey.trim() })
      setTestState(result.ok ? 'ok' : 'error')
      if (!result.ok) toast.error(result.error || 'Invalid API key')
    } catch {
      setTestState('error')
    }
  }

  const handleSave = async () => {
    if (!apiKey.trim() && !status?.apiConfigured) {
      toast.error('Enter an API key')
      return
    }
    try {
      await saveConfig.mutateAsync({ provider, apiKey: apiKey.trim() || '__keep__', model, maxTokens })
      toast.success(`${meta.label} configuration saved`)
      onOpenChange(false)
    } catch (err: any) {
      toast.error(err.message || 'Failed to save')
    }
  }

  const handleDelete = async () => {
    try {
      await deleteConfig.mutateAsync(provider)
      toast.success(`${meta.label} API key removed`)
      onOpenChange(false)
    } catch {
      toast.error('Failed to remove')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{meta.label} API key</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-sm font-medium">API Key</label>
            <p className="text-xs text-muted-foreground mb-2">
              Get your key from{' '}
              <a href={meta.keyUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {meta.keyLabel}
              </a>
            </p>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestState('idle') }}
                  placeholder={status?.apiConfigured ? 'Key saved (enter new to replace)' : meta.keyPlaceholder}
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
                disabled={!apiKey.trim() || testState === 'testing'}
                className="shrink-0 gap-1.5"
              >
                {testState === 'testing' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {testState === 'ok' && <Check className="h-3.5 w-3.5 text-success" />}
                {testState === 'error' && <X className="h-3.5 w-3.5 text-destructive" />}
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
                {meta.models.map(m => (
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
            <p>Your key is stored encrypted on the server and never sent to the browser.</p>
            <p>The key is only used when the {meta.cliCommand} CLI is unavailable — it bills per use.</p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          {status?.apiConfigured && (
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
