import { useState } from 'react'
import { useActivity } from '@/hooks/useActivity'
import { ProjectsView } from './views/ProjectsView'
import { ExplorerView } from './views/ExplorerView'
import { SearchView } from './views/SearchView'
import { SourceControlView } from './views/SourceControlView'
import { ClaudeView } from './views/ClaudeView'

const WIDTH_KEY = 'shipyard:side-panel-width'
const MIN = 200
const MAX = 600
const DEFAULT = 280
const ACTIVITY_BAR_WIDTH = 48

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
  const { activity, panelOpen } = useActivity()
  const [width, setWidth] = useState<number>(loadWidth)

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    let latest = width
    const onMove = (ev: MouseEvent) => {
      latest = Math.min(Math.max(ev.clientX - ACTIVITY_BAR_WIDTH, MIN), MAX)
      setWidth(latest)
    }
    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      localStorage.setItem(WIDTH_KEY, String(latest))
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (!panelOpen) return null

  let content: React.ReactNode = null
  switch (activity) {
    case 'projects': content = <ProjectsView />; break
    case 'explorer': content = <ExplorerView />; break
    case 'search': content = <SearchView />; break
    case 'git': content = <SourceControlView />; break
    case 'claude': content = <ClaudeView />; break
  }

  return (
    <div className="flex h-screen shrink-0 relative" style={{ width }}>
      <div className="flex-1 min-w-0 flex flex-col border-r bg-card/20 overflow-hidden">
        {/* Header (Claude view manages its own header) */}
        {activity !== 'claude' && (
          <div className="h-9 flex items-center px-3 shrink-0 border-b">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {titles[activity]}
            </span>
          </div>
        )}
        <div className="flex-1 overflow-hidden min-h-0">
          {content}
        </div>
      </div>
      {/* Resize handle */}
      <div
        className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 z-10"
        onMouseDown={startDrag}
      />
    </div>
  )
}
