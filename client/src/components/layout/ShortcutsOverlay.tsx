import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SHORTCUTS } from '@/lib/shortcuts'

export function ShortcutsOverlay() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handler = () => setOpen(prev => !prev)
    window.addEventListener('shipyard:toggle-shortcuts', handler)
    return () => window.removeEventListener('shipyard:toggle-shortcuts', handler)
  }, [])

  const hasDesktopOnly = SHORTCUTS.some(group => group.items.some(item => item.desktopOnly))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="text-sm">Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUTS.map(group => (
            <div key={group.scope}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group.scope}
              </div>
              <div className="mt-1.5 space-y-1">
                {group.items.map(item => (
                  <div key={item.keys + item.label} className="flex items-baseline gap-3 text-xs">
                    <kbd className="shrink-0 rounded border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] text-foreground/80">
                      {item.keys}
                    </kbd>
                    <span className="text-muted-foreground">
                      {item.label}
                      {item.desktopOnly && <span className="ml-1 text-muted-foreground/60">*</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {hasDesktopOnly && (
            <p className="border-t pt-2 text-[11px] text-muted-foreground/70">
              * The browser keeps these keys for itself — they only work in the desktop app.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
