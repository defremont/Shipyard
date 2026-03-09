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

  // Git
  getGitStatus: (projectId: string) => request<any>(`/projects/${projectId}/git/status`),
  getGitDiff: (projectId: string, file?: string) => request<{ diff: string }>(`/projects/${projectId}/git/diff${file ? `?file=${encodeURIComponent(file)}` : ''}`),
  stageFile: (projectId: string, file: string) => request(`/projects/${projectId}/git/stage`, { method: 'POST', body: JSON.stringify({ file }) }),
  stageAll: (projectId: string) => request(`/projects/${projectId}/git/stage-all`, { method: 'POST' }),
  unstageFile: (projectId: string, file: string) => request(`/projects/${projectId}/git/unstage`, { method: 'POST', body: JSON.stringify({ file }) }),
  unstageAll: (projectId: string) => request(`/projects/${projectId}/git/unstage-all`, { method: 'POST' }),
  gitCommit: (projectId: string, message: string) => request(`/projects/${projectId}/git/commit`, { method: 'POST', body: JSON.stringify({ message }) }),
  gitPush: (projectId: string) => request(`/projects/${projectId}/git/push`, { method: 'POST' }),
  gitPull: (projectId: string) => request(`/projects/${projectId}/git/pull`, { method: 'POST' }),
  getGitLog: (projectId: string) => request<any>(`/projects/${projectId}/git/log`),
  getGitBranches: (projectId: string) => request<any>(`/projects/${projectId}/git/branches`),

  // Terminals
  launchTerminal: (projectId: string, type: string) => request('/terminals/launch', { method: 'POST', body: JSON.stringify({ projectId, type }) }),
  launchVSCode: (projectId: string) => request('/terminals/vscode', { method: 'POST', body: JSON.stringify({ projectId }) }),
  openFolder: (projectId: string) => request('/terminals/folder', { method: 'POST', body: JSON.stringify({ projectId }) }),

  // Project management
  scanDirectory: (directory: string) => request<{ projects: { path: string; name: string; techStack: string[]; isGitRepo: boolean }[] }>('/projects/scan', { method: 'POST', body: JSON.stringify({ directory }) }),
  addProjects: (paths: string[]) => request<{ projects: any[] }>('/projects/add', { method: 'POST', body: JSON.stringify({ paths }) }),
  removeProject: (path: string) => request<{ projects: any[] }>('/projects/remove', { method: 'POST', body: JSON.stringify({ path }) }),

  // Browse filesystem
  browse: (path: string) => request<{ directories: { name: string; path: string }[] }>('/browse', { method: 'POST', body: JSON.stringify({ path }) }),
};
