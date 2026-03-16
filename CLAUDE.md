# Shipyard - Local Development Dashboard

Dashboard web local (localhost) para centralizar gerenciamento de projetos, tarefas, git, terminais integrados e launchers. Complementa o VS Code, nao substitui.

## Quick Start

```bash
pnpm dev          # Inicia client (5421) + server (5420)
./shipyard.sh      # Linux: inicia server + abre browser
shipyard           # Alias bash (se configurado em ~/.bashrc)
shipyard.cmd       # Windows: batch file na raiz do projeto
```

No Ubuntu, pesquisar "Shipyard" no Activities/App Grid abre um gnome-terminal com o servidor + browser.
Atalho desktop: `~/.local/share/applications/shipyard.desktop`

### Requisitos (Ubuntu/Linux)
- Node.js >= 18 (recomendado via nvm)
- pnpm (`npm install -g pnpm`)
- git
- gnome-terminal (instalado por padrao no Ubuntu/GNOME)
- xdg-open (instalado por padrao) — para abrir pastas no file manager
- VS Code (`code`) — opcional, para o launcher "Open in VS Code"

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui |
| Backend | Fastify 5 + TypeScript (via tsx) |
| Dados | Arquivos JSON em `data/` (sem banco de dados) |
| Monorepo | pnpm workspaces (client + server) |
| Package manager | pnpm |

## Estrutura do Projeto

```
shipyard/
├── client/                        # Frontend (porta 5421)
│   ├── src/
│   │   ├── App.tsx                # Rotas: /, /tasks, /project/:id, /settings, /help, /logs
│   │   │                          # Help sections: +Claude AI, +MCP Server
│   │   ├── main.tsx               # Entry point com QueryClientProvider
│   │   ├── index.css              # Tema dark/light (CSS variables shadcn)
│   │   ├── components/
│   │   │   ├── ui/                # shadcn/ui: button, card, badge, input, textarea,
│   │   │   │                      #   dialog, select, tabs, tooltip, popover, folder-browser
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx    # Nav: All Projects, All Tasks, counters, favorites, active, git indicators
│   │   │   │   ├── Header.tsx     # Titulo + acoes do projeto (Claude, Dev, Shell, VS Code, Folder)
│   │   │   │   ├── Layout.tsx     # Sidebar + Outlet wrapper
│   │   │   │   └── CommandPalette.tsx  # Ctrl+K command palette (cmdk): search projects, tasks, quick actions
│   │   │   ├── onboarding/
│   │   │   │   └── WelcomeWizard.tsx  # First-run setup wizard (4 steps)
│   │   │   ├── projects/
│   │   │   │   ├── ProjectList.tsx    # Grid com busca, filtro por categoria, sorting
│   │   │   │   ├── ProjectCard.tsx    # Card: nome, stack, branch, git status indicators, launchers
│   │   │   │   ├── ProjectSettings.tsx
│   │   │   │   └── ExternalLinkEditor.tsx  # Inline editor para link externo (popover)
│   │   │   ├── tasks/
│   │   │   │   ├── TaskBoard.tsx      # Kanban 3 colunas com drag-and-drop (@dnd-kit)
│   │   │   │   ├── TaskItem.tsx       # Card de tarefa com prioridade, status, acoes
│   │   │   │   │   ├── TaskEditor.tsx     # Dialog criar/editar tarefa
│   │   │   │   ├── TaskSummary.tsx    # Resumo global na Dashboard (counters + listas)
│   │   │   │   ├── MilestoneSelector.tsx  # Dropdown seletor de milestone no TaskBoard header
│   │   │   │   ├── MilestoneDialog.tsx    # Dialog criar/editar milestone
│   │   │   │   └── SheetSyncPanel.tsx # Google Sheets sync: config, push, pull (localStorage)
│   │   │   ├── sync/
│   │   │   │   ├── SyncSettingsCard.tsx  # Card de integrações na pagina Settings
│   │   │   │   └── SyncPanel.tsx         # Botoes de export (JSON, Markdown) no toolbar
│   │   │   ├── editor/
│   │   │   │   ├── CodeMirrorEditor.tsx   # CodeMirror 6 wrapper com syntax highlighting
│   │   │   │   ├── EditorTabBar.tsx       # Abas de arquivos abertos com dirty indicators
│   │   │   │   └── EditorPanel.tsx        # Painel principal do editor com tabs + save
│   │   │   ├── files/
│   │   │   │   ├── FileExplorer.tsx       # Tree view na sidebar do Workspace (lazy-loading)
│   │   │   │   ├── FilePreviewDialog.tsx  # Dialog preview: markdown, code, imagens
│   │   │   │   └── FileIcon.tsx           # Icone colorido por extensao (lucide)
│   │   │   ├── git/
│   │   │   │   ├── GitPanel.tsx       # Staged/unstaged/untracked + commit + log
│   │   │   │   ├── FileChange.tsx     # Arquivo individual com diff
│   │   │   │   ├── CommitForm.tsx     # Input de mensagem + commit
│   │   │   │   └── GitLog.tsx         # Ultimos commits
│   │   │   ├── claude/
│   │   │   │   ├── ChatPanel.tsx          # Chat AI no workspace sidebar (SSE streaming)
│   │   │   │   ├── ChatMessage.tsx        # Mensagem com markdown (react-markdown)
│   │   │   │   ├── ClaudeConfigDialog.tsx # Dialog para API key + modelo + max tokens
│   │   │   │   ├── ClaudeSettingsCard.tsx # Card na pagina Settings
│   │   │   │   └── TaskAnalysisButton.tsx # Botao "AI Analyze" no TaskEditor
│   │   │   ├── mcp/
│   │   │   │   └── McpSettingsCard.tsx    # Card MCP na pagina Settings (toggle, URL, config)
│   │   │   └── terminals/
│   │   │       ├── TerminalLauncher.tsx    # Botoes: Claude, Dev, Shell (integrado ou nativo)
│   │   │       ├── IntegratedTerminal.tsx # Componente xterm.js com WebSocket
│   │   │       └── TerminalPanel.tsx      # Painel inferior resizavel com abas
│   │   ├── hooks/
│   │   │   ├── useProjects.ts     # CRUD projetos + launchers
│   │   │   ├── useTasks.ts        # CRUD tarefas + reorder (invalida cache global e por projeto)
│   │   │   ├── useGit.ts          # Git operations com 5s refetch
│   │   │   ├── useSheetSync.ts    # Google Sheets sync hooks (config em localStorage)
│   │   │   ├── useTerminal.ts     # Hook para sessoes de terminal integrado
│   │   │   ├── useClaude.ts       # Claude API hooks + SSE streaming chat
│   │   │   ├── useMcp.ts          # MCP server status/config hooks
│   │   │   ├── useMilestones.ts   # Milestone CRUD hooks + active milestone (localStorage)
│   │   │   ├── useEditorTabs.ts    # Estado de abas do editor (open/close/dirty/save)
│   │   │   ├── useFiles.ts        # File tree, content, delete, open-folder, save hooks
│   │   │   └── useLogs.ts         # System logs hooks (fetch, stats, clear)
│   │   ├── lib/
│   │   │   ├── api.ts             # Fetch wrapper para todas as rotas do backend
│   │   │   ├── sheetsAdapter.ts   # Converte Task[] <-> formato Google Sheets
│   │   │   ├── sync/              # Sistema de sync com provider pattern
│   │   │   │   ├── types.ts       # Interfaces: SyncProvider, ProviderConfig, etc.
│   │   │   │   ├── configStore.ts # localStorage config (com backward compat Sheets)
│   │   │   │   ├── registry.ts    # Registro de providers
│   │   │   │   ├── autoSync.ts    # Auto-sync debounced por projeto
│   │   │   │   ├── index.ts       # Re-exports
│   │   │   │   └── providers/     # Implementacoes por provider
│   │   │   │       ├── index.ts       # Registra todos os providers
│   │   │   │       ├── googleSheets.ts
│   │   │   │       ├── jsonExport.ts
│   │   │   │       └── markdownExport.ts
│   │   │   └── utils.ts           # cn() do shadcn
│   │   └── pages/
│   │       ├── Dashboard.tsx      # TaskSummary + ProjectList
│   │       ├── Workspace.tsx      # TaskBoard (kanban) + TerminalLauncher + GitPanel
│   │       ├── TasksPage.tsx      # Kanban global: todas tarefas de todos projetos
│   │       ├── Settings.tsx       # Scan/add/remove projetos com folder browser
│   │       ├── Help.tsx           # Manual completo do sistema com navegacao lateral
│   │       └── LogsPage.tsx       # System logs viewer com filtros por level/category
│   ├── vite.config.ts             # Proxy /api -> localhost:5420, alias @
│   └── tailwind.config.ts         # Tema shadcn com CSS variables
│
├── server/                        # Backend (porta 5420)
│   ├── src/
│   │   ├── index.ts               # Fastify entry: registra rotas, CORS, init
│   │   ├── routes/
│   │   │   ├── projects.ts        # GET/PATCH + POST scan/add/remove
│   │   │   ├── tasks.ts           # CRUD + GET /api/tasks/all + POST reorder
│   │   │   ├── git.ts             # status, diff, stage, unstage, commit, push, pull, log, branches
│   │   │   ├── terminals.ts       # POST launch (gnome-terminal/wt.exe/Terminal.app), folder
│   │   │   ├── settings.ts       # GET settings + POST /api/browse (filesystem navigation)
│   │   │   ├── sync.ts           # Proxy stateless para Google Sheets via Apps Script
│   │   │   ├── claude.ts         # Claude API: status, config, chat (SSE), analyze, summarize
│   │   │   ├── mcp.ts            # MCP JSON-RPC endpoint + OAuth 2.1 (register, authorize, token)
│   │   │   ├── terminalWs.ts    # WebSocket route para terminal integrado (xterm ↔ pty)
│   │   │   ├── files.ts         # File tree, content, delete, open-folder
│   │   │   └── logs.ts          # System logs: GET/DELETE /api/logs, GET /api/logs/stats
│   │   ├── services/
│   │   │   ├── projectDiscovery.ts  # Selecao manual de projetos (scan + add/remove)
│   │   │   ├── gitService.ts        # Wrapper simple-git, GIT_TERMINAL_PROMPT=0
│   │   │   ├── taskStore.ts         # CRUD JSON com timestamps de status
│   │   │   ├── terminalLauncher.ts  # Multiplataforma: gnome-terminal (Linux) / Terminal.app (macOS) / wt.exe (Windows)
│   │   │   ├── terminalService.ts   # Gerencia sessoes PTY (node-pty) para terminal integrado
│   │   │   ├── settingsStore.ts     # data/settings.json com selectedProjects[]
│   │   │   ├── claudeService.ts     # Anthropic API wrapper: encrypt key, stream chat, analyze, summarize
│   │   │   ├── claudeContextBuilder.ts # Monta system prompt com context do projeto/tasks/git
│   │   │   ├── mcpServer.ts         # MCP tool registry + handler (list_projects, create_task, etc.)
│   │   │   ├── mcpAuth.ts           # OAuth 2.1: client registration, PKCE auth codes, JWT tokens
│   │   │   └── logService.ts        # Ring buffer + JSONL file logging (info/warn/error by category)
│   │   └── types/
│   │       └── index.ts           # Project, Task, Settings, ProjectsCache, TasksFile
│   └── package.json
│
├── data/                          # Persistencia (criado automaticamente)
│   ├── projects.json              # Cache dos projetos selecionados
│   ├── settings.json              # { selectedProjects: string[] }
│   ├── claude.json                # API key encriptada + model + maxTokens
│   ├── .claude-key                # Chave AES-256-GCM para encriptar API key
│   ├── mcp-config.json            # { enabled, requireAuth }
│   ├── mcp-auth.json              # JWT secret, OAuth clients, auth codes, refresh tokens
│   ├── server.log                 # JSONL system logs (appended, ring buffer in memory)
│   └── tasks/                     # Um JSON por projeto
│       └── {projectId}.json       # { milestones?: Milestone[], tasks: Task[] }
│
├── electron/                      # Electron desktop wrapper
│   ├── main.ts                    # Main process: server spawn, window, tray
│   ├── preload.ts                 # Preload script (contextBridge)
│   └── tsconfig.json              # TS config para Electron (CJS output)
│
├── assets/                        # Icones do app
│   ├── icon.png                   # 512x512 PNG (Linux, tray)
│   ├── icon.ico                   # Multi-size ICO (Windows)
│   └── icon.icns                  # Multi-size ICNS (macOS)
│
├── electron-builder.yml           # Config de build do instalador
├── setup.sh                       # Linux/macOS: setup + optional alias/desktop shortcut
├── setup.cmd                      # Windows: setup
├── devdash.cmd                    # Windows: inicia server + abre browser
├── devdash.sh                     # Linux/macOS: inicia server + abre browser
├── README.md                      # Documentacao publica
├── LICENSE                        # MIT
├── pnpm-workspace.yaml            # packages: [client, server]
└── package.json                   # Root: scripts, Electron deps, pnpm config
```

## Modelos de Dados

```typescript
interface Project {
  id: string;               // Slug gerado do path
  name: string;             // Display name (editavel)
  path: string;             // Caminho absoluto no filesystem
  category: string;         // Pasta pai (ex: "2026", "freelas", "root")
  isGitRepo: boolean;
  gitBranch?: string;
  gitDirty?: boolean;
  gitAhead?: number;        // Commits ahead of remote (not pushed)
  gitBehind?: number;       // Commits behind remote (not pulled)
  gitStaged?: number;       // Number of staged files
  gitUnstaged?: number;     // Number of modified but unstaged files
  gitUntracked?: number;    // Number of untracked files
  lastCommitDate?: string;
  lastCommitMessage?: string;
  gitRemoteUrl?: string;
  techStack: string[];      // Detectado do package.json (ex: ["react", "vite"])
  favorite: boolean;
  lastOpenedAt?: string;
  externalLink?: string;   // URL para documento externo (Notion, Google Sheets, etc.)
}

interface Milestone {
  id: string;               // nanoid(10) or 'default' (virtual)
  projectId: string;
  name: string;
  description?: string;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
  order: number;
}

interface Task {
  id: string;               // nanoid(10)
  projectId: string;
  milestoneId?: string;     // References Milestone.id; undefined/'default' = default milestone
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'backlog' | 'todo' | 'in_progress' | 'done';
  prompt?: string;  // Detalhes tecnicos, causas, solucoes (copiado junto ao contexto)
  createdAt: string;
  updatedAt: string;
  order: number;
  inboxAt?: string;         // Timestamp quando entrou em backlog/todo
  inProgressAt?: string;    // Timestamp quando moveu para in_progress
  doneAt?: string;          // Timestamp quando moveu para done
}

interface Settings {
  selectedProjects: string[];  // Paths absolutos dos projetos adicionados
}

interface ClaudeConfig {
  apiKey: string;              // Encriptado com AES-256-GCM em data/claude.json
  model: string;               // ex: "claude-sonnet-4-5-20250929"
  maxTokens: number;           // Padrao 4096
}

interface McpConfig {
  enabled: boolean;            // data/mcp-config.json
  requireAuth: boolean;        // OAuth 2.1 required (padrao true)
}
```

## Rotas da API

### Projetos
- `GET /api/projects` - Lista projetos selecionados (com git info atualizado)
- `PATCH /api/projects/:id` - Atualiza nome/favorito/externalLink
- `POST /api/projects/refresh` - Rebuilda git info de todos
- `POST /api/projects/scan` - Escaneia diretorio para encontrar projetos
- `POST /api/projects/add` - Adiciona projetos por paths[]
- `POST /api/projects/remove` - Remove projeto por path

### Milestones
- `GET /api/projects/:id/milestones` - Lista milestones (inclui virtual "General" default)
- `POST /api/projects/:id/milestones` - Criar milestone { name, description? }
- `PUT /api/projects/:id/milestones/:milestoneId` - Atualizar { name?, description?, status? }
- `DELETE /api/projects/:id/milestones/:milestoneId` - Deletar (move tasks para "General")

### Tarefas
- `GET /api/tasks/all` - Todas as tarefas de todos os projetos
- `GET /api/projects/:id/tasks?milestone=xxx` - Tarefas de um projeto (filtro opcional por milestone)
- `POST /api/projects/:id/tasks` - Criar tarefa
- `PUT /api/projects/:id/tasks/:taskId` - Atualizar tarefa
- `DELETE /api/projects/:id/tasks/:taskId` - Deletar tarefa
- `POST /api/projects/:id/tasks/reorder` - Reordenar { taskIds: string[] }
- `POST /api/projects/:id/tasks/replace` - Substituir todas as tarefas (usado pelo sync pull)

### Google Sheets Sync (proxy stateless)
- `POST /api/sync/proxy` - Proxy para Apps Script { url, method, payload? } — valida URL Google
- `POST /api/sync/test` - Testa conexao { url } → { ok, data }

### Git
- `GET /api/projects/:id/git/status` - Status (staged, unstaged, untracked, branch, etc)
- `GET /api/projects/:id/git/diff` - Diff (opcional ?file=path)
- `POST /api/projects/:id/git/stage` - Stage { file }
- `POST /api/projects/:id/git/stage-all` - Stage all
- `POST /api/projects/:id/git/unstage` - Unstage { file }
- `POST /api/projects/:id/git/commit` - Commit { message }
- `POST /api/projects/:id/git/push` - Push
- `POST /api/projects/:id/git/pull` - Pull
- `GET /api/projects/:id/git/log` - Ultimos commits
- `GET /api/projects/:id/git/branches` - Branches
- `POST /api/projects/:id/git/discard` - Discard file changes { file, type: 'staged'|'unstaged'|'untracked' }
- `POST /api/projects/:id/git/discard-all` - Discard all changes in section { section: 'staged'|'unstaged' }

### Terminais (nativos)
- `POST /api/terminals/launch` - Abre terminal nativo { projectId, type } com titulo `[project] Type`
- `POST /api/terminals/folder` - Abre file manager { projectId }

### Terminal Integrado (WebSocket)
- `GET /api/terminal/status` - Retorna { available: boolean } (node-pty instalado?)
- `GET /api/terminal/sessions` - Lista sessoes ativas { sessions[] } (?projectId= opcional)
- `POST /api/terminal/sessions` - Cria sessao { projectId, type?, cols?, rows? } → { id, title, ... }
- `DELETE /api/terminal/sessions/:sessionId` - Mata sessao PTY
- `WS /ws/terminal/:sessionId` - WebSocket: input/output/resize/exit

### Claude AI
- `GET /api/claude/status` - Status: { configured, model, maxTokens } (nunca expoe a API key)
- `POST /api/claude/config` - Salva config { apiKey, model, maxTokens }
- `DELETE /api/claude/config` - Remove API key
- `POST /api/claude/config/test` - Testa API key { apiKey } → { ok, error? }
- `POST /api/claude/chat` - Chat streaming via SSE { projectId?, messages[], systemContext? }
- `POST /api/claude/analyze-task` - Gera description+prompt { projectId, title, taskId? }
- `POST /api/claude/summarize` - Resume tarefas { projectId } → { summary }

### MCP Server
- `GET /api/mcp/status` - Status: { enabled, requireAuth, clients[] }
- `POST /api/mcp/config` - Configura { enabled, requireAuth? }
- `DELETE /api/mcp/clients/:clientId` - Revoga acesso de um client
- `POST /mcp` - Endpoint MCP JSON-RPC (Streamable HTTP transport)
- `GET /mcp` - SSE endpoint para notificacoes server→client
- `DELETE /mcp` - Terminacao de sessao MCP

### MCP OAuth 2.1
- `GET /.well-known/oauth-authorization-server` - Metadata (RFC 8414)
- `POST /register` - Dynamic Client Registration (RFC 7591)
- `GET /authorize` - Pagina de consentimento OAuth
- `POST /authorize` - Processa aprovacao/negacao
- `POST /token` - Token exchange (authorization_code, refresh_token)

### Files
- `GET /api/projects/:id/files/tree?path=<relpath>` - Lista arquivos/pastas (depth=1, lazy)
- `GET /api/projects/:id/files/content?path=<relpath>` - Conteudo do arquivo (JSON ou raw binary)
- `PUT /api/projects/:id/files/content` - Salva conteudo do arquivo { path, content } (somente texto, max 2MB)
- `DELETE /api/projects/:id/files?path=<relpath>` - Deleta arquivo ou pasta (recursivo)
- `POST /api/projects/:id/files/open-folder` - Abre pasta no explorer do sistema { path }

### Logs
- `GET /api/logs` - Lista logs { level?, category?, projectId?, since?, limit? } → { logs[] }
- `GET /api/logs/stats` - Contadores { total, errors, warnings, byCategory }
- `DELETE /api/logs` - Limpar todos os logs

### Sistema
- `GET /api/settings` - Configuracoes
- `POST /api/browse` - Navega filesystem { path } → { directories[] }

## Funcionalidades Implementadas

### Code Editor (editor integrado)
- Editor de codigo integrado no Workspace com **CodeMirror 6** e syntax highlighting
- **Multi-tab**: abre multiplos arquivos em abas, com indicador de unsaved changes (dot azul)
- **Ctrl+S** salva o arquivo ativo via API PUT
- **Syntax highlighting** para: TypeScript, JavaScript, JSON, CSS, HTML, Markdown, Python, Rust, SQL, XML, YAML
- **Mode toggle**: botao no info bar alterna entre Kanban (Tasks) e Editor
- Arquivos abertos via menu "Edit" no contexto do FileExplorer (tres pontos)
- Somente arquivos de texto podem ser editados (binarios/imagens sao preview-only)
- Confirmacao de discard ao fechar aba com alteracoes nao salvas
- Tab state (paths) persistido em localStorage por projeto (`shipyard:editor-tabs:{projectId}`)
- Conteudo NAO persiste em localStorage — recarrega do servidor ao reabrir
- Cada aba de projeto tem seu proprio editor state independente
- Tema: One Dark do CodeMirror, alinhado com o dark theme do app
- Arquivos server: `routes/files.ts` (PUT endpoint)
- Arquivos client: `CodeMirrorEditor.tsx`, `EditorTabBar.tsx`, `EditorPanel.tsx`, `useEditorTabs.ts`

### File Explorer (browser de arquivos)
- Tree view na sidebar direita do Workspace, colapsavel (fechado por padrao)
- **Lazy loading**: carrega apenas filhos imediatos ao expandir pasta (nao recursivo)
- **Preview em Dialog**: abre arquivos em dialog full-screen (max-w-5xl, 80vh)
  - Markdown: renderizado com react-markdown + remark-gfm (mesma lib do ChatPanel)
  - Codigo/texto: monospace com numeros de linha
  - Imagens: preview inline (PNG, JPG, GIF, SVG, WebP, ICO)
  - Binarios: placeholder "cannot preview"
  - Arquivos > 2MB: bloqueados no servidor ("too large")
- **Delete**: confirmacao via AlertDialog, suporta arquivos e pastas (recursivo)
- **Open in Explorer**: abre pasta no file manager do sistema (reusa openFolder existente)
- **Copy Path**: copia caminho relativo do arquivo
- **Icones coloridos** por extensao/tipo (FileIcon component)
- **Filtro automatico**: esconde .git, node_modules, dist, build, __pycache__, .cache, etc.
- **Seguranca**: validatePath() com path.resolve + startsWith previne path traversal (403)
- Menu de contexto via Popover (tres pontos, aparece no hover)
- Max height 288px (max-h-72) com scroll interno para nao empurrar GitPanel
- Arquivos server: `routes/files.ts`
- Arquivos client: `FileExplorer.tsx`, `FilePreviewDialog.tsx`, `FileIcon.tsx`, `useFiles.ts`

### Google Sheets Sync
- Sincroniza tarefas com Google Sheets via Google Apps Script (sem API do Google)
- **Config armazenado APENAS no localStorage** (`shipyard:sync:{projectId}`) — nada salvo no servidor
- Backend e um **proxy stateless**: recebe URL no body, faz fetch ao Apps Script, retorna resultado
- Validacao de URL: so permite `https://script.google.com/macros/s/...` (previne SSRF)
- **Auto-push**: cada mutation de task dispara push com merge (debounce 2s)
- **Auto-pull**: polling a cada 30s faz merge bidirecional (silencioso)
- **Merge inteligente**: por task (via `updatedAt`), vence a versao mais recente. Tasks novas de ambos os lados sao preservadas. Nenhum dado e perdido.
- **Push manual**: botao envia merge local+sheet → planilha
- **Pull manual**: botao sobrescreve cache local com dados da planilha
- **Test connection**: testa ping ao Apps Script antes de salvar
- UI no header do TaskBoard: badge "Sheets" (verde) quando configurado, botoes Pull/Push, Settings
- Popover de setup com guia passo-a-passo + template Apps Script copiavel
- Portabilidade: qualquer pessoa instala Shipyard, cola a mesma URL, faz Pull e tem as tasks
- Arquivos: `SheetSyncPanel.tsx`, `useSheetSync.ts`, `sheetsAdapter.ts`, `server/routes/sync.ts`
- Colunas sincronizadas: id, title, description, priority, status, prompt, updatedAt
- Protecao anti-loop: `lastPushAt` guard impede pull nos 10s apos um push

### Sync Provider System (extensivel)
- Arquitetura de **provider pattern** para sync de tarefas com servicos externos
- Cada provider implementa interface `SyncProvider` (push, pull, merge, export, notify)
- Config em localStorage por projeto+provider (`shipyard:sync:{projectId}:{providerId}`)
- Backward compat: migra config legado do Google Sheets automaticamente
- `autoSync.ts`: scheduler debounced que dispara sync para todos providers habilitados
- **Providers disponiveis (Fase 1):**
  - Google Sheets (bidirecional, via Apps Script)
  - JSON Export (backup completo com timestamps)
  - Markdown Export (checklist, tabela, ou detalhado — clipboard ou download)
- **Providers planejados (Fase 2):** GitHub Issues, Webhooks (Discord/Slack/n8n)
- **Providers planejados (Fase 3):** Linear, Trello, Notion
- Card "Integrations" na pagina Settings mostra todos os providers com status
- Botoes JSON e Markdown no toolbar do TaskBoard
- Registro central em `registry.ts` — basta chamar `registerProvider()` para adicionar novo

### Terminal Integrado (browser)
- Terminal real dentro do browser usando **xterm.js** + **node-pty** + **WebSocket**
- `node-pty` e **optional dependency**: se nao instalar, launchers nativos continuam funcionando
- Deteccao dinamica no boot: server loga "Terminal integration: available/disabled"
- **Painel inferior** no Workspace, estilo VS Code, com resize por drag
- **Multiplas abas**: cada aba e uma sessao PTY independente
- Tipos de sessao: Shell, Dev (roda `pnpm dev`), Claude, Claude YOLO
- Atalho **Ctrl+`** para toggle do painel
- Botoes do Quick Launch abrem no terminal integrado (se disponivel) ou nativo (fallback)
- Botao "Open Native Terminal" aparece quando integrado esta disponivel
- Sessoes sobrevivem navegacao entre abas (PTY no server, reconecta via WebSocket)
- Altura do painel persistida em localStorage (`shipyard:terminal-height`)
- Shell default: `powershell.exe` (Windows), `$SHELL` ou `/bin/bash` (Linux/macOS)
- Tema do terminal combina com dark theme do Shipyard
- Fontes: Cascadia Code, Fira Code, JetBrains Mono, Consolas (fallback)
- Arquivos: `IntegratedTerminal.tsx`, `TerminalPanel.tsx`, `useTerminal.ts`, `terminalService.ts`, `terminalWs.ts`

### Electron Desktop App (distribuicao)
- Wrapper Electron para distribuir como app nativo instalavel
- `electron/main.ts`: processo principal, spawn do server como child process, BrowserWindow, Tray
- Server roda como child process (preserva ESM, env vars SHIPYARD_*)
- **Data path configuravel**: `SHIPYARD_DATA_DIR` env var (AppData em prod, ./data em dev)
- Centralizado em `server/src/services/dataDir.ts` — todos os services importam de la
- **Static file serving**: `@fastify/static` serve client/dist em producao
- **SPA fallback**: rotas nao-API retornam index.html
- **Tray icon**: minimiza para bandeja, double-click reabre, menu contextual
- **Single instance**: so permite uma instancia do app rodando
- **electron-builder**: NSIS (Win .exe), DMG (Mac), AppImage+deb (Linux)
- Scripts: `pnpm dist`, `dist:win`, `dist:mac`, `dist:linux`
- Dev mode Electron: `pnpm dev:electron` (Vite HMR + Electron window)
- Arquivos: `electron/main.ts`, `electron/preload.ts`, `electron-builder.yml`

### Claude AI Integration (via API Key)
- Integra Anthropic Claude API diretamente no dashboard via API key (pay-per-use)
- **API key encriptada** com AES-256-GCM no servidor (`data/claude.json`) — nunca chega ao browser
- **Chat panel** no workspace sidebar: conversa com Claude com contexto do projeto (tasks, git, files)
- Streaming de respostas via **Server-Sent Events (SSE)** — tempo real
- **AI Analyze**: botao no TaskEditor gera description + prompt automaticamente
- **Task Summarization**: resume progresso do projeto via Claude
- **Context builder**: monta system prompt com info do projeto, tasks, git status, file tree
- Modelos disponiveis: Sonnet 4.5 (padrao), Opus 4.5, Haiku 4.5
- Configuracao em Settings > Claude AI (API key, modelo, max tokens)
- Teste de conexao antes de salvar
- Arquivos server: `claudeService.ts`, `claudeContextBuilder.ts`, `routes/claude.ts`
- Arquivos client: `ChatPanel.tsx`, `ClaudeConfigDialog.tsx`, `ClaudeSettingsCard.tsx`, `TaskAnalysisButton.tsx`, `useClaude.ts`

### MCP Server (Claude acessa Shipyard de fora)
- Shipyard como **MCP server** (Model Context Protocol) via Streamable HTTP transport
- Claude Desktop, Claude Code, ou qualquer client MCP pode conectar ao Shipyard
- **OAuth 2.1 + PKCE**: autorizacao segura com registro dinamico de clients (RFC 7591)
- **JWT tokens**: access token (1h), refresh token (30 dias) com rotacao
- **Pagina de consentimento**: HTML simples servido pelo backend no `/authorize`
- **11 MCP tools**: list_projects, get_project, list_tasks, get_all_tasks, get_task, create_task, update_task, delete_task, get_git_status, get_git_log, search_tasks
- **MCP resources**: shipyard://projects, shipyard://tasks/all
- Git via MCP e **read-only** (sem push/commit/stage por seguranca)
- Configuracao em Settings > MCP Server (enable, auth toggle, revoke clients)
- Config snippets para Claude Desktop e Claude Code copiáveis na UI
- Endpoint: `POST /mcp` (JSON-RPC), `GET /mcp` (SSE), `DELETE /mcp` (session end)
- Arquivos server: `mcpServer.ts`, `mcpAuth.ts`, `routes/mcp.ts`
- Arquivos client: `McpSettingsCard.tsx`, `useMcp.ts`

### Onboarding (first-run)
- WelcomeWizard exibido na primeira visita (se nao ha projetos adicionados)
- 4 steps: Welcome → Add Projects → Features → Ready
- Step Features: apresenta Kanban, Terminal Integrado, Git Panel, Sync & Export
- Step Ready: quick reference com atalhos e dicas (Ctrl+`, Quick Launch, git indicators, Help)
- Permite scan/add projetos direto no wizard
- Skip disponivel em qualquer passo
- Controlado via localStorage (`shipyard:onboarding-complete`)
- Arquivo: `components/onboarding/WelcomeWizard.tsx`

### Help Page (/help)
- Manual completo do sistema acessivel via sidebar (icone ?) e rota /help
- Navegacao lateral com 11 secoes: Overview, Dashboard, Workspace, Tasks, Terminal, Git, Sync, Settings, Shortcuts, Data, Electron
- Cada secao documenta funcionalidades, fluxos, atalhos e detalhes tecnicos
- Inclui indicadores visuais de git (icones coloridos com explicacao)
- Secao Desktop App documenta Electron, build, tray, portas
- Secao Data & Storage explica localizacao dos arquivos, portabilidade, privacidade
- Arquivo: `pages/Help.tsx`

### System Logs (/logs)
- Pagina de visualizacao de logs do servidor acessivel via sidebar (icone ScrollText)
- **Ring buffer** de 1000 entradas em memoria + persistencia em `data/server.log` (JSONL)
- **Filtros por level**: info, warn, error (toggle buttons)
- **Filtros por category**: server, git, claude, sync, terminal, mcp, tasks, files
- **Auto-refresh** a cada 5s via react-query polling
- **Expandir detalhes**: clique em um log para ver details expandidos
- **Agrupamento por data** com headers sticky
- **Contadores** no header: total, errors, warnings
- **Limpar logs**: botao Clear remove todos os logs (in-memory + arquivo)
- Logs persistem entre restarts do servidor via arquivo JSONL
- Categorias integradas: git (commit/push/pull errors), claude (chat/analyze failures), sync (proxy errors), terminal (session failures), server (startup events)
- Arquivo server: `logService.ts`, `routes/logs.ts`
- Arquivo client: `LogsPage.tsx`, `useLogs.ts`

### Git Status Indicators
- ProjectCard exibe: ahead (unpushed), behind (to pull), staged, unstaged+untracked
- Sidebar (expanded) mostra indicadores ao lado de cada projeto
- Sidebar (collapsed) tooltips incluem git info
- Backend: `projectDiscovery.ts` detecta `gitAhead`, `gitBehind`, `gitStaged`, `gitUnstaged`, `gitUntracked`
- Todos os botoes de acao tem tooltips explicativos

### Milestones
- Organiza tarefas em fases/sprints dentro de um projeto
- Cada milestone tem seu proprio kanban board + tarefas isoladas
- **Default milestone** ("General"): virtual, nao armazenado no arquivo — tarefas sem milestoneId pertencem a ele
- Selector dropdown no header do TaskBoard para alternar entre milestones
- Criar, editar, fechar e reabrir milestones via popover e dialog
- Deletar milestone move tasks para "General"
- **Zero migration**: projetos existentes funcionam sem mudanças — tudo aparece em "General"
- Milestone ativo persistido em localStorage por projeto (`shipyard:milestone:{projectId}`)
- Dados armazenados no mesmo `{projectId}.json` em campo `milestones[]`
- `milestoneId` adicionado ao modelo Task (campo opcional)
- **MCP tools**: `list_milestones`, `list_tasks` (com filtro milestoneId), `create_task` (com milestoneId)
- Tarefas criadas via inline input ou TaskEditor herdam o milestone ativo
- Arquivos: `MilestoneSelector.tsx`, `MilestoneDialog.tsx`, `useMilestones.ts`, `taskStore.ts`

### Command Palette (Ctrl+K)
- Atalho global **Ctrl+K / Cmd+K** abre command palette (cmdk)
- **Busca projetos**: pesquisa por nome, categoria, tech stack — abre como aba
- **Busca tarefas**: pesquisa por titulo, prioridade, status, projeto — navega ao projeto
- **Quick actions**: Dashboard, All Tasks, Settings, Help
- Exibe tarefas ativas (nao-done) com icone de prioridade e nome do projeto
- Exibe projetos com branch git atual
- Footer com atalhos de teclado (setas, Enter, Esc)
- Backdrop com blur, fecha ao clicar fora ou pressionar Esc
- Maximo 20 tarefas exibidas para performance
- Arquivo: `components/layout/CommandPalette.tsx`

### Sistema de Abas (multi-projeto)
- Abrir varios projetos simultaneamente em abas
- Tab bar no topo da area principal: aba Home (fixa) + abas de projetos
- Clicar em qualquer projeto (sidebar, dashboard, cards) abre como aba
- Fechar abas com X (fecha aba ativa, muda para adjacente ou volta pro Home)
- react-query cache garante troca instantanea entre abas
- Contexto: `useTabs` hook via `TabsProvider` no Layout
- Arquivos: `hooks/useTabs.tsx`, `components/layout/TabBar.tsx`

### Dashboard (/) — Tela principal, orientada a acao
- Busca rapida de projetos no topo (autofocus)
- "Working On": tarefas in-progress agrupadas por projeto, com quick launch (Claude, VS Code)
- "Needs Attention": tarefas urgentes/high no inbox
- Coluna lateral: lista compacta dos 12 projetos mais recentes/favoritos
- Ao buscar: resultados filtrados em lista compacta inline
- Todos os links de projeto abrem como abas

### Workspace (/project/:id) — Layout 3/4 + 1/4
- **Esquerda (3/4)**: Kanban board com 3 colunas (Inbox | In Progress | Done), drag-and-drop
- **Direita (1/4 sidebar)**: Claude Context + Quick Launch + Git Panel
  - **Claude section**: "Open Claude + Copy Context" (copia contexto e abre terminal) e "Copy Tasks Context"
  - O contexto copiado inclui: project path, tasks file path, lista de tarefas atuais
  - **Quick Launch**: Claude Code, Dev Server, Shell, Open Folder
  - **Git Panel**: staged/unstaged retrateis, stage all, unstage all, commit, push, pull, log
  - Staged vem minimizado por padrao
- Sem Header duplicado — TabBar mostra nome do projeto + botao fechar
- Linha de info compacta: path do projeto + badge da branch + link externo editavel
- **External Link**: icone de link na barra de info, clicavel para abrir URL externo (Notion, Sheets, etc.)
  - Popover inline para adicionar/editar/remover o link
  - Persistido no campo `externalLink` do Project via PATCH
  - Sobrevive a refresh (preservado em `buildProject`)
- Criar/editar/deletar tarefas via dialog
- Copiar tarefa como prompt (clipboard)
- Toggle de status clicando no icone da tarefa

### Pagina de Tarefas (/tasks)
- Kanban global com todas as tarefas de todos os projetos
- Drag-and-drop entre colunas
- Badge com nome do projeto em cada tarefa
- Delete e copy-as-prompt inline

### Sidebar
- **Expanded (w-56)**: Header com logo + Refresh + Collapse, Search button (Ctrl+K), Dashboard link, All Tasks link com counter
- **Collapsible sections** com chevron toggle + localStorage persistence (`shipyard:sidebar-sections`):
  - **Favorites**: projetos favoritos com avatar, nome, git branch, git indicators, task count badge
  - **Active**: projetos com tarefas in_progress que NAO sao favoritos (evita duplicacao)
  - **Projects**: todos os demais projetos (auto-collapsed se > 8 projetos)
- Per-project **task count badges** (pending = inbox + in_progress)
- Per-project **git branch name** exibido abaixo do nome (expanded mode)
- **Collapsed (w-12)**: icones de navegacao, avatars agrupados por secao com dividers
  - Dot amarelo pulsante em projetos com tarefas in_progress
  - Dot laranja em projetos com git pendente
  - Tooltips incluem nome, task count e git info
- Footer: project count, Help, Settings, credit link

### Settings (/settings)
- Folder browser visual para navegar filesystem
- Scan de diretorio para descobrir projetos
- Multi-select para adicionar varios projetos de uma vez
- Adicionar pasta individual
- Remover projetos da lista

## Detalhes Tecnicos Importantes

### Terminais (multiplataforma)
O `terminalLauncher.ts` detecta o OS via `os.platform()` e usa comandos nativos:

| Acao | Linux (Ubuntu/GNOME) | macOS | Windows |
|------|---------------------|-------|---------|
| Abrir terminal | `gnome-terminal --title --working-directory` | `osascript` (Terminal.app) | `wt.exe --title` + `cmd.exe /k` |
| Abrir pasta | `xdg-open` | `open` | `explorer.exe` |

- Titulos dos terminais seguem o padrao `[projectName] Type` (ex: `[canoe claudio] Claude`, `[shipyard] Dev`)
- Nomes de projeto maiores que 18 chars sao truncados: `[canoe-clau...] Shell`
- No Linux, comandos executados no terminal usam `bash -c "cmd; exec bash"` para manter a aba aberta
- No macOS, usa osascript com `printf '\e]0;Title\a'` para definir titulo
- No Windows, usa `cmd.exe /k` (NAO bash, para evitar trigger do WSL)

### Cache e Invalidacao
- react-query com refetchInterval: 15s (tasks), 30s (projects), 5s (git status)
- Mutations de tarefas invalidam AMBOS: `['tasks', projectId]` e `['tasks', 'all']`
- Projeto refresh rebuilda git info de todos os projetos

### Drag-and-Drop
- @dnd-kit/core: DndContext, useDroppable, useDraggable, DragOverlay
- PointerSensor com activationConstraint distance: 8px
- Ao soltar em coluna diferente, chama updateTask com novo status
- Drop status mapping: inbox→'todo', in_progress→'in_progress', done→'done'

### Descoberta de Projetos
- NAO e auto-scan. Usuario seleciona manualmente via Settings
- `scanDirectory()` lista projetos em um diretorio (detecta package.json, .git, etc)
- `buildProject()` cria objeto Project com detecao de tech stack
- Projetos salvos em `data/settings.json` (paths) e `data/projects.json` (cache)

## Portas
- Backend Fastify (dev): **5420**
- Frontend Vite dev: **5421** (proxy /api → 5420)
- Electron produção: **5430** (evita conflito com dev server)

## Electron (Desktop App)
- Wrapper Electron para distribuir como app desktop instalavel
- Main process: `electron/main.ts` → compila para CJS em `electron/dist/main.js`
- Server roda como child process via `spawn()` com `ELECTRON_RUN_AS_NODE=1`
- Dados em produção: `%APPDATA%/shipyard/data/` (Windows), `~/Library/Application Support/shipyard/data/` (macOS)
- Dados em dev: `./data/` (como sempre)
- Tray icon: minimiza para bandeja ao fechar, double-click restaura, single instance lock
- Static files: Fastify serve `client/dist/` via `@fastify/static` em produção
- Build: `pnpm dist:win`, `pnpm dist:mac`, `pnpm dist:linux`
- afterPack hook: instala deps do server via npm (pnpm symlinks nao sobrevivem packaging)
- asar: desabilitado (server roda como Node puro, nao consegue ler de dentro do asar)
- Arquivos: `electron/main.ts`, `electron/preload.ts`, `electron/tsconfig.json`, `electron/afterPack.js`, `electron-builder.yml`

## Dependencias Principais

**Frontend**: react, react-dom, vite, @vitejs/plugin-react-swc, tailwindcss, @tanstack/react-query, react-router-dom, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, lucide-react, sonner, date-fns, cmdk, @xterm/xterm, @xterm/addon-fit, @xterm/addon-web-links, react-markdown, remark-gfm, @uiw/react-codemirror, @codemirror/lang-javascript, @codemirror/lang-css, @codemirror/lang-html, @codemirror/lang-json, @codemirror/lang-markdown, @codemirror/lang-python, @codemirror/lang-rust, @codemirror/lang-sql, @codemirror/lang-xml, @codemirror/lang-yaml, @codemirror/theme-one-dark

**Backend**: fastify, @fastify/cors, @fastify/static, @fastify/websocket, simple-git, tsx, nanoid, @anthropic-ai/sdk, jose, node-pty (optional)

**Desktop**: electron, electron-builder, cross-env (devDependencies na raiz)

**Um modulo nativo opcional**: `node-pty` (optionalDependencies) para terminal integrado. Se nao instalar, tudo funciona exceto terminal no browser.

## Padrao de Tarefas (description vs prompt)

Ao criar ou importar tarefas (via CSV, texto ou manualmente), seguir esta separacao:

- **description**: Entendimento geral da tarefa. Descreve O QUE precisa ser feito do ponto de vista do usuario/produto. Linguagem clara, sem referencias a codigo. Baseado nos documentos/requisitos fornecidos pelo cliente. Qualquer pessoa deve entender a tarefa lendo apenas este campo.
- **prompt**: Analise tecnica detalhada. Contem: detalhes do erro/bug, causas identificadas, arquivos e linhas relevantes, possiveis solucoes, checklist de implementacao. Este campo e destinado ao desenvolvedor/Claude que vai executar a tarefa.

Quando o usuario fornecer um texto ou CSV com novas tarefas:
1. Extrair a descricao original do cliente para o campo `description` (melhorar redacao mantendo a essencia)
2. Fazer analise tecnica do codebase e colocar no campo `prompt` (causas, arquivos, solucoes)
3. Se a tarefa ja estiver concluida (done), o `prompt` contem o resumo da implementacao

## Timestamps de Status (inboxAt, inProgressAt, doneAt)

Cada tarefa rastreia QUANDO entrou em cada etapa do kanban. Os timestamps sao **cascading**: etapas posteriores implicam que as anteriores ja aconteceram.

- `inboxAt`: quando entrou no inbox (backlog/todo)
- `inProgressAt`: quando moveu para in_progress
- `doneAt`: quando foi concluida

### Regras de cascata ao criar/importar tarefas:
- Status `todo`/`backlog` → define `inboxAt`
- Status `in_progress` → define `inboxAt` + `inProgressAt`
- Status `done` → define `inboxAt` + `inProgressAt` + `doneAt`

### Ao mover tarefas entre colunas:
- Preenche o timestamp da nova etapa E qualquer anterior que esteja faltando
- Ex: mover direto de inbox para done → define `inProgressAt` + `doneAt` (preserva `inboxAt` existente)

### Para IA/Claude que modifica tarefas diretamente no JSON:
- **NUNCA** remova ou resete os campos `inboxAt`, `inProgressAt`, `doneAt` ao editar tarefas
- Ao mudar status, adicione o timestamp da nova etapa sem apagar os anteriores
- Ao criar tarefas novas, defina os timestamps cascading conforme o status inicial
- Formato: ISO 8601 string (`new Date().toISOString()`)

Implementado em `taskStore.ts` via `buildCascadingTimestamps()`.

## Regras para Contribuicao

1. **SEMPRE atualize este CLAUDE.md** quando adicionar/remover funcionalidades, rotas, componentes ou mudar arquitetura
2. Mantenha a secao "Funcionalidades Implementadas" atualizada
3. Se adicionar nova rota API, documente em "Rotas da API"
4. Se criar novo componente, adicione na arvore de estrutura
5. Se mudar modelo de dados, atualize "Modelos de Dados"
6. Dados persistem em JSON - nao introduza banco de dados sem discutir
7. Terminais: Windows usa wt.exe + cmd.exe (nao bash, causa erro WSL); Linux usa gnome-terminal + bash; macOS usa osascript + Terminal.app
8. Todas mutations de tarefas devem invalidar `['tasks', 'all']` alem do cache do projeto
9. Novos hooks devem seguir o padrao de `useTasks.ts` (react-query + api wrapper)
10. Componentes UI usam shadcn/ui - rodar `npx shadcn@latest add <component>` se precisar de novo
