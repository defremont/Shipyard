/** Set when Ctrl+N fires while the task board is not mounted; the board reads
 *  and clears it as soon as it appears. */
export const PENDING_NEW_TASK_KEY = 'shipyard:pending-new-task'

export interface ShortcutDef {
  keys: string
  label: string
  /** Reserved by the browser — only works in the desktop app. */
  desktopOnly?: boolean
}

export interface ShortcutGroup {
  scope: string
  items: ShortcutDef[]
}

/** Single source of truth for the shortcut overlay and the Help page. */
export const SHORTCUTS: ShortcutGroup[] = [
  {
    scope: 'Global',
    items: [
      { keys: 'Ctrl+K', label: 'Search projects, tasks and files' },
      { keys: 'Ctrl+Shift+F', label: 'Search in file contents' },
      { keys: 'Ctrl+`', label: 'Toggle the terminal panel' },
      { keys: '?', label: 'Show this shortcut list' },
    ],
  },
  {
    scope: 'Tabs',
    items: [
      { keys: 'Ctrl+W', label: 'Close the active editor or project tab', desktopOnly: true },
      { keys: 'Middle click', label: 'Close a project, editor or terminal tab' },
      { keys: 'Right click', label: 'Tab and project actions' },
      { keys: 'Drag', label: 'Reorder project tabs' },
    ],
  },
  {
    scope: 'Tasks',
    items: [
      { keys: 'Ctrl+N', label: 'New task in the active project', desktopOnly: true },
      { keys: 'Shift+click', label: 'Run with AI without the feedback dialog' },
    ],
  },
  {
    scope: 'Editor',
    items: [
      { keys: 'Ctrl+S', label: 'Save the open file' },
      { keys: 'Alt+Z', label: 'Toggle word wrap' },
    ],
  },
  {
    scope: 'Terminal',
    items: [
      { keys: 'Ctrl+C', label: 'Copy when there is a selection, otherwise interrupt' },
      { keys: 'Ctrl+V', label: 'Paste' },
      { keys: 'Right click', label: 'Copy when there is a selection, otherwise paste' },
      { keys: 'Shift+drag', label: 'Select text while an app is tracking the mouse' },
    ],
  },
]
