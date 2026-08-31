export interface Project {
  id: string;
  name: string;
  path: string;
  category: string;
  isGitRepo: boolean;
  gitBranch?: string;
  gitDirty?: boolean;
  gitAhead?: number;       // Commits ahead of remote (not pushed)
  gitBehind?: number;      // Commits behind remote (not pulled)
  gitStaged?: number;      // Number of staged files
  gitUnstaged?: number;    // Number of modified but unstaged files
  gitUntracked?: number;   // Number of untracked files
  lastCommitDate?: string;
  lastCommitMessage?: string;
  gitRemoteUrl?: string;
  techStack: string[];
  favorite: boolean;
  lastOpenedAt?: string;
  externalLink?: string;
  notes?: string;
  links?: { label: string; url: string }[];
  subRepos?: string[];   // Relative paths to sub-directories that are git repos (e.g. ['client', 'server'])
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface TaskAttachment {
  id: string;
  name: string;
  url: string;
  mimeType?: string;
  bytes?: number;
  isImage?: boolean;
  date?: string;
  source: 'trello';
}

export interface TaskComment {
  id: string;
  author?: string;
  text: string;
  date: string;
  source: 'trello';
}

export type EffortPoints = 1 | 2 | 3 | 5 | 8;
export type EffortSource = 'claude' | 'manual' | 'backfill';
export type EffortConfidence = 'low' | 'medium' | 'high';

export interface Task {
  id: string;
  number?: number;        // Human-friendly sequential number per project (#1, #2, ...)
  projectId: string;
  milestoneId?: string;   // References Milestone.id; undefined/'default' = default milestone
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  effort?: EffortPoints;
  effortSource?: EffortSource;
  effortConfidence?: EffortConfidence;
  status: 'backlog' | 'todo' | 'in_progress' | 'done';
  prompt?: string;
  createdAt: string;
  updatedAt: string;
  order: number;
  // Status change timestamps
  inboxAt?: string;       // When moved to backlog/todo
  inProgressAt?: string;  // When moved to in_progress
  doneAt?: string;        // When moved to done
  needsReview?: boolean;  // True when AI resolved — cleared when user views the task
  subtasks?: Subtask[];
  attachments?: TaskAttachment[];  // Pulled from the remote board — remote is authoritative
  comments?: TaskComment[];        // Pulled from the remote board — remote is authoritative
}

export interface Milestone {
  id: string;             // nanoid(10) or 'default'
  projectId: string;
  name: string;
  description?: string;
  status: 'active' | 'closed';
  createdAt: string;
  updatedAt: string;
  order: number;
}

export interface ProjectsCache {
  projects: Project[];
  lastScannedAt: string;
}

export interface TasksFile {
  milestones?: Milestone[];
  tasks: Task[];
}

export interface Settings {
  // Paths of projects the user has added to the dashboard
  selectedProjects: string[];
}

// ── Claude API Integration ──────────────────────────────

export interface ClaudeConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── MCP Server Integration ──────────────────────────────

export interface McpConfig {
  enabled: boolean;
  requireAuth: boolean;
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  scope: string;
  expiresAt: number;
  createdAt: number;
}

export interface McpAuthData {
  jwtSecret: string;
  clients: OAuthClient[];
  authCodes: Array<{
    code: string;
    clientId: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    redirectUri: string;
    expiresAt: number;
    scope: string;
  }>;
  refreshTokens: Array<{
    token: string;
    clientId: string;
    scope: string;
    expiresAt: number;
  }>;
}
