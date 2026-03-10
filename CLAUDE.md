# DevDash - Local Development Dashboard

Dashboard web local (localhost) para centralizar gerenciamento de projetos, tarefas, git e launchers de terminal. Complementa o VS Code, nao substitui.

## Quick Start

```bash
pnpm dev          # Inicia client (5421) + server (5420)
./devdash.sh      # Linux: inicia server + abre browser
devdash           # Alias bash (se configurado em ~/.bashrc)
devdash.cmd       # Windows: batch file na raiz do projeto
```

No Ubuntu, pesquisar "DevDash" no Activities/App Grid abre um gnome-terminal com o servidor + browser.
Atalho desktop: `~/.local/share/applications/devdash.desktop`

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
vibedash/
├── client/                        # Frontend (porta 5421)
│   ├── src/
│   │   ├── App.tsx                # Rotas: /, /tasks, /project/:id, /settings
│   │   ├── main.tsx               # Entry point com QueryClientProvider
│   │   ├── index.css              # Tema dark/light (CSS variables shadcn)
│   │   ├── components/
│   │   │   ├── ui/                # shadcn/ui: button, card, badge, input, textarea,
│   │   │   │                      #   dialog, select, tabs, tooltip, folder-browser
│   │   │   ├── layout/
│   │   │   │   ├── Sidebar.tsx    # Nav: All Projects, All Tasks, counters, favorites, active, git indicators
│   │   │   │   ├── Header.tsx     # Titulo + acoes do projeto (Claude, Dev, Shell, VS Code, Folder)
│   │   │   │   └── Layout.tsx     # Sidebar + Outlet wrapper
│   │   │   ├── onboarding/
│   │   │   │   └── WelcomeWizard.tsx  # First-run setup wizard (4 steps)
│   │   │   ├── projects/
│   │   │   │   ├── ProjectList.tsx    # Grid com busca, filtro por categoria, sorting
│   │   │   │   ├── ProjectCard.tsx    # Card: nome, stack, branch, git status indicators, launchers
│   │   │   │   └── ProjectSettings.tsx
│   │   │   ├── tasks/
│   │   │   │   ├── TaskBoard.tsx      # Kanban 3 colunas com drag-and-drop (@dnd-kit)
│   │   │   │   ├── TaskItem.tsx       # Card de tarefa com prioridade, status, acoes
│   │   │   │   ├── TaskEditor.tsx     # Dialog criar/editar tarefa
│   │   │   │   └── TaskSummary.tsx    # Resumo global na Dashboard (counters + listas)
│   │   │   ├── git/
│   │   │   │   ├── GitPanel.tsx       # Staged/unstaged/untracked + commit + log
│   │   │   │   ├── FileChange.tsx     # Arquivo individual com diff
│   │   │   │   ├── CommitForm.tsx     # Input de mensagem + commit
│   │   │   │   └── GitLog.tsx         # Ultimos commits
│   │   │   └── terminals/
│   │   │       └── TerminalLauncher.tsx  # Botoes: Claude, Dev Server, Shell
│   │   ├── hooks/
│   │   │   ├── useProjects.ts     # CRUD projetos + launchers
│   │   │   ├── useTasks.ts        # CRUD tarefas + reorder (invalida cache global e por projeto)
│   │   │   └── useGit.ts          # Git operations com 5s refetch
│   │   ├── lib/
│   │   │   ├── api.ts             # Fetch wrapper para todas as rotas do backend
│   │   │   └── utils.ts           # cn() do shadcn
│   │   └── pages/
│   │       ├── Dashboard.tsx      # TaskSummary + ProjectList
│   │       ├── Workspace.tsx      # TaskBoard (kanban) + TerminalLauncher + GitPanel
│   │       ├── TasksPage.tsx      # Kanban global: todas tarefas de todos projetos
│   │       └── Settings.tsx       # Scan/add/remove projetos com folder browser
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
│   │   │   ├── terminals.ts       # POST launch (gnome-terminal/wt.exe), vscode, folder
│   │   │   └── settings.ts       # GET settings + POST /api/browse (filesystem navigation)
│   │   ├── services/
│   │   │   ├── projectDiscovery.ts  # Selecao manual de projetos (scan + add/remove)
│   │   │   ├── gitService.ts        # Wrapper simple-git, GIT_TERMINAL_PROMPT=0
│   │   │   ├── taskStore.ts         # CRUD JSON com timestamps de status
│   │   │   ├── terminalLauncher.ts  # Multiplataforma: gnome-terminal (Linux) / wt.exe (Windows)
│   │   │   └── settingsStore.ts     # data/settings.json com selectedProjects[]
│   │   └── types/
│   │       └── index.ts           # Project, Task, Settings, ProjectsCache, TasksFile
│   └── package.json
│
├── data/                          # Persistencia (criado automaticamente)
│   ├── projects.json              # Cache dos projetos selecionados
│   ├── settings.json              # { selectedProjects: string[] }
│   └── tasks/                     # Um JSON por projeto
│       └── {projectId}.json       # { tasks: Task[] }
│
├── setup.sh                       # Linux/macOS: setup + optional alias/desktop shortcut
├── setup.cmd                      # Windows: setup
├── devdash.cmd                    # Windows: inicia server + abre browser
├── devdash.sh                     # Linux/macOS: inicia server + abre browser
├── README.md                      # Documentacao publica
├── LICENSE                        # MIT
├── pnpm-workspace.yaml            # packages: [client, server]
└── package.json                   # Root: concurrently para pnpm dev
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
}

interface Task {
  id: string;               // nanoid(10)
  projectId: string;
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'backlog' | 'todo' | 'in_progress' | 'done';
  promptTemplate?: string;  // Prompt pre-pronto para copiar pro Claude
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
```

## Rotas da API

### Projetos
- `GET /api/projects` - Lista projetos selecionados (com git info atualizado)
- `PATCH /api/projects/:id` - Atualiza nome/favorito
- `POST /api/projects/refresh` - Rebuilda git info de todos
- `POST /api/projects/scan` - Escaneia diretorio para encontrar projetos
- `POST /api/projects/add` - Adiciona projetos por paths[]
- `POST /api/projects/remove` - Remove projeto por path

### Tarefas
- `GET /api/tasks/all` - Todas as tarefas de todos os projetos
- `GET /api/projects/:id/tasks` - Tarefas de um projeto
- `POST /api/projects/:id/tasks` - Criar tarefa
- `PUT /api/projects/:id/tasks/:taskId` - Atualizar tarefa
- `DELETE /api/projects/:id/tasks/:taskId` - Deletar tarefa
- `POST /api/projects/:id/tasks/reorder` - Reordenar { taskIds: string[] }

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

### Terminais
- `POST /api/terminals/launch` - Abre terminal nativo { projectId, type } (gnome-terminal no Linux, wt.exe no Windows)
- `POST /api/terminals/vscode` - Abre VS Code { projectId }
- `POST /api/terminals/folder` - Abre file manager { projectId } (xdg-open no Linux, explorer.exe no Windows)

### Sistema
- `GET /api/settings` - Configuracoes
- `POST /api/browse` - Navega filesystem { path } → { directories[] }

## Funcionalidades Implementadas

### Onboarding (first-run)
- WelcomeWizard exibido na primeira visita (se nao ha projetos adicionados)
- 4 steps: Welcome → Add Projects → Data Info → Ready
- Permite scan/add projetos direto no wizard
- Explica sobre dados locais, export/import, sync
- Skip disponivel em qualquer passo
- Controlado via localStorage (`devdash:onboarding-complete`)
- Arquivo: `components/onboarding/WelcomeWizard.tsx`

### Git Status Indicators
- ProjectCard exibe: ahead (unpushed), behind (to pull), staged, unstaged+untracked
- Sidebar (expanded) mostra indicadores ao lado de cada projeto
- Sidebar (collapsed) tooltips incluem git info
- Backend: `projectDiscovery.ts` detecta `gitAhead`, `gitBehind`, `gitStaged`, `gitUnstaged`, `gitUntracked`
- Todos os botoes de acao tem tooltips explicativos

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
  - **Quick Launch**: Claude Code, Dev Server, Shell, VS Code, Open Folder
  - **Git Panel**: staged/unstaged retrateis, stage all, unstage all, commit, push, pull, log
  - Staged vem minimizado por padrao
- Sem Header duplicado — TabBar mostra nome do projeto + botao fechar
- Linha de info compacta: path do projeto + badge da branch
- Criar/editar/deletar tarefas via dialog
- Copiar tarefa como prompt (clipboard)
- Toggle de status clicando no icone da tarefa

### Pagina de Tarefas (/tasks)
- Kanban global com todas as tarefas de todos os projetos
- Drag-and-drop entre colunas
- Badge com nome do projeto em cada tarefa
- Delete e copy-as-prompt inline

### Sidebar
- Link "All Projects" → /
- Link "All Tasks" → /tasks (com contador de pendentes)
- Counters separados: Inbox e In Progress
- Projetos ativos (com tarefas in-progress) — clique abre como aba
- Projetos favoritos — clique abre como aba
- Busca de projetos — resultados abrem como aba
- Link para Settings

### Settings (/settings)
- Folder browser visual para navegar filesystem
- Scan de diretorio para descobrir projetos
- Multi-select para adicionar varios projetos de uma vez
- Adicionar pasta individual
- Remover projetos da lista

## Detalhes Tecnicos Importantes

### Terminais (multiplataforma)
O `terminalLauncher.ts` detecta o OS via `os.platform()` e usa comandos nativos:

| Acao | Linux (Ubuntu/GNOME) | Windows |
|------|---------------------|---------|
| Abrir terminal | `gnome-terminal --working-directory` | `wt.exe` + `cmd.exe /k` |
| Abrir VS Code | `code` (via shell) | `code` (via shell) |
| Abrir pasta | `xdg-open` | `explorer.exe` |

- No Linux, comandos executados no terminal usam `bash -c "cmd; exec bash"` para manter a aba aberta
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
- Backend Fastify: **5420**
- Frontend Vite dev: **5421** (proxy /api → 5420)

## Dependencias Principais

**Frontend**: react, react-dom, vite, @vitejs/plugin-react-swc, tailwindcss, @tanstack/react-query, react-router-dom, @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities, lucide-react, sonner, date-fns, cmdk

**Backend**: fastify, @fastify/cors, simple-git, tsx, nanoid

**Zero modulos nativos** - nenhum node-pty ou binding C++.

## Padrao de Tarefas (description vs promptTemplate)

Ao criar ou importar tarefas (via CSV, texto ou manualmente), seguir esta separacao:

- **description**: Entendimento geral da tarefa. Descreve O QUE precisa ser feito do ponto de vista do usuario/produto. Linguagem clara, sem referencias a codigo. Baseado nos documentos/requisitos fornecidos pelo cliente. Qualquer pessoa deve entender a tarefa lendo apenas este campo.
- **promptTemplate**: Analise tecnica detalhada. Contem: detalhes do erro/bug, causas identificadas, arquivos e linhas relevantes, possiveis solucoes, checklist de implementacao. Este campo e destinado ao desenvolvedor/Claude que vai executar a tarefa.

Quando o usuario fornecer um texto ou CSV com novas tarefas:
1. Extrair a descricao original do cliente para o campo `description` (melhorar redacao mantendo a essencia)
2. Fazer analise tecnica do codebase e colocar no campo `promptTemplate` (causas, arquivos, solucoes)
3. Se a tarefa ja estiver concluida (done), o `promptTemplate` contem o resumo da implementacao

## Regras para Contribuicao

1. **SEMPRE atualize este CLAUDE.md** quando adicionar/remover funcionalidades, rotas, componentes ou mudar arquitetura
2. Mantenha a secao "Funcionalidades Implementadas" atualizada
3. Se adicionar nova rota API, documente em "Rotas da API"
4. Se criar novo componente, adicione na arvore de estrutura
5. Se mudar modelo de dados, atualize "Modelos de Dados"
6. Dados persistem em JSON - nao introduza banco de dados sem discutir
7. Terminais: no Windows usam cmd.exe (nao bash, causa erro WSL); no Linux usam gnome-terminal + bash
8. Todas mutations de tarefas devem invalidar `['tasks', 'all']` alem do cache do projeto
9. Novos hooks devem seguir o padrao de `useTasks.ts` (react-query + api wrapper)
10. Componentes UI usam shadcn/ui - rodar `npx shadcn@latest add <component>` se precisar de novo
