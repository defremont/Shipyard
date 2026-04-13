import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import CodeMirror from '@uiw/react-codemirror'
import { html as cmHtml } from '@codemirror/lang-html'
import { EditorView } from '@codemirror/view'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import {
  DEFAULT_SECTIONS,
  renderReportHtml,
  type ReportData,
  type ReportRenderOptions,
  type ReportSections,
} from './reportTemplates'
import { downloadHtml, downloadTxt, printAsPdf, insertAiSection } from './reportExport'
import {
  FileText,
  FileDown,
  FileType2,
  Printer,
  Sparkles,
  Loader2,
  RefreshCw,
  Eye,
  Code2,
} from 'lucide-react'

interface ReportDialogProps {
  projectId: string
  projectName: string
  milestoneId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type EnhanceMode = 'summary' | 'highlights' | 'client-tone' | 'narrative'

interface EnhanceOption {
  mode: EnhanceMode
  label: string
  description: string
}

const ENHANCE_OPTIONS: EnhanceOption[] = [
  { mode: 'summary', label: 'Resumo executivo', description: 'Parágrafo introdutório com o estado do projeto' },
  { mode: 'highlights', label: 'Destaques', description: 'Pontos altos do período em bullets' },
  { mode: 'client-tone', label: 'Tom cliente', description: 'Apresentação sem jargão técnico' },
  { mode: 'narrative', label: 'Narrativa técnica', description: 'Correlaciona tarefas com commits' },
]

function todayIso(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'report'
}

export function ReportDialog({ projectId, projectName, milestoneId, open, onOpenChange }: ReportDialogProps) {
  const [step, setStep] = useState<'config' | 'editor'>('config')

  // Config state
  const [title, setTitle] = useState('')
  const [clientName, setClientName] = useState('')
  const [from, setFrom] = useState(todayIso(-30))
  const [to, setTo] = useState(todayIso(0))
  const [usePeriod, setUsePeriod] = useState(false)
  const [sections, setSections] = useState<ReportSections>(DEFAULT_SECTIONS)
  const [includeCommits, setIncludeCommits] = useState(false)
  const [includeTech, setIncludeTech] = useState(false)
  const [loading, setLoading] = useState(false)

  // Editor state
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [html, setHtmlValue] = useState('')
  const [view, setView] = useState<'preview' | 'html'>('preview')
  const [enhancing, setEnhancing] = useState<EnhanceMode | null>(null)

  // Reset when closed
  useEffect(() => {
    if (!open) {
      setStep('config')
      setReportData(null)
      setHtmlValue('')
      setEnhancing(null)
    }
  }, [open])

  const renderOptions: ReportRenderOptions = useMemo(
    () => ({
      sections,
      includeTechnicalDetails: includeTech,
      title: title.trim() || undefined,
      clientName: clientName.trim() || undefined,
    }),
    [sections, includeTech, title, clientName]
  )

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const data = (await api.getReportData(projectId, {
        milestoneId,
        from: usePeriod ? from : undefined,
        to: usePeriod ? to : undefined,
        includeCommits: sections.commits || includeCommits,
      })) as ReportData
      const rendered = renderReportHtml(data, renderOptions)
      setReportData(data)
      setHtmlValue(rendered)
      setStep('editor')
    } catch (err: any) {
      toast.error(err.message || 'Falha ao gerar relatório')
    } finally {
      setLoading(false)
    }
  }

  const handleRerender = () => {
    if (!reportData) return
    const rendered = renderReportHtml(reportData, renderOptions)
    setHtmlValue(rendered)
    toast.success('Relatório regenerado (edições manuais perdidas)')
  }

  const handleEnhance = async (mode: EnhanceMode) => {
    setEnhancing(mode)
    try {
      const result = await api.enhanceReport(projectId, {
        mode,
        milestoneId,
        from: usePeriod ? from : undefined,
        to: usePeriod ? to : undefined,
        includeCommits: sections.commits || includeCommits,
      })
      setHtmlValue(current => insertAiSection(current, result.html))
      toast.success(`Seção "${mode}" gerada`)
    } catch (err: any) {
      toast.error(err.message || 'IA indisponível')
    } finally {
      setEnhancing(null)
    }
  }

  const filename = useMemo(() => {
    const base = slugify(title || `${projectName}-report`)
    return `${base}-${todayIso(0)}`
  }, [title, projectName])

  const toggleSection = (key: keyof ReportSections) => {
    setSections(s => ({ ...s, [key]: !s[key] }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1100px] h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-6 py-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {step === 'config' ? 'Novo Relatório' : 'Editor de Relatório'}
          </DialogTitle>
        </DialogHeader>

        {step === 'config' && (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Título</label>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={`${projectName} — Relatório`}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Cliente (opcional)</label>
                <Input
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  placeholder="Nome do cliente..."
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={usePeriod} onChange={e => setUsePeriod(e.target.checked)} />
                Filtrar por período
              </label>
              {usePeriod && (
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <label className="text-xs text-muted-foreground">De</label>
                    <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="mt-1" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Até</label>
                    <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="mt-1" />
                  </div>
                </div>
              )}
            </div>

            <div>
              <label className="text-sm font-medium">Seções</label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {([
                  ['cover', 'Capa'],
                  ['summary', 'Espaço para resumo (IA)'],
                  ['metrics', 'Métricas e progresso'],
                  ['kanban', 'Kanban de tarefas'],
                  ['timeline', 'Timeline de entregas'],
                  ['commits', 'Lista de commits'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input type="checkbox" checked={sections[key]} onChange={() => toggleSection(key)} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeCommits} onChange={e => setIncludeCommits(e.target.checked)} />
                Buscar commits do git (usado pela IA mesmo se seção desativada)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeTech} onChange={e => setIncludeTech(e.target.checked)} />
                Incluir notas técnicas das tarefas (campo "prompt")
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={handleGenerate} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
                Gerar relatório
              </Button>
            </div>
          </div>
        )}

        {step === 'editor' && (
          <div className="flex-1 flex min-h-0">
            {/* Sidebar: AI actions + export */}
            <aside className="w-60 border-r flex flex-col bg-muted/20">
              <div className="px-4 py-3 border-b">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Melhorar com IA</div>
              </div>
              <div className="p-3 space-y-2">
                {ENHANCE_OPTIONS.map(opt => (
                  <Button
                    key={opt.mode}
                    variant="outline"
                    size="sm"
                    className="w-full justify-start h-auto py-2 px-3"
                    onClick={() => handleEnhance(opt.mode)}
                    disabled={enhancing !== null}
                  >
                    <div className="flex items-start gap-2 text-left w-full">
                      {enhancing === opt.mode
                        ? <Loader2 className="h-4 w-4 mt-0.5 animate-spin shrink-0" />
                        : <Sparkles className="h-4 w-4 mt-0.5 shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-xs font-medium">{opt.label}</div>
                        <div className="text-[10px] text-muted-foreground leading-tight">{opt.description}</div>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>

              <div className="px-4 py-3 border-t border-b mt-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Exportar</div>
              </div>
              <div className="p-3 space-y-2">
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => printAsPdf(html)}>
                  <Printer className="h-4 w-4 mr-2" /> PDF (imprimir)
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => downloadHtml(html, filename)}>
                  <FileDown className="h-4 w-4 mr-2" /> Baixar HTML
                </Button>
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => downloadTxt(html, filename)}>
                  <FileType2 className="h-4 w-4 mr-2" /> Baixar TXT
                </Button>
              </div>

              <div className="mt-auto p-3 border-t">
                <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={handleRerender}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Regenerar
                </Button>
                <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setStep('config')}>
                  Voltar à configuração
                </Button>
              </div>
            </aside>

            {/* Main: preview/source tabs */}
            <div className="flex-1 flex flex-col min-w-0">
              <Tabs value={view} onValueChange={v => setView(v as 'preview' | 'html')} className="flex-1 flex flex-col min-h-0">
                <div className="px-4 pt-3 pb-2 border-b flex items-center justify-between">
                  <TabsList>
                    <TabsTrigger value="preview"><Eye className="h-4 w-4 mr-1.5" />Preview</TabsTrigger>
                    <TabsTrigger value="html"><Code2 className="h-4 w-4 mr-1.5" />HTML</TabsTrigger>
                  </TabsList>
                  <div className="text-xs text-muted-foreground">
                    {reportData ? `${reportData.metrics.total} tarefas · ${reportData.metrics.completionRate}% concluído` : ''}
                  </div>
                </div>
                <TabsContent value="preview" className="flex-1 m-0 p-0 overflow-hidden bg-muted/30">
                  <iframe
                    title="report-preview"
                    srcDoc={html}
                    className="w-full h-full bg-white"
                    sandbox="allow-same-origin"
                  />
                </TabsContent>
                <TabsContent value="html" className="flex-1 m-0 p-0 overflow-auto">
                  <CodeMirror
                    value={html}
                    height="100%"
                    extensions={[cmHtml(), EditorView.lineWrapping]}
                    onChange={setHtmlValue}
                    theme="light"
                    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: false }}
                  />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
