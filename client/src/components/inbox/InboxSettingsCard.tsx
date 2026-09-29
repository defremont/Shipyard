import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MessageSquareText, Check, Loader2, Trash2, RefreshCw, ExternalLink } from 'lucide-react'
import { useConfigureInbox, useDisconnectInbox, useInboxStatus, useSyncInbox } from '@/hooks/useInbox'
import { toast } from 'sonner'

/**
 * The WhatsApp inbox reads chosen clients' messages and holds the demands for
 * review in its own web area. Once one is approved there, this Shipyard picks
 * it up within a minute and turns it into a task in the project the client is
 * mapped to.
 */

function ago(iso: string | null): string {
  if (!iso) return 'never'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  return new Date(iso).toLocaleString()
}

export function InboxSettingsCard() {
  const { data } = useInboxStatus()
  const configure = useConfigureInbox()
  const sync = useSyncInbox()
  const disconnect = useDisconnectInbox()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')

  const connected = !!data?.configured

  const save = async () => {
    if (!url.trim() || !token.trim()) return
    try {
      const result = await configure.mutateAsync({ url: url.trim(), token: token.trim() })
      setToken('')
      setUrl('')
      toast.success(
        result.created ? `Inbox connected — ${result.created} task${result.created === 1 ? '' : 's'} created` : 'Inbox connected'
      )
    } catch (err: any) {
      toast.error(err.message || 'The inbox refused the connection')
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-primary" />
          WhatsApp inbox
          {connected && (
            <span className="inline-flex items-center gap-1 text-[10px] font-normal text-success">
              <Check className="h-3 w-3" />
              connected
            </span>
          )}
        </CardTitle>
        <CardDescription className="text-xs">
          Client requests from WhatsApp — text, audio, photos and video — become tasks after you review them in the inbox's web area.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!connected ? (
          <div className="space-y-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Inbox URL (https://…up.railway.app)"
              className="h-8 text-xs"
            />
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="SHIPYARD_TOKEN"
                className="h-8 text-xs"
                onKeyDown={(e) => { if (e.key === 'Enter') save() }}
              />
              <Button size="sm" className="h-8 text-xs" onClick={save} disabled={!url.trim() || !token.trim() || configure.isPending}>
                {configure.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Connect'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <a
                href={data!.url!}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-w-0 items-center gap-1 truncate text-[11px] text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                <span className="truncate">Open the review area</span>
              </a>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 text-[10px]"
                  disabled={sync.isPending}
                  onClick={async () => {
                    try {
                      const result = await sync.mutateAsync()
                      toast.success(result.created ? `${result.created} task${result.created === 1 ? '' : 's'} created` : 'Nothing new approved')
                    } catch (err: any) {
                      toast.error(err.message || 'Could not reach the inbox')
                    }
                  }}
                >
                  <RefreshCw className={sync.isPending ? 'h-3 w-3 animate-spin' : 'h-3 w-3'} />
                  Sync now
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-muted-foreground hover:text-destructive"
                  title="Disconnect the inbox"
                  disabled={disconnect.isPending}
                  onClick={async () => {
                    await disconnect.mutateAsync()
                    toast.success('Inbox disconnected')
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Last sync {ago(data!.lastSyncAt)} · {data!.imported} demand{data!.imported === 1 ? '' : 's'} delivered
            </p>
            {data!.lastError && <p className="text-[11px] text-destructive">{data!.lastError}</p>}
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          Checked every minute while Shipyard is open. Nothing becomes a task without your approval in the inbox.
        </p>
      </CardContent>
    </Card>
  )
}
