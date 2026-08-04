import { useState } from 'react'
import { Play, Monitor, FolderOpen, Copy, Sparkles, Rocket, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLaunchTerminal, useOpenFolder } from '@/hooks/useProjects'
import { useTerminalStatus } from '@/hooks/useTerminal'
import { useTasks, type Task } from '@/hooks/useTasks'
import { useMcpStatus } from '@/hooks/useMcp'
import { useClaudeStatus } from '@/hooks/useClaude'
import { TaskManagerDialog } from '@/components/tasks/TaskManagerDialog'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

interface TerminalLauncherProps {
  projectId: string
  projectPath?: string
  projectName?: string
}

const priorityLabel = { urgent: 'URGENT', high: 'HIGH', medium: 'MEDIUM', low: 'LOW' }
const statusLabel = { backlog: 'BACKLOG', todo: 'TODO', in_progress: 'IN_PROGRESS', done: 'DONE' }

function buildClaudeContext(projectName: string, projectPath: string, projectId: string, tasks: Task[], tasksDir: string) {
  const sep = tasksDir.includes('\\') ? '\\' : '/'
  const tasksFile = `${tasksDir}${sep}${projectId}.json`

  const lines = [
    `Project: ${projectName}`,
    `Project path: ${projectPath}`,
    `Shipyard tasks file: ${tasksFile}`,
    '',
  ]

  const active = tasks.filter(t => t.status !== 'done')
  const done = tasks.filter(t => t.status === 'done')

  if (active.length > 0) {
    lines.push(`Active tasks (${active.length}):`)
    for (const t of active) {
      lines.push(`- [${statusLabel[t.status]}] ${t.title} (${priorityLabel[t.priority]}, ${t.effort ? t.effort + ' pts' : 'effort unclassified'})${t.description ? ` — ${t.description}` : ''}`)
      if (t.prompt) lines.push(`  Details: ${t.prompt.split('\n')[0]}${t.prompt.includes('\n') ? '...' : ''}`)
    }
  }

  if (done.length > 0) {
    lines.push('')
    lines.push(`Done (${done.length}):`)
    for (const t of done.slice(0, 5)) {
      lines.push(`- [DONE] ${t.title}`)
    }
    if (done.length > 5) lines.push(`  ... and ${done.length - 5} more`)
  }

  lines.push('')
  lines.push('You can read and update the tasks JSON file directly to organize, add, or update tasks.')
  lines.push('IMPORTANT: Whenever you create or refine a task, ALWAYS set effort to 1, 2, 3, 5, or 8 based on implementation size and uncertainty, independently of priority.')
  lines.push('IMPORTANT: Each task has timestamp fields (inboxAt, inProgressAt, doneAt) tracking when it entered each stage. NEVER remove or reset these. When changing status, add the new timestamp without erasing previous ones.')

  return lines.join('\n')
}

function openIntegratedTerminal(projectId: string, type: string) {
  window.dispatchEvent(new CustomEvent('shipyard:open-terminal', { detail: { projectId, type } }))
}

export function TerminalLauncher({ projectId, projectPath, projectName }: TerminalLauncherProps) {
  const launchTerminal = useLaunchTerminal()
  const openFolder = useOpenFolder()
  const { data: terminalStatus } = useTerminalStatus()
  const hasIntegrated = terminalStatus?.available ?? false
  const { data: tasks } = useTasks(projectId)
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings, staleTime: Infinity })
  const { data: mcpStatus } = useMcpStatus()
  const { data: claudeStatus } = useClaudeStatus()
  const mcpActive = mcpStatus?.enabled ?? false
  const aiAvailable = claudeStatus?.configured || claudeStatus?.cliAvailable
  const [taskManagerOpen, setTaskManagerOpen] = useState(false)
  const [skipPermissions, setSkipPermissions] = useState(() => {
    try { return localStorage.getItem('shipyard:skipPermissions') === 'true' } catch { return false }
  })

  const claudeType = skipPermissions ? 'claude-yolo' : 'claude'

  const handleCopyContext = () => {
    if (!projectPath || !projectName) return
    const context = buildClaudeContext(projectName, projectPath, projectId, tasks || [], settings?.tasksDir || '')
    navigator.clipboard.writeText(context)
    toast.success('Context copied — paste in Claude')
  }

  const handleLaunchClaude = () => {
    // Copy context only when MCP is not active
    if (!mcpActive && projectPath && projectName) {
      const context = buildClaudeContext(projectName, projectPath, projectId, tasks || [], settings?.tasksDir || '')
      navigator.clipboard.writeText(context)
    }
    if (hasIntegrated) {
      openIntegratedTerminal(projectId, claudeType)
    } else {
      launchTerminal.mutate({ projectId, type: claudeType })
    }
    toast.success(mcpActive ? 'Claude opened — MCP provides context' : 'Claude opened — context in clipboard, paste it')
  }

  const launch = (type: string, label: string) => {
    if (hasIntegrated) {
      openIntegratedTerminal(projectId, type)
    } else {
      launchTerminal.mutate({ projectId, type }, { onSuccess: () => toast.success(`Launched ${label}`) })
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Rocket className="h-3.5 w-3.5" />
        Launcher
        {mcpActive && (
          <span className="text-[9px] font-medium bg-success/15 text-success px-1.5 py-0.5 rounded-full normal-case tracking-normal">
            MCP
          </span>
        )}
      </h2>

      {/* Primary actions */}
      <div className="space-y-1">
        {aiAvailable && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="default" className="w-full justify-start gap-2 h-8 text-xs" onClick={() => setTaskManagerOpen(true)}>
                <Wand2 className="h-3.5 w-3.5" />
                AI Task Manager
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="max-w-[200px] text-xs">
                Paste any text — notes, emails, bug reports — and AI organizes them into tasks.
              </p>
            </TooltipContent>
          </Tooltip>
        )}

        {projectPath && projectName && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={aiAvailable ? "outline" : "default"} className="w-full justify-start gap-2 h-8 text-xs" onClick={handleLaunchClaude}>
                <Sparkles className="h-3.5 w-3.5" />
                {mcpActive ? 'Open Claude Code' : 'Open Claude + Copy Context'}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              <p className="max-w-[200px] text-xs">
                {mcpActive
                  ? 'Opens Claude Code — MCP gives it access to projects and tasks automatically'
                  : 'Copies project info + tasks to clipboard, then opens Claude Code. Just paste to give context.'}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Quick actions — compact icon row */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => launch('dev', 'Dev Server')}>
              <Play className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Dev Server</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => launch('shell', 'Shell')}>
              <Monitor className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Shell</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8"
              onClick={() => openFolder.mutate(projectId, { onSuccess: () => toast.success('Opened folder') })}
            >
              <FolderOpen className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Open Folder</TooltipContent>
        </Tooltip>

        {!mcpActive && projectPath && projectName && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopyContext}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Copy Tasks Context</TooltipContent>
          </Tooltip>
        )}

        {/* YOLO toggle */}
        {projectPath && (
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="ml-auto flex items-center cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={skipPermissions}
                  onChange={e => {
                    setSkipPermissions(e.target.checked)
                    localStorage.setItem('shipyard:skipPermissions', String(e.target.checked))
                  }}
                  className="rounded border-muted-foreground/30 h-3 w-3"
                />
                <span className="text-[10px] text-muted-foreground ml-1.5">YOLO</span>
              </label>
            </TooltipTrigger>
            <TooltipContent side="bottom">--dangerously-skip-permissions</TooltipContent>
          </Tooltip>
        )}
      </div>

      <TaskManagerDialog
        projectId={projectId}
        tasks={tasks || []}
        open={taskManagerOpen}
        onOpenChange={setTaskManagerOpen}
      />
    </div>
  )
}
