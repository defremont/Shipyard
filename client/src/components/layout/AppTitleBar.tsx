import { useLocation, useNavigate } from 'react-router-dom'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ChevronDown, Search } from 'lucide-react'

type TitlebarCommand =
  | 'quit' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'select-all'
  | 'reload' | 'toggle-devtools' | 'zoom-in' | 'zoom-out' | 'zoom-reset' | 'toggle-fullscreen'

interface ElectronTitlebarAPI {
  isElectron?: boolean
  platform?: string
  sendTitlebarCommand?: (command: TitlebarCommand) => void
}

function Shortcut({ children }: { children: React.ReactNode }) {
  return <span className="ml-auto pl-6 text-[10px] text-muted-foreground/60">{children}</span>
}

function MenuButton({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="app-no-drag flex h-6 items-center gap-0.5 rounded px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none data-[state=open]:bg-accent data-[state=open]:text-foreground">
        {label}<ChevronDown className="h-2.5 w-2.5 opacity-40" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

export function AppTitleBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const electronAPI = (window as { electronAPI?: ElectronTitlebarAPI }).electronAPI

  if (!electronAPI?.isElectron) return null

  const command = (value: TitlebarCommand) => electronAPI.sendTitlebarCommand?.(value)
  const dispatch = (action: 'toggle-search' | 'toggle-file-search' | 'toggle-terminal') => {
    window.dispatchEvent(new CustomEvent(`shipyard:${action}`))
  }
  const isMac = electronAPI.platform === 'darwin'

  return (
    <div className={`app-drag relative flex h-[35px] shrink-0 items-center border-b bg-card/90 ${isMac ? 'pl-20 pr-3' : 'pl-2 pr-[140px]'}`}>
      <div className="app-no-drag flex shrink-0 items-center gap-1.5 pr-1.5">
        <img src="/favicon.svg" alt="" className="h-4 w-4" draggable={false} />
        <span className="hidden text-[11px] font-semibold text-foreground/90 min-[1050px]:inline">Shipyard</span>
      </div>
      <div className="flex shrink-0 items-center">
        <MenuButton label="File">
          <DropdownMenuItem onClick={() => navigate('/')}>Dashboard<Shortcut>Ctrl+Shift+D</Shortcut></DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/tasks')}>Tasks</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => navigate('/settings')}>Settings<Shortcut>Ctrl+,</Shortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => command('quit')}>Quit<Shortcut>Ctrl+Q</Shortcut></DropdownMenuItem>
        </MenuButton>
        <MenuButton label="Edit">
          <DropdownMenuItem onClick={() => command('undo')}>Undo<Shortcut>Ctrl+Z</Shortcut></DropdownMenuItem>
          <DropdownMenuItem onClick={() => command('redo')}>Redo<Shortcut>Ctrl+Y</Shortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => command('cut')}>Cut<Shortcut>Ctrl+X</Shortcut></DropdownMenuItem>
          <DropdownMenuItem onClick={() => command('copy')}>Copy<Shortcut>Ctrl+C</Shortcut></DropdownMenuItem>
          <DropdownMenuItem onClick={() => command('paste')}>Paste<Shortcut>Ctrl+V</Shortcut></DropdownMenuItem>
          <DropdownMenuItem onClick={() => command('select-all')}>Select All<Shortcut>Ctrl+A</Shortcut></DropdownMenuItem>
        </MenuButton>
        <MenuButton label="View">
          <DropdownMenuItem onClick={() => dispatch('toggle-search')}>Global Search<Shortcut>Ctrl+K</Shortcut></DropdownMenuItem>
          <DropdownMenuItem onClick={() => dispatch('toggle-file-search')}>Search in Files<Shortcut>Ctrl+Shift+F</Shortcut></DropdownMenuItem>
          <DropdownMenuItem onClick={() => dispatch('toggle-terminal')}>Toggle Terminal<Shortcut>Ctrl+`</Shortcut></DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => command('reload')}>Reload</DropdownMenuItem>
          <DropdownMenuItem onClick={() => command('toggle-devtools')}>Developer Tools</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => command('zoom-in')}>Zoom In</DropdownMenuItem>
          <DropdownMenuItem onClick={() => command('zoom-out')}>Zoom Out</DropdownMenuItem>
          <DropdownMenuItem onClick={() => command('zoom-reset')}>Reset Zoom</DropdownMenuItem>
          <DropdownMenuItem onClick={() => command('toggle-fullscreen')}>Full Screen</DropdownMenuItem>
        </MenuButton>
        <MenuButton label="Help">
          <DropdownMenuItem onClick={() => navigate('/help')}>Help & Documentation</DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/logs')}>Logs</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => window.open('https://github.com/defremont/Shipyard', '_blank', 'noopener,noreferrer')}>GitHub Repository</DropdownMenuItem>
        </MenuButton>
      </div>
      <button
        className="app-no-drag absolute left-1/2 flex h-6 w-[clamp(220px,32vw,520px)] -translate-x-1/2 items-center gap-2 rounded-md border bg-background/55 px-3 text-[11px] text-muted-foreground shadow-sm transition-colors hover:border-muted-foreground/30 hover:bg-background hover:text-foreground"
        onClick={() => dispatch('toggle-search')}
        title="Global Search (Ctrl+K)"
      >
        <Search className="h-3 w-3" />
        <span className="flex-1 truncate text-center">{location.pathname.startsWith('/project/') ? 'Search in Shipyard' : 'Search projects and tasks'}</span>
        <span className="text-[9px] text-muted-foreground/50">Ctrl+K</span>
      </button>
    </div>
  )
}
