import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { keymap, EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorSelection, type Extension } from '@codemirror/state'
import type { EditorReveal } from '@/hooks/useEditorTabs'

interface CodeMirrorEditorProps {
  value: string
  extension: string
  onChange: (value: string) => void
  onSave: () => void
  readOnly?: boolean
  /** Select this spot and scroll it to the middle (a search hit). */
  reveal?: EditorReveal
}

function getLanguageExtension(ext: string): Extension[] {
  const map: Record<string, () => Extension> = {
    '.ts': () => javascript({ typescript: true }),
    '.tsx': () => javascript({ typescript: true, jsx: true }),
    '.js': () => javascript(),
    '.jsx': () => javascript({ jsx: true }),
    '.mjs': () => javascript(),
    '.cjs': () => javascript(),
    '.json': () => json(),
    '.jsonc': () => json(),
    '.css': () => css(),
    '.scss': () => css(),
    '.sass': () => css(),
    '.less': () => css(),
    '.html': () => html(),
    '.htm': () => html(),
    '.md': () => markdown(),
    '.mdx': () => markdown(),
    '.py': () => python(),
    '.rs': () => rust(),
    '.sql': () => sql(),
    '.yaml': () => yaml(),
    '.yml': () => yaml(),
    '.xml': () => xml(),
    '.svg': () => xml(),
  }
  const factory = map[ext]
  return factory ? [factory()] : []
}

export function CodeMirrorEditor({ value, extension, onChange, onSave, readOnly, reveal }: CodeMirrorEditorProps) {
  const [wordWrap, setWordWrap] = useState(false)
  // The view is created in the library's own effect, after ours ran once.
  const [view, setView] = useState<EditorView | null>(null)
  const revealed = useRef(0)

  // Runs again when the content arrives: the tab can mount before its file.
  useEffect(() => {
    if (!view || !reveal || revealed.current === reveal.nonce) return
    const doc = view.state.doc
    if (reveal.line > doc.lines) return
    revealed.current = reveal.nonce
    const line = doc.line(Math.max(1, reveal.line))
    const from = Math.min(line.from + (reveal.column ?? 0), line.to)
    const to = Math.min(from + (reveal.length ?? 0), line.to)
    view.dispatch({
      selection: EditorSelection.range(from, to),
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    })
    view.focus()
  }, [view, reveal, value])

  const handleChange = useCallback((val: string) => {
    onChange(val)
  }, [onChange])

  const extensions = useMemo(() => {
    const lang = getLanguageExtension(extension)
    const keymaps = keymap.of([
      {
        key: 'Mod-s',
        run: () => {
          onSave()
          return true
        },
      },
      {
        key: 'Alt-z',
        run: () => {
          setWordWrap(prev => !prev)
          return true
        },
      },
    ])
    const exts: Extension[] = [...lang, keymaps]
    if (wordWrap) {
      exts.push(EditorView.lineWrapping)
    }
    return exts
  }, [extension, onSave, wordWrap])

  return (
    <CodeMirror
      onCreateEditor={setView}
      value={value}
      height="100%"
      theme={oneDark}
      extensions={extensions}
      onChange={handleChange}
      readOnly={readOnly}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLineGutter: true,
        highlightActiveLine: true,
        foldGutter: true,
        bracketMatching: true,
        closeBrackets: true,
        autocompletion: true,
        indentOnInput: true,
        syntaxHighlighting: true,
      }}
      className="h-full [&_.cm-editor]:h-full [&_.cm-scroller]:!font-mono"
      style={{ height: '100%' }}
    />
  )
}
