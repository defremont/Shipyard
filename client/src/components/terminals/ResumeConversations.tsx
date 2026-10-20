import { History, RotateCcw } from 'lucide-react'
import { shortAgo } from '@/lib/activityFeed'
import type { ClaudeConversation } from '@/lib/api'

/** Open a tab running `claude --resume` on this conversation (TerminalPanel listens). */
export function resumeConversation(conversation: ClaudeConversation) {
  window.dispatchEvent(new CustomEvent('shipyard:open-terminal', {
    detail: {
      projectId: conversation.projectId,
      type: conversation.yolo ? 'claude-yolo' : 'claude',
      taskId: conversation.taskId,
      resume: { id: conversation.id, title: conversation.title },
    },
  }))
}

interface ResumeConversationsProps {
  conversations: ClaudeConversation[] | undefined
  /** Name the project on each row — set where the list spans projects */
  projectNames?: Map<string, string>
  /** Runs before the tabs open, e.g. to bring the project to the front */
  onBeforeResume?: (conversation: ClaudeConversation) => void
}

/**
 * Claude Code conversations to pick up again after a restart: the ones that
 * were on a tab when Shipyard closed, then the newest of each project. A row
 * opens a terminal with `claude --resume <id>`. Hides itself when empty.
 */
export function ResumeConversations({ conversations, projectNames, onBeforeResume }: ResumeConversationsProps) {
  if (!conversations?.length) return null

  const now = Date.now()
  const leftOpen = conversations.filter(c => c.open)

  const resume = (conversation: ClaudeConversation) => {
    onBeforeResume?.(conversation)
    resumeConversation(conversation)
  }

  return (
    <div className="w-full space-y-1 text-left">
      <div className="flex items-center gap-2 px-1">
        <h2 className="text-xs font-medium text-muted-foreground">Continue where you left off</h2>
        {leftOpen.length > 1 && (
          <button
            onClick={() => {
              onBeforeResume?.(leftOpen[0])
              leftOpen.forEach(resumeConversation)
            }}
            className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reopen {leftOpen.length} tabs
          </button>
        )}
      </div>

      <div className="rounded-lg border divide-y divide-border/50">
        {conversations.map(conversation => {
          const label = conversation.title || conversation.lastPrompt || 'Untitled conversation'
          const at = Date.parse(conversation.updatedAt)
          return (
            <button
              key={conversation.id}
              onClick={() => resume(conversation)}
              title={[
                label,
                conversation.lastPrompt && conversation.lastPrompt !== label ? `Last prompt: ${conversation.lastPrompt}` : '',
                `claude --resume ${conversation.id}`,
              ].filter(Boolean).join('\n')}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-muted/40 transition-colors first:rounded-t-lg last:rounded-b-lg"
            >
              <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {projectNames && (
                <>
                  <span className="shrink-0 max-w-[140px] truncate text-muted-foreground">
                    {projectNames.get(conversation.projectId) || conversation.projectId}
                  </span>
                  <span className="shrink-0 text-muted-foreground/30">·</span>
                </>
              )}
              <span className="truncate text-foreground">{label}</span>
              <span className="ml-auto shrink-0 flex items-center gap-2 text-muted-foreground/60">
                {conversation.open && <span>open at close</span>}
                <time dateTime={conversation.updatedAt}>{shortAgo(at, now)}</time>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
