import { useEffect } from 'react'
import { toast } from 'sonner'

interface UpdateAPI {
  getUpdateState?: () => Promise<{ version: string } | null>
  onUpdateReady?: (callback: (info: { version: string }) => void) => () => void
  installUpdate?: () => void
}

/**
 * The desktop app downloads new releases in the background. When one is ready
 * this asks once, in a toast that stays until answered; "Later" leaves it for
 * the next launch, and the tray menu keeps a "Restart to update" item.
 */
export function useAppUpdate() {
  useEffect(() => {
    const electronAPI = (window as { electronAPI?: UpdateAPI }).electronAPI
    if (!electronAPI?.onUpdateReady) return

    const prompt = ({ version }: { version: string }) => {
      toast(`Shipyard v${version} is ready`, {
        id: 'app-update',
        description: 'Restart to finish updating. Open terminals will close.',
        duration: Infinity,
        action: { label: 'Restart', onClick: () => electronAPI.installUpdate?.() },
        cancel: { label: 'Later', onClick: () => {} },
      })
    }

    electronAPI.getUpdateState?.().then(state => { if (state) prompt(state) }).catch(() => {})
    return electronAPI.onUpdateReady(prompt)
  }, [])
}
