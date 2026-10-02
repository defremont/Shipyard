import { useNavigate } from 'react-router-dom'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, Search } from 'lucide-react'
import { TabBar } from './TabBar'

/** True in the desktop app, where the title bar also carries the project tabs. */
export function isDesktopApp(): boolean {
  return !!(window as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron
}

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

function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-52">{children}</DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/**
 * The desktop title bar. It is also the project tab strip: window, menus and
 * projects share one row, so the workspace starts one bar higher. The four
 * menus fold into the logo — they are reached a few times a day, the project
 * tabs every minute.
 */
export function AppTitleBar() {
  const navigate = useNavigate()
  const electronAPI = (window as { electronAPI?: ElectronTitlebarAPI }).electronAPI

  if (!electronAPI?.isElectron) return null

  const command = (value: TitlebarCommand) => electronAPI.sendTitlebarCommand?.(value)
  const dispatch = (
    action: 'toggle-search' | 'toggle-file-search' | 'toggle-terminal'
      | 'toggle-shortcuts' | 'close-tab' | 'new-task-request'
  ) => {
    window.dispatchEvent(new CustomEvent(`shipyard:${action}`))
  }
  const isMac = electronAPI.platform === 'darwin'

  return (
    <div className={`app-drag flex h-[35px] shrink-0 items-center gap-1 border-b bg-card/90 ${isMac ? 'pl-20 pr-2' : 'pl-1.5 pr-[140px]'}`}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Shipyard menu"
          title="Menu"
          className="app-no-drag flex h-7 shrink-0 items-center gap-1 rounded px-1.5 hover:bg-accent focus:outline-none data-[state=open]:bg-accent"
        >
          <img src="/favicon.svg" alt="" className="h-4 w-4" draggable={false} />
          <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <MenuGroup label="File">
            <DropdownMenuItem onClick={() => navigate('/')}>Dashboard<Shortcut>Ctrl+Shift+D</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/tasks')}>Tasks</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => dispatch('new-task-request')}>New Task<Shortcut>Ctrl+N</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => dispatch('close-tab')}>Close Tab<Shortcut>Ctrl+W</Shortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>Settings<Shortcut>Ctrl+,</Shortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => command('quit')}>Quit<Shortcut>Ctrl+Q</Shortcut></DropdownMenuItem>
          </MenuGroup>
          <MenuGroup label="Edit">
            <DropdownMenuItem onClick={() => command('undo')}>Undo<Shortcut>Ctrl+Z</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => command('redo')}>Redo<Shortcut>Ctrl+Y</Shortcut></DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => command('cut')}>Cut<Shortcut>Ctrl+X</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => command('copy')}>Copy<Shortcut>Ctrl+C</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => command('paste')}>Paste<Shortcut>Ctrl+V</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => command('select-all')}>Select All<Shortcut>Ctrl+A</Shortcut></DropdownMenuItem>
          </MenuGroup>
          <MenuGroup label="View">
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
          </MenuGroup>
          <MenuGroup label="Help">
            <DropdownMenuItem onClick={() => dispatch('toggle-shortcuts')}>Keyboard Shortcuts<Shortcut>?</Shortcut></DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/help')}>Help & Documentation</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate('/logs')}>Logs</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => window.open('https://github.com/defremont/Shipyard', '_blank', 'noopener,noreferrer')}>GitHub Repository</DropdownMenuItem>
          </MenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <TabBar embedded />

      <button
        className="app-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        onClick={() => dispatch('toggle-search')}
        title="Global Search (Ctrl+K)"
        aria-label="Global Search"
      >
        <Search className="h-3.5 w-3.5" />
      </button>
      {/* The tabs may fill the row; this strip always stays free to drag the
          window by. */}
      <div className="h-full w-10 shrink-0" />
    </div>
  )
}
