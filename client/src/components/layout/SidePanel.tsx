import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useActivity } from '@/hooks/useActivity'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { cn } from '@/lib/utils'
import { ProjectsView } from './views/ProjectsView'
import { ExplorerView } from './views/ExplorerView'
import { SearchView } from './views/SearchView'
import { SourceControlView } from './views/SourceControlView'
import { ClaudeView } from './views/ClaudeView'

const WIDTH_KEY = 'shipyard:side-panel-width'
const MIN = 160
const MAX = 600
const DEFAULT = 280
const ACTIVITY_BAR_WIDTH = 0

function loadWidth(): number {
  const raw = localStorage.getItem(WIDTH_KEY)
  const n = raw ? parseInt(raw, 10) : NaN
  if (!isFinite(n)) return DEFAULT
  return Math.min(Math.max(n, MIN), MAX)
}

const titles: Record<string, string> = {
  projects: 'Projects',
  explorer: 'Explorer',
  search: 'Search',
  git: 'Source Control',
  claude: 'Claude AI',
}

export function SidePanel() {
  const { activity, panelOpen, togglePanel } = useActivity()
  const { chatFull } = useLayoutMode()
  const [width, setWidth] = useState<number>(loadWidth)
  const panelRef = useRef<HTMLDivElement>(null)

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    let latest = width
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(Math.max(ev.clientX - ACTIVITY_BAR_WIDTH, MIN), MAX)
      // Keep the expensive sidebar tree out of the pointer-move render loop.
      if (panelRef.current) panelRef.current.style.width = latest + 'px'
    }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setWidth(latest)
      localStorage.setItem(WIDTH_KEY, String(latest))
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // A drawer closes the way drawers do: Escape, or a click outside it.
  useEffect(() => {
    if (!panelOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // A dialog or menu opened from inside the drawer owns Escape first.
      if (document.querySelector('[role="dialog"], [role="menu"]')) return
      togglePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, togglePanel])

  if (!panelOpen) return null

  // Expanded chat: the panel takes the room of the main column (Layout hides it).
  const full = chatFull && activity === 'claude'

  let content: React.ReactNode = null
  switch (activity) {
    case 'projects': content = <ProjectsView />; break
    case 'explorer': content = <ExplorerView />; break
    case 'search': content = <SearchView />; break
    case 'git': content = <SourceControlView />; break
    case 'claude': content = <ClaudeView />; break
  }

  return (
    <>
    {/* Source control, chat and the project list are visited, not lived in:
        they open over the work area and leave it its full width. */}
    {!full && <div className="anim-fade absolute inset-0 z-30 bg-background/50" onClick={togglePanel} />}
    <div
      ref={panelRef}
      className={cn(
        'absolute inset-y-0 left-0 z-40 flex',
        full ? 'right-0' : 'anim-slide shadow-2xl shadow-black/60'
      )}
      style={full ? undefined : { width }}
    >
      <div className="flex-1 min-w-0 flex flex-col border-r bg-card overflow-hidden">
        {/* Header (Claude view manages its own header) */}
        {activity !== 'claude' && (
          <div className="h-9 flex items-center px-3 shrink-0 border-b">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {titles[activity]}
            </span>
            <button
              onClick={togglePanel}
              aria-label="Close panel"
              className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-hidden min-h-0">
          {content}
        </div>
      </div>
      {/* Resize handle */}
      {!full && (
        <div
          className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 z-10"
          onMouseDown={startDrag}
        />
      )}
    </div>
    </>
  )
}
