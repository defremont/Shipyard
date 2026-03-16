import { Routes, Route } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Layout } from '@/components/layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { Workspace } from '@/pages/Workspace'
import { TasksPage } from '@/pages/TasksPage'
import { Settings } from '@/pages/Settings'
import { Help } from '@/pages/Help'
import { LogsPage } from '@/pages/LogsPage'
import { AiSessionsProvider } from '@/hooks/useAiSessions'

export default function App() {
  return (
    <TooltipProvider>
      <AiSessionsProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/project/:projectId" element={<Workspace />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/help" element={<Help />} />
            <Route path="/logs" element={<LogsPage />} />
          </Route>
        </Routes>
      </AiSessionsProvider>
    </TooltipProvider>
  )
}
