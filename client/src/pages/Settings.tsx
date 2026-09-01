import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FolderBrowser } from '@/components/ui/folder-browser'
import { SyncSettingsCard } from '@/components/sync/SyncSettingsCard'
import { ClaudeSettingsCard } from '@/components/claude/ClaudeSettingsCard'
import { AgentSettingsCard } from '@/components/ai/AgentSettingsCard'
import { McpSettingsCard } from '@/components/mcp/McpSettingsCard'
import { FolderPlus, Plus, FolderOpen, Check, Loader2, GitBranch, X, FolderSearch, Download, Upload, Volume2, VolumeX, Sparkles, Server, Cloud, Database } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useProjects } from '@/hooks/useProjects'
import { useAllTasks, useImportAllTasks } from '@/hooks/useTasks'
import { api } from '@/lib/api'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { isSoundEnabled, setSoundEnabled, playAiCompleteSound } from '@/lib/sounds'

interface ScannedProject {
  path: string
  name: string
  techStack: string[]
  isGitRepo: boolean
}

type ExportOption = 'settings' | 'tasks'

export function Settings() {
  const queryClient = useQueryClient()
  const { data: projects } = useProjects()
  const { data: allTasks } = useAllTasks()
  const importAllTasks = useImportAllTasks()

  const [scanBrowserOpen, setScanBrowserOpen] = useState(false)
  const [addBrowserOpen, setAddBrowserOpen] = useState(false)
  const [scannedProjects, setScannedProjects] = useState<ScannedProject[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [scannedDir, setScannedDir] = useState('')

  const [soundOn, setSoundOn] = useState(isSoundEnabled)
  const [exportOptions, setExportOptions] = useState<Set<ExportOption>>(new Set(['settings', 'tasks']))
  const [importing, setImporting] = useState(false)

  const toggleExportOption = (opt: ExportOption) => {
    setExportOptions(prev => {
      const next = new Set(prev)
      if (next.has(opt)) next.delete(opt)
      else next.add(opt)
      return next
    })
  }

  const handleExport = async () => {
    if (exportOptions.size === 0) { toast.info('Select at least one option'); return }

    const data: Record<string, any> = {
      exportedAt: new Date().toISOString(),
      source: 'shipyard',
      version: 1,
    }

    if (exportOptions.has('settings')) {
      const settings = await api.getSettings()
      data.settings = settings
      data.projects = projects || []
    }

    if (exportOptions.has('tasks')) {
      // The cross-project list omits Trello comment and attachment bodies to
      // keep the polled payload small, so a backup reads each project instead.
      const perProject = await Promise.all(
        (projects || []).map(p => api.getTasks(p.id).then(r => r.tasks).catch(() => []))
      )
      data.tasks = perProject.flat()
    }

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shipyard-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)

    const parts = []
    if (exportOptions.has('settings')) parts.push('settings')
    if (exportOptions.has('tasks')) parts.push(`${(data.tasks as unknown[]).length} tasks`)
    toast.success(`Exported: ${parts.join(', ')}`)
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      setImporting(true)
      try {
        const text = await file.text()
        const data = JSON.parse(text)
        const results: string[] = []

        // Import settings (project paths)
        if (data.settings?.selectedProjects?.length) {
          const existingSet = new Set(projects?.map(p => p.path) || [])
          const newPaths = (data.settings.selectedProjects as string[]).filter(p => !existingSet.has(p))
          if (newPaths.length > 0) {
            await api.addProjects(newPaths)
            queryClient.invalidateQueries({ queryKey: ['projects'] })
            results.push(`${newPaths.length} projects`)
          }
        }

        // Import tasks
        if (data.tasks?.length) {
          const taskList = data.tasks.filter((t: any) => t.projectId)
          if (taskList.length > 0) {
            const res = await api.importAllTasks(taskList)
            queryClient.invalidateQueries({ queryKey: ['tasks'] })
            results.push(`${res.imported} tasks`)
          }
        }

        if (results.length > 0) {
          toast.success(`Imported: ${results.join(', ')}`)
        } else {
          toast.info('No data to import found in file')
        }
      } catch {
        toast.error('Failed to read or import file')
      } finally {
        setImporting(false)
      }
    }
    input.click()
  }

  const existingPaths = new Set(projects?.map(p => p.path) || [])

  const scanMutation = useMutation({
    mutationFn: (directory: string) => api.scanDirectory(directory),
    onSuccess: (data, directory) => {
      setScannedProjects(data.projects)
      setSelectedPaths(new Set())
      setScannedDir(directory)
      if (data.projects.length === 0) {
        toast.info('No projects found in this directory')
      }
    },
    onError: (err) => toast.error(`Scan failed: ${err.message}`),
  })

  const addMutation = useMutation({
    mutationFn: (paths: string[]) => api.addProjects(paths),
    onSuccess: (data) => {
      queryClient.setQueryData(['projects'], data.projects)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setScannedProjects([])
      setSelectedPaths(new Set())
      setScannedDir('')
      toast.success('Projects added!')
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  })

  const removeMutation = useMutation({
    mutationFn: (path: string) => api.removeProject(path),
    onSuccess: (data) => {
      queryClient.setQueryData(['projects'], data.projects)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Project removed')
    },
    onError: (err) => toast.error(`Failed: ${err.message}`),
  })

  const handleScanFolder = (path: string) => {
    scanMutation.mutate(path)
  }

  const handleAddFolders = (paths: string[]) => {
    addMutation.mutate(paths)
  }

  const toggleSelect = (path: string) => {
    const next = new Set(selectedPaths)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    setSelectedPaths(next)
  }

  const selectAll = () => {
    const available = scannedProjects.filter(p => !existingPaths.has(p.path))
    setSelectedPaths(new Set(available.map(p => p.path)))
  }

  const handleAddSelected = () => {
    if (selectedPaths.size === 0) return
    addMutation.mutate(Array.from(selectedPaths))
  }

  type SectionId = 'projects' | 'preferences' | 'ai' | 'data'
  const [activeSection, setActiveSection] = useState<SectionId>('projects')

  const sections: { id: SectionId; label: string; icon: React.ReactNode }[] = [
    { id: 'projects', label: 'Projects', icon: <FolderOpen className="h-4 w-4" /> },
    { id: 'preferences', label: 'Preferences', icon: <Volume2 className="h-4 w-4" /> },
    { id: 'ai', label: 'AI & Integrations', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'data', label: 'Data', icon: <Database className="h-4 w-4" /> },
  ]

  return (
    <>
      <div className="flex-1 overflow-hidden flex">
        {/* Left nav */}
        <nav className="w-48 shrink-0 border-r overflow-y-auto p-3 space-y-0.5 scrollbar-dark">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left',
                activeSection === s.id
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-dark">
          <div className="max-w-4xl px-6 py-5 space-y-5">

          {activeSection === 'projects' && (
            <>
              <div>
                <h2 className="text-sm font-semibold">Projects</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Add, scan, and manage your project folders.</p>
              </div>

              {/* Add Projects */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Add Projects</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Button onClick={() => setScanBrowserOpen(true)} className="gap-2 flex-1" variant="outline" size="sm">
                      <FolderSearch className="h-3.5 w-3.5" />
                      Scan folder
                    </Button>
                    <Button onClick={() => setAddBrowserOpen(true)} className="gap-2 flex-1" variant="outline" size="sm">
                      <FolderPlus className="h-3.5 w-3.5" />
                      Add folder
                    </Button>
                  </div>

                  {scanMutation.isPending && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-3 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Scanning...
                    </div>
                  )}

                  {scannedProjects.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          Found {scannedProjects.length} in <code className="bg-muted px-1 py-0.5 rounded text-[10px]">{scannedDir}</code>
                        </span>
                        <div className="flex gap-1.5">
                          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={selectAll}>Select all new</Button>
                          <Button size="sm" className="h-6 text-[11px] gap-1" onClick={handleAddSelected}
                            disabled={selectedPaths.size === 0 || addMutation.isPending}>
                            <Plus className="h-3 w-3" />
                            Add {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}
                          </Button>
                        </div>
                      </div>
                      <div className="border rounded-lg divide-y max-h-64 overflow-y-auto scrollbar-dark">
                        {scannedProjects.map(p => {
                          const alreadyAdded = existingPaths.has(p.path)
                          const isSelected = selectedPaths.has(p.path)
                          return (
                            <button key={p.path}
                              className={cn('w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                                alreadyAdded ? 'opacity-50 cursor-default' : isSelected ? 'bg-primary/10' : 'hover:bg-accent/50 cursor-pointer'
                              )}
                              onClick={() => !alreadyAdded && toggleSelect(p.path)}
                              disabled={alreadyAdded}
                            >
                              <div className={cn('h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                                alreadyAdded ? 'bg-muted border-muted-foreground/30' : isSelected ? 'bg-primary border-primary' : 'border-input'
                              )}>
                                {(alreadyAdded || isSelected) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs font-medium">{p.name}</span>
                                  {p.isGitRepo && <GitBranch className="h-3 w-3 text-muted-foreground" />}
                                  {alreadyAdded && <Badge variant="secondary" className="text-[9px] px-1 py-0">added</Badge>}
                                </div>
                                <p className="text-[10px] text-muted-foreground truncate">{p.path}</p>
                              </div>
                              {p.techStack.length > 0 && (
                                <div className="flex gap-1 shrink-0">
                                  {p.techStack.slice(0, 3).map(t => (
                                    <Badge key={t} variant="outline" className="text-[9px] px-1 py-0">{t}</Badge>
                                  ))}
                                </div>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Current Projects */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">Current Projects</CardTitle>
                    <span className="text-xs text-muted-foreground">{projects?.length || 0} projects</span>
                  </div>
                </CardHeader>
                <CardContent>
                  {projects && projects.length > 0 ? (
                    <div className="border rounded-lg divide-y max-h-[28rem] overflow-y-auto scrollbar-dark">
                      {projects.map(p => (
                        <div key={p.id} className="flex items-center gap-3 px-3 py-2 group">
                          <FolderOpen className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-medium">{p.name}</span>
                            <p className="text-[10px] text-muted-foreground truncate">{p.path}</p>
                          </div>
                          {p.techStack.length > 0 && (
                            <div className="flex gap-1 shrink-0 hidden sm:flex">
                              {p.techStack.slice(0, 4).map((t: string) => (
                                <Badge key={t} variant="outline" className="text-[9px] px-1 py-0">{t}</Badge>
                              ))}
                            </div>
                          )}
                          <Button variant="ghost" size="icon"
                            className="h-6 w-6 text-muted-foreground/30 hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => removeMutation.mutate(p.path)} title="Remove">
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      No projects yet. Use the buttons above to add some.
                    </p>
                  )}
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'preferences' && (
            <>
              <div>
                <h2 className="text-sm font-semibold">Preferences</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Customize behavior and notifications.</p>
              </div>

              <Card>
                <CardContent className="pt-5">
                  <button
                    onClick={() => {
                      const next = !soundOn
                      setSoundOn(next)
                      setSoundEnabled(next)
                      if (next) playAiCompleteSound()
                    }}
                    className="flex items-center justify-between w-full px-3 py-2.5 rounded-md border hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {soundOn ? <Volume2 className="h-4 w-4 text-muted-foreground" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
                      <div className="text-left">
                        <span className="text-sm font-medium">AI completion sound</span>
                        <p className="text-xs text-muted-foreground">Play a chime when AI operations finish</p>
                      </div>
                    </div>
                    <div className={cn(
                      'w-9 h-5 rounded-full transition-colors relative',
                      soundOn ? 'bg-primary' : 'bg-muted'
                    )}>
                      <div className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
                        soundOn ? 'translate-x-4' : 'translate-x-0.5'
                      )} />
                    </div>
                  </button>
                </CardContent>
              </Card>
            </>
          )}

          {activeSection === 'ai' && (
            <>
              <div>
                <h2 className="text-sm font-semibold">AI & Integrations</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Configure Claude AI, coding agents, MCP server, and sync providers.</p>
              </div>

              <ClaudeSettingsCard />
              <AgentSettingsCard />
              <McpSettingsCard />
              <SyncSettingsCard projects={projects || []} />
            </>
          )}

          {activeSection === 'data' && (
            <>
              <div>
                <h2 className="text-sm font-semibold">Data</h2>
                <p className="text-xs text-muted-foreground mt-0.5">Export backups and import data.</p>
              </div>

              <Card>
                <CardContent className="pt-5">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Export */}
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">Export</p>
                      <div className="space-y-1.5">
                        {([
                          { key: 'settings' as ExportOption, label: 'Settings & Projects', desc: `${projects?.length || 0} projects` },
                          { key: 'tasks' as ExportOption, label: 'Tasks', desc: `${allTasks?.length || 0} tasks` },
                        ]).map(opt => (
                          <button key={opt.key} onClick={() => toggleExportOption(opt.key)}
                            className={cn(
                              'flex items-center gap-2.5 px-3 py-2 rounded-md border text-left transition-colors w-full',
                              exportOptions.has(opt.key) ? 'border-primary/50 bg-primary/5' : 'hover:bg-accent/50'
                            )}>
                            <div className={cn('h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0',
                              exportOptions.has(opt.key) ? 'bg-primary border-primary' : 'border-input'
                            )}>
                              {exportOptions.has(opt.key) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                            </div>
                            <span className="text-xs font-medium">{opt.label}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{opt.desc}</span>
                          </button>
                        ))}
                      </div>
                      <Button onClick={handleExport} disabled={exportOptions.size === 0} className="gap-2" variant="outline" size="sm">
                        <Download className="h-3.5 w-3.5" />
                        Export
                      </Button>
                    </div>

                    {/* Import */}
                    <div className="space-y-3">
                      <p className="text-xs font-medium text-muted-foreground">Import</p>
                      <p className="text-xs text-muted-foreground">
                        Upload a Shipyard backup file. Settings and tasks will be merged with existing data.
                      </p>
                      <Button onClick={handleImport} disabled={importing} className="gap-2" variant="outline" size="sm">
                        {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                        {importing ? 'Importing...' : 'Import from file'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          </div>
        </div>
      </div>

      <FolderBrowser
        open={scanBrowserOpen}
        onOpenChange={setScanBrowserOpen}
        onSelect={handleScanFolder}
        title="Select folder to scan for projects"
      />

      <FolderBrowser
        open={addBrowserOpen}
        onOpenChange={setAddBrowserOpen}
        onSelectMultiple={handleAddFolders}
        multiSelect
        title="Select project folders to add"
      />
    </>
  )
}
