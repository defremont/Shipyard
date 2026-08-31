import { useState } from 'react'
import { Paperclip, FileText, ExternalLink } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { TaskAttachment } from '@/hooks/useTasks'

interface TaskAttachmentsProps {
  projectId: string
  taskId: string
  milestoneId?: string
  attachments: TaskAttachment[]
}

/** Trello requires an OAuth header to serve an attachment, so every image goes
 *  through the server proxy instead of straight to trello.com. */
function attachmentUrl(
  projectId: string,
  taskId: string,
  attachmentId: string,
  opts: { preview?: boolean; milestoneId?: string },
): string {
  const params = new URLSearchParams()
  if (opts.preview) params.set('preview', '1')
  if (opts.milestoneId) params.set('milestoneId', opts.milestoneId)
  const query = params.toString()
  return `/api/projects/${projectId}/tasks/${taskId}/attachment/${attachmentId}${query ? `?${query}` : ''}`
}

function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function TaskAttachments({ projectId, taskId, milestoneId, attachments }: TaskAttachmentsProps) {
  const [preview, setPreview] = useState<TaskAttachment | null>(null)
  // A screenshot whose bytes we cannot fetch falls back to a file row rather
  // than leaving a broken image in the dialog.
  const [failed, setFailed] = useState<Record<string, boolean>>({})

  if (attachments.length === 0) return null

  const images = attachments.filter(a => a.isImage && !failed[a.id])
  const files = attachments.filter(a => !a.isImage || failed[a.id])

  return (
    <div className="space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {images.map(attachment => (
            <button
              key={attachment.id}
              onClick={() => setPreview(attachment)}
              title={attachment.name}
              className="h-20 w-20 overflow-hidden rounded-md border bg-muted/30 transition-colors hover:border-primary/50"
            >
              <img
                src={attachmentUrl(projectId, taskId, attachment.id, { preview: true, milestoneId })}
                alt={attachment.name}
                loading="lazy"
                className="h-full w-full object-cover"
                onError={() => setFailed(prev => ({ ...prev, [attachment.id]: true }))}
              />
            </button>
          ))}
        </div>
      )}

      {files.map(attachment => (
        <a
          key={attachment.id}
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
          {attachment.bytes ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/60">{formatBytes(attachment.bytes)}</span>
          ) : null}
        </a>
      ))}

      <Dialog open={!!preview} onOpenChange={open => !open && setPreview(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 truncate">{preview?.name}</span>
            </DialogTitle>
          </DialogHeader>
          {preview && (
            <>
              <img
                src={attachmentUrl(projectId, taskId, preview.id, { milestoneId })}
                alt={preview.name}
                className="max-h-[65vh] w-full rounded-md object-contain"
              />
              <a
                href={preview.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Open original on Trello
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
