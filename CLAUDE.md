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
  components/   # ui/ (shadcn), layout/, projects/, tasks/, git/, claude/, ai/,
                # terminals/, editor/, files/, sync/, mcp/, onboarding/
  hooks/        # useProjects, useTasks, useGit, useClaude, useAi, useTerminal,
                # useMilestones, useSheetSync, useFiles, useEditorTabs, useLogs, useMcp
  pages/        # Dashboard, Workspace, TasksPage, Settings, Help, LogsPage
  lib/          # api.ts (fetch wrapper), sync/ (provider pattern)

server/src/
  routes/       # projects, tasks, git, terminals, terminalWs, claude, ai, mcp,
                # files, logs, sync, settings
  services/     # projectDiscovery, gitService, taskStore, terminalLauncher,
                # terminalService, aiBackend, aiConfigStore, aiJson,
                # claudeService, claudeCliService, openaiService, geminiService,
                # cliDetect, cliRunner, sseStream, claudeContextBuilder,
                # aiResolvePrompt, aiManagePrompt,
                # mcpServer, mcpAuth, logService, settingsStore, dataDir

data/           # Persistencia (auto-criado)
  projects.json, settings.json, ai-config.json, .claude-key,   # claude.json = legado, migrado
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
  agent?: string;           // qual CLI roda a task (id do agentRegistry; vazio = default)
  priority: 'urgent' | 'high' | 'medium' | 'low';
  effort?: 1 | 2 | 3 | 5 | 8;      // tamanho de implementacao (opcional, por compatibilidade)
  effortSource?: 'claude' | 'manual' | 'backfill';
  effortConfidence?: 'low' | 'medium' | 'high';
  status: 'backlog' | 'todo' | 'in_progress' | 'done';
  order: number;
  createdAt: string;
  updatedAt: string;
  inboxAt?: string;         // quando entrou em backlog/todo
  inProgressAt?: string;    // quando moveu para in_progress
  doneAt?: string;          // quando foi concluida
  attachments?: TaskAttachment[];  // vem do card do Trello (pull-only)
  comments?: TaskComment[];        // vem do card do Trello (pull-only)
}

interface TaskAttachment {
  id: string;  name: string;  url: string;
  mimeType?: string;  bytes?: number;  isImage?: boolean;  date?: string;
  source: 'trello';
}

interface TaskComment {
  id: string;  author?: string;  text: string;  date: string;  source: 'trello';
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
**Tarefas**: GET /api/tasks/all, GET/POST /:id/tasks, PUT/DELETE /:id/tasks/:tid, POST /:id/tasks/reorder, POST /:id/tasks/replace, POST /:id/tasks/:tid/note, GET /:id/tasks/forecast, POST /:id/tasks/effort/apply
**Git**: GET /:id/git/status|diff|log|branches|commit-diff|main-commit|task-review, POST /:id/git/stage|stage-all|unstage|commit|push|pull|discard|discard-all (all accept optional `subrepo` param for multi-repo projects)
**Files**: GET /:id/files/tree|content, PUT /:id/files/content, DELETE /:id/files, POST /:id/files/open-folder
**Terminais**: POST /api/terminals/launch|folder (nativos), GET/POST/DELETE /api/terminal/sessions (integrado), POST /api/terminal/sessions/:id/clipboard-image, WS /ws/terminal/:id
**Claude AI**: GET /api/claude/status|usage, POST config|config/test|chat(SSE)|analyze-task|classify-task-effort|summarize, DELETE config
**AI (multi-provedor)**: GET /api/ai/status, POST /api/ai/preferred, POST/DELETE /api/ai/config/:provider, POST /api/ai/config/:provider/test
**MCP**: POST /mcp (JSON-RPC), GET /mcp (SSE), OAuth em /register, /authorize, /token
**Sync**:
  POST /api/sync/proxy|test (proxy stateless para Google Apps Script)
  GET/POST/DELETE /api/sync/providers/:providerId (creds globais Trello/ClickUp)
  GET /api/projects/:id/sync (lista integracoes desse projeto, uma por milestone)
  POST/DELETE /api/projects/:id/sync/:providerId (body/query: milestoneId — default 'default'/General)
  POST /api/projects/:id/sync/:providerId/push|pull|merge (body: { milestoneId? })
  POST /api/projects/:id/sync/{trello,clickup}/link (body: { milestoneId?, ... })
  GET /api/projects/:id/tasks/:tid/attachment/:aid?milestoneId=&preview=1
    (proxy autenticado — a URL do anexo no Trello exige header OAuth, um `<img>`
     apontando direto para ela recebe 401)
**Logs**: GET /api/logs|logs/stats, DELETE /api/logs
**Agentes**: GET /api/agents (builtins + customizados + `available` por PATH), PUT /api/agents (`{ agents?, defaultAgent? }`)
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
- Abas de projetos compartilham toda a largura disponivel (`basis-0 flex-1 min-w-0`),
  permanecem todas visiveis e truncam os nomes; nao reintroduzir scroll horizontal
  nem menu de abas excedentes
- Painel lateral fecha automaticamente em rotas full-page (`/settings`, `/logs`,
  `/help`) e restaura a preferencia ao voltar — ver `FULL_PAGE_ROUTES` em
  `useActivity.tsx`

### Tarefas: description vs prompt
- **description**: O QUE fazer, visao usuario/produto, sem referencias a codigo
- **prompt**: Analise tecnica — causas, arquivos, solucoes, checklist de implementacao
- Para tarefas done: prompt contem resumo da implementacao

### Dialogo de tarefa (TaskEditor)
- Um unico componente serve New Task e Edit Task. O caminho comum e so titulo:
  titulo + descricao + a linha `Priority/Effort/Status` ficam sempre visiveis;
  **Details (prompt) e subtasks vivem atras do disclosure** "Technical details and
  subtasks" — colapsado em tarefa nova, aberto sozinho quando a tarefa ja tem
  prompt ou subtasks (contador no rotulo quando fechado)
- Prioridade e status usam os icones/cores de `taskVisuals.ts`. Nao redefinir
  labels ou cores aqui
- **Ctrl/Cmd+Enter salva de qualquer campo** (Enter sozinho salva no titulo).
  Registrado em `lib/shortcuts.ts`
- A subtask ainda digitada no input entra no save — nao dependa do Enter.
  `POST /api/projects/:id/tasks` aceita `subtasks` e descarta entradas sem titulo
  (`sanitizeSubtasks` em routes/tasks.ts)
- "Keep open for the next task" (`shipyard:quick-create` no localStorage) mantem
  o dialogo aberto apos criar e **preserva priority/status** — so os campos de
  texto, effort e subtasks sao limpos
- O milestone alvo aparece como badge no titulo quando nao e o General

### Timestamps de Status (cascading)
Os timestamps sao cascading — etapas posteriores preenchem as anteriores automaticamente:
- `todo`/`backlog` → define `inboxAt`
- `in_progress` → define `inboxAt` + `inProgressAt`
- `done` → define `inboxAt` + `inProgressAt` + `doneAt`

**NUNCA remova timestamps existentes** ao editar tarefas. Ao mover entre colunas, adicione o novo sem apagar anteriores. Formato: ISO 8601 (`new Date().toISOString()`). Implementado via `buildCascadingTimestamps()` em taskStore.ts.

### Previsao de tarefas
- `taskForecast.ts` calcula sob demanda usando timestamps; estimativas nao sao persistidas nas tasks.
- Duracao de desenvolvimento = `inProgressAt` -> `doneAt`; espera = `inboxAt`/`createdAt` -> `inProgressAt`.
- Usa mediana e quartis (P25-P75), preferindo mesmo projeto + mesmo `effort`; depois usa effort global e fallbacks por projeto/prioridade/historico global (cache de 60s).
- Duracoes instantaneas/invalidas e acima de 180 dias sao ignoradas; tarefas em andamento usam duracao residual condicional.
- Tasks antigas sem effort continuam validas. `POST /api/claude/classify-task-effort` gera sugestoes sem receber status/timestamps/duracao; o usuario revisa e `POST /api/projects/:id/tasks/effort/apply` grava somente as selecionadas com `effortSource: backfill`.
- Endpoint: `GET /api/projects/:id/tasks/forecast?milestone=...`; mutations invalidam `['task-forecast', projectId]`.
- A resposta do forecast inclui `breakdown` para `inbox` (`todo`), `backlog`,
  `inboxAndBacklog` e `inProgress`; cada recorte soma estimativa restante e faixa
  P25-P75. O kanban exibe esses totais nos cabecalhos e no popover geral.

### Aba Review da tarefa (o que a IA fez)
- `GET /:id/git/task-review?since=&until=` responde numa chamada tudo que a
  revisao precisa: branch atual, commits da janela (cada um com os arquivos que
  tocou, via um unico `git log --numstat`), o agregado por arquivo e a contagem
  do que ficou sem commit na working tree
- A janela vai de `inProgressAt` ate `doneAt` + 15min (a folga cobre o agente que
  faz commit logo depois de marcar done). Tarefa sem `inProgressAt` nao mostra a
  aba — nao ha janela para revisar
- O diff de um commit so e buscado quando o usuario expande (`useCommitDiff`, que
  ja cacheia por hash). Nunca carregar todos os diffs de uma vez
- Se o repo nao existir ou o git falhar, a rota devolve `available: false` e a aba
  mostra um aviso — nunca 500
- `DiffView.tsx` (`DiffBlock`, `parseDiffByFile`, `DiffFileEntry`) e a fonte unica
  de renderizacao de diff, compartilhada com o `CommitDetailDialog`
- "Needs changes" chama `POST /:id/tasks/:tid/note` — anexa uma secao datada ao
  prompt (mesmo formato do `log_task_progress` do MCP, via
  `taskStore.appendPromptSection`) e move a task de volta para in_progress

### Multi-repo Git (sub-repositorios)
- Projeto pode conter sub-pastas com `.git` proprio (ex: `client/` e `server/` dentro de `Sistema01/`)
- `detectSubRepos()` em projectDiscovery.ts escaneia 1 nivel de profundidade
- `subRepos` armazena caminhos relativos dos sub-repos encontrados
- Todas rotas git aceitam parametro opcional `subrepo` (query para GET, body para POST)
- GitPanel mostra tabs para selecionar sub-repo quando ha mais de um
- Query keys incluem `subrepo`: `['git-status', projectId, subrepo]`

### MCP (servidor de ferramentas para agentes)
- `mcpServer.ts` expoe 29 tools. Cobertura: projetos, milestones (CRUD),
  tarefas (incl. `create_tasks`/`bulk_update_tasks`/`bulk_delete_tasks`/`reorder_tasks`),
  git (status/log/diff) e sync (`list_sync_integrations`/`sync_push`/`sync_pull`)
- `get_task` devolve tambem os comentarios e os metadados de anexo vindos do
  Trello; `get_task_attachment` baixa um anexo e retorna a imagem inline
  (bloco `image` em base64, teto de 5 MB) — e assim que o agente enxerga o
  print que o cliente anexou no card. `McpToolResult.content` aceita blocos
  `text` e `image`
- **Toda mutacao de task no MCP DEVE chamar `afterTaskMutation(projectId)`**
  (= `triggerAutoSync`). Sem isso o agente altera tarefas e o Trello/ClickUp
  fica desatualizado ate o usuario mexer na UI
- `create_task`/`create_tasks`/`update_task`/`bulk_update_tasks` aceitam `effort`
  Fibonacci (1/2/3/5/8). Agentes DEVEM sempre atribuir/revisar effort pelo tamanho
  tecnico, nunca inferi-lo da prioridade
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
- Imagens coladas com Ctrl+V sao salvas temporariamente em `data/terminal-clipboard/`
  e o caminho absoluto e inserido no prompt; limite de 10 MB e limpeza oportunista
  apos 24h
- `safeChunks()` (server) nunca corta um par surrogate nem uma sequencia de escape.
  Cortar `\x1b[201~` ao meio prende o CLI em bracketed-paste e engole o prompt
- Toda escrita no PTY passa por uma **fila por sessao** — sem ela uma tecla
  digitada cai no meio de um paste em andamento
- Saida do PTY e agrupada por ~8ms antes de ir pro WebSocket (um redraw de TUI
  gera centenas de chunks minusculos)
- Renderer WebGL com fallback automatico para DOM (`attachRenderer`)

### Indicador de "esperando resposta" no terminal Claude
- `startOutputWatcher` (terminalService.ts) observa a saida das sessoes Claude
  (`claude`, `claude-yolo`, `ai-resolve`, `ai-manage`) e classifica em
  `busy` / `awaiting-input` / `idle`. So **observa**: nunca escreve no PTY, nunca
  toca na fila de escrita nem no flag `injecting` — escrever ali corromperia um
  paste em andamento
- Reaproveita `PROMPT_RE` (prompt ocioso) do injetor e acrescenta um padrao de
  decisao (`Do you want`, opcoes numeradas, `(y/n)`), sempre depois de ~1.2s de
  silencio. Qualquer input do usuario volta o estado para `busy`
- O watcher so comeca depois que a injecao de prompt termina (`onInjected`) —
  durante a espera o CLI mostra prompt ocioso e daria falso `idle`
- Transicoes viram frame WS `{ type: 'state', state }`; o estado atual e
  reenviado quando um socket conecta. No client vira `awaitingInput` no
  `GlobalTab` (transitorio: resetado na validacao de sessoes no mount)

### Atalhos globais e comportamento das abas
- `useGlobalShortcuts` (chamado em `LayoutInner`) e a casa dos atalhos que valem
  para o app inteiro: **Ctrl+W** (fecha aba), **Ctrl+N** (nova tarefa) e **?**
  (overlay de atalhos). Atalhos de um componente continuam com o dono
  (Ctrl+K, Ctrl+Shift+F, Ctrl+`, Ctrl+S) — registrar duas vezes dispara duplo
- Ctrl+W com o terminal em foco **nao** e capturado: no shell essa tecla e
  delete-word e roubá-la quebra a edicao da linha
- Ctrl+W dispara `shipyard:close-editor-tab` como evento **cancelavel**: o
  EditorPanel cancela quando fecha um arquivo (passando pela confirmacao de
  alteracoes nao salvas); se ninguem cancelar, fecha a aba de projeto
- Ctrl+N deixa `shipyard:pending-new-task` no sessionStorage alem de emitir o
  evento — o TaskBoard so monta no modo tasks e sem a flag o evento se perde
- Fonte unica dos atalhos exibidos: `client/src/lib/shortcuts.ts` (`SHORTCUTS`)
- As tres barras de abas (projeto, editor, terminal) seguem as mesmas regras:
  botao do meio fecha, botao direito abre menu de contexto, e ao fechar a aba
  ativa a **adjacente** assume
- Ctrl+W / Ctrl+N sao reservados pelo navegador: so funcionam no app desktop.
  Itens de menu no Electron usam `registerAccelerator: false` (o renderer e quem
  trata) e no macOS o `role: 'close'` foi trocado por item proprio, senao o
  Cmd+W fecharia a janela antes de chegar no renderer

### Menus de contexto de projeto
- `ProjectContextMenu` e o menu unico de projeto, usado no card do Dashboard, na
  linha da sidebar, na aba de projeto e no botao Claude da toolbar. Ordem fixa:
  Workspace · Editor · Claude (+ variante skip permissions) · Dev · Shell ·
  Pasta · Repositorio · Cloud · Favorito · Settings
- `useProjectLaunch` e o unico caminho de launch: prefere o terminal integrado
  (evento `shipyard:open-terminal`), cai para o nativo, compartilha a preferencia
  `shipyard:skipPermissions` entre todos os pontos e padroniza os toasts.
  Nao duplicar essa logica por componente

### AI Backend (multi-provider, CLI-first)
- `aiBackend.ts` e o UNICO ponto de entrada para features de IA server-side
  (chat, commit message, analyze-task, bulk-organize, manage-tasks)
- Tres provedores: **claude**, **openai**, **gemini**. O usuario escolhe o
  preferido em Settings > AI (`preferredProvider`); a cadeia e
  `[preferido, ...demais na ordem de AI_PROVIDERS]`. Se o preferido nao tem
  backend usavel (ou falha), o proximo assume — features nunca dependem de um so
- Dentro de cada provedor a ordem e sempre **CLI primeiro** (roda na assinatura,
  custo zero por token), API key como fallback pago:
  - claude: token OAuth (`~/.claude/.credentials.json`, `Authorization: Bearer` +
    `anthropic-beta: oauth-2025-04-20`, NUNCA `x-api-key`) → `claude -p` → key
  - openai: `codex exec --json` → key (`api.openai.com/v1/chat/completions`)
  - gemini: `gemini -p` → key (`generativelanguage.googleapis.com`, header
    `x-goog-api-key` — nunca a key na URL)
- 429 nao aborta a cadeia: fica guardado e so e relancado se **nenhum** provedor
  responder. `options.provider` forca um provedor e desliga o fallback
- NUNCA ler API key de env var (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `GEMINI_API_KEY`) — pertencem a outras ferramentas
- `generateText()` para one-shot, `streamText()` para chat SSE. Novas features de
  IA DEVEM usar aiBackend, nunca chamar um provedor direto
- Modelos: `FAST_MODELS` (one-shot) e `CHAT_MODELS` (chat / default ao salvar
  key) em `aiConfigStore.ts`. O modelo salvo so vale para o caminho da API key —
  CLI usa o modelo da conta
- OpenAI: modelos `gpt-5*`/`o*` exigem `max_completion_tokens`; os demais,
  `max_tokens`. `isReasoningModel()` decide

### Credenciais de IA (`ai-config.json`)
- `aiConfigStore.ts` guarda `{ preferredProvider, providers[p] = { apiKey, model,
  maxTokens } }` cifrado com AES-256-GCM (`data/.claude-key`), cache em memoria +
  escrita serializada e atomica (tmp + rename), como os outros stores JSON
- Migracao automatica do `claude.json` antigo na primeira leitura (mesma chave de
  cifra, entao o ciphertext e reaproveitado). O arquivo legado so e apagado
  quando o usuario remove a key do Claude — senao ela ressuscitaria no proximo
  boot frio
- `claudeService.ts` virou so o cliente Anthropic; as credenciais vivem no store

### Deteccao de CLIs (`cliDetect.ts` / `cliRunner.ts`)
- `detectCli(bin)` resolve **como** lancar o CLI e cacheia por 60s, devolvendo
  `{ command, prefixArgs }`
- **Windows**: npm instala CLI como shim `.cmd` e o Node se recusa a spawnar
  `.cmd` sem shell; passar pelo shell estragaria prompt multilinha. Entao o shim
  e lido e o entry JS que ele aponta e chamado direto (`node <entry>`), o que
  mantem os argumentos verbatim. Sem isso, `codex` e `gemini` ficam invisiveis
- `runCli`/`streamCli` centralizam spawn, timeout por inatividade, hard timeout,
  stdin e cwd. `claudeCliService` tambem passa por eles
- Prompt do codex vai por **stdin** (`codex exec ... -`); `--skip-git-repo-check`
  cai fora automaticamente se a versao instalada nao conhecer a flag

### Parsing de resposta estruturada (`aiJson.ts`)
- `parseJsonResponse()` e compartilhado por todas as rotas de IA. Cada provedor
  erra diferente: Claude poe prosa antes, OpenAI cerca em ```json, Gemini as
  vezes abre com `<thinking>`. A funcao vai do estrito ao tolerante (parse direto
  → tira fences → tira bloco de raciocinio → extracao por profundidade de chaves
  → conserta virgula sobrando e chave sem aspas)
- Rota de IA nova DEVE usar essa funcao, nao um `JSON.parse` proprio

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
- "Run with AI" abre antes o `AiResolveDialog`, onde o usuario pode escrever uma
  decisao ou contexto extra so para aquela execucao. O texto vai no corpo de
  `POST /:id/tasks/:tid/ai-resolve` e vira a secao `## User decision feedback`
  do prompt, declarada como instrucao que prevalece sobre a descricao.
  Shift+clique pula o dialogo. Sem feedback, o prompt sai identico ao anterior
- O mesmo dialogo tem o seletor de agente. `useAiResolve` e o unico caminho que
  monta o prompt e dispara `shipyard:open-terminal`; a paleta (Ctrl+K) usa
  `AiResolveHost`, montado no Layout, porque ela desmonta ao fechar

### Agentes de codigo (qual CLI roda a task)
- `agentRegistry.ts` e a fonte unica: 6 builtins (Claude Code, Codex, Aider,
  Gemini CLI, OpenCode, Cursor CLI) + os que o usuario cadastra em Settings
  (guardados em `settings.json` como `customAgents`, com `defaultAgent`)
- `task.agent` guarda o id escolhido; vazio = `defaultAgent` = `claude`.
  `replaceTasks` copia o campo do `existing` — sem isso todo pull de sync apaga
- `buildAgentLaunch()` monta a linha de comando. O template de args aceita
  `{cwd}`, `{taskFile}` (arquivo com o prompt inteiro, em `data/agent-prompts/`,
  limpo apos 24h) e `{task}` (prompt em uma linha, entre aspas do shell)
- **Sem placeholder de prompt o CLI sobe vazio e o prompt e digitado nele**
  (`injectPromptWhenReady`) — e o caminho dos builtins, e o unico que preserva
  quebras de linha. Com `{task}`/`{taskFile}` a sessao e one-shot e nao ha injecao
- Aspas por shell (PowerShell no Windows, sh no resto). Comando com espaco no
  caminho vira `& 'caminho'` no PowerShell
- Escolha do agente: `AgentSelect` no TaskViewer (grava na task) e no
  `AiResolveDialog` (so aquela execucao). O id viaja no evento
  `shipyard:open-terminal` → `POST /api/terminal/sessions` → `createSession`
- A aba do terminal leva o nome do agente quando nao e o default
- Nao criar um segundo lugar que decida comando de agente: passe pelo registry

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

**Anexos e comentarios do Trello** (pull-only — o cliente escreve no card, o
Shipyard so le):
- `pullCards` pede `attachments=true` na propria chamada de cards (zero requests
  extras) e busca os comentarios em UMA chamada de board
  (`/boards/{id}/actions?filter=commentCard`, teto de 1000). Se essa chamada
  falhar, o pull segue sem comentarios em vez de quebrar
- Teto por card: 20 anexos, 50 comentarios (os mais recentes, reordenados do mais
  antigo para o mais novo)
- **Nunca** renderize esses campos no `desc` do card (`renderDesc`): o parser do
  pull faz round-trip do desc e qualquer assimetria vira diff fantasma que
  re-envia todos os cards a cada push
- `fieldsChanged` (syncMerge) compara por ids ordenados — dado identico nao pode
  contar como mudanca, senao o par pull/push entra em loop a cada 30s
- `replaceTasks` reconstroi a task a partir de uma lista fixa de campos e e o
  caminho de escrita de **todo** pull. Campo novo que nao for copiado do
  `existing` la e apagado a cada ciclo (era assim que `subtasks` e `needsReview`
  se perdiam)
- Ver imagem: proxy `GET /api/projects/:id/tasks/:tid/attachment/:aid`
  (`fetchAttachmentBytes` em trelloSync.ts monta o header
  `Authorization: OAuth ...`). A URL crua do Trello devolve 401

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
