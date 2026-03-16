const BASE_URL = '/api';

interface RequestOptions extends RequestInit {
  timeout?: number;
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
  createTask: (projectId: string, data: any) => request(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (projectId: string, taskId: string, data: any) => request(`/projects/${projectId}/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTask: (projectId: string, taskId: string) => request(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }),
  reorderTasks: (projectId: string, taskIds: string[]) => request(`/projects/${projectId}/tasks/reorder`, { method: 'POST', body: JSON.stringify({ taskIds }) }),
  importTasks: (projectId: string, tasks: any[]) => request<{ imported: number }>(`/projects/${projectId}/tasks/import`, { method: 'POST', body: JSON.stringify({ tasks }) }),
  importAllTasks: (tasks: any[]) => request<{ imported: number }>('/tasks/import', { method: 'POST', body: JSON.stringify({ tasks }) }),
  applyCsvChanges: (projectId: string, changes: { update: any[]; create: any[]; remove: string[] }) =>
    request<{ updated: number; created: number; removed: number }>(`/projects/${projectId}/tasks/csv-apply`, { method: 'POST', body: JSON.stringify(changes) }),
  replaceTasks: (projectId: string, tasks: any[], milestoneId?: string) =>
    request<{ tasks: any[] }>(`/projects/${projectId}/tasks/replace`, { method: 'POST', body: JSON.stringify({ tasks, milestoneId }) }),

  // Sync (stateless proxy)
  syncProxy: (url: string, method: 'GET' | 'POST', payload?: unknown, action?: string) =>
    request<{ data: any; error?: string }>('/sync/proxy', { method: 'POST', body: JSON.stringify({ url, method, payload, action }) }),
  syncTest: (url: string) =>
    request<{ ok: boolean; error?: string; data?: any }>('/sync/test', { method: 'POST', body: JSON.stringify({ url }) }),

  // Git
  getGitStatus: (projectId: string) => request<any>(`/projects/${projectId}/git/status`),
  getGitDiff: (projectId: string, file?: string, staged = false) => request<{ diff: string }>(`/projects/${projectId}/git/diff?${file ? `file=${encodeURIComponent(file)}&` : ''}staged=${staged}`),
  stageFile: (projectId: string, file: string) => request(`/projects/${projectId}/git/stage`, { method: 'POST', body: JSON.stringify({ file }) }),
  stageAll: (projectId: string) => request(`/projects/${projectId}/git/stage-all`, { method: 'POST' }),
  unstageFile: (projectId: string, file: string) => request(`/projects/${projectId}/git/unstage`, { method: 'POST', body: JSON.stringify({ file }) }),
  unstageAll: (projectId: string) => request(`/projects/${projectId}/git/unstage-all`, { method: 'POST' }),
  gitCommit: (projectId: string, message: string) => request(`/projects/${projectId}/git/commit`, { method: 'POST', body: JSON.stringify({ message }) }),
  gitPush: (projectId: string) => request(`/projects/${projectId}/git/push`, { method: 'POST' }),
  gitPull: (projectId: string) => request(`/projects/${projectId}/git/pull`, { method: 'POST' }),
  getGitLog: (projectId: string) => request<any>(`/projects/${projectId}/git/log`),
  getGitBranches: (projectId: string) => request<any>(`/projects/${projectId}/git/branches`),
  getGitMainCommit: (projectId: string) => request<{ commit: { hash: string; message: string; date: string; author_name: string; isMerged: boolean } | null }>(`/projects/${projectId}/git/main-commit`),
  discardFile: (projectId: string, file: string, type: 'staged' | 'unstaged' | 'untracked') =>
    request(`/projects/${projectId}/git/discard`, { method: 'POST', body: JSON.stringify({ file, type }) }),
  discardAll: (projectId: string, section: 'staged' | 'unstaged') =>
    request(`/projects/${projectId}/git/discard-all`, { method: 'POST', body: JSON.stringify({ section }) }),
  undoCommit: (projectId: string) =>
    request(`/projects/${projectId}/git/undo-commit`, { method: 'POST' }),
  generateCommitMessage: (projectId: string) =>
    request<{ message: string; source: 'cli' | 'api' }>(`/projects/${projectId}/git/generate-commit-message`, { method: 'POST', timeout: 70_000 }),

  // Terminals (native launchers)
  launchTerminal: (projectId: string, type: string) => request('/terminals/launch', { method: 'POST', body: JSON.stringify({ projectId, type }) }),
  openFolder: (projectId: string) => request('/terminals/folder', { method: 'POST', body: JSON.stringify({ projectId }) }),

  // Integrated terminal
  getTerminalStatus: () => request<{ available: boolean }>('/terminal/status'),
  getTerminalSessions: (projectId?: string) =>
    request<{ sessions: { id: string; projectId: string; type: string; title: string; createdAt: string }[] }>(
      `/terminal/sessions${projectId ? `?projectId=${projectId}` : ''}`
    ),
  createTerminalSession: (projectId: string, type = 'shell', cols = 80, rows = 24, taskId?: string, prompt?: string) =>
    request<{ id: string; projectId: string; type: string; title: string; createdAt: string; taskId?: string }>(
      '/terminal/sessions',
      { method: 'POST', body: JSON.stringify({ projectId, type, cols, rows, ...(taskId ? { taskId } : {}), ...(prompt ? { prompt } : {}) }) }
    ),
  killTerminalSession: (sessionId: string) =>
    request('/terminal/sessions/' + sessionId, { method: 'DELETE' }),
  getAiTerminalSessions: () =>
    request<{ sessions: { id: string; projectId: string; type: string; taskId: string; createdAt: string }[] }>(
      '/terminal/ai-sessions'
    ),
  writeToTerminalSession: (sessionId: string, data: string) =>
    request<{ success: boolean }>(`/terminal/sessions/${sessionId}/write`, { method: 'POST', body: JSON.stringify({ data }) }),
  getAiResolvePrompt: (projectId: string, taskId: string) =>
    request<{ prompt: string }>(`/projects/${projectId}/tasks/${taskId}/ai-resolve`, { method: 'POST' }),
  getAiManagePrompt: (projectId: string, rawText: string) =>
    request<{ prompt: string }>(`/projects/${projectId}/ai-manage-prompt`, { method: 'POST', body: JSON.stringify({ rawText }) }),

  // Project management
  scanDirectory: (directory: string) => request<{ projects: { path: string; name: string; techStack: string[]; isGitRepo: boolean }[] }>('/projects/scan', { method: 'POST', body: JSON.stringify({ directory }) }),
  addProjects: (paths: string[]) => request<{ projects: any[] }>('/projects/add', { method: 'POST', body: JSON.stringify({ paths }) }),
  removeProject: (path: string) => request<{ projects: any[] }>('/projects/remove', { method: 'POST', body: JSON.stringify({ path }) }),

  // Settings
  getSettings: () => request<{ tasksDir: string }>('/settings'),

  // Browse filesystem
  browse: (path: string) => request<{ directories: { name: string; path: string }[] }>('/browse', { method: 'POST', body: JSON.stringify({ path }) }),

  // Claude AI
  getClaudeStatus: () => request<{ configured: boolean; cliAvailable: boolean; model: string | null; maxTokens: number | null }>('/claude/status'),
  saveClaudeConfig: (data: { apiKey: string; model?: string; maxTokens?: number }) =>
    request<{ ok: boolean }>('/claude/config', { method: 'POST', body: JSON.stringify(data) }),
  deleteClaudeConfig: () => request<{ ok: boolean }>('/claude/config', { method: 'DELETE' }),
  testClaudeKey: (apiKey: string) =>
    request<{ ok: boolean; error?: string }>('/claude/config/test', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  analyzeTask: (projectId: string, title: string, taskId?: string) =>
    request<{ title: string; description: string; prompt: string }>('/claude/analyze-task', { method: 'POST', body: JSON.stringify({ projectId, title, taskId }), timeout: 30_000 }),
  bulkOrganizeTasks: (projectId: string, rawText: string) =>
    request<{ tasks: Array<{ title: string; description: string; prompt: string; priority: string; status: string }> }>(
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
};
