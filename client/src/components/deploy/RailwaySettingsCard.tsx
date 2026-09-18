import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Rocket, Check, Loader2, Trash2 } from 'lucide-react'
import { useConnectRailway, useDeployProviders, useDisconnectRailway } from '@/hooks/useDeploy'
import { toast } from 'sonner'

/**
 * The Railway account token, so a project can say whether its last build went
 * up. The token is stored encrypted on the server and never sent back here.
 */
export function RailwaySettingsCard() {
  const { data } = useDeployProviders()
  const connect = useConnectRailway()
  const disconnect = useDisconnectRailway()
  const [token, setToken] = useState('')

  const connected = !!data?.providers?.railway?.connected

  const save = async () => {
    if (!token.trim()) return
    try {
      const result = await connect.mutateAsync(token.trim())
      setToken('')
      toast.success(`Railway connected${result.account?.email ? ` as ${result.account.email}` : ''}`)
    } catch (err: any) {
      toast.error(err.message || 'Railway refused the token')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Rocket className="h-4 w-4 text-primary" />
          Railway deploys
          {connected && (
            <span className="inline-flex items-center gap-1 text-[10px] font-normal text-success">
              <Check className="h-3 w-3" />
              connected
            </span>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Show in each project whether its last build went up. Create an account token at railway.com/account/tokens, then link the Railway project in that project's settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={connected ? 'Replace the saved token…' : 'Railway account token'}
            className="h-8 text-xs"
            onKeyDown={(e) => { if (e.key === 'Enter') save() }}
          />
          <Button size="sm" className="h-8 text-xs" onClick={save} disabled={!token.trim() || connect.isPending}>
            {connect.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : connected ? 'Replace' : 'Connect'}
          </Button>
          {connected && (
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-destructive"
              title="Remove the saved token"
              disabled={disconnect.isPending}
              onClick={async () => {
                await disconnect.mutateAsync()
                toast.success('Railway token removed')
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Read-only use: Shipyard only asks for the latest deployment. It never redeploys or rolls back.
        </p>
      </CardContent>
    </Card>
  )
}
