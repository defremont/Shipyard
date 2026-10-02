import { Outlet } from 'react-router-dom'
import { SidePanel } from './SidePanel'
import { GlobalSearch } from './GlobalSearch'
import { AiResolveHost } from '@/components/tasks/AiResolveHost'
import { FileContentSearch } from './FileContentSearch'
import { TabsProvider } from '@/hooks/useTabs'
import { ActivityProvider, useActivity } from '@/hooks/useActivity'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { cn } from '@/lib/utils'
import { EditorTabsProvider } from '@/hooks/useEditorTabsContext'
import { TerminalPanel } from '@/components/terminals/TerminalPanel'
import { TaskRail } from '@/components/tasks/TaskRail'
import { useTabs } from '@/hooks/useTabs'
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
  const { terminalFull, chatFull, taskRail } = useLayoutMode()
  const { activeTabId } = useTabs()
  const { activity, panelOpen } = useActivity()
  const chatOnly = chatFull && panelOpen && activity === 'claude'
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppTitleBar />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <SidePanel />
        <main className={cn('flex-1 flex flex-col overflow-hidden min-w-0', chatOnly && 'hidden')}>
          <div className={cn('flex flex-col overflow-hidden min-h-0', terminalFull ? 'shrink-0' : 'flex-1')}>
            <Outlet />
          </div>
          {/* A full-size terminal shares its row with the task rail: tasks on
              the left, the agents in the middle. */}
          <div className={cn('flex min-w-0', terminalFull ? 'min-h-0 flex-1' : 'shrink-0')}>
            {terminalFull && taskRail && activeTabId && <TaskRail key={activeTabId} projectId={activeTabId} />}
            <div className="flex min-w-0 flex-1 flex-col">
              <TerminalPanel />
            </div>
          </div>
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
