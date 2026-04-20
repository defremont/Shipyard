import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TabBar } from './TabBar'
import { GlobalSearch } from './GlobalSearch'
import { FileContentSearch } from './FileContentSearch'
import { TabsProvider } from '@/hooks/useTabs'
import { TerminalPanel } from '@/components/terminals/TerminalPanel'
import { useIntegrationAutoPull } from '@/hooks/useIntegrationAutoPull'

const SIDEBAR_KEY = 'shipyard-sidebar-collapsed'

export function Layout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === 'true')
  useIntegrationAutoPull()

  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(SIDEBAR_KEY, String(next))
      return next
    })
  }

  return (
    <TabsProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <TabBar />
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <Outlet />
          </div>
          <TerminalPanel />
        </main>
      </div>
      <GlobalSearch />
      <FileContentSearch />
    </TabsProvider>
  )
}
