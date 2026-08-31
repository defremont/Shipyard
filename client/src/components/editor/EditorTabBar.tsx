import { X, XSquare, XCircle, Copy, GitCompareArrows } from 'lucide-react'
import { FileIcon } from '@/components/files/FileIcon'
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import type { EditorTab } from '@/hooks/useEditorTabs'

interface EditorTabBarProps {
  tabs: EditorTab[]
  activeTabPath: string | null
  onSelectTab: (path: string) => void
  onCloseTab: (path: string) => void
}

export function EditorTabBar({ tabs, activeTabPath, onSelectTab, onCloseTab }: EditorTabBarProps) {
  if (tabs.length === 0) return null

  // Saved files close outright; the dirty ones go into the editor's
  // confirmation queue, which asks about each in turn.
  const closeMany = (targets: EditorTab[]) => {
    for (const t of targets.filter(t => !t.isDirty)) onCloseTab(t.path)
    for (const t of targets.filter(t => t.isDirty)) onCloseTab(t.path)
  }

  return (
    <div className="flex items-center border-b bg-card/80 overflow-x-auto scrollbar-dark shrink-0">
      {tabs.map(tab => (
        <ContextMenu key={tab.path}>
          <ContextMenuTrigger asChild>
        <div
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs border-r cursor-pointer group min-w-0 max-w-[180px]',
            'hover:bg-accent/50 transition-colors',
            tab.path === activeTabPath
              ? 'bg-background text-foreground border-b-2 border-b-primary'
              : 'text-muted-foreground'
          )}
          onClick={() => onSelectTab(tab.path)}
          onAuxClick={e => {
            if (e.button === 1) {
              e.preventDefault()
              onCloseTab(tab.path)
            }
          }}
        >
          <FileIcon
            name={tab.name}
            extension={tab.extension}
            type="file"
            className="h-3.5 w-3.5 shrink-0"
          />
          <span className="truncate">{tab.name}</span>
          {tab.diffMode && (
            <span title="Diff view"><GitCompareArrows className="h-3 w-3 text-primary shrink-0" /></span>
          )}
          {tab.isDirty && (
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" title="Unsaved changes" />
          )}
          <button
            className="h-4 w-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-accent transition-all shrink-0 ml-auto"
            onClick={e => {
              e.stopPropagation()
              onCloseTab(tab.path)
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-44">
            <ContextMenuItem onClick={() => onCloseTab(tab.path)}>
              <X />
              Close
            </ContextMenuItem>
            <ContextMenuItem onClick={() => closeMany(tabs.filter(t => t.path !== tab.path))}>
              <XSquare />
              Close Others
            </ContextMenuItem>
            <ContextMenuItem onClick={() => closeMany(tabs)}>
              <XCircle />
              Close All
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => navigator.clipboard.writeText(tab.path)}>
              <Copy />
              Copy Path
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  )
}
