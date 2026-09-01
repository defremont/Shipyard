import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { FileText, ChevronDown, ChevronRight, Plus, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

const statusLabel: Record<string, { text: string; color: string }> = {
  M: { text: 'Modified', color: 'text-warning bg-warning/10 border-warning/20' },
  A: { text: 'Added', color: 'text-success bg-success/10 border-success/20' },
  D: { text: 'Deleted', color: 'text-destructive bg-destructive/10 border-destructive/20' },
  R: { text: 'Renamed', color: 'text-primary bg-primary/10 border-primary/20' },
  C: { text: 'Copied', color: 'text-primary bg-primary/10 border-primary/20' },
}

/** Split a multi-file diff into one entry per file path. */
export function parseDiffByFile(diff: string): Map<string, string> {
  const fileMap = new Map<string, string>()
  const parts = diff.split(/^diff --git /m)
  for (const part of parts) {
    if (!part.trim()) continue
    // Extract file path from the diff header: "a/path b/path"
    const headerMatch = part.match(/^a\/(.+?) b\/(.+?)[\n\r]/)
    if (headerMatch) {
      const filePath = headerMatch[2]
      fileMap.set(filePath, 'diff --git ' + part)
    }
  }
  return fileMap
}

export function DiffBlock({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  return (
    <pre className="text-[11px] leading-relaxed font-mono overflow-x-auto">
      {lines.map((line, i) => {
        let className = 'px-3 min-h-[20px] whitespace-pre '
        if (line.startsWith('+++') || line.startsWith('---')) {
          className += 'text-muted-foreground/70 bg-muted/30'
        } else if (line.startsWith('+')) {
          className += 'text-green-400 bg-green-500/10'
        } else if (line.startsWith('-')) {
          className += 'text-red-400 bg-red-500/10'
        } else if (line.startsWith('@@')) {
          className += 'text-blue-400 bg-blue-500/10'
        } else if (line.startsWith('diff ')) {
          className += 'text-muted-foreground/50 bg-muted/20'
        } else {
          className += 'text-muted-foreground/80'
        }
        return (
          <div key={i} className={className}>
            {line || ' '}
          </div>
        )
      })}
    </pre>
  )
}

/** One collapsible file row with its diff. */
export function DiffFileEntry({ file, status, additions, deletions, diff, defaultExpanded, compact }: {
  file: string
  status?: string
  additions: number
  deletions: number
  diff: string | undefined
  defaultExpanded: boolean
  compact?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const label = status ? statusLabel[status] || { text: status, color: 'text-muted-foreground' } : null

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className={cn(
          'flex items-center gap-2 w-full text-left hover:bg-accent/50 transition-colors',
          compact ? 'px-2 py-1.5' : 'px-3 py-2'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <span className="text-xs font-mono truncate flex-1">{file}</span>
        {label && (
          <Badge variant="outline" className={cn('text-[9px] px-1.5 py-0', label.color)}>
            {label.text}
          </Badge>
        )}
        {additions > 0 && (
          <span className="text-[10px] text-success flex items-center gap-0.5">
            <Plus className="h-2.5 w-2.5" />{additions}
          </span>
        )}
        {deletions > 0 && (
          <span className="text-[10px] text-destructive flex items-center gap-0.5">
            <Minus className="h-2.5 w-2.5" />{deletions}
          </span>
        )}
      </button>
      {expanded && diff && (
        <div className={cn('border-t bg-background overflow-auto', compact ? 'max-h-[320px]' : 'max-h-[500px]')}>
          <DiffBlock diff={diff} />
        </div>
      )}
    </div>
  )
}
