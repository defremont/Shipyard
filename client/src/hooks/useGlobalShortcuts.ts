import { useEffect } from 'react'
import { useTabs } from '@/hooks/useTabs'
import { useEditorTabsContext } from '@/hooks/useEditorTabsContext'
import { PENDING_NEW_TASK_KEY } from '@/lib/shortcuts'

/** Typing somewhere should never trigger a bare-key shortcut. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  return !!el.closest?.('.xterm, .cm-editor')
}

function isTerminalFocused(): boolean {
  const active = document.activeElement as HTMLElement | null
  return !!active?.closest?.('.xterm')
}

/**
 * The shortcuts that belong to the app as a whole. Everything scoped to one
 * component (Ctrl+K, Ctrl+Shift+F, Ctrl+`, Ctrl+S) stays with its owner —
 * registering them twice would double-fire.
 */
export function useGlobalShortcuts() {
  const { activeTabId, closeTab } = useTabs()
  const { hasDirtyTabs } = useEditorTabsContext()

  useEffect(() => {
    const closeActiveTab = () => {
      // Ask the editor first — it is mounted only in editor mode and routes
      // the close through its unsaved-changes confirmation. It cancels the
      // event when it handled it; otherwise the project tab closes.
      const handled = !window.dispatchEvent(
        new CustomEvent('shipyard:close-editor-tab', { cancelable: true })
      )
      if (handled || !activeTabId) return
      // In tasks mode the editor is unmounted, so nobody guards its unsaved
      // buffers — closing the project tab would discard them silently.
      if (hasDirtyTabs && !window.confirm('This project has unsaved file changes. Close the tab anyway?')) return
      closeTab(activeTabId)
    }

    const newTask = () => {
      if (!activeTabId) {
        window.dispatchEvent(new CustomEvent('shipyard:toggle-search'))
        return
      }
      // The board may not be mounted yet (editor mode) — the flag survives the
      // switch, the event covers the already-mounted case. It carries the
      // project id so a stranded flag can never open a dialog for a different
      // project later on.
      try { sessionStorage.setItem(PENDING_NEW_TASK_KEY, activeTabId) } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent('shipyard:workspace-mode', { detail: { mode: 'tasks' } }))
      window.dispatchEvent(new CustomEvent('shipyard:new-task'))
    }

    const handler = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey

      if (mod && event.key.toLowerCase() === 'w') {
        // Ctrl+W is readline's delete-word. Stealing it from a shell would
        // break editing a command mid-line, so the terminal keeps it.
        if (isTerminalFocused()) return
        event.preventDefault()
        closeActiveTab()
        return
      }

      if (mod && event.key.toLowerCase() === 'n' && !event.shiftKey) {
        if (isTerminalFocused()) return
        event.preventDefault()
        newTask()
        return
      }

      if (event.key === '?' && !mod && !isTypingTarget(event.target)) {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('shipyard:toggle-shortcuts'))
      }
    }

    // The Electron menu items route through the same two actions.
    window.addEventListener('keydown', handler)
    window.addEventListener('shipyard:close-tab', closeActiveTab)
    window.addEventListener('shipyard:new-task-request', newTask)
    return () => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener('shipyard:close-tab', closeActiveTab)
      window.removeEventListener('shipyard:new-task-request', newTask)
    }
  }, [activeTabId, closeTab, hasDirtyTabs])
}
