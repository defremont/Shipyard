import { useCallback, useEffect, useState } from 'react'
import { useLaunchTerminal, useOpenFolder, type Project } from '@/hooks/useProjects'
import { useTerminalStatus } from '@/hooks/useTerminal'
import { toast } from 'sonner'

const SKIP_PERMISSIONS_KEY = 'shipyard:skipPermissions'
// 'storage' only fires in other browser tabs — this event keeps every mounted
// consumer in the same window in sync when one of them flips the preference.
const SKIP_PERMISSIONS_EVENT = 'shipyard:skip-permissions-changed'

function readSkipPermissions(): boolean {
  try { return localStorage.getItem(SKIP_PERMISSIONS_KEY) === 'true' } catch { return false }
}

/**
 * Single source of truth for launching things for a project: integrated
 * terminal first (when available), native terminal fallback, shared YOLO
 * preference, consistent toasts.
 */
export function useProjectLaunch() {
  const launchTerminal = useLaunchTerminal()
  const openFolderMutation = useOpenFolder()
  const { data: terminalStatus } = useTerminalStatus()
  const hasIntegrated = terminalStatus?.available ?? false

  const [skipPermissions, setSkipPermissionsState] = useState(readSkipPermissions)

  useEffect(() => {
    const fromStorage = () => setSkipPermissionsState(readSkipPermissions())
    // The in-window event carries the value, so the preference still holds
    // when the browser refuses to persist it (blocked site data, quota).
    const fromEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: boolean }>).detail
      setSkipPermissionsState(detail?.value ?? readSkipPermissions())
    }
    window.addEventListener('storage', fromStorage)
    window.addEventListener(SKIP_PERMISSIONS_EVENT, fromEvent)
    return () => {
      window.removeEventListener('storage', fromStorage)
      window.removeEventListener(SKIP_PERMISSIONS_EVENT, fromEvent)
    }
  }, [])

  const setSkipPermissions = useCallback((next: boolean) => {
    try { localStorage.setItem(SKIP_PERMISSIONS_KEY, String(next)) } catch { /* ignore */ }
    setSkipPermissionsState(next)
    window.dispatchEvent(new CustomEvent(SKIP_PERMISSIONS_EVENT, { detail: { value: next } }))
  }, [])

  const launch = useCallback((project: Project, type: string, label: string) => {
    if (hasIntegrated) {
      // TerminalPanel opens itself and focuses the new tab, so the result is
      // already on screen — a toast would only repeat it. The native path
      // below opens a window elsewhere, which does need saying.
      window.dispatchEvent(new CustomEvent('shipyard:open-terminal', { detail: { projectId: project.id, type } }))
      return
    }
    launchTerminal.mutate(
      { projectId: project.id, type },
      { onSuccess: () => toast.success(`Launched ${label}`) }
    )
  }, [hasIntegrated, launchTerminal])

  const launchClaude = useCallback((project: Project, opts?: { skipPermissions?: boolean }) => {
    const yolo = opts?.skipPermissions ?? skipPermissions
    launch(project, yolo ? 'claude-yolo' : 'claude', 'Claude Code')
  }, [launch, skipPermissions])

  const launchDev = useCallback((project: Project) => {
    launch(project, 'dev', 'dev server')
  }, [launch])

  const launchShell = useCallback((project: Project) => {
    launch(project, 'shell', 'shell')
  }, [launch])

  const openFolder = useCallback((project: Project) => {
    openFolderMutation.mutate(project.id, { onSuccess: () => toast.success('Opened folder') })
  }, [openFolderMutation])

  return { skipPermissions, setSkipPermissions, launchClaude, launchDev, launchShell, openFolder }
}
