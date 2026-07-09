import { lazy, Suspense, type ReactNode } from 'react'
import { Routes, Route } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Layout } from '@/components/layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { AiSessionsProvider } from '@/hooks/useAiSessions'

// Dashboard is the landing route, so it stays eager. The rest load on demand —
// Workspace alone drags in CodeMirror, and Help/Logs are rarely opened.
const Workspace = lazy(() => import('@/pages/Workspace').then(m => ({ default: m.Workspace })))
const TasksPage = lazy(() => import('@/pages/TasksPage').then(m => ({ default: m.TasksPage })))
const Settings = lazy(() => import('@/pages/Settings').then(m => ({ default: m.Settings })))
const Help = lazy(() => import('@/pages/Help').then(m => ({ default: m.Help })))
const LogsPage = lazy(() => import('@/pages/LogsPage').then(m => ({ default: m.LogsPage })))

// The boundary must sit *below* Layout, where the Outlet renders. A Suspense
// wrapped around <Routes> would unmount Layout while a chunk loads, tearing
// down the terminal panel and its WebSockets on every navigation.
const page = (element: ReactNode) => <Suspense fallback={null}>{element}</Suspense>

export default function App() {
  return (
    <TooltipProvider>
      <AiSessionsProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tasks" element={page(<TasksPage />)} />
            <Route path="/project/:projectId" element={page(<Workspace />)} />
            <Route path="/settings" element={page(<Settings />)} />
            <Route path="/help" element={page(<Help />)} />
            <Route path="/logs" element={page(<LogsPage />)} />
          </Route>
        </Routes>
      </AiSessionsProvider>
    </TooltipProvider>
  )
}
