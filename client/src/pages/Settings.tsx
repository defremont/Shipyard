import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { FolderBrowser } from '@/components/ui/folder-browser'
import { SyncSettingsCard } from '@/components/sync/SyncSettingsCard'
import { ClaudeSettingsCard } from '@/components/claude/ClaudeSettingsCard'
import { McpSettingsCard } from '@/components/mcp/McpSettingsCard'
import { Search, Plus, FolderOpen, Check, Loader2, GitBranch, X, FolderSearch, Download, Upload, Volume2, VolumeX } from 'lucide-react'
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
      data.tasks = allTasks || []
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
    if (exportOptions.has('tasks')) parts.push(`${(allTasks || []).length} tasks`)
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

  return (
    <>
      <Header title="Settings" />
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 2xl:p-8 max-w-3xl mx-auto">
        <div className="space-y-6">
          {/* Add Projects */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add Projects</CardTitle>
              <CardDescription>
                Scan a folder to discover projects inside it, or add a specific project folder directly.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Button
                  onClick={() => setScanBrowserOpen(true)}
                  className="gap-2 flex-1"
                  variant="outline"
                >
                  <FolderSearch className="h-4 w-4" />
                  Scan folder for projects
                </Button>
                <Button
                  onClick={() => setAddBrowserOpen(true)}
                  className="gap-2 flex-1"
                  variant="outline"
                >
                  <Plus className="h-4 w-4" />
                  Add single project folder
                </Button>
              </div>

              {scanMutation.isPending && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning...
                </div>
              )}

              {scannedProjects.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Found {scannedProjects.length} projects in <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{scannedDir}</code>
                    </span>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAll}>
                        Select all new
                      </Button>
                      <Button
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={handleAddSelected}
                        disabled={selectedPaths.size === 0 || addMutation.isPending}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ''}
                      </Button>
                    </div>
                  </div>

                  <div className="border rounded-lg divide-y max-h-80 overflow-y-auto">
                    {scannedProjects.map(p => {
                      const alreadyAdded = existingPaths.has(p.path)
                      const isSelected = selectedPaths.has(p.path)

                      return (
                        <button
                          key={p.path}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                            alreadyAdded
                              ? 'opacity-50 cursor-default'
                              : isSelected
                                ? 'bg-primary/10'
                                : 'hover:bg-accent/50 cursor-pointer'
                          }`}
                          onClick={() => !alreadyAdded && toggleSelect(p.path)}
                          disabled={alreadyAdded}
                        >
                          <div className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                            alreadyAdded
                              ? 'bg-muted border-muted-foreground/30'
                              : isSelected
                                ? 'bg-primary border-primary'
                                : 'border-input'
                          }`}>
                            {(alreadyAdded || isSelected) && <Check className="h-3 w-3 text-primary-foreground" />}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{p.name}</span>
                              {p.isGitRepo && <GitBranch className="h-3 w-3 text-muted-foreground" />}
                              {alreadyAdded && (
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">already added</Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">{p.path}</p>
                          </div>

                          {p.techStack.length > 0 && (
                            <div className="flex gap-1 shrink-0">
                              {p.techStack.slice(0, 3).map(t => (
                                <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{t}</Badge>
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
            <CardHeader>
              <CardTitle className="text-base">Current Projects ({projects?.length || 0})</CardTitle>
              <CardDescription>
                Projects in your dashboard. Remove any you no longer need.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {projects && projects.length > 0 ? (
                <div className="border rounded-lg divide-y max-h-96 overflow-y-auto">
                  {projects.map(p => (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2.5">
                      <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{p.name}</span>
                        <p className="text-[11px] text-muted-foreground truncate">{p.path}</p>
                      </div>
                      {p.techStack.length > 0 && (
                        <div className="flex gap-1 shrink-0">
                          {p.techStack.slice(0, 3).map((t: string) => (
                            <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{t}</Badge>
                          ))}
                        </div>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => removeMutation.mutate(p.path)}
                        title="Remove"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-6">
                  No projects yet. Use the buttons above to add some.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Preferences */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preferences</CardTitle>
            </CardHeader>
            <CardContent>
              <button
                onClick={() => {
                  const next = !soundOn
                  setSoundOn(next)
                  setSoundEnabled(next)
                  if (next) playAiCompleteSound()
                }}
                className="flex items-center justify-between w-full px-3 py-2.5 rounded-lg border hover:bg-accent/50 transition-colors"
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

          {/* Claude AI */}
          <ClaudeSettingsCard />

          {/* MCP Server */}
          <McpSettingsCard />

          {/* Integrations / Sync */}
          <SyncSettingsCard projects={projects || []} />

          {/* Export / Import */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Export / Import</CardTitle>
              <CardDescription>
                Backup your data or restore from a previous export. Select what to include.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Export */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Export</p>
                <div className="flex flex-col gap-2">
                  {([
                    { key: 'settings' as ExportOption, label: 'Settings & Projects', desc: `${projects?.length || 0} projects` },
                    { key: 'tasks' as ExportOption, label: 'Tasks', desc: `${allTasks?.length || 0} tasks` },
                  ]).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => toggleExportOption(opt.key)}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-colors',
                        exportOptions.has(opt.key) ? 'border-primary/50 bg-primary/5' : 'hover:bg-accent/50'
                      )}
                    >
                      <div className={cn(
                        'h-4 w-4 rounded border flex items-center justify-center shrink-0',
                        exportOptions.has(opt.key) ? 'bg-primary border-primary' : 'border-input'
                      )}>
                        {exportOptions.has(opt.key) && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                      <div className="flex-1">
                        <span className="text-sm font-medium">{opt.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">({opt.desc})</span>
                      </div>
                    </button>
                  ))}
                </div>
                <Button
                  onClick={handleExport}
                  disabled={exportOptions.size === 0}
                  className="gap-2"
                  variant="outline"
                >
                  <Download className="h-4 w-4" />
                  Export selected
                </Button>
              </div>

              <div className="border-t" />

              {/* Import */}
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Import</p>
                <p className="text-xs text-muted-foreground">
                  Upload a Shipyard backup file. Settings and tasks will be merged with existing data.
                </p>
                <Button
                  onClick={handleImport}
                  disabled={importing}
                  className="gap-2"
                  variant="outline"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {importing ? 'Importing...' : 'Import from file'}
                </Button>
              </div>
            </CardContent>
          </Card>
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
