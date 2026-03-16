import { useState } from 'react'
import { Header } from '@/components/layout/Header'
import {
  LayoutDashboard, ClipboardList, GitBranch, Terminal, Settings, FolderOpen,
  Star, ArrowUp, ArrowDown, FileEdit, Cloud, Download, Keyboard, ChevronDown,
  Layers, Search, ExternalLink, GripVertical, Copy, Plus, Trash2, RefreshCw,
  MonitorPlay, HelpCircle, Sparkles, Server, List, LayoutGrid, Wand2,
  CheckSquare, Import, Eye
} from 'lucide-react'
import { cn } from '@/lib/utils'

type SectionId = 'overview' | 'dashboard' | 'workspace' | 'tasks' | 'terminal' | 'git' | 'sync' | 'claude' | 'mcp' | 'settings' | 'shortcuts' | 'data' | 'electron'

const sections: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: 'overview', label: 'Overview', icon: <HelpCircle className="h-4 w-4" /> },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'workspace', label: 'Workspace', icon: <Layers className="h-4 w-4" /> },
  { id: 'tasks', label: 'Tasks & Kanban', icon: <ClipboardList className="h-4 w-4" /> },
  { id: 'terminal', label: 'Terminal', icon: <Terminal className="h-4 w-4" /> },
  { id: 'git', label: 'Git', icon: <GitBranch className="h-4 w-4" /> },
  { id: 'sync', label: 'Sync & Export', icon: <Cloud className="h-4 w-4" /> },
  { id: 'claude', label: 'Claude AI', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'mcp', label: 'MCP Server', icon: <Server className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard className="h-4 w-4" /> },
  { id: 'data', label: 'Data & Storage', icon: <Download className="h-4 w-4" /> },
  { id: 'electron', label: 'Desktop App', icon: <MonitorPlay className="h-4 w-4" /> },
]

export function Help() {
  const [active, setActive] = useState<SectionId>('overview')

  return (
    <>
      <Header title="Help" />
      <div className="flex-1 overflow-hidden flex">
        {/* Nav sidebar */}
        <nav className="w-52 shrink-0 border-r overflow-y-auto p-3 space-y-0.5 scrollbar-dark">
          {sections.map(s => (
            <button
              key={s.id}
              onClick={() => setActive(s.id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left',
                active === s.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              {s.icon}
              {s.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-6 2xl:p-8 scrollbar-dark">
          <div className="max-w-3xl mx-auto space-y-6">
            {active === 'overview' && <SectionOverview />}
            {active === 'dashboard' && <SectionDashboard />}
            {active === 'workspace' && <SectionWorkspace />}
            {active === 'tasks' && <SectionTasks />}
            {active === 'terminal' && <SectionTerminal />}
            {active === 'git' && <SectionGit />}
            {active === 'sync' && <SectionSync />}
            {active === 'claude' && <SectionClaude />}
            {active === 'mcp' && <SectionMcp />}
            {active === 'settings' && <SectionSettings />}
            {active === 'shortcuts' && <SectionShortcuts />}
            {active === 'data' && <SectionData />}
            {active === 'electron' && <SectionElectron />}
          </div>
        </div>
      </div>
    </>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-bold mb-3">{children}</h2>
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold mt-5 mb-2">{children}</h3>
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground leading-relaxed mb-3">{children}</p>
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-muted border rounded-md">{children}</kbd>
  )
}

function Bullet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm mb-2">
      <span className="text-primary shrink-0 mt-0.5">•</span>
      <p><strong>{title}</strong> <span className="text-muted-foreground">— {children}</span></p>
    </div>
  )
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-muted/50 border text-xs text-muted-foreground space-y-1">
      {children}
    </div>
  )
}

function ShortcutRow({ keys, description }: { keys: string; description: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{description}</span>
      <Kbd>{keys}</Kbd>
    </div>
  )
}

// ── Sections ────────────────────────────────────────────────────────

function SectionOverview() {
  return (
    <>
      <H2>Shipyard — Local Development Dashboard</H2>
      <P>
        Shipyard is a local dashboard for developers who manage multiple projects. It centralizes
        task management, git operations, terminal launchers, and project navigation in a single
        browser-based interface.
      </P>
      <P>
        It runs entirely on your machine. All data is stored as JSON files — no cloud services,
        no accounts, no tracking. It complements your editor (VS Code, etc.), it doesn't replace it.
      </P>

      <H3>Key Features</H3>
      <Bullet title="Multi-project tabs">Open several projects simultaneously and switch instantly between them.</Bullet>
      <Bullet title="Kanban & List views">Organize tasks in Inbox, In Progress, and Done with drag-and-drop or a compact list view.</Bullet>
      <Bullet title="Subtasks">Break tasks into smaller subtasks with checkboxes and progress tracking.</Bullet>
      <Bullet title="Integrated terminal">Run shells, dev servers, and Claude Code inside the dashboard.</Bullet>
      <Bullet title="Git panel">Stage, commit, push, pull, discard, and view diffs without leaving the browser.</Bullet>
      <Bullet title="Claude AI">Chat with Claude, auto-analyze tasks, bulk import, and AI-powered task resolution.</Bullet>
      <Bullet title="Global search">Search projects, tasks, and files across all projects with <Kbd>Ctrl + K</Kbd>.</Bullet>
      <Bullet title="Google Sheets sync">Bidirectional sync of tasks via Google Apps Script.</Bullet>
      <Bullet title="Export/Import">JSON and Markdown export. Full backup/restore in Settings.</Bullet>
      <Bullet title="File explorer">Browse project files, preview code and images, copy paths.</Bullet>
      <Bullet title="Desktop app">Available as an installable app via Electron (Windows, macOS, Linux).</Bullet>

      <H3>Architecture</H3>
      <InfoBox>
        <p><strong>Frontend:</strong> React + Vite + Tailwind CSS + shadcn/ui (port 5421 in dev)</p>
        <p><strong>Backend:</strong> Fastify + TypeScript (port 5420 in dev)</p>
        <p><strong>Data:</strong> JSON files in <code className="bg-muted px-1 rounded">data/</code></p>
        <p><strong>Desktop:</strong> Electron wrapper (port 5430 in production)</p>
      </InfoBox>
    </>
  )
}

function SectionDashboard() {
  return (
    <>
      <H2>Dashboard (Home)</H2>
      <P>
        The dashboard is the landing page, oriented toward action. It highlights active work
        and provides quick access to all your projects.
      </P>

      <H3>Working On</H3>
      <P>
        At the top, tasks currently in progress are grouped by project. Each task shows quick
        launch buttons (Claude, VS Code) so you can jump right into work. Click any task to
        open its project workspace.
      </P>

      <H3>Needs Attention</H3>
      <P>
        Below the active work, urgent and high-priority tasks in the inbox are highlighted.
        These are tasks that haven't been started yet but need attention.
      </P>

      <H3>Recent Projects</H3>
      <P>
        A compact list of your most recent and favorite projects appears in the sidebar column.
        Click any project to open it as a tab.
      </P>

      <H3>Search</H3>
      <P>
        The search bar at the top filters projects by name. Results update as you type and
        appear inline. You can also use <Kbd>Ctrl + K</Kbd> for global search across
        projects, tasks, and files.
      </P>

      <H3>Sorting & Filters</H3>
      <P>
        Sort by name, recent activity, or task count. Filter by category (parent folder name).
        Favorites appear first when sorting by recent.
      </P>
    </>
  )
}

function SectionWorkspace() {
  return (
    <>
      <H2>Project Workspace</H2>
      <P>
        Click any project to open it as a tab. Each workspace has three areas:
      </P>

      <H3>Main Area (left, 3/4 width)</H3>
      <Bullet title="Info bar">Project path, git branch badge, favorite star, external link.</Bullet>
      <Bullet title="Kanban board">Three columns: Inbox, In Progress, Done. Drag tasks between them.</Bullet>
      <Bullet title="List view">Toggle between Kanban and List views using the toolbar buttons.</Bullet>

      <H3>Sidebar (right, 1/4 width)</H3>
      <Bullet title="Claude context">Copy project context (path, tasks) to clipboard. "Open Claude + Copy Context" opens a terminal with context ready.</Bullet>
      <Bullet title="Quick Launch">Buttons to open Claude Code, Dev Server, Shell, VS Code, and Folder.</Bullet>
      <Bullet title="File explorer">Collapsible tree view for browsing project files (lazy-loaded). Supports preview, delete, copy path, and open in system explorer.</Bullet>
      <Bullet title="Git panel">Full git operations (details in Git section).</Bullet>

      <H3>Terminal Panel (bottom)</H3>
      <P>
        A resizable panel at the bottom with integrated terminal tabs. Toggle with <Kbd>Ctrl + `</Kbd>.
        More details in the Terminal section.
      </P>

      <H3>Multi-tab Navigation</H3>
      <P>
        The tab bar at the top shows all open projects. Home tab is always present. Click a project
        anywhere (sidebar, dashboard, task badge) to open it as a new tab. Close tabs with the X button.
        Switching between tabs is instant thanks to cached data.
      </P>

      <H3>External Links</H3>
      <P>
        Each project can have an external link (Notion, Google Sheets, Figma, etc.).
        Click the link icon in the info bar to add or edit it. Links open in the default browser.
      </P>

      <H3>File Explorer</H3>
      <P>
        The file explorer in the sidebar shows a tree view of the project's files. It loads
        lazily — only the immediate children of a folder are fetched when you expand it.
      </P>
      <Bullet title="Preview">Click a file to open a preview dialog. Supports Markdown (rendered), code (syntax highlighted), and images.</Bullet>
      <Bullet title="Copy path">Copy the relative path of any file to clipboard.</Bullet>
      <Bullet title="Open in explorer">Open the containing folder in your OS file manager.</Bullet>
      <Bullet title="Delete">Delete files or folders with confirmation dialog.</Bullet>
      <P>
        Common directories like .git, node_modules, dist, and build are automatically hidden.
        Files larger than 2MB are blocked from preview.
      </P>
    </>
  )
}

function SectionTasks() {
  return (
    <>
      <H2>Tasks & Kanban</H2>

      <H3>Kanban Board</H3>
      <P>
        Each project has a 3-column kanban board: <strong>Inbox</strong> (backlog/todo),{' '}
        <strong>In Progress</strong>, and <strong>Done</strong>. Drag tasks between columns
        to change their status. Tasks are ordered within each column — drag to reorder.
      </P>

      <H3>List View</H3>
      <P>
        Toggle between Kanban and List views using the grid/list icons in the toolbar. The list
        view shows tasks in collapsible sections (In Progress, Inbox, Done) with compact rows.
        Each row displays the status, priority, task ID, title, subtask progress, project badge,
        and age. Hover for inline actions (copy, duplicate, edit, delete).
      </P>

      <H3>Creating Tasks</H3>
      <P>
        Click the <strong>+</strong> button at the top of any column. Fill in:
      </P>
      <Bullet title="Title">Short description of the task.</Bullet>
      <Bullet title="Description">What needs to be done (user-facing, plain language).</Bullet>
      <Bullet title="Details (Prompt)">Technical details, causes, files, solutions. This is copied along with context for Claude.</Bullet>
      <Bullet title="Priority">Urgent, High, Medium, or Low. Affects visual indicators.</Bullet>
      <Bullet title="Subtasks">Add a checklist of smaller steps within the task.</Bullet>

      <H3>Quick Create Mode</H3>
      <P>
        In the task editor dialog, enable "Quick create" to keep the dialog open after saving.
        The form clears automatically so you can rapidly create multiple tasks without
        reopening the dialog each time. The preference is saved in localStorage.
      </P>

      <H3>Subtasks</H3>
      <P>
        Tasks can have nested subtasks — a simple checklist of smaller steps. Add subtasks in the
        task editor by typing in the input field and pressing Enter. Check/uncheck subtasks to track
        progress. The task card shows a progress indicator (e.g., "3/5") when subtasks exist.
      </P>

      <H3>Task Viewer</H3>
      <P>
        Click a task title to open the read-only viewer dialog. It shows the full task details
        including description, technical details, subtask checklist, and timestamps (created,
        started, completed). From here you can change status, copy as prompt, edit, or delete.
      </P>

      <H3>Task Actions</H3>
      <Bullet title="Edit">Click the edit button to open the editor dialog.</Bullet>
      <Bullet title="View">Click the task title to open the read-only viewer.</Bullet>
      <Bullet title="Copy as prompt">Copies task title, description, and prompt to clipboard for AI tools.</Bullet>
      <Bullet title="Duplicate">Create a copy of the task.</Bullet>
      <Bullet title="Delete">Remove the task permanently.</Bullet>
      <Bullet title="Toggle status">Click the status icon on the card to cycle through states.</Bullet>
      <Bullet title="AI Improve">Use the wand button to have Claude improve the task's title, description, and details.</Bullet>

      <H3>Column Actions</H3>
      <P>
        Each kanban column has a copy button in its header. This copies all tasks in the column
        as a formatted prompt for Claude with context-specific instructions (e.g., "organize and
        detail" for Inbox, "resolve them" for In Progress, "verify completion" for Done).
      </P>

      <H3>Bulk Import</H3>
      <P>
        Click the "Import" button in the task toolbar to open the bulk import dialog. Paste
        unstructured text or a list, and Claude AI will organize it into individual tasks with
        proper titles and descriptions.
      </P>

      <H3>All Tasks View</H3>
      <P>
        Navigate to <strong>All Tasks</strong> in the sidebar to see every task across all projects.
        This view supports both Kanban and List modes with the same toggle buttons.
      </P>
      <Bullet title="Search">Filter by title, description, or project name.</Bullet>
      <Bullet title="Priority filters">Toggle buttons for Urgent, High, Medium, Low (multi-select).</Bullet>
      <Bullet title="Sort options">Sort by Priority, Newest, Oldest, or Recently Updated.</Bullet>
      <Bullet title="Clear filters">Reset all filters with one click.</Bullet>

      <H3>Timestamps</H3>
      <P>
        Tasks track when they entered each stage: <code>inboxAt</code>, <code>inProgressAt</code>,{' '}
        <code>doneAt</code>. These cascade — moving to Done also fills in the earlier timestamps if missing.
        The task viewer and list view show time elapsed since each transition.
      </P>
    </>
  )
}

function SectionTerminal() {
  return (
    <>
      <H2>Integrated Terminal</H2>
      <P>
        Shipyard includes a full terminal emulator inside the browser, powered by xterm.js and node-pty.
        It supports colors, interactive programs, and all the features of a real terminal.
      </P>

      <H3>Terminal Panel</H3>
      <P>
        The terminal panel sits at the bottom of the workspace. Toggle it with <Kbd>Ctrl + `</Kbd> or
        the terminal button. Resize it by dragging the top edge. The height is saved between sessions.
      </P>

      <H3>Terminal Tabs</H3>
      <P>
        Each tab is an independent terminal session. Click <strong>+</strong> to open a new shell.
        The Quick Launch buttons create named tabs:
      </P>
      <Bullet title="Shell">Opens a shell in the project directory (PowerShell on Windows, bash/zsh on Linux/macOS).</Bullet>
      <Bullet title="Dev">Runs <code>pnpm dev</code> (or npm/yarn) in the project directory.</Bullet>
      <Bullet title="Claude">Opens Claude Code (<code>claude</code> command) in the project directory.</Bullet>
      <Bullet title="Claude YOLO">Opens Claude Code with auto-accept (<code>claude --dangerously-skip-permissions</code>).</Bullet>

      <H3>Native Terminal Fallback</H3>
      <P>
        If node-pty is not available (build tools missing), the Quick Launch buttons
        fall back to opening native OS terminals (Windows Terminal, gnome-terminal, Terminal.app).
        A "Open Native Terminal" button is also available when the integrated terminal is active.
      </P>

      <H3>Session Persistence</H3>
      <P>
        Terminal sessions stay alive when you switch between project tabs. The PTY process
        runs on the server — navigating away and back reconnects to the same session.
        Closing a tab kills the PTY process.
      </P>

      <InfoBox>
        <p><strong>Requirement:</strong> node-pty (optional dependency). Installed automatically on most systems.</p>
        <p><strong>Shell:</strong> PowerShell (Windows), $SHELL or /bin/bash (Linux/macOS)</p>
        <p><strong>Fonts:</strong> Cascadia Code, Fira Code, JetBrains Mono, Consolas (fallback)</p>
      </InfoBox>
    </>
  )
}

function SectionGit() {
  return (
    <>
      <H2>Git Panel</H2>
      <P>
        The git panel in the workspace sidebar provides a complete git workflow without
        leaving the dashboard.
      </P>

      <H3>File Changes</H3>
      <P>
        Files are grouped into three collapsible sections:
      </P>
      <Bullet title="Staged">Files ready to commit. Click to unstage. Expand to see diff.</Bullet>
      <Bullet title="Unstaged">Modified files not yet staged. Click to stage.</Bullet>
      <Bullet title="Untracked">New files. Click to stage.</Bullet>
      <P>
        Use "Stage All" and "Unstage All" buttons for bulk operations.
      </P>

      <H3>Discard Changes</H3>
      <P>
        Right-click or use the action menu on individual files to discard changes. You can also
        discard all changes in a section (staged or unstaged) at once. Untracked files can be
        deleted individually. All discard operations require confirmation.
      </P>

      <H3>Commit</H3>
      <P>
        Type a commit message and click Commit. The message input clears after a successful commit.
        Only staged files are included in the commit.
      </P>

      <H3>Push & Pull</H3>
      <P>
        Push commits to remote or pull latest changes. The panel shows ahead/behind counts
        relative to the remote tracking branch.
      </P>

      <H3>Commit Log</H3>
      <P>
        A collapsible section shows recent commits with hash, message, author, and date.
      </P>

      <H3>Sidebar Indicators</H3>
      <P>
        The navigation sidebar shows git status indicators next to each project:
      </P>
      <div className="flex flex-col gap-2 pl-4 my-3">
        <div className="flex items-center gap-2 text-sm">
          <ArrowUp className="h-3.5 w-3.5 text-orange-400" />
          <span className="text-muted-foreground">Orange — unpushed commits (ahead of remote)</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <ArrowDown className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-muted-foreground">Blue — commits to pull (behind remote)</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <FileEdit className="h-3.5 w-3.5 text-yellow-400" />
          <span className="text-muted-foreground">Yellow — uncommitted changes (staged + unstaged + untracked)</span>
        </div>
      </div>
      <P>
        Indicators refresh automatically every 15 seconds.
      </P>
    </>
  )
}

function SectionSync() {
  return (
    <>
      <H2>Sync & Export</H2>

      <H3>Google Sheets Sync</H3>
      <P>
        Sync tasks bidirectionally with a Google Sheets spreadsheet via Google Apps Script.
        No Google API keys needed — you deploy a small script to your Sheet and paste the URL.
      </P>
      <Bullet title="Setup">Open the Sheets badge on any project's kanban header. Follow the step-by-step guide to deploy the Apps Script.</Bullet>
      <Bullet title="Auto-push">Every task change is automatically pushed to the sheet (2s debounce).</Bullet>
      <Bullet title="Auto-pull">Tasks are pulled from the sheet every 30 seconds and merged silently.</Bullet>
      <Bullet title="Merge">Per-task merge by updatedAt — the most recent version wins. New tasks from both sides are preserved.</Bullet>
      <Bullet title="Manual push/pull">Buttons in the kanban header for immediate sync.</Bullet>

      <InfoBox>
        <p><strong>Config location:</strong> localStorage only — nothing saved on the server. Portable via URL.</p>
        <p><strong>Columns synced:</strong> id, title, description, priority, status, prompt, updatedAt</p>
      </InfoBox>

      <H3>JSON Export</H3>
      <P>
        Export all tasks of a project as a JSON file. Includes timestamps and metadata.
        Available from the toolbar buttons on the kanban board.
      </P>

      <H3>Markdown Export</H3>
      <P>
        Export tasks as formatted Markdown — choose between checklist, table, or detailed formats.
        Copy to clipboard or download as a file.
      </P>

      <H3>Full Backup (Settings)</H3>
      <P>
        In Settings, export/import a complete backup including projects, settings, and all tasks.
        Useful for migrating to another machine or creating snapshots.
      </P>
    </>
  )
}

function SectionSettings() {
  return (
    <>
      <H2>Settings</H2>

      <H3>Adding Projects</H3>
      <P>
        Shipyard doesn't auto-scan your filesystem. You manually select which projects to track:
      </P>
      <Bullet title="Scan a folder">Select a parent directory and Shipyard finds all projects inside it (up to 3 levels deep).</Bullet>
      <Bullet title="Add folder">Select a specific project folder directly.</Bullet>
      <P>
        Projects are detected by markers: package.json, .git, Cargo.toml, go.mod, requirements.txt, pyproject.toml, CLAUDE.md.
      </P>

      <H3>Managing Projects</H3>
      <Bullet title="Remove">Remove a project from the dashboard (doesn't delete files).</Bullet>
      <Bullet title="Rename">Edit the display name by clicking it in the project card or workspace.</Bullet>
      <Bullet title="Favorite">Star projects to pin them in the sidebar favorites section.</Bullet>

      <H3>Integrations</H3>
      <P>
        The Integrations card shows available sync providers and their status per project.
        Currently available: Google Sheets, JSON Export, Markdown Export.
      </P>

      <H3>Claude AI</H3>
      <P>
        Configure your Anthropic API key, choose a model, and set max tokens. The API key
        is encrypted and stored server-side only. See the Claude AI section for details.
      </P>

      <H3>MCP Server</H3>
      <P>
        Enable/disable the MCP server, toggle OAuth authentication, and manage connected
        clients. See the MCP Server section for details.
      </P>

      <H3>Export & Import</H3>
      <Bullet title="Export">Download a JSON backup of settings, projects, and tasks.</Bullet>
      <Bullet title="Import">Load a backup file to merge with existing data. Duplicates are skipped.</Bullet>
    </>
  )
}

function SectionShortcuts() {
  return (
    <>
      <H2>Keyboard Shortcuts</H2>

      <H3>Global</H3>
      <div className="border rounded-lg p-3">
        <ShortcutRow keys="Ctrl + K" description="Open global search (projects, tasks, files)" />
        <ShortcutRow keys="Ctrl + `" description="Toggle terminal panel" />
      </div>

      <H3>Global Search</H3>
      <div className="border rounded-lg p-3">
        <ShortcutRow keys="Tab" description="Cycle through filter tabs (All, Projects, Tasks, Files)" />
        <ShortcutRow keys="Arrow Up / Down" description="Navigate through results" />
        <ShortcutRow keys="Enter" description="Open selected result" />
        <ShortcutRow keys="Esc" description="Close search" />
      </div>

      <H3>Navigation</H3>
      <P>
        Click projects in the sidebar or dashboard to open them as tabs. Close tabs with the X button
        or by clicking the active tab's close button.
      </P>

      <H3>Task Board</H3>
      <P>
        Drag-and-drop tasks between columns. Click a task title to view details. Click the edit
        button to modify. The kanban board supports pointer-based drag with an 8px activation
        distance to prevent accidental drags.
      </P>
    </>
  )
}

function SectionData() {
  return (
    <>
      <H2>Data & Storage</H2>

      <H3>File Locations</H3>
      <InfoBox>
        <p><strong>Dev mode:</strong> <code className="bg-muted px-1 rounded">./data/</code> inside the project folder</p>
        <p><strong>Desktop app:</strong> <code className="bg-muted px-1 rounded">%APPDATA%/shipyard/data/</code> (Windows) or <code className="bg-muted px-1 rounded">~/Library/Application Support/shipyard/data/</code> (macOS)</p>
      </InfoBox>

      <H3>File Structure</H3>
      <div className="font-mono text-xs bg-muted/50 border rounded-lg p-4 space-y-1">
        <p>data/</p>
        <p className="pl-4">settings.json <span className="text-muted-foreground">— selected project paths</span></p>
        <p className="pl-4">projects.json <span className="text-muted-foreground">— cache (auto-generated)</span></p>
        <p className="pl-4">claude.json <span className="text-muted-foreground">— encrypted API key + model config</span></p>
        <p className="pl-4">.claude-key <span className="text-muted-foreground">— AES-256-GCM encryption key</span></p>
        <p className="pl-4">mcp-config.json <span className="text-muted-foreground">— MCP server config</span></p>
        <p className="pl-4">mcp-auth.json <span className="text-muted-foreground">— OAuth clients, tokens, JWT secret</span></p>
        <p className="pl-4">tasks/</p>
        <p className="pl-8">project-id.json <span className="text-muted-foreground">— tasks for each project</span></p>
      </div>

      <H3>Portability</H3>
      <P>
        Since all data is JSON files, you can:
      </P>
      <Bullet title="Sync across machines">Put the data folder in Dropbox, Google Drive, or OneDrive.</Bullet>
      <Bullet title="Version control">Track the data folder in a private git repo.</Bullet>
      <Bullet title="Backup/restore">Use the export/import feature in Settings.</Bullet>

      <H3>Privacy</H3>
      <P>
        Shipyard never sends data to external servers. The only network calls are:
      </P>
      <Bullet title="Claude AI">Only if you configure an API key. Calls go to Anthropic's API.</Bullet>
      <Bullet title="Google Sheets sync">Only if you configure it. Goes through your own Apps Script URL.</Bullet>
      <Bullet title="Git operations">Push/pull go to your configured git remotes.</Bullet>
      <P>
        Everything else runs 100% locally.
      </P>
    </>
  )
}

function SectionClaude() {
  return (
    <>
      <H2>Claude AI Integration</H2>
      <P>
        Shipyard integrates with the Anthropic Claude API to provide AI-powered features
        directly in your dashboard. This requires an Anthropic API key (pay-per-use billing).
      </P>

      <H3>Setup</H3>
      <Bullet title="Get an API Key">
        Sign up at <a href="https://console.anthropic.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.anthropic.com</a> and create an API key in Settings &gt; API Keys.
      </Bullet>
      <Bullet title="Configure in Shipyard">
        Go to Settings &gt; Claude AI and enter your key. Click "Test" to verify, then "Save".
      </Bullet>
      <Bullet title="Security">
        Your API key is encrypted with AES-256-GCM and stored server-side only. It never reaches the browser.
      </Bullet>

      <H3>Chat Panel</H3>
      <P>
        Available in the workspace sidebar. Chat with Claude about your project — it has context
        about your tasks, git status, and file structure. Responses stream in real-time via SSE.
      </P>

      <H3>AI Task Analysis</H3>
      <P>
        In the task editor, click "AI Analyze" to auto-generate the description (user-facing)
        and technical details/prompt fields based on the task title and project context.
      </P>

      <H3>AI Improve</H3>
      <P>
        The wand button on task cards sends the task to Claude for improvement. Claude enhances
        the title, description, and technical details based on the project context. Available
        in the task viewer and on task cards in both Kanban and List views.
      </P>

      <H3>AI Task Resolution</H3>
      <P>
        For tasks in progress, click the sparkles button to open Claude Code with the task context
        pre-loaded. Shipyard tracks the AI session and monitors progress. When Claude completes
        the work, the task is automatically flagged for review with a pulsing indicator.
      </P>
      <Bullet title="Session tracking">Active AI sessions show a pulsing purple indicator on the task card.</Bullet>
      <Bullet title="Auto-detection">When the task moves to "done", it's automatically marked as "needs review".</Bullet>
      <Bullet title="Requirement">Requires the integrated terminal to be available (node-pty installed).</Bullet>

      <H3>Bulk Import with AI</H3>
      <P>
        Paste unstructured text or a list into the bulk import dialog and Claude will organize
        it into properly structured tasks with titles, descriptions, and appropriate priorities.
      </P>

      <H3>Task Summarization</H3>
      <P>
        Get an AI summary of all tasks in a project — highlights priorities, blockers, and progress.
      </P>

      <H3>Models</H3>
      <P>
        Choose your preferred model in Settings. Available options:
      </P>
      <Bullet title="Claude Sonnet 4.5">Best balance of speed and quality (recommended)</Bullet>
      <Bullet title="Claude Opus 4.5">Most capable, best for complex analysis</Bullet>
      <Bullet title="Claude Haiku 4.5">Fastest, most affordable</Bullet>

      <H3>Configuration</H3>
      <InfoBox>
        <p>Settings &gt; Claude AI — configure API key, model, max tokens</p>
        <p>Data file: <code className="bg-muted px-1 rounded">data/claude.json</code> (encrypted key)</p>
        <p>Encryption key: <code className="bg-muted px-1 rounded">data/.claude-key</code></p>
      </InfoBox>
    </>
  )
}

function SectionMcp() {
  return (
    <>
      <H2>MCP Server</H2>
      <P>
        Shipyard can act as a <strong>Model Context Protocol (MCP)</strong> server, allowing
        Claude Desktop, Claude Code, or any MCP-compatible client to connect and interact with
        your projects and tasks from outside the dashboard.
      </P>

      <H3>What is MCP?</H3>
      <P>
        MCP is an open protocol by Anthropic that lets AI assistants connect to external tools
        and data sources. When enabled, Claude can directly list your projects, create/update tasks,
        view git status, and search across all tasks — all through natural language.
      </P>

      <H3>Setup</H3>
      <Bullet title="Enable">Go to Settings &gt; MCP Server and toggle "Enable MCP Server".</Bullet>
      <Bullet title="Authorization">
        By default, OAuth authorization is required. Clients must go through a consent flow.
        For local-only use, you can disable auth.
      </Bullet>

      <H3>Connect from Claude Desktop</H3>
      <P>
        Add this to your <code className="bg-muted px-1 rounded">claude_desktop_config.json</code>:
      </P>
      <InfoBox>
        <pre className="text-[11px]">{`{
  "mcpServers": {
    "shipyard": {
      "url": "http://localhost:${window.location.port || 5420}/mcp"
    }
  }
}`}</pre>
      </InfoBox>

      <H3>Connect from Claude Code</H3>
      <P>
        Run this command or add to <code className="bg-muted px-1 rounded">.claude/settings.json</code>:
      </P>
      <InfoBox>
        <p><code className="bg-muted px-1 rounded">{`claude mcp add shipyard --transport http --url http://localhost:${window.location.port || 5420}/mcp`}</code></p>
      </InfoBox>

      <H3>Available Tools</H3>
      <Bullet title="list_projects">List all projects with git info and tech stack</Bullet>
      <Bullet title="get_project">Get detailed info about a specific project</Bullet>
      <Bullet title="list_tasks / get_all_tasks">List tasks for a project or across all projects</Bullet>
      <Bullet title="create_task">Create a new task with title, description, priority, status</Bullet>
      <Bullet title="update_task">Update any task field (title, status, priority, etc.)</Bullet>
      <Bullet title="delete_task">Delete a task</Bullet>
      <Bullet title="get_git_status / get_git_log">Read-only git information</Bullet>
      <Bullet title="search_tasks">Search tasks by keyword across all projects</Bullet>

      <H3>Security</H3>
      <Bullet title="OAuth 2.1 + PKCE">Secure authorization flow with dynamic client registration</Bullet>
      <Bullet title="JWT Tokens">Access tokens expire in 1 hour, refresh tokens in 30 days</Bullet>
      <Bullet title="Localhost Only">Server binds to localhost by default</Bullet>
      <Bullet title="Read-only Git">No push/commit/stage operations exposed — git info is read-only</Bullet>
      <Bullet title="Revoke Access">Revoke any client from Settings &gt; MCP Server</Bullet>

      <H3>Configuration</H3>
      <InfoBox>
        <p>Settings &gt; MCP Server — enable/disable, auth toggle, client management</p>
        <p>Data files: <code className="bg-muted px-1 rounded">data/mcp-config.json</code>, <code className="bg-muted px-1 rounded">data/mcp-auth.json</code></p>
        <p>Protocol: MCP JSON-RPC over Streamable HTTP</p>
        <p>Endpoint: <code className="bg-muted px-1 rounded">POST /mcp</code></p>
      </InfoBox>
    </>
  )
}

function SectionElectron() {
  return (
    <>
      <H2>Desktop App (Electron)</H2>
      <P>
        Shipyard can run as a standalone desktop application. The Electron wrapper packages
        the server and client into a single installable app.
      </P>

      <H3>Installation</H3>
      <P>
        Run the installer for your platform (e.g., <code>Shipyard-Setup-1.0.0.exe</code> on Windows).
        The app installs to the default location and creates Start Menu/Desktop shortcuts.
      </P>

      <H3>How It Works</H3>
      <Bullet title="Server">The Fastify server runs as a background process inside the app.</Bullet>
      <Bullet title="Client">The frontend is served as static files by the server.</Bullet>
      <Bullet title="Data">Stored in your OS app data directory (separate from dev mode).</Bullet>
      <Bullet title="Port">Uses port 5430 in production (5420 in dev) to avoid conflicts.</Bullet>

      <H3>System Tray</H3>
      <P>
        Closing the window minimizes to the system tray. Double-click the tray icon to restore.
        Right-click for options: Show, Quit. Only one instance can run at a time.
      </P>

      <H3>Building from Source</H3>
      <InfoBox>
        <p><code className="bg-muted px-1 rounded">pnpm dist:win</code> — Build Windows installer (.exe)</p>
        <p><code className="bg-muted px-1 rounded">pnpm dist:mac</code> — Build macOS disk image (.dmg)</p>
        <p><code className="bg-muted px-1 rounded">pnpm dist:linux</code> — Build Linux packages (.AppImage, .deb)</p>
      </InfoBox>

      <H3>Dev vs Desktop</H3>
      <P>
        You can use both modes simultaneously. The dev server (port 5420) and the desktop app
        (port 5430) run independently with separate data directories. The dev version uses
        <code> ./data/</code> while the desktop app uses the OS app data folder.
      </P>
    </>
  )
}
