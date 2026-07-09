import { lazy, Suspense } from 'react'

// FilePreviewDialog renders markdown, which pulls in react-markdown + plugins
// (~330kB). Three always-mounted trees reference it, so importing it eagerly
// put that bundle on the critical path. Mounting only while a file is open
// keeps it out of the initial load.
const FilePreviewDialog = lazy(() =>
  import('./FilePreviewDialog').then(m => ({ default: m.FilePreviewDialog }))
)

interface Props {
  projectId: string
  filePath: string | null
  onClose: () => void
}

export function LazyFilePreviewDialog({ projectId, filePath, onClose }: Props) {
  if (!filePath) return null
  return (
    <Suspense fallback={null}>
      <FilePreviewDialog projectId={projectId} filePath={filePath} onClose={onClose} />
    </Suspense>
  )
}
