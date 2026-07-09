import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { getWebSocketUrl } from '@/hooks/useTerminal'
import '@xterm/xterm/css/xterm.css'

interface IntegratedTerminalProps {
  sessionId: string
  isActive: boolean
  onExit?: (sessionId: string, code: number) => void
}

const TERMINAL_THEME = {
  background: '#0a0a0f',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#0a0a0f',
  selectionBackground: '#27272a',
  selectionForeground: '#e4e4e7',
  black: '#18181b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#fafafa',
}

const MAX_RECONNECT_ATTEMPTS = 5

/**
 * Swap the default DOM renderer for the WebGL one. The DOM renderer rebuilds a
 * span per cell on every frame, which a full-screen TUI like the Claude CLI
 * repaints constantly. Falls back silently — WebGL is unavailable in some
 * remote-desktop and software-rendering setups, and the context can be lost at
 * runtime (GPU reset, driver update), in which case xterm reverts to DOM.
 */
function attachRenderer(term: Terminal): () => void {
  let addon: WebglAddon | undefined
  try {
    addon = new WebglAddon()
    addon.onContextLoss(() => addon?.dispose())
    term.loadAddon(addon)
  } catch {
    addon?.dispose()
    addon = undefined
  }
  return () => {
    try { addon?.dispose() } catch {}
  }
}

export function IntegratedTerminal({ sessionId, isActive, onExit }: IntegratedTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const disposedRef = useRef(false)
  const reconnectCountRef = useRef(0)
  // Use ref for onExit to avoid re-creating WS on every render
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit

  const connectWs = useCallback(() => {
    if (disposedRef.current || !termRef.current) return

    // Close any existing connection first
    if (wsRef.current) {
      const old = wsRef.current
      wsRef.current = null
      old.onclose = null // prevent reconnect from old close
      old.close()
    }

    const ws = new WebSocket(getWebSocketUrl(sessionId))
    wsRef.current = ws

    ws.onopen = () => {
      reconnectCountRef.current = 0
      // Send initial resize
      if (fitAddonRef.current && termRef.current) {
        const dims = fitAddonRef.current.proposeDimensions()
        if (dims) {
          ws.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
        }
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'output':
            termRef.current?.write(msg.data)
            break
          case 'exit':
            termRef.current?.write(`\r\n\x1b[90m[Process exited with code ${msg.code}]\x1b[0m\r\n`)
            onExitRef.current?.(sessionId, msg.code)
            break
          case 'error':
            termRef.current?.write(`\r\n\x1b[31m[Error: ${msg.data}]\x1b[0m\r\n`)
            break
        }
      } catch {}
    }

    ws.onclose = () => {
      if (disposedRef.current) return
      // Reconnect with limit
      if (reconnectCountRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectCountRef.current++
        const delay = Math.min(2000 * reconnectCountRef.current, 8000)
        reconnectTimerRef.current = setTimeout(() => {
          if (!disposedRef.current && termRef.current) {
            connectWs()
          }
        }, delay)
      }
    }

    ws.onerror = () => {
      // onclose will fire after this
    }
  }, [sessionId]) // no onExit dep — uses ref

  // Initialize terminal (only when sessionId changes)
  useEffect(() => {
    if (!containerRef.current) return

    disposedRef.current = false
    reconnectCountRef.current = 0

    const isWindows = navigator.platform?.startsWith('Win') || navigator.userAgent.includes('Windows')

    const term = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'Consolas', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
      allowProposedApi: true,
      // Tell xterm.js about the ConPTY backend so it can optimize escape
      // sequence handling (arrow keys, cursor movement, line wrapping)
      ...(isWindows && { windowsPty: { backend: 'conpty' as const } }),
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.open(uri, '_blank', 'noopener,noreferrer')
    })

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.open(containerRef.current)
    // Must run after open() — the renderer needs the screen element to exist.
    const disposeRenderer = attachRenderer(term)

    termRef.current = term
    fitAddonRef.current = fitAddon

    const copySelection = () => {
      const sel = term.getSelection()
      if (!sel) return false
      void navigator.clipboard.writeText(sel)
      term.clearSelection()
      return true
    }

    // term.paste() is what makes pasting into the Claude CLI work: it strips
    // the \n → \r translation the PTY would misread as repeated Enter, and
    // wraps the text in bracketed-paste markers whenever the running program
    // asked for them, so the CLI receives one paste instead of N submissions.
    const pasteFromClipboard = () => {
      navigator.clipboard.readText().then(text => {
        if (text) term.paste(text)
      }).catch(() => {})
    }

    // Fit to container
    const rafId = requestAnimationFrame(() => {
      try { fitAddon.fit() } catch {}
    })

    // Clipboard: Ctrl+C (copy if selection), Ctrl+Shift+C (always copy), Ctrl+V / Ctrl+Shift+V (paste)
    term.attachCustomKeyEventHandler((ev) => {
      // Global app shortcuts must keep working while the terminal has focus.
      // Returning false stops xterm from consuming the key; the event still
      // bubbles to the document/window listeners that implement each shortcut.
      // Ctrl+K (global search), Ctrl+Shift+F (file content search), Ctrl+` (toggle terminal)
      if (ev.ctrlKey && ev.type === 'keydown') {
        const key = ev.key.toLowerCase()
        if ((key === 'k' && !ev.shiftKey) || (key === 'f' && ev.shiftKey) || ev.key === '`') {
          return false
        }
      }
      if (ev.type !== 'keydown' || !ev.ctrlKey) return true
      const key = ev.key.toLowerCase()

      // Ctrl+C: copy if there's a selection, otherwise let terminal handle (SIGINT)
      if (!ev.shiftKey && key === 'c') {
        if (copySelection()) return false
      }
      // Ctrl+Shift+C: always copy selection
      if (ev.shiftKey && key === 'c') {
        copySelection()
        return false
      }
      // Ctrl+V / Ctrl+Shift+V: paste. We handle it ourselves rather than
      // letting the browser's native paste event through, because the native
      // path is unreliable inside Electron's focus model.
      if (key === 'v') {
        ev.preventDefault()
        pasteFromClipboard()
        return false
      }
      return true
    })

    // Right-click: copy a selection if there is one, otherwise paste — the
    // Windows Terminal / PuTTY convention. Middle-click pastes (X11 habit).
    const handleContextMenu = (ev: MouseEvent) => {
      ev.preventDefault()
      if (!copySelection()) pasteFromClipboard()
    }
    const handleMouseDown = (ev: MouseEvent) => {
      if (ev.button !== 1) return
      ev.preventDefault()
      pasteFromClipboard()
    }
    const el = containerRef.current
    el.addEventListener('contextmenu', handleContextMenu)
    el.addEventListener('mousedown', handleMouseDown)

    // Send keystrokes to server
    const dataDisposable = term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'input', data }))
      }
    })

    // Forward binary data (some TUI apps like Claude CLI use non-UTF8 mouse
    // reports and other binary escape sequences for interactive prompts)
    const binaryDisposable = term.onBinary((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'binary', data }))
      }
    })

    // Connect WebSocket
    connectWs()

    return () => {
      disposedRef.current = true
      cancelAnimationFrame(rafId)
      clearTimeout(reconnectTimerRef.current)
      el.removeEventListener('contextmenu', handleContextMenu)
      el.removeEventListener('mousedown', handleMouseDown)
      dataDisposable.dispose()
      binaryDisposable.dispose()
      if (wsRef.current) {
        const ws = wsRef.current
        wsRef.current = null
        ws.onclose = null // prevent reconnect
        ws.close()
      }
      disposeRenderer()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId, connectWs])

  // Fit on resize
  useEffect(() => {
    if (!isActive) return

    let rafId: number

    const handleResize = () => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit()
          const dims = fitAddonRef.current.proposeDimensions()
          if (dims && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'resize', cols: dims.cols, rows: dims.rows }))
          }
        } catch {}
      }
    }

    const observer = new ResizeObserver(handleResize)
    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    window.addEventListener('resize', handleResize)

    // Initial fit when tab becomes active
    rafId = requestAnimationFrame(handleResize)

    return () => {
      cancelAnimationFrame(rafId)
      observer.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [isActive])

  // Focus terminal when tab becomes active
  useEffect(() => {
    if (isActive && termRef.current) {
      termRef.current.focus()
    }
  }, [isActive])

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ padding: '4px 0 0 8px' }}
    />
  )
}
