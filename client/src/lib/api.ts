const BASE_URL = '/api';

interface RequestOptions extends RequestInit {
  timeout?: number;
}

export interface Agent {
  id: string
  name: string
  /** Binary the terminal launches. */
  command: string
  /** Argument template — {cwd}, {task}, {taskFile}. */
  args: string
  builtin?: boolean
  /** Whether the binary answered a --version probe on this machine. */
  available?: boolean
}

export interface SyncProviderStatus {
  providerId: 'trello' | 'clickup';
  connected: boolean;
  settingsSet: Record<string, boolean>;
  updatedAt: string | null;
}

export interface TaskCommitFile {
  file: string;
  additions: number;
  deletions: number;
  binary?: boolean;
}

export interface TaskCommit {
  hash: string;
  message: string;
  date: string;
  author_name: string;
  files: TaskCommitFile[];
  additions: number;
  deletions: number;
}

export interface TaskGitReview {
  available: boolean;
  branch: string | null;
  commits: TaskCommit[];
  files: { file: string; additions: number; deletions: number; commits: number }[];
  additions: number;
  deletions: number;
  working: { staged: number; unstaged: number; untracked: number } | null;
}

export type UsageSeverity = 'normal' | 'warning' | 'critical';

export interface UsageWindow {
  percent: number;
  resetsAt: string | null;
}

export interface ScopedUsageWindow extends UsageWindow {
  label: string;
}

/** Subscription usage from the Claude CLI's OAuth session. */
export type ClaudeUsage =
  | {
      available: true;
      plan: string | null;
      session: UsageWindow | null;
      weekly: UsageWindow | null;
      scoped: ScopedUsageWindow[];
      severity: UsageSeverity;
      extraCredits: { enabled: boolean; percent: number | null } | null;
      fetchedAt: string;
      stale: boolean;
    }
  | { available: false; reason: 'no-oauth' | 'request-failed' };

export interface SyncIntegration {
  providerId: 'trello' | 'clickup';
  projectId: string;
  milestoneId: string;
  enabled: boolean;
  autoSync: boolean;
  settings: Record<string, any>;
  state: Record<string, any>;
  lastSyncAt: string | null;
  lastSyncStatus: 'ok' | 'error' | null;
  lastSyncError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SyncOperationResult {
  success: boolean;
  message: string;
  pushed?: number;
  pulled?: number;
  created?: number;
  updated?: number;
  errors?: string[];
  remoteUrl?: string;
  milestoneId?: string;
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const { timeout, ...fetchOptions } = options || {};
  const headers: Record<string, string> = {};
  if (fetchOptions.body) {
    headers['Content-Type'] = 'application/json';
  }

  let signal = fetchOptions.signal;
  let controller: AbortController | undefined;
  if (timeout && !signal) {
    controller = new AbortController();
    signal = controller.signal;
    setTimeout(() => controller!.abort(), timeout);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...fetchOptions,
    signal,
  }).catch((err) => {
    if (err.name === 'AbortError') throw new Error('Request timed out');
    throw err;
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || 'Request failed');
  }

  return res.json();
}

export const api = {
  // Projects
  getProjects: () => request<{ projects: any[] }>('/projects'),
  refreshProjects: () => request<{ projects: any[] }>('/projects/refresh', { method: 'POST' }),
  updateProject: (id: string, data: any) => request(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Milestones
  getMilestones: (projectId: string) => request<{ milestones: any[] }>(`/projects/${projectId}/milestones`),
  createMilestone: (projectId: string, data: { name: string; description?: string }) =>
    request(`/projects/${projectId}/milestones`, { method: 'POST', body: JSON.stringify(data) }),
  updateMilestone: (projectId: string, milestoneId: string, data: { name?: string; description?: string; status?: string }) =>
    request(`/projects/${projectId}/milestones/${milestoneId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMilestone: (projectId: string, milestoneId: string) =>
    request(`/projects/${projectId}/milestones/${milestoneId}`, { method: 'DELETE' }),

  // Tasks
  getAllTasks: () => request<{ tasks: any[] }>('/tasks/all'),
  getTasks: (projectId: string, milestoneId?: string) =>
    request<{ tasks: any[] }>(`/projects/${projectId}/tasks${milestoneId ? `?milestone=${encodeURIComponent(milestoneId)}` : ''}`),
  getTaskForecast: (projectId: string, milestoneId?: string) =>
    request<any>(`/projects/${projectId}/tasks/forecast${milestoneId ? `?milestone=${encodeURIComponent(milestoneId)}` : ''}`),
  createTask: (projectId: string, data: any) => request(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (projectId: string, taskId: string, data: any) => request(`/projects/${projectId}/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(data) }),
  addTaskNote: (projectId: string, taskId: string, note: string, status?: string) =>
    request(`/projects/${projectId}/tasks/${taskId}/note`, { method: 'POST', body: JSON.stringify({ note, status }) }),
  deleteTask: (projectId: string, taskId: string) => request(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }),
  reorderTasks: (projectId: string, taskIds: string[]) => request(`/projects/${projectId}/tasks/reorder`, { method: 'POST', body: JSON.stringify({ taskIds }) }),
  importTasks: (projectId: string, tasks: any[]) => request<{ imported: number }>(`/projects/${projectId}/tasks/import`, { method: 'POST', body: JSON.stringify({ tasks }) }),
  importAllTasks: (tasks: any[]) => request<{ imported: number }>('/tasks/import', { method: 'POST', body: JSON.stringify({ tasks }) }),
  applyCsvChanges: (projectId: string, changes: { update: any[]; create: any[]; remove: string[] }) =>
    request<{ updated: number; created: number; removed: number }>(`/projects/${projectId}/tasks/csv-apply`, { method: 'POST', body: JSON.stringify(changes) }),
  replaceTasks: (projectId: string, tasks: any[], milestoneId?: string) =>
    request<{ tasks: any[] }>(`/projects/${projectId}/tasks/replace`, { method: 'POST', body: JSON.stringify({ tasks, milestoneId }) }),
  bulkUpdateTasks: (projectId: string, taskIds: string[], data: Record<string, any>) =>
    request<{ updated: number }>(`/projects/${projectId}/tasks/bulk-update`, { method: 'POST', body: JSON.stringify({ taskIds, data }) }),
  bulkDeleteTasks: (projectId: string, taskIds: string[]) =>
    request<{ deleted: number }>(`/projects/${projectId}/tasks/bulk-delete`, { method: 'POST', body: JSON.stringify({ taskIds }) }),

  // Sync (stateless proxy)
  syncProxy: (url: string, method: 'GET' | 'POST', payload?: unknown, action?: string) =>
    request<{ data: any; error?: string }>('/sync/proxy', { method: 'POST', body: JSON.stringify({ url, method, payload, action }) }),
  syncTest: (url: string) =>
    request<{ ok: boolean; error?: string; data?: any }>('/sync/test', { method: 'POST', body: JSON.stringify({ url }) }),

  // ── Stateful integrations (Trello, ClickUp) ─────────────────────────
  // Global provider credentials (shared across projects)
  listSyncProviders: () =>
    request<{ providers: SyncProviderStatus[] }>('/sync/providers'),
  saveSyncProvider: (providerId: 'trello' | 'clickup', settings: Record<string, any>) =>
    request<{ provider: SyncProviderStatus }>(
      `/sync/providers/${providerId}`,
      { method: 'POST', body: JSON.stringify({ settings }) },
    ),
  deleteSyncProvider: (providerId: 'trello' | 'clickup') =>
    request<{ deleted: boolean }>(`/sync/providers/${providerId}`, { method: 'DELETE' }),
  testSyncProvider: (providerId: 'trello' | 'clickup', overrides?: Record<string, any>) =>
    request<{ ok: boolean; message: string }>(
      `/sync/providers/${providerId}/test`,
      { method: 'POST', body: JSON.stringify({ overrides }) },
    ),
  clickupDiscover: (body: { token?: string; teamId?: string }) =>
    request<{ teams?: Array<{ id: string; name: string }>; spaces?: Array<{ id: string; name: string; private: boolean }> }>(
      '/sync/clickup/discover',
      { method: 'POST', body: JSON.stringify(body) },
    ),
  trelloAuthorizeUrl: (apiKey?: string) =>
    request<{ url: string }>(
      '/sync/trello/authorize-url',
      { method: 'POST', body: JSON.stringify({ apiKey }) },
    ),

  // Link-to-existing flow (for connecting a project on another computer
  // to a board/list that already exists)
  listTrelloBoards: () =>
    request<{ boards: Array<{ id: string; name: string; url: string; closed: boolean }> }>(
      '/sync/trello/boards',
    ),
  listClickupLists: (spaceId: string) =>
    request<{ lists: Array<{ id: string; name: string; url?: string }> }>(
      `/sync/clickup/lists?spaceId=${encodeURIComponent(spaceId)}`,
    ),
  linkTrelloBoard: (projectId: string, boardId: string, milestoneId?: string) =>
    request<SyncOperationResult & { matchedCount?: number; totalRemote?: number; milestoneId?: string }>(
      `/projects/${projectId}/sync/trello/link`,
      { method: 'POST', body: JSON.stringify({ boardId, milestoneId }) },
    ),
  linkClickupList: (projectId: string, spaceId: string, listId: string, milestoneId?: string) =>
    request<SyncOperationResult & { matchedCount?: number; totalRemote?: number; milestoneId?: string }>(
      `/projects/${projectId}/sync/clickup/link`,
      { method: 'POST', body: JSON.stringify({ spaceId, listId, milestoneId }) },
    ),

  // Per-(project, milestone) sync configs.
  // The list endpoints return one entry per (projectId, providerId, milestoneId);
  // mutating endpoints take milestoneId in the body/query and default to
  // 'default' (the General milestone) when omitted, which keeps callers that
  // don't yet know about milestones working.
  listIntegrations: (projectId?: string) =>
    request<{ integrations: SyncIntegration[] }>(
      projectId ? `/projects/${projectId}/sync` : '/sync/integrations',
    ),
  saveIntegration: (projectId: string, providerId: 'trello' | 'clickup', body: {
    milestoneId?: string;
    settings?: Record<string, any>;
    enabled?: boolean;
    autoSync?: boolean;
  }) =>
    request<{ integration: SyncIntegration }>(
      `/projects/${projectId}/sync/${providerId}`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  deleteIntegration: (projectId: string, providerId: 'trello' | 'clickup', milestoneId?: string) =>
    request<{ deleted: boolean }>(
      `/projects/${projectId}/sync/${providerId}${milestoneId ? `?milestoneId=${encodeURIComponent(milestoneId)}` : ''}`,
      { method: 'DELETE' },
    ),
  testIntegration: (projectId: string, providerId: 'trello' | 'clickup', milestoneId?: string, overrides?: Record<string, any>) =>
    request<{ ok: boolean; message: string }>(
      `/projects/${projectId}/sync/${providerId}/test`,
      { method: 'POST', body: JSON.stringify({ milestoneId, overrides }) },
    ),
  pushIntegration: (projectId: string, providerId: 'trello' | 'clickup', milestoneId?: string) =>
    request<SyncOperationResult>(
      `/projects/${projectId}/sync/${providerId}/push`,
      { method: 'POST', body: JSON.stringify({ milestoneId }) },
    ),
  pullIntegration: (projectId: string, providerId: 'trello' | 'clickup', milestoneId?: string) =>
    request<SyncOperationResult>(
      `/projects/${projectId}/sync/${providerId}/pull`,
      { method: 'POST', body: JSON.stringify({ milestoneId }) },
    ),
  mergeIntegration: (projectId: string, providerId: 'trello' | 'clickup', milestoneId?: string) =>
    request<SyncOperationResult>(
      `/projects/${projectId}/sync/${providerId}/merge`,
      { method: 'POST', body: JSON.stringify({ milestoneId }) },
    ),

  // Git
  getGitStatus: (projectId: string, subrepo?: string) => request<any>(`/projects/${projectId}/git/status${subrepo ? `?subrepo=${encodeURIComponent(subrepo)}` : ''}`),
  getGitDiff: (projectId: string, file?: string, staged = false, subrepo?: string) => request<{ diff: string }>(`/projects/${projectId}/git/diff?${file ? `file=${encodeURIComponent(file)}&` : ''}staged=${staged}${subrepo ? `&subrepo=${encodeURIComponent(subrepo)}` : ''}`),
  getGitFileAtRef: (projectId: string, file: string, ref = 'HEAD', subrepo?: string) => request<{ content: string }>(`/projects/${projectId}/git/show?file=${encodeURIComponent(file)}&ref=${encodeURIComponent(ref)}${subrepo ? `&subrepo=${encodeURIComponent(subrepo)}` : ''}`),
  stageFile: (projectId: string, file: string, subrepo?: string) => request(`/projects/${projectId}/git/stage`, { method: 'POST', body: JSON.stringify({ file, subrepo }) }),
  stageAll: (projectId: string, subrepo?: string) => request(`/projects/${projectId}/git/stage-all`, { method: 'POST', body: JSON.stringify({ subrepo }) }),
  unstageFile: (projectId: string, file: string, subrepo?: string) => request(`/projects/${projectId}/git/unstage`, { method: 'POST', body: JSON.stringify({ file, subrepo }) }),
  unstageAll: (projectId: string, subrepo?: string) => request(`/projects/${projectId}/git/unstage-all`, { method: 'POST', body: JSON.stringify({ subrepo }) }),
  gitCommit: (projectId: string, message: string, subrepo?: string) => request(`/projects/${projectId}/git/commit`, { method: 'POST', body: JSON.stringify({ message, subrepo }) }),
  gitPush: (projectId: string, subrepo?: string) => request(`/projects/${projectId}/git/push`, { method: 'POST', body: JSON.stringify({ subrepo }) }),
  gitPull: (projectId: string, subrepo?: string) => request(`/projects/${projectId}/git/pull`, { method: 'POST', body: JSON.stringify({ subrepo }) }),
  getGitLog: (projectId: string, subrepo?: string) => request<any>(`/projects/${projectId}/git/log${subrepo ? `?subrepo=${encodeURIComponent(subrepo)}` : ''}`),
  getGitBranches: (projectId: string, subrepo?: string) => request<any>(`/projects/${projectId}/git/branches${subrepo ? `?subrepo=${encodeURIComponent(subrepo)}` : ''}`),
  checkoutBranch: (projectId: string, branch: string, subrepo?: string) =>
    request<{ success: boolean; branch: string }>(`/projects/${projectId}/git/checkout`, { method: 'POST', body: JSON.stringify({ branch, subrepo }) }),
  getGitMainCommit: (projectId: string, subrepo?: string) => request<{ commit: { hash: string; message: string; date: string; author_name: string; isMerged: boolean } | null }>(`/projects/${projectId}/git/main-commit${subrepo ? `?subrepo=${encodeURIComponent(subrepo)}` : ''}`),
  getCommitDiff: (projectId: string, hash: string, subrepo?: string) =>
    request<{ files: { file: string; status: string; additions: number; deletions: number }[]; diff: string }>(
      `/projects/${projectId}/git/commit-diff?hash=${encodeURIComponent(hash)}${subrepo ? `&subrepo=${encodeURIComponent(subrepo)}` : ''}`
    ),
  getTaskGitReview: (projectId: string, since: string, until?: string, subrepo?: string) =>
    request<TaskGitReview>(
      `/projects/${projectId}/git/task-review?since=${encodeURIComponent(since)}${until ? `&until=${encodeURIComponent(until)}` : ''}${subrepo ? `&subrepo=${encodeURIComponent(subrepo)}` : ''}`
    ),
  discardFile: (projectId: string, file: string, type: 'staged' | 'unstaged' | 'untracked', subrepo?: string) =>
    request(`/projects/${projectId}/git/discard`, { method: 'POST', body: JSON.stringify({ file, type, subrepo }) }),
  discardAll: (projectId: string, section: 'staged' | 'unstaged', subrepo?: string) =>
    request(`/projects/${projectId}/git/discard-all`, { method: 'POST', body: JSON.stringify({ section, subrepo }) }),
  undoCommit: (projectId: string, subrepo?: string) =>
    request(`/projects/${projectId}/git/undo-commit`, { method: 'POST', body: JSON.stringify({ subrepo }) }),
  generateCommitMessage: (projectId: string, subrepo?: string) =>
    request<{ message: string; source: 'cli' | 'api' }>(`/projects/${projectId}/git/generate-commit-message`, { method: 'POST', body: JSON.stringify({ subrepo }), timeout: 70_000 }),

  // Terminals (native launchers)
  launchTerminal: (projectId: string, type: string) => request('/terminals/launch', { method: 'POST', body: JSON.stringify({ projectId, type }) }),
  openFolder: (projectId: string) => request('/terminals/folder', { method: 'POST', body: JSON.stringify({ projectId }) }),

  // Integrated terminal
  getTerminalStatus: () => request<{ available: boolean }>('/terminal/status'),
  getTerminalSessions: (projectId?: string) =>
    request<{ sessions: { id: string; projectId: string; type: string; title: string; createdAt: string }[] }>(
      `/terminal/sessions${projectId ? `?projectId=${projectId}` : ''}`
    ),
  createTerminalSession: (projectId: string, type = 'shell', cols = 80, rows = 24, taskId?: string, prompt?: string, agent?: string) =>
    request<{ id: string; projectId: string; type: string; title: string; createdAt: string; taskId?: string; agent?: string }>(
      '/terminal/sessions',
      { method: 'POST', body: JSON.stringify({ projectId, type, cols, rows, ...(taskId ? { taskId } : {}), ...(prompt ? { prompt } : {}), ...(agent ? { agent } : {}) }) }
    ),
  killTerminalSession: (sessionId: string) =>
    request('/terminal/sessions/' + sessionId, { method: 'DELETE' }),
  getAiTerminalSessions: () =>
    request<{ sessions: { id: string; projectId: string; type: string; taskId: string; createdAt: string }[] }>(
      '/terminal/ai-sessions'
    ),
  writeToTerminalSession: (sessionId: string, data: string) =>
    request<{ success: boolean }>(`/terminal/sessions/${sessionId}/write`, { method: 'POST', body: JSON.stringify({ data }) }),
  uploadTerminalClipboardImage: (sessionId: string, mimeType: string, data: string) =>
    request<{ path: string; expiresInMs: number }>(`/terminal/sessions/${sessionId}/clipboard-image`, {
      method: 'POST',
      body: JSON.stringify({ mimeType, data }),
      timeout: 20_000,
    }),
  getAiResolvePrompt: (projectId: string, taskId: string, feedback?: string) =>
    request<{ prompt: string }>(`/projects/${projectId}/tasks/${taskId}/ai-resolve`, {
      method: 'POST',
      ...(feedback?.trim() ? { body: JSON.stringify({ feedback }) } : {}),
    }),
  getAiManagePrompt: (projectId: string, rawText: string) =>
    request<{ prompt: string }>(`/projects/${projectId}/ai-manage-prompt`, { method: 'POST', body: JSON.stringify({ rawText }) }),

  // Project management
  scanDirectory: (directory: string) => request<{ projects: { path: string; name: string; techStack: string[]; isGitRepo: boolean }[] }>('/projects/scan', { method: 'POST', body: JSON.stringify({ directory }) }),
  addProjects: (paths: string[]) => request<{ projects: any[] }>('/projects/add', { method: 'POST', body: JSON.stringify({ paths }) }),
  removeProject: (path: string) => request<{ projects: any[] }>('/projects/remove', { method: 'POST', body: JSON.stringify({ path }) }),

  // Settings
  getSettings: () => request<{ tasksDir: string }>('/settings'),

  // Coding agents (which CLI runs a task)
  getAgents: () => request<{ agents: Agent[]; defaultAgent: string }>('/agents'),
  saveAgents: (body: { agents?: Agent[]; defaultAgent?: string }) =>
    request<{ agents: Agent[]; defaultAgent: string }>('/agents', { method: 'PUT', body: JSON.stringify(body) }),

  // Browse filesystem
  browse: (path: string) => request<{ directories: { name: string; path: string }[] }>('/browse', { method: 'POST', body: JSON.stringify({ path }) }),

  // Claude AI
  getClaudeStatus: () => request<{ configured: boolean; cliAvailable: boolean; oauthAvailable: boolean; activeBackend: 'cli-oauth' | 'cli' | 'api' | null; model: string | null; maxTokens: number | null }>('/claude/status'),
  getClaudeUsage: () => request<ClaudeUsage>('/claude/usage'),
  saveClaudeConfig: (data: { apiKey: string; model?: string; maxTokens?: number }) =>
    request<{ ok: boolean }>('/claude/config', { method: 'POST', body: JSON.stringify(data) }),
  deleteClaudeConfig: () => request<{ ok: boolean }>('/claude/config', { method: 'DELETE' }),
  testClaudeKey: (apiKey: string) =>
    request<{ ok: boolean; error?: string }>('/claude/config/test', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  analyzeTask: (projectId: string, title: string, taskId?: string) =>
    request<{ title: string; description: string; prompt: string; effort?: 1 | 2 | 3 | 5 | 8; effortConfidence?: 'low' | 'medium' | 'high' }>('/claude/analyze-task', { method: 'POST', body: JSON.stringify({ projectId, title, taskId }), timeout: 60_000 }),
  classifyTaskEffort: (projectId: string, taskIds?: string[]) =>
    request<{ suggestions: Array<{ taskId: string; title: string; effort: 1 | 2 | 3 | 5 | 8; confidence: 'low' | 'medium' | 'high'; rationale: string }> }>(
      '/claude/classify-task-effort', { method: 'POST', body: JSON.stringify({ projectId, taskIds }), timeout: 180_000 }
    ),
  applyTaskEffort: (projectId: string, assignments: Array<{ taskId: string; effort: 1 | 2 | 3 | 5 | 8; confidence?: 'low' | 'medium' | 'high' }>) =>
    request<{ updated: number }>(`/projects/${projectId}/tasks/effort/apply`, { method: 'POST', body: JSON.stringify({ assignments }) }),  bulkOrganizeTasks: (projectId: string, rawText: string) =>
    request<{ tasks: Array<{ title: string; description: string; prompt: string; priority: string; effort?: 1 | 2 | 3 | 5 | 8; status: string }> }>(
      '/claude/bulk-organize', { method: 'POST', body: JSON.stringify({ projectId, rawText }) }
    ),
  manageTasks: (projectId: string, rawText: string, existingTasks: Array<{ id: string; title: string; description: string; status: string; priority: string }>) =>
    request<{ actions: Array<{ type: string; task?: any; taskId?: string; changes?: any; reason?: string; title?: string; existingTaskId?: string }>; summary: string }>(
      '/claude/manage-tasks', { method: 'POST', body: JSON.stringify({ projectId, rawText, existingTasks }) }
    ),
  // MCP Server
  getMcpStatus: () => request<{
    enabled: boolean;
    requireAuth: boolean;
    clients: Array<{ clientId: string; clientName: string; createdAt: string }>;
  }>('/mcp/status'),
  saveMcpConfig: (data: { enabled: boolean; requireAuth?: boolean }) =>
    request<{ ok: boolean; enabled: boolean; requireAuth: boolean }>('/mcp/config', { method: 'POST', body: JSON.stringify(data) }),
  revokeMcpClient: (clientId: string) =>
    request<{ ok: boolean }>(`/mcp/clients/${clientId}`, { method: 'DELETE' }),

  // Logs
  getLogs: (filters?: { level?: string; category?: string; projectId?: string; limit?: number }) => {
    const params = new URLSearchParams()
    if (filters?.level) params.set('level', filters.level)
    if (filters?.category) params.set('category', filters.category)
    if (filters?.projectId) params.set('projectId', filters.projectId)
    if (filters?.limit) params.set('limit', String(filters.limit))
    const qs = params.toString()
    return request<{ logs: any[] }>(`/logs${qs ? `?${qs}` : ''}`)
  },
  getLogStats: () => request<{ total: number; errors: number; warnings: number; byCategory: Record<string, number> }>('/logs/stats'),
  clearLogs: () => request<{ ok: boolean }>('/logs', { method: 'DELETE' }),

  // Search
  searchFiles: (query: string, projectId?: string) =>
    request<{ results: Array<{ name: string; path: string; projectId: string; projectName: string; type: 'file' | 'dir'; extension?: string }> }>(
      `/search/files?q=${encodeURIComponent(query)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`
    ),
  searchContent: (query: string, projectId?: string, caseSensitive = false) =>
    request<{ results: Array<{ file: string; filePath: string; projectId: string; projectName: string; extension?: string; matches: Array<{ line: number; text: string; column: number }> }>; totalMatches: number }>(
      `/search/content?q=${encodeURIComponent(query)}${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}${caseSensitive ? '&caseSensitive=true' : ''}`
    ),

  // Files
  getFileTree: (projectId: string, relPath: string) =>
    request<{ entries: Array<{ name: string; path: string; type: 'file' | 'dir'; size?: number; extension?: string; mimeHint?: string }> }>(
      `/projects/${projectId}/files/tree?path=${encodeURIComponent(relPath)}`
    ),
  getFileContent: (projectId: string, relPath: string) =>
    request<{ content: string; encoding: string; mimeHint: string; size: number }>(
      `/projects/${projectId}/files/content?path=${encodeURIComponent(relPath)}`,
      { headers: { 'Accept': 'application/json' } }
    ),
  deleteFile: (projectId: string, relPath: string) =>
    request<{ success: boolean }>(
      `/projects/${projectId}/files?path=${encodeURIComponent(relPath)}`,
      { method: 'DELETE' }
    ),
  openFileFolder: (projectId: string, relPath: string) =>
    request<{ success: boolean }>(
      `/projects/${projectId}/files/open-folder`,
      { method: 'POST', body: JSON.stringify({ path: relPath }) }
    ),
  saveFileContent: (projectId: string, relPath: string, content: string) =>
    request<{ success: boolean; size: number }>(
      `/projects/${projectId}/files/content`,
      { method: 'PUT', body: JSON.stringify({ path: relPath, content }) }
    ),
  renameFile: (projectId: string, relPath: string, newName: string) =>
    request<{ success: boolean; newPath: string }>(
      `/projects/${projectId}/files/rename`,
      { method: 'POST', body: JSON.stringify({ path: relPath, newName }) }
    ),
  createFile: (projectId: string, parentPath: string, name: string, type: 'file' | 'dir') =>
    request<{ success: boolean; path: string }>(
      `/projects/${projectId}/files/create`,
      { method: 'POST', body: JSON.stringify({ parentPath, name, type }) }
    ),
  copyFile: (projectId: string, sourcePath: string, destParentPath?: string, newName?: string) =>
    request<{ success: boolean; path: string }>(
      `/projects/${projectId}/files/copy`,
      { method: 'POST', body: JSON.stringify({ sourcePath, destParentPath, newName }) }
    ),

  // Reports
  getReportData: (projectId: string, opts: { milestoneId?: string; from?: string; to?: string; includeCommits?: boolean; status?: string[] }) => {
    const params = new URLSearchParams();
    if (opts.milestoneId) params.set('milestone', opts.milestoneId);
    if (opts.from) params.set('from', opts.from);
    if (opts.to) params.set('to', opts.to);
    if (opts.includeCommits) params.set('includeCommits', '1');
    if (opts.status?.length) params.set('status', opts.status.join(','));
    const qs = params.toString();
    return request<any>(`/projects/${projectId}/reports/data${qs ? `?${qs}` : ''}`);
  },
};
