<p align="center">
  <img src="assets/icon.png" width="112" height="112" alt="Shipyard logo" />
</p>

<h1 align="center">Shipyard</h1>

<p align="center">
  <strong>A local-first command center for software projects.</strong><br />
  Projects, tasks, Git, terminals, files, and coding agents in one focused workspace.
</p>

<p align="center">
  <a href="https://github.com/defremont/Shipyard/releases/latest"><img src="https://img.shields.io/github/v/release/defremont/Shipyard?style=flat-square&label=release" alt="Latest release" /></a>
  <a href="https://github.com/defremont/Shipyard/releases"><img src="https://img.shields.io/github/downloads/defremont/Shipyard/total?style=flat-square&label=downloads" alt="Total downloads" /></a>
  <a href="https://github.com/defremont/Shipyard/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/defremont/Shipyard/release.yml?style=flat-square&label=build" alt="Release build" /></a>
  <a href="https://github.com/defremont/Shipyard/stargazers"><img src="https://img.shields.io/github/stars/defremont/Shipyard?style=flat-square" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0-green?style=flat-square" alt="Apache 2.0 License" /></a>
</p>

<p align="center">
  <a href="https://github.com/defremont/Shipyard/releases/latest"><strong>Download Shipyard</strong></a>
  ·
  <a href="#run-from-source">Run from source</a>
  ·
  <a href="#contributing">Contribute</a>
</p>

<p align="center">
  <img src="assets/shipyard-gif.gif" alt="Shipyard workspace showing projects, a Kanban board, Git tools, and an integrated terminal" width="100%" />
</p>

## Why Shipyard?

Development work is spread across editors, terminal windows, Git clients, task boards, and AI tools. Shipyard brings the operational layer together without trying to replace your editor.

- **Local-first** — the dashboard and API run on your machine; project and task data stays in local JSON files.
- **Portfolio view** — see every project, active task, branch, and working tree from one place.
- **Fast project switching** — keep many workspaces open; project tabs share the available width and stay visible.
- **Built for coding agents** — hand a task to Claude Code, Codex, Aider, Gemini CLI, OpenCode, Cursor CLI, or your own CLI, each in its own Git worktree if you want, then review what it changed.
- **No database required** — installation, backup, inspection, and recovery remain straightforward.
- **Cross-platform** — desktop installers for Windows, macOS, and Linux with automatic updates, plus browser-based development mode.

## Highlights

| Area | What Shipyard provides |
|---|---|
| Dashboard | Project health, Git state, detected stack, task counts, favorites, deploy status, and a 24-hour feed of what agents started, noted, and finished |
| Tasks | Milestone-scoped Kanban boards, priorities, effort points, time forecasts, subtasks, technical prompts, search, and a global task view |
| Agents | Run a task with any registered coding CLI, add a one-off instruction, optionally isolate it in a per-task Git worktree, and review its commits afterwards |
| Git | Status, diffs, history, branches, stage/unstage, commit, pull, push, and projects with many nested repositories |
| Terminals | Integrated xterm sessions, split panes, native launchers, dev servers, AI-written tab names, and an alert when an agent asks a question or finishes |
| Files | Lazy file tree, previews, editing, filename search, and content search |
| AI | Claude, OpenAI, and Gemini with automatic fallback; subscription CLIs first, API keys as a paid fallback |
| MCP | OAuth-protected server with 29 tools for projects, milestones, tasks, Git, Trello attachments, and sync |
| Sync | Milestone-scoped Google Sheets, Trello, and ClickUp integrations |
| Deploys | Read-only Railway status per service, linked automatically by GitHub repository |
| Cloud sync | Optional end-to-end encrypted sync of projects, tasks, and settings between your machines |
| Desktop | Electron app with tray, native shortcuts, automatic updates, and platform installers |

### A terminal designed for AI workflows

The integrated terminal includes WebGL rendering, output batching, safe bracketed paste, reconnect handling, split panes, and session persistence. Clipboard images can be pasted with `Ctrl+V`: Shipyard stores the image temporarily on your machine and inserts its path into the agent's prompt.

Shipyard reads each terminal's screen. When Claude Code waits for an answer, the tab shows an amber question mark; when it finishes a job, a green check. Tabs opened for a task carry its number and title, and other tabs get a short name written by AI from their output (optional).

### Minimal, scalable interface

Primary actions stay visible; secondary actions live in contextual menus. Project tabs share the available width instead of scrolling sideways, so every open project stays one click away.

## Download

Use the latest CI-built installers from the [Releases page](https://github.com/defremont/Shipyard/releases/latest).

| Platform | Installer |
|---|---|
| Windows x64 | `Shipyard-Setup-<version>.exe` |
| macOS Apple Silicon | `Shipyard-<version>-arm64.dmg` |
| macOS Intel | `Shipyard-<version>-x64.dmg` |
| Linux x64 | `Shipyard-<version>.AppImage` or `Shipyard-<version>.deb` |

Installed apps check for new releases at startup and every four hours, download them in the background, and offer a restart (macOS updates require a signed build; on Linux only the AppImage updates itself).

Release builds support Windows Authenticode signing and macOS Developer ID signing/notarization. Maintainers must configure the repository secrets described in [Release signing](#release-signing); unsigned local builds may still show the operating system's security warning.

## Run from source

### Requirements

- [Node.js](https://nodejs.org/) 20 LTS or newer
- [pnpm](https://pnpm.io/installation)
- [Git](https://git-scm.com/)

```bash
git clone https://github.com/defremont/Shipyard.git
cd Shipyard
pnpm install
pnpm dev
```

Open [http://localhost:5421](http://localhost:5421). The frontend runs on port `5421` and the Fastify API on `5420`.

Setup helpers are also available:

```bash
# Linux / macOS
chmod +x setup.sh devdash.sh
./setup.sh
./devdash.sh

# Windows
setup.cmd
devdash.cmd
```

The first-run wizard helps discover project folders and explains the main workspace controls.

### Optional integrated terminal

The browser terminal uses `node-pty`, which is installed as an optional native dependency. If it is unavailable, the rest of Shipyard continues to work and terminal actions fall back to native operating-system terminals.

## Core workflows

### Manage projects

Add existing folders or scan a parent directory. Shipyard detects Git repositories, common technologies, branches, local changes, remotes, and one-level nested repositories. Favorite important projects or jump to any workspace with `Ctrl+K`.

### Plan and execute tasks

Each project has a virtual **General** milestone and can define additional milestones. Tasks move through Inbox, In Progress, and Done while preserving cascading timestamps. The description captures the product outcome; the technical prompt captures implementation context for a developer or coding agent.

Tasks can carry an effort size (1, 2, 3, 5, or 8). Shipyard uses your own history of finished tasks to forecast how long the open ones will take, and shows the totals on each Kanban column.

### Work with Git

Inspect changes, review diffs, stage files, commit, synchronize with remotes, and browse history without leaving the workspace. Projects that hold several independent repositories get a filterable repository picker, and Shipyard remembers the last one you chose.

### Hand tasks to coding agents

**Run with AI** opens the task in a terminal with a generated prompt: project context, the task, and the MCP tools the agent should use to report progress. Before it starts you can pick the agent and add a decision that overrides the task description for that run.

- **Agents** — Claude Code, Codex CLI, Aider, Gemini CLI, OpenCode, and Cursor CLI are built in. Add your own command under **Settings**; argument templates accept `{cwd}`, `{task}`, and `{taskFile}`.
- **Worktree per task** — optional. Each task gets its own branch and Git worktree, so several agents can work on one repository at once. Worktrees of tasks done for more than seven days are removed automatically, unless they hold uncommitted changes.
- **Review** — the task's Review tab lists the commits and files changed between the moment it started and the moment it finished. Expand a commit to see its diff; **Needs changes** adds a dated note and sends the task back to In Progress.

### Use AI features

Shipyard supports Claude, OpenAI, and Gemini. You choose a preferred provider; if it fails, the next one takes over. Within each provider Shipyard uses your subscription CLI first (Claude Code, Codex, Gemini CLI) and a configured API key only as a paid fallback. You can:

- chat with project context;
- analyze tasks and generate implementation prompts;
- organize or update several tasks from plain text;
- size tasks by effort in bulk and review the suggestions before saving;
- generate commit messages from the current diff.

With a Claude subscription, a small ring in the sidebar shows how much of the five-hour usage window you have used.

AI features are optional; project, task, Git, file, and terminal management work without them.

### Connect through MCP

Shipyard includes a Model Context Protocol server with OAuth 2.1 and PKCE. Compatible agents can list projects and milestones, create, update, and bulk-edit tasks, log progress notes, inspect Git state, reorder work, read Trello comments and image attachments, and trigger configured sync providers. Connection instructions and consent controls are available under **Settings → MCP**.

### Synchronize milestones

Integrations are isolated by `(project, provider, milestone)`, so each milestone can connect to a different remote board, list, or sheet.

| Provider | Direction | Notes |
|---|---|---|
| Google Sheets | Bidirectional | Apps Script bridge, timestamp merge, automatic push and pull |
| Trello | Bidirectional | Board/list mapping, controlled card ordering, remote edit protection, retry handling |
| ClickUp | Bidirectional | List mapping with project and milestone isolation |

Trello comments and attachments are pulled into the task (read-only), so an agent can see the screenshot a client attached to the card. Credentials are configured once per provider; mappings and synchronization state remain local. Detailed setup guidance is built into Shipyard's **Help** and **Settings** pages.

### Watch deploys

Connect a Railway token under **Settings → AI & Integrations** and Shipyard links each project to the services built from the same GitHub repository. A badge answers one question — did the last build succeed? — and its popover lists what the checkout still holds: uncommitted files, commits to push, or a branch different from the one being deployed. Shipyard only reads from Railway; it never redeploys or rolls back.

### Sync between machines

**Shipyard Cloud** is an optional hosted service that keeps projects, tasks, milestones, and settings in step across your computers. It is off until you sign in under **Settings → Cloud sync**. Your password never leaves the machine: data is encrypted before upload, and the server stores only encrypted blobs. There is no password reset — if you lose it, you lose the cloud copy, while each machine keeps its data.

To move a whole setup instead, `pnpm workspace:export` packs Shipyard's data, the Git remotes to clone, bundles of repositories with no remote, and ignored `.env` files; `workspace-import.mjs`, shipped inside the bundle, restores it on the other machine.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` | Search projects, tasks, and files |
| `Ctrl+Shift+F` | Search file contents |
| `Ctrl+Backtick` | Toggle the integrated terminal |
| `?` | Show every shortcut |
| `Ctrl+N` | New task in the active project (desktop app) |
| `Ctrl+W` | Close the active editor or project tab (desktop app) |
| `Ctrl+Enter` | Save the task dialog from any field |
| `Ctrl+S` | Save the open file |
| `Ctrl+V` | Paste text or a clipboard image into the terminal |
| `Shift` + drag | Select terminal text while mouse tracking is active |

Browsers reserve `Ctrl+N` and `Ctrl+W`, so those two work only in the desktop app. On macOS, use `Cmd` for application shortcuts where applicable.

## Data and privacy

Shipyard does not require an account or a hosted database. Shipyard Cloud is opt-in and end-to-end encrypted.

In development mode, data is written under `data/`. Desktop builds store it in the operating system's application-data directory. The main files are plain JSON and can be backed up with normal filesystem tools.

```text
data/
├── projects.json
├── settings.json
├── tasks/
│   └── <projectId>.json
├── ai-config.json      # encrypted API keys
├── sync-config.json
├── deploy-config.json  # encrypted Railway token
├── cloud-sync.json     # encrypted Shipyard Cloud session
├── mcp-config.json
├── mcp-auth.json
└── server.log
```

Third-party features communicate only with the provider you configure, such as Anthropic, OpenAI, Google, Trello, ClickUp, or Railway. Review those providers' privacy policies before enabling an integration.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ React + Vite client                                         │
│ dashboard · tasks · Git · files · terminal · agents · AI   │
└──────────────────────────────┬──────────────────────────────┘
                               │ REST / SSE / WebSocket
┌──────────────────────────────▼──────────────────────────────┐
│ Fastify server                                              │
│ routes · services · MCP · PTY · sync · AI · deploy · cloud │
└───────────────┬──────────────────────────────┬──────────────┘
                │                              │
       ┌────────▼────────┐            ┌────────▼────────┐
       │ Local JSON data │            │ Local projects  │
       │ atomic + locked │            │ Git + filesystem│
       └─────────────────┘            └─────────────────┘
```

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Query |
| Backend | Fastify 5, TypeScript, Zod, simple-git |
| Terminal | xterm.js, WebSocket, optional node-pty |
| Desktop | Electron, electron-builder, electron-updater |
| Persistence | Atomic JSON stores with in-process mutation locks |
| Monorepo | pnpm workspaces |

### Repository layout

```text
client/src/       React application, components, hooks, and API client
server/src/       Fastify routes and domain services
electron/         Desktop process, preload bridge, and packaging hooks
scripts/          Workspace export/import between machines
assets/           Icons and README media
data/             Local development data (generated and gitignored)
.github/workflows Release automation for Windows, macOS, and Linux
```

## Development

```bash
pnpm dev              # frontend + backend with watch mode
pnpm build            # production client, server, and Electron build
pnpm dist:win         # Windows installer
pnpm dist:mac         # macOS DMGs
pnpm dist:linux       # Linux AppImage and deb
```

The codebase intentionally avoids a database and keeps its data stores recoverable. Before contributing architecture, route, model, or convention changes, read [`AGENTS.md`](AGENTS.md).

## Contributing

Contributions, bug reports, and focused feature proposals are welcome.

1. Fork the repository.
2. Create a branch from `main`.
3. Install dependencies with `pnpm install`.
4. Make a scoped change and update documentation when behavior changes.
5. Run `pnpm build` and test the affected workflow.
6. Open a pull request explaining the problem, solution, and validation.

UI changes should use the existing design tokens and shadcn/ui primitives. New task mutations must invalidate both project tasks and the global task query. New JSON stores must use serialized mutations and atomic writes.

## Release process

Pushing a `v*` tag starts the GitHub Actions release workflow. It builds Windows, macOS Intel/Apple Silicon, AppImage, and Debian artifacts, then creates a draft GitHub release with generated notes, installers, and the `latest*.yml` update manifests. Installed apps ignore drafts: publishing the draft is what releases the update.

### Release signing

For Windows, add `WIN_CSC_LINK` (a path/URL or base64-encoded PFX) and `WIN_CSC_KEY_PASSWORD` as GitHub Actions secrets. An OV certificate identifies the publisher but can still need time to build SmartScreen reputation; an EV certificate provides immediate reputation. Keep the certificate subject stable between releases.

For macOS, add `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY` (the base64-encoded contents of the `.p8` key), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, and `APPLE_TEAM_ID`. The certificate must be a **Developer ID Application** certificate for direct DMG distribution. The build uses Hardened Runtime, submits it to Apple for notarization, and staples the resulting ticket.

The application ID (`com.shipyard.dev`), product name, executable name, and Linux desktop filename are intentionally stable. Changing one of them is a migration and can break Windows taskbar pins, macOS preferences, Linux launcher association, or the upgrade path.

## License

Shipyard is available under the [Apache License 2.0](LICENSE).

If Shipyard improves your development workflow, consider [starring the repository](https://github.com/defremont/Shipyard) or sharing what you build with it.