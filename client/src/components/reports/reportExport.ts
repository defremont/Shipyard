export function downloadHtml(html: string, filename: string): void {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  triggerDownload(blob, filename.endsWith('.html') ? filename : `${filename}.html`)
}

export function downloadTxt(html: string, filename: string): void {
  const txt = htmlToPlainText(html)
  const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' })
  triggerDownload(blob, filename.endsWith('.txt') ? filename : `${filename}.txt`)
}

/** Opens a hidden iframe with the report HTML and triggers print dialog. User picks "Save as PDF". */
export function printAsPdf(html: string): void {
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) {
    document.body.removeChild(iframe)
    return
  }
  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => {
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
    }, 1000)
  }

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } finally {
      cleanup()
    }
  }
  // Fallback if onload doesn't fire (already loaded synchronously)
  setTimeout(() => {
    if (iframe.contentWindow) {
      try {
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
      } catch { /* ignore */ }
      cleanup()
    }
  }, 300)
}

function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  // Remove style/script
  doc.querySelectorAll('style, script').forEach(el => el.remove())

  const lines: string[] = []
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = (node.textContent || '').replace(/\s+/g, ' ').trim()
      if (t) lines[lines.length - 1] += (lines[lines.length - 1] ? ' ' : '') + t
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    const block = ['h1', 'h2', 'h3', 'h4', 'p', 'li', 'div', 'section', 'header', 'footer', 'article', 'tr', 'br'].includes(tag)
    if (block && lines[lines.length - 1]) lines.push('')
    if (tag === 'h1') lines.push('=== ')
    if (tag === 'h2') lines.push('## ')
    if (tag === 'h3') lines.push('# ')
    if (tag === 'li') lines.push('- ')
    for (const child of Array.from(el.childNodes)) walk(child)
    if (block) lines.push('')
  }
  lines.push('')
  walk(doc.body)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

