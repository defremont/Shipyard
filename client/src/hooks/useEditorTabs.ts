import { useState, useCallback, useEffect, useRef } from 'react'

export interface EditorTab {
  path: string
  name: string
  extension: string
  originalContent: string
  content: string
  isDirty: boolean
  needsFetch: boolean
  diffMode?: 'staged' | 'unstaged'
  subrepo?: string
  /** Where to put the cursor once the editor shows the file (a search hit).
   *  `nonce` makes the same spot count again on a second open. */
  reveal?: EditorReveal
}

export interface EditorReveal {
  line: number
  /** 0-based character index in the line. */
  column?: number
  /** Characters to select from `column`. */
  length?: number
  nonce: number
}

export interface OpenFileOptions {
  diffMode?: 'staged' | 'unstaged'
  subrepo?: string
  reveal?: Omit<EditorReveal, 'nonce'>
}

interface PersistedTab {
  path: string
  name: string
  extension: string
}

const STORAGE_KEY = (projectId: string) => `shipyard:editor-tabs:${projectId}`
const ACTIVE_KEY = (projectId: string) => `shipyard:editor-active-tab:${projectId}`

function loadPersistedTabs(projectId: string): PersistedTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(projectId))
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function persistTabs(projectId: string, tabs: EditorTab[]) {
  const data: PersistedTab[] = tabs.map(t => ({ path: t.path, name: t.name, extension: t.extension }))
  localStorage.setItem(STORAGE_KEY(projectId), JSON.stringify(data))
}

function loadActiveTab(projectId: string): string | null {
  return localStorage.getItem(ACTIVE_KEY(projectId))
}

function persistActiveTab(projectId: string, path: string | null) {
  if (path) {
    localStorage.setItem(ACTIVE_KEY(projectId), path)
  } else {
    localStorage.removeItem(ACTIVE_KEY(projectId))
  }
}

export function useEditorTabs(projectId: string) {
  const [tabs, setTabs] = useState<EditorTab[]>(() => {
    const persisted = loadPersistedTabs(projectId)
    return persisted.map(p => ({
      ...p,
      originalContent: '',
      content: '',
      isDirty: false,
      needsFetch: true,
    }))
  })

  const [activeTabPath, setActiveTabPath] = useState<string | null>(() => {
    const saved = loadActiveTab(projectId)
    const persisted = loadPersistedTabs(projectId)
    if (saved && persisted.some(t => t.path === saved)) return saved
    return persisted.length > 0 ? persisted[0].path : null
  })

  // Reset when project changes
  const prevProjectId = useRef(projectId)
  useEffect(() => {
    if (prevProjectId.current !== projectId) {
      prevProjectId.current = projectId
      const persisted = loadPersistedTabs(projectId)
      setTabs(persisted.map(p => ({
        ...p,
        originalContent: '',
        content: '',
        isDirty: false,
        needsFetch: true,
      })))
      const saved = loadActiveTab(projectId)
      setActiveTabPath(saved && persisted.some(t => t.path === saved) ? saved : persisted[0]?.path || null)
    }
  }, [projectId])

  // Persist tabs on change
  useEffect(() => {
    persistTabs(projectId, tabs)
  }, [projectId, tabs])

  useEffect(() => {
    persistActiveTab(projectId, activeTabPath)
  }, [projectId, activeTabPath])

  const openFile = useCallback((path: string, name: string, extension: string, content: string, options?: OpenFileOptions) => {
    const reveal = options?.reveal ? { ...options.reveal, nonce: Date.now() } : undefined
    setTabs(prev => {
      const existing = prev.find(t => t.path === path)
      if (existing) {
        // Update diff mode if changed
        if (options?.diffMode !== existing.diffMode) {
          return prev.map(t => t.path === path ? { ...t, diffMode: options?.diffMode, subrepo: options?.subrepo, reveal } : t)
        }
        return reveal ? prev.map(t => t.path === path ? { ...t, reveal } : t) : prev
      }
      return [...prev, {
        path,
        name,
        extension,
        originalContent: content,
        content,
        isDirty: false,
        needsFetch: content === '',
        diffMode: options?.diffMode,
        subrepo: options?.subrepo,
        reveal,
      }]
    })
    setActiveTabPath(path)
  }, [])

  const initContent = useCallback((path: string, content: string) => {
    setTabs(prev => prev.map(t =>
      t.path === path && t.needsFetch
        ? { ...t, originalContent: content, content, needsFetch: false }
        : t
    ))
  }, [])

  const closeTab = useCallback((path: string) => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.path === path)
      if (idx === -1) return prev
      const next = prev.filter(t => t.path !== path)
      return next
    })
    setActiveTabPath(prev => {
      if (prev !== path) return prev
      const remaining = tabs.filter(t => t.path !== path)
      if (remaining.length === 0) return null
      const idx = tabs.findIndex(t => t.path === path)
      return remaining[Math.min(idx, remaining.length - 1)]?.path || null
    })
  }, [tabs])

  const setContent = useCallback((path: string, content: string) => {
    setTabs(prev => prev.map(t =>
      t.path === path
        ? { ...t, content, isDirty: content !== t.originalContent }
        : t
    ))
  }, [])

  const markSaved = useCallback((path: string, content: string) => {
    setTabs(prev => prev.map(t =>
      t.path === path
        ? { ...t, originalContent: content, content, isDirty: false }
        : t
    ))
  }, [])

  const setActiveTab = useCallback((path: string) => {
    setActiveTabPath(path)
  }, [])

  const hasDirtyTabs = tabs.some(t => t.isDirty)

  return {
    tabs,
    activeTabPath,
    openFile,
    initContent,
    closeTab,
    setContent,
    markSaved,
    setActiveTab,
    hasDirtyTabs,
  }
}
