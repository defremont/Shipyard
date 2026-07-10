# Shipyard - Local Development Dashboard

Dashboard web local (localhost) para gerenciamento de projetos, tarefas, git, terminais e AI. Complementa o VS Code.

## Quick Start

```bash
pnpm dev          # client (5421) + server (5420)
shipyard.cmd      # Windows: batch file na raiz
./shipyard.sh     # Linux: server + browser
```

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui |
| Backend | Fastify 5 + TypeScript (via tsx) |
| Dados | Arquivos JSON em `data/` (sem banco de dados) |
| Monorepo | pnpm workspaces (client + server) |
| Desktop | Electron (opcional, `pnpm dist:win/mac/linux`) |

## Estrutura (resumo)

```
client/src/
  components/   # ui/ (shadcn), layout/, projects/, tasks/, git/, claude/,
                # terminals/, editor/, files/, sync/, mcp/, onboarding/
  hooks/        # useProjects, useTasks, useGit, useClaude, useTerminal,
                # useMilestones, useSheetSync, useFiles, useEditorTabs, useLogs, useMcp
  pages/        # Dashboard, Workspace, TasksPage, Settings, Help, LogsPage
  lib/          # api.ts (fetch wrapper), sync/ (provider pattern)

server/src/
  routes/       # projects, tasks, git, terminals, terminalWs, claude, mcp,
                # files, logs, sync, settings
  services/     # projectDiscovery, gitService, taskStore, terminalLauncher,
                # terminalService, aiBackend, claudeService, claudeContextBuilder,
                # claudeCliService, aiResolvePrompt, aiManagePrompt,
                # mcpServer, mcpAuth, logService, settingsStore, dataDir

data/           # Persistencia (auto-criado)
  projects.json, settings.json, claude.json, .claude-key,
  mcp-config.json, mcp-auth.json, server.log,
  sync-config.json,                # v3: providers (creds globais) + projects[id][provider][milestoneId]
  tasks/{projectId}.json  # { milestones?: Milestone[], tasks: Task[] }

electron/       # main.ts, preload.ts (desktop wrapper)
```

## Modelos de Dados

```typescript
interface Task {
  id: string;               // nanoid(10)
  projectId: string;
  milestoneId?: string;     // undefined/'default' = milestone "General" (virtual)
  title: string;
  description: string;      // O QUE fazer (visao usuario/produto)
  prompt?: string;          // HOW/WHY tecnico (causas, arquivos, solucoes)
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'backlog' | 'todo' | 'in_progress' | 'done';
  order: number;
  createdAt: string;
  updatedAt: string;
  inboxAt?: string;         // quando entrou em backlog/todo
  inProgressAt?: string;    // quando moveu para in_progress
  doneAt?: string;          // quando foi concluida
}

interface Milestone {
  id: string;  projectId: string;  name: string;
  description?: string;  status: 'active' | 'closed';
  createdAt: string;  updatedAt: string;  order: number;
}

interface Project {
  id: string;  name: string;  path: string;  category: string;
  isGitRepo: boolean;  techStack: string[];  favorite: boolean;
  gitBranch?: string;  gitAhead?: number;  gitBehind?: number;
  gitStaged?: number;  gitUnstaged?: number;  gitUntracked?: number;
  externalLink?: string;  lastOpenedAt?: string;
  subRepos?: string[];   // Relative paths to sub-directories with their own .git
}
```

## Rotas da API (padrao: `/api/projects/:id/...`)

**Projetos**: GET /api/projects, PATCH /:id, POST scan/add/remove/refresh
**Milestones**: GET/POST /:id/milestones, PUT/DELETE /:id/milestones/:mid
**Tarefas**: GET /api/tasks/all, GET/POST /:id/tasks, PUT/DELETE /:id/tasks/:tid, POST /:id/tasks/reorder, POST /:id/tasks/replace
**Git**: GET /:id/git/status|diff|log|branches, POST /:id/git/stage|stage-all|unstage|commit|push|pull|discard|discard-all (all accept optional `subrepo` param for multi-repo projects)
**Files**: GET /:id/files/tree|content, PUT /:id/files/content, DELETE /:id/files, POST /:id/files/open-folder
**Terminais**: POST /api/terminals/launch|folder (nativos), GET/POST/DELETE /api/terminal/sessions (integrado), WS /ws/terminal/:id
**Claude AI**: GET /api/claude/status|usage, POST config|config/test|chat(SSE)|analyze-task|summarize, DELETE config
**MCP**: POST /mcp (JSON-RPC), GET /mcp (SSE), OAuth em /register, /authorize, /token
**Sync**:
  POST /api/sync/proxy|test (proxy stateless para Google Apps Script)
  GET/POST/DELETE /api/sync/providers/:providerId (creds globais Trello/ClickUp)
  GET /api/projects/:id/sync (lista integracoes desse projeto, uma por milestone)
  POST/DELETE /api/projects/:id/sync/:providerId (body/query: milestoneId — default 'default'/General)
  POST /api/projects/:id/sync/:providerId/push|pull|merge (body: { milestoneId? })
  POST /api/projects/:id/sync/{trello,clickup}/link (body: { milestoneId?, ... })
**Logs**: GET /api/logs|logs/stats, DELETE /api/logs
**Sistema**: GET /api/settings, POST /api/browse

## Portas

- Backend: **5420** (dev), **5430** (Electron prod)
- Frontend Vite: **5421** (proxy /api → 5420)

## Convencoes e Regras

### Design system (UI)
- Fonte: **Inter Variable** (`@fontsource-variable/inter`, importada em `main.tsx`;
  `fontFamily.sans` no tailwind config)
- Tokens de cor em `client/src/index.css` (CSS vars) mapeados no tailwind config.
  Alem dos padroes shadcn: `--success` (verde), `--warning` (ambar), `--sidebar`.
  `--primary` e a cor de marca (azul) — usada para acoes primarias, foco, links,
  estados ativos, features de IA/Claude e status inbox/todo
- Semantica de cor: inbox/todo = `primary` · in_progress = `warning` ·
  done = `success` · urgent/erro/delete = `destructive`. **NUNCA** usar classes
  literais de paleta (`text-purple-500`, `bg-yellow-500`...) para semantica de
  status/prioridade — use os tokens. Excecoes: cores de marca de terceiros
  (Trello/ClickUp em SyncMenu) e cores por tipo de arquivo (FileIcon)
- Aparencia de prioridade/status de tasks vem de `client/src/lib/taskVisuals.ts`
  (`PRIORITY_CONFIG`, `STATUS_CONFIG`, `priorityVisual()`, `statusVisual()`) —
  nao redefinir configs locais por componente. So urgent (vermelho) e high
  (ambar) tem cor; medium/low sao neutros
- Tasks done: **sem** `line-through` e **sem** `opacity` no card — titulo em
  `text-muted-foreground` + check verde. Legibilidade > decoracao
- **Cromo minimo**: toolbars mostram so as acoes do fluxo principal (Claude,
  New Task, milestone, toggle Tasks/Editor). Acoes secundarias (sort, view mode,
  import/export, report, dev server, shell, links, settings) vivem em menus "⋯"
  (`ui/dropdown-menu.tsx`) ou aparecem apenas no hover (acoes de coluna do kanban:
  `group/col` + `opacity-0 group-hover/col:opacity-100`). Nao adicionar botoes
  sempre-visiveis a toolbars sem justificativa de fluxo
- Painel lateral fecha automaticamente em rotas full-page (`/settings`, `/logs`,
  `/help`) e restaura a preferencia ao voltar — ver `FULL_PAGE_ROUTES` em
  `useActivity.tsx`

### Tarefas: description vs prompt
- **description**: O QUE fazer, visao usuario/produto, sem referencias a codigo
- **prompt**: Analise tecnica — causas, arquivos, solucoes, checklist de implementacao
- Para tarefas done: prompt contem resumo da implementacao

### Timestamps de Status (cascading)
Os timestamps sao cascading — etapas posteriores preenchem as anteriores automaticamente:
- `todo`/`backlog` → define `inboxAt`
- `in_progress` → define `inboxAt` + `inProgressAt`
- `done` → define `inboxAt` + `inProgressAt` + `doneAt`

**NUNCA remova timestamps existentes** ao editar tarefas. Ao mover entre colunas, adicione o novo sem apagar anteriores. Formato: ISO 8601 (`new Date().toISOString()`). Implementado via `buildCascadingTimestamps()` em taskStore.ts.

### Multi-repo Git (sub-repositorios)
- Projeto pode conter sub-pastas com `.git` proprio (ex: `client/` e `server/` dentro de `Sistema01/`)
- `detectSubRepos()` em projectDiscovery.ts escaneia 1 nivel de profundidade
- `subRepos` armazena caminhos relativos dos sub-repos encontrados
- Todas rotas git aceitam parametro opcional `subrepo` (query para GET, body para POST)
- GitPanel mostra tabs para selecionar sub-repo quando ha mais de um
- Query keys incluem `subrepo`: `['git-status', projectId, subrepo]`

### MCP (servidor de ferramentas para agentes)
- `mcpServer.ts` expoe 24 tools. Cobertura: projetos, milestones (CRUD),
  tarefas (incl. `create_tasks`/`bulk_update_tasks`/`bulk_delete_tasks`/`reorder_tasks`),
  git (status/log/diff) e sync (`list_sync_integrations`/`sync_push`/`sync_pull`)
- **Toda mutacao de task no MCP DEVE chamar `afterTaskMutation(projectId)`**
  (= `triggerAutoSync`). Sem isso o agente altera tarefas e o Trello/ClickUp
  fica desatualizado ate o usuario mexer na UI
- `update_task`/`bulk_update_tasks` aceitam `milestoneId` (`'default'` = General)
- Tools read-only levam `annotations.readOnlyHint`; destrutivas, `destructiveHint`
- Ao adicionar tool: registrar em `MCP_TOOLS` **e** no `handleToolCall`, e atualizar
  a lista de permissoes da tela de consentimento OAuth em `routes/mcp.ts`

### Cache e Invalidacao (react-query)
- `staleTime` default: 3s (`main.tsx`) — evita refetch de tudo a cada foco de janela
- refetchInterval: 5s (git status, tasks do board), 30s (`['tasks','all']`, projects)
- `['tasks','all']` le TODOS os arquivos de tasks — e a query mais cara. Componentes
  sempre montados (GlobalSearch, CommandPalette) passam `useAllTasks({ enabled: open })`
- Mutations de tarefas DEVEM invalidar `['tasks', projectId]` E `['tasks', 'all']`
- Auto-pull so invalida quando houve mudanca real (created/updated), nunca a cada tick

### Performance (regras que nao podem regredir)
- `syncStore`: leituras vem do cache em memoria (`cachedStore`); o processo e o
  unico escritor. Nunca voltar a ler o JSON do disco por chamada
- `taskStore`: caminho de leitura NAO escreve. O backfill de `number` persiste
  uma unica vez, sob lock, e retorna a lista ja autoritativa
- `projectDiscovery`: refresh de git a cada 15s usa `gitService` (instancia
  compartilhada por repo = fila serializada). `status.current` ja da o branch —
  nao chamar `git.branch()`. Remote URL e sub-repos sao cacheados
- `logService`: escritas em disco sao bufferizadas (flush 200ms / 64 linhas)
- Componentes de lista (`TaskItem`, `SortableTaskItem`, `TaskRow`) sao `React.memo` —
  o structural sharing do react-query mantem `task` estavel entre polls
- Editor (CodeMirror), terminal (xterm) e markdown sao `lazy()`. **Nao** usar
  `manualChunks`: agrupar vendors puxa modulos compartilhados para o entry chunk

### Terminais (multiplataforma)
- **Windows**: `wt.exe` + `cmd.exe /k` (NAO bash — causa erro WSL)
- **Linux**: `gnome-terminal --title --working-directory` + `bash -c "cmd; exec bash"`
- **macOS**: `osascript` (Terminal.app)
- Terminal integrado: xterm.js + node-pty (optional dep) + WebSocket

### Terminal integrado — copiar/colar e performance
- **Colar SEMPRE via `term.paste()`** (client). Ele converte `\n` → `\r` e aplica
  os marcadores de bracketed paste (`\x1b[200~`…`\x1b[201~`) quando o programa os
  pediu. Enviar o texto cru pelo WebSocket faz o Claude CLI ler cada `\n` como
  Enter e submeter linha a linha
- Botao direito: copia se ha selecao, senao cola. Botao do meio cola.
  Com mouse tracking ligado (Claude CLI), selecionar exige **Shift**+arrastar
- `safeChunks()` (server) nunca corta um par surrogate nem uma sequencia de escape.
  Cortar `\x1b[201~` ao meio prende o CLI em bracketed-paste e engole o prompt
- Toda escrita no PTY passa por uma **fila por sessao** — sem ela uma tecla
  digitada cai no meio de um paste em andamento
- Saida do PTY e agrupada por ~8ms antes de ir pro WebSocket (um redraw de TUI
  gera centenas de chunks minusculos)
- Renderer WebGL com fallback automatico para DOM (`attachRenderer`)

### AI Backend (CLI-first, padronizado)
- `aiBackend.ts` e o UNICO ponto de entrada para features de IA server-side
  (chat, commit message, analyze-task, bulk-organize, manage-tasks)
- Prioridade fixa: **1)** token OAuth do Claude CLI (`~/.claude/.credentials.json`,
  usa assinatura — chamada direta a API com `Authorization: Bearer` +
  `anthropic-beta: oauth-2025-04-20`, NUNCA `x-api-key`) → **2)** subprocess
  `claude -p` → **3)** API key configurada no Shipyard
- NUNCA ler `process.env.ANTHROPIC_API_KEY` — pertence a outras ferramentas
- `generateText()` para one-shot, `streamText()` para chat SSE
- Novas features de IA DEVEM usar aiBackend, nao chamar Anthropic direto

### Medidor de uso da assinatura
- `claudeUsage.ts` le `GET https://api.anthropic.com/api/oauth/usage` com o token
  OAuth do CLI (mesmo endpoint que o `/usage` do proprio CLI usa)
- **Endpoint nao documentado**: pode mudar de forma ou sumir. Toda falha degrada
  para `{ available: false }` e o widget some — nunca quebra a UI
- So expoe **percentual** de utilizacao (`limit_dollars`/`used_dollars` vem `null`
  em planos de assinatura). Nao ha contagem de tokens nem de dolares
- Ler o array generico `limits[]` (kinds: `session`, `weekly_all`, `weekly_scoped`),
  nao os campos nomeados de topo — junto deles vem codinomes internos (`tangelo`,
  `iguana_necktie`…) que chegam `null` e nao tem significado estavel
- 429 nesse endpoint = throttle do medidor, **nao** limite do plano estourado.
  Nesse caso serve a ultima leitura boa (`stale: true`) por ate 10min
- Cache de 60s no server + `refetchInterval` de 60s no client. A janela de 5h
  anda devagar; nao vale poll mais agressivo
- `ClaudeUsageBadge` no rodape da ActivityBar: anel = janela de 5h (a que trava a
  sessao de trabalho); popover abre o detalhe. Cor por severidade: <75% neutro,
  75-89% `warning`, >=90% `destructive`

### AI Task Management (Claude CLI)
- `claudeCliService.ts`: detecta e executa Claude CLI (`claude`) como subprocess
- `aiResolvePrompt.ts`: monta prompt para Claude resolver UMA tarefa (inclui contexto do projeto + task + MCP tools disponiveis)
- `aiManagePrompt.ts`: monta prompt para Claude gerenciar MULTIPLAS tarefas a partir de texto livre
- Auto-close: TerminalPanel detecta quando sessao AI termina e marca task como done se Claude nao o fez
- Prompt reforça que Claude DEVE atualizar status da task via MCP ao concluir

### Stores JSON (concorrencia)
- `taskStore.ts` e `syncStore.ts` serializam toda mutacao com mutex (promise chain)
  e gravam atomicamente (tmp + rename). Leitura corrompida usa ultima copia boa
  em memoria + backup `.corrupt-*.bak` — nunca retorna store vazio sobre dados existentes
- Novos stores JSON DEVEM seguir esse padrao (read-modify-write sem lock corrompe dados)

### Electron
- Server roda como child process via spawn (`ELECTRON_RUN_AS_NODE=1`)
- Menu de aplicacao em `createApplicationMenu()` (main.ts) envia acoes via IPC
  `menu-action` → preload expoe `electronAPI.onMenuAction` → hook `useElectronMenu`
  roteia (`navigate:<path>`) ou redispara CustomEvents (`shipyard:toggle-search`,
  `shipyard:toggle-file-search`, `shipyard:toggle-terminal`)
- Atalhos Ctrl+K / Ctrl+Shift+F / Ctrl+` sao do renderer; itens de menu usam
  `registerAccelerator: false` para mostrar o hint sem duplicar o handler
- Terminal integrado (xterm) repassa esses atalhos globais via
  `attachCustomKeyEventHandler` (return false) em IntegratedTerminal.tsx
- Data path: `SHIPYARD_DATA_DIR` env var → AppData em prod, ./data em dev
- Centralizado em `server/src/services/dataDir.ts`
- asar desabilitado, afterPack reinstala deps via npm (pnpm symlinks nao sobrevivem)

### Sync — milestone-scoped (Google Sheets, Trello, ClickUp)
Toda integracao de tasks e por **(projectId, providerId, milestoneId)**. Cada milestone tem
sua propria sheet/board/list. O milestone "General" usa o id literal `'default'`.

**Google Sheets** (cliente-only via Apps Script proxy):
- Config em localStorage por milestone: `shipyard:sync:m:{projectId}:{milestoneId}`
- URL validada: so permite `https://script.google.com/macros/s/...`
- Auto-push: debounce 2s; auto-pull: polling 30s com merge bidirecional
- Anti-loop: `lastPushAt` guard impede pull nos 10s apos push

**Trello / ClickUp** (server-side, schema v3 em `data/sync-config.json`):
- Creds globais em `providers[providerId]` (apiKey/token), config em `projects[id][provider][milestoneId]`
- Push: server-side debounce 2.5s em mutations de task — empurra TODOS os milestones
  habilitados do projeto, cada um para sua propria board/list

**Ordenacao dos cards no Trello** (`computePositions` em trelloSync.ts):
- O Trello so ordena lista por data de criacao ou alfabeticamente, e o agente MCP
  cria as tarefas todas no mesmo segundo — logo a ordem de criacao nao diz nada.
  Por isso o Shipyard controla o `pos` de cada card e o reescreve a cada push:
  - **Done** → concluidas mais recentes no topo (`doneAt` desc)
  - **In Progress** → iniciadas mais recentes no topo (`inProgressAt` desc)
  - **To Do / Backlog** → ordem do kanban (prioridade, depois `order`)
- Cards `done` recebem `due = doneAt` + `dueComplete: true` → badge de data visivel
  no card (e permite ordenar por data no proprio Trello)
- Push envia **so os campos que mudaram** (diff contra snapshot do board). Se nada
  mudou, zero requests. Requisicoes em paralelo (limite 6) com retry/backoff em 429
- Edicao feita no Trello nao e sobrescrita (comparamos `dateLastActivity` vs
  `updatedAt`) — a unica excecao e `pos`, que e derivado do estado do Shipyard
- Pull: cliente faz merge a cada 30s via `useIntegrationAutoPull` (key inclui milestoneId)
- Tasks novas vindas do remoto recebem `milestoneId` automaticamente no merge
- Board/list e nomeada `Shipyard · {project} · {milestone}` (ou so `Shipyard · {project}`
  para General)

**Migracao v2 → v3**: integracoes Trello/ClickUp pre-existentes sao descartadas (creds
globais sao mantidas) — usuarios reconectam cada milestone manualmente.

### Milestones
- "General" e virtual (nao armazenado) — tasks sem milestoneId pertencem a ele
- Deletar milestone move tasks para "General"
- Milestone ativo em localStorage: `shipyard:milestone:{projectId}`

## Regras para Contribuicao

1. **SEMPRE atualize este CLAUDE.md** quando mudar arquitetura, rotas, modelos ou convencoes
2. Dados persistem em JSON — nao introduza banco de dados sem discutir
3. Novos hooks seguem padrao de `useTasks.ts` (react-query + api.ts wrapper)
4. Componentes UI usam shadcn/ui (`npx shadcn@latest add <component>`)
5. Todas mutations de tarefas devem invalidar `['tasks', 'all']`
6. Terminal no Windows: SEMPRE cmd.exe, nunca bash
7. Novos services devem importar data path de `dataDir.ts`
