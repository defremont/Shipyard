import { useNavigate } from 'react-router-dom'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu'
import { ChevronDown, FolderKanban, Inbox, LayoutGrid, MessageSquare, Search, Settings } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useInboxStatus } from '@/hooks/useInbox'
import { useLocation } from 'react-router-dom'
import { useTerminalTabs } from '@/hooks/useTerminalTabs'
import { TabBar } from './TabBar'
import { useActivity } from '@/hooks/useActivity'
import { ClaudeUsageBadge } from '@/components/claude/ClaudeUsageBadge'
import { cn } from '@/lib/utils'

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
 * The one bar at the top: window, menus, project tabs and the app-wide
 * actions. In the desktop app it is also the title bar (drag region, room for
 * the window buttons); in the browser it is the same row without those.
 * There is no activity bar — search, chat, usage and settings live on the
 * right of this row, and everything else opens from where it is used.
 */
export function AppTitleBar() {
  const navigate = useNavigate()
  const { activity, panelOpen, selectActivity } = useActivity()
  const electronAPI = (window as { electronAPI?: ElectronTitlebarAPI }).electronAPI
  const desktop = !!electronAPI?.isElectron

  const command = (value: TitlebarCommand) => electronAPI?.sendTitlebarCommand?.(value)
  const dispatch = (
    action: 'toggle-search' | 'toggle-file-search' | 'toggle-terminal'
      | 'toggle-shortcuts' | 'close-tab' | 'new-task-request'
  ) => {
    window.dispatchEvent(new CustomEvent(`shipyard:${action}`))
  }
  const isMac = electronAPI?.platform === 'darwin'
  const iconButton = 'app-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

  return (
    <div className={cn(
      'app-drag flex h-[35px] shrink-0 items-center gap-1 border-b bg-card',
      !desktop ? 'px-1.5' : isMac ? 'pl-20 pr-2' : 'pl-1.5 pr-[140px]'
    )}>
      {desktop && (
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
      )}

      <TabBar embedded />

      <InboxButton className={iconButton} />
      <AgentsButton className={iconButton} />
      <button className={iconButton} onClick={() => dispatch('toggle-search')} title="Search (Ctrl+K)" aria-label="Search">
        <Search className="h-3.5 w-3.5" />
      </button>
      <button
        className={cn(iconButton, panelOpen && activity === 'projects' && 'bg-accent text-foreground')}
        onClick={() => selectActivity('projects')}
        title="Projects"
        aria-label="Projects"
      >
        <FolderKanban className="h-3.5 w-3.5" />
      </button>
      <button
        className={cn(iconButton, panelOpen && activity === 'claude' && 'bg-accent text-foreground')}
        onClick={() => selectActivity('claude')}
        title="Claude chat"
        aria-label="Claude chat"
      >
        <MessageSquare className="h-3.5 w-3.5" />
      </button>
      <ClaudeUsageBadge />
      <DropdownMenu>
        <DropdownMenuTrigger className={cn(iconButton, 'focus:outline-none data-[state=open]:bg-accent')} title="Settings and help" aria-label="Settings and help">
          <Settings className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => navigate('/settings')}>Settings</DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/logs')}>Logs</DropdownMenuItem>
          <DropdownMenuItem onClick={() => navigate('/help')}>Help</DropdownMenuItem>
          <DropdownMenuItem onClick={() => dispatch('toggle-shortcuts')}>Keyboard shortcuts<Shortcut>?</Shortcut></DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* The tabs may fill the row; in the desktop app this strip always
          stays free to drag the window by. */}
      {desktop && <div className="h-full w-8 shrink-0" />}
    </div>
  )
}

/** Opens the grid of every agent; the count is the agents waiting for an answer. */
function AgentsButton({ className }: { className: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const tabs = useTerminalTabs()
  const waiting = tabs.filter(t => t.status === 'question').length
  const here = location.pathname === '/agents'
  return (
    <button
      className={cn(className, 'relative', here && 'bg-accent text-foreground')}
      onClick={() => (here ? navigate(-1) : navigate('/agents'))}
      title={waiting ? `Agents — ${waiting} waiting for you` : 'Agents (all projects)'}
      aria-label="All agents"
    >
      <LayoutGrid className="h-3.5 w-3.5" />
      {waiting > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-warning px-0.5 text-[9px] font-semibold tabular-nums text-background">
          {waiting}
        </span>
      )}
    </button>
  )
}

/** The WhatsApp review; shown only with the inbox connected. The count is what waits for review. */
function InboxButton({ className }: { className: string }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { data: status } = useInboxStatus()
  const { data } = useQuery({
    queryKey: ['inbox-review-count'],
    queryFn: api.getInboxReviewCount,
    enabled: !!status?.configured,
    refetchInterval: 60_000,
    retry: false,
  })
  if (!status?.configured) return null
  const here = location.pathname === '/inbox'
  const count = data?.count ?? 0
  return (
    <button
      className={cn(className, 'relative', here && 'bg-accent text-foreground')}
      onClick={() => (here ? navigate(-1) : navigate('/inbox'))}
      title={count ? `WhatsApp review — ${count} waiting` : 'WhatsApp review'}
      aria-label="WhatsApp review"
    >
      <Inbox className="h-3.5 w-3.5" />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-semibold tabular-nums text-primary-foreground">
          {count > 99 ? '99' : count}
        </span>
      )}
    </button>
  )
}
