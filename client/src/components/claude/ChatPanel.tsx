import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useClaudeStatus, streamChat, type ChatMessage } from '@/hooks/useClaude'
import { ClaudeConfigDialog } from './ClaudeConfigDialog'
import { Bot, Send, Settings, Loader2, ChevronDown, ChevronRight, Trash2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatPanelProps {
  projectId: string
}

export function ChatPanel({ projectId }: ChatPanelProps) {
  const { data: status } = useClaudeStatus()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setIsStreaming(true)

    // Add empty assistant message to stream into
    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setMessages([...newMessages, assistantMsg])

    await streamChat(
      projectId,
      newMessages,
      (chunk) => {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + chunk }
          }
          return updated
        })
      },
      () => setIsStreaming(false),
      (error) => {
        setMessages(prev => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = { ...last, content: `Error: ${error}` }
          }
          return updated
        })
        setIsStreaming(false)
      },
    )
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const clearChat = () => {
    setMessages([])
  }

  const aiAvailable = status?.configured || status?.cliAvailable

  if (!aiAvailable) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Claude AI
          </h3>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-muted-foreground" onClick={() => setConfigOpen(true)}>
            <Settings className="h-3 w-3" />
            Setup
          </Button>
        </div>
        <ClaudeConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
        >
          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <Sparkles className="h-3.5 w-3.5" />
          Claude AI
        </button>
        <div className="flex items-center gap-1">
          <span className="text-[9px] font-medium text-muted-foreground/60">{status?.configured ? 'API' : 'CLI'}</span>
          <div className="h-1.5 w-1.5 rounded-full bg-green-500" title={status?.configured ? 'API connected' : 'CLI available'} />
          {messages.length > 0 && (
            <button onClick={clearChat} className="text-muted-foreground hover:text-foreground p-0.5" title="Clear chat">
              <Trash2 className="h-3 w-3" />
            </button>
          )}
          <button onClick={() => setConfigOpen(true)} className="text-muted-foreground hover:text-foreground p-0.5" title="Settings">
            <Settings className="h-3 w-3" />
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="border rounded-lg overflow-hidden bg-background">
          {/* Messages */}
          <div className="max-h-64 overflow-y-auto p-2 space-y-2 scrollbar-dark">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">
                Ask anything about this project...
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={cn(
                'text-xs rounded-lg px-2.5 py-1.5 max-w-[95%]',
                msg.role === 'user'
                  ? 'bg-primary/10 ml-auto text-foreground'
                  : 'bg-muted/50 text-foreground'
              )}>
                {msg.role === 'assistant' ? (
                  <div className="prose prose-xs prose-invert max-w-none [&_p]:mb-1 [&_p]:mt-0 [&_pre]:text-[10px] [&_code]:text-[10px] [&_li]:my-0">
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {msg.content || (isStreaming && i === messages.length - 1 ? '...' : '')}
                    </Markdown>
                  </div>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-2 flex gap-1.5">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Claude..."
              className="min-h-[32px] max-h-20 text-xs resize-none"
              rows={1}
              disabled={isStreaming}
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="shrink-0 h-8 w-8"
            >
              {isStreaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
      )}

      <ClaudeConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  )
}
