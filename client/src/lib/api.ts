const BASE_URL = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    headers,
    ...options,
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

  // Tasks
  getAllTasks: () => request<{ tasks: any[] }>('/tasks/all'),
  getTasks: (projectId: string) => request<{ tasks: any[] }>(`/projects/${projectId}/tasks`),
  createTask: (projectId: string, data: any) => request(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (projectId: string, taskId: string, data: any) => request(`/projects/${projectId}/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTask: (projectId: string, taskId: string) => request(`/projects/${projectId}/tasks/${taskId}`, { method: 'DELETE' }),
  reorderTasks: (projectId: string, taskIds: string[]) => request(`/projects/${projectId}/tasks/reorder`, { method: 'POST', body: JSON.stringify({ taskIds }) }),
  importTasks: (projectId: string, tasks: any[]) => request<{ imported: number }>(`/projects/${projectId}/tasks/import`, { method: 'POST', body: JSON.stringify({ tasks }) }),
  importAllTasks: (tasks: any[]) => request<{ imported: number }>('/tasks/import', { method: 'POST', body: JSON.stringify({ tasks }) }),
  applyCsvChanges: (projectId: string, changes: { update: any[]; create: any[]; remove: string[] }) =>
    request<{ updated: number; created: number; removed: number }>(`/projects/${projectId}/tasks/csv-apply`, { method: 'POST', body: JSON.stringify(changes) }),
  replaceTasks: (projectId: string, tasks: any[]) =>
    request<{ tasks: any[] }>(`/projects/${projectId}/tasks/replace`, { method: 'POST', body: JSON.stringify({ tasks }) }),

  // Sync (stateless proxy)
  syncProxy: (url: string, method: 'GET' | 'POST', payload?: unknown) =>
    request<{ data: any; error?: string }>('/sync/proxy', { method: 'POST', body: JSON.stringify({ url, method, payload }) }),
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

  // Terminals (native launchers)
  launchTerminal: (projectId: string, type: string) => request('/terminals/launch', { method: 'POST', body: JSON.stringify({ projectId, type }) }),
  openFolder: (projectId: string) => request('/terminals/folder', { method: 'POST', body: JSON.stringify({ projectId }) }),

  // Integrated terminal
  getTerminalStatus: () => request<{ available: boolean }>('/terminal/status'),
  getTerminalSessions: (projectId?: string) =>
    request<{ sessions: { id: string; projectId: string; type: string; title: string; createdAt: string }[] }>(
      `/terminal/sessions${projectId ? `?projectId=${projectId}` : ''}`
    ),
  createTerminalSession: (projectId: string, type = 'shell', cols = 80, rows = 24) =>
    request<{ id: string; projectId: string; type: string; title: string; createdAt: string }>(
      '/terminal/sessions',
      { method: 'POST', body: JSON.stringify({ projectId, type, cols, rows }) }
    ),
  killTerminalSession: (sessionId: string) =>
    request('/terminal/sessions/' + sessionId, { method: 'DELETE' }),

  // Project management
  scanDirectory: (directory: string) => request<{ projects: { path: string; name: string; techStack: string[]; isGitRepo: boolean }[] }>('/projects/scan', { method: 'POST', body: JSON.stringify({ directory }) }),
  addProjects: (paths: string[]) => request<{ projects: any[] }>('/projects/add', { method: 'POST', body: JSON.stringify({ paths }) }),
  removeProject: (path: string) => request<{ projects: any[] }>('/projects/remove', { method: 'POST', body: JSON.stringify({ path }) }),

  // Settings
  getSettings: () => request<{ tasksDir: string }>('/settings'),

  // Browse filesystem
  browse: (path: string) => request<{ directories: { name: string; path: string }[] }>('/browse', { method: 'POST', body: JSON.stringify({ path }) }),

  // Claude AI
  getClaudeStatus: () => request<{ configured: boolean; model: string | null; maxTokens: number | null }>('/claude/status'),
  saveClaudeConfig: (data: { apiKey: string; model?: string; maxTokens?: number }) =>
    request<{ ok: boolean }>('/claude/config', { method: 'POST', body: JSON.stringify(data) }),
  deleteClaudeConfig: () => request<{ ok: boolean }>('/claude/config', { method: 'DELETE' }),
  testClaudeKey: (apiKey: string) =>
    request<{ ok: boolean; error?: string }>('/claude/config/test', { method: 'POST', body: JSON.stringify({ apiKey }) }),
  analyzeTask: (projectId: string, title: string, taskId?: string) =>
    request<{ description: string; prompt: string }>('/claude/analyze-task', { method: 'POST', body: JSON.stringify({ projectId, title, taskId }) }),
  bulkOrganizeTasks: (projectId: string, rawText: string) =>
    request<{ tasks: Array<{ title: string; description: string; prompt: string; priority: string; status: string }> }>(
      '/claude/bulk-organize', { method: 'POST', body: JSON.stringify({ projectId, rawText }) }
    ),
  summarizeTasks: (projectId: string) =>
    request<{ summary: string }>('/claude/summarize', { method: 'POST', body: JSON.stringify({ projectId }) }),

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
};
