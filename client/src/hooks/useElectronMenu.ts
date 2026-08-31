import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

interface ElectronAPI {
  isElectron: boolean
  platform: string
  onMenuAction?: (callback: (action: string) => void) => () => void
}

/**
 * Bridge Electron application-menu actions into the SPA.
 * Actions: 'navigate:<path>' routes via react-router; toggle actions are
 * re-dispatched as window CustomEvents that the owning components listen to
 * ('shipyard:toggle-search', 'shipyard:toggle-file-search', 'shipyard:toggle-terminal').
 * No-op outside Electron.
 */
export function useElectronMenu() {
  const navigate = useNavigate()

  useEffect(() => {
    const electronAPI = (window as { electronAPI?: ElectronAPI }).electronAPI
    if (!electronAPI?.onMenuAction) return

    const unsubscribe = electronAPI.onMenuAction((action) => {
      if (action.startsWith('navigate:')) {
        navigate(action.slice('navigate:'.length))
      } else if (
        action === 'toggle-search' ||
        action === 'toggle-file-search' ||
        action === 'toggle-terminal' ||
        action === 'toggle-shortcuts' ||
        action === 'close-tab' ||
        action === 'new-task-request'
      ) {
        window.dispatchEvent(new CustomEvent(`shipyard:${action}`))
      }
    })
    return unsubscribe
  }, [navigate])
}
