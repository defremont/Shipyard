import { Outlet } from 'react-router-dom'
import { ActivityBar } from './ActivityBar'
import { SidePanel } from './SidePanel'
import { TabBar } from './TabBar'
import { GlobalSearch } from './GlobalSearch'
import { AiResolveHost } from '@/components/tasks/AiResolveHost'
import { FileContentSearch } from './FileContentSearch'
import { TabsProvider } from '@/hooks/useTabs'
import { ActivityProvider, useActivity } from '@/hooks/useActivity'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { cn } from '@/lib/utils'
import { EditorTabsProvider } from '@/hooks/useEditorTabsContext'
import { TerminalPanel } from '@/components/terminals/TerminalPanel'
import { useIntegrationAutoPull } from '@/hooks/useIntegrationAutoPull'
import { useElectronMenu } from '@/hooks/useElectronMenu'
import { useAppUpdate } from '@/hooks/useAppUpdate'
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { AppTitleBar } from './AppTitleBar'

function LayoutInner() {
  useIntegrationAutoPull()
  useElectronMenu()
  useAppUpdate()
  useGlobalShortcuts()
  // Panels that took the whole space hide their neighbours with `hidden`
  // instead of unmounting them — the board, the editor and the terminals keep
  // their state. With the terminal full-size the workspace shrinks to its
  // toolbar (Workspace hides its own content): Tasks/Editor stay one click away.
  const { terminalFull, chatFull } = useLayoutMode()
  const { activity, panelOpen } = useActivity()
  const chatOnly = chatFull && panelOpen && activity === 'claude'
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppTitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityBar />
        <SidePanel />
        <main className={cn('flex-1 flex flex-col overflow-hidden min-w-0', chatOnly && 'hidden')}>
          <TabBar />
          <div className={cn('flex flex-col overflow-hidden min-h-0', terminalFull ? 'shrink-0' : 'flex-1')}>
            <Outlet />
          </div>
          <TerminalPanel />
        </main>
      </div>
      <GlobalSearch />
      <AiResolveHost />
      <FileContentSearch />
      <ShortcutsOverlay />
    </div>
  )
}

export function Layout() {
  return (
    <TabsProvider>
      <EditorTabsProvider>
        <ActivityProvider>
          <LayoutInner />
        </ActivityProvider>
      </EditorTabsProvider>
    </TabsProvider>
  )
}
