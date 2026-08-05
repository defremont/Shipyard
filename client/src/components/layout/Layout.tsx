import { Outlet } from 'react-router-dom'
import { ActivityBar } from './ActivityBar'
import { SidePanel } from './SidePanel'
import { TabBar } from './TabBar'
import { GlobalSearch } from './GlobalSearch'
import { FileContentSearch } from './FileContentSearch'
import { TabsProvider } from '@/hooks/useTabs'
import { ActivityProvider } from '@/hooks/useActivity'
import { EditorTabsProvider } from '@/hooks/useEditorTabsContext'
import { TerminalPanel } from '@/components/terminals/TerminalPanel'
import { useIntegrationAutoPull } from '@/hooks/useIntegrationAutoPull'
import { useElectronMenu } from '@/hooks/useElectronMenu'
import { AppTitleBar } from './AppTitleBar'

function LayoutInner() {
  useIntegrationAutoPull()
  useElectronMenu()
  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <AppTitleBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityBar />
        <SidePanel />
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          <TabBar />
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <Outlet />
          </div>
          <TerminalPanel />
        </main>
      </div>
      <GlobalSearch />
      <FileContentSearch />
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
