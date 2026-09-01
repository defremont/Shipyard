import { FastifyInstance } from 'fastify';
import { join } from 'path';
import * as gitService from '../services/gitService.js';
import * as aiBackend from '../services/aiBackend.js';
import { getProjects } from '../services/projectDiscovery.js';
import * as log from '../services/logService.js';

/**
 * Strip context lines from a git diff, keeping only +/- lines, file headers,
 * and hunk headers. This significantly reduces token count for AI processing.
 */
function compactGitDiff(diff: string, maxLen: number): string {
  const lines = diff.split('\n');
  const kept: string[] = [];
  let totalLen = 0;

  for (const line of lines) {
    // Always keep: diff headers, file names, hunk headers, +/- lines
    if (
      line.startsWith('diff ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('@@') ||
      line.startsWith('+') ||
      line.startsWith('-')
    ) {
      if (totalLen + line.length > maxLen) break;
      kept.push(line);
      totalLen += line.length + 1;
    }
  }

  return kept.join('\n');
}

async function getProjectPath(projectId: string, subrepo?: string): Promise<string | null> {
  const projects = await getProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project?.path) return null;
  if (subrepo) {
    // Validate subrepo is in the allowed list
    if (!project.subRepos?.includes(subrepo)) return null;
    return join(project.path, subrepo);
  }
  return project.path;
}

export async function gitRoutes(app: FastifyInstance) {
  // Track last fetch time per project to avoid fetching too often
  const lastFetch = new Map<string, number>();

  app.get<{ Params: { projectId: string }; Querystring: { subrepo?: string } }>(
    '/api/projects/:projectId/git/status',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.query.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        // Fetch at most once per 60s to keep ahead/behind accurate
        const now = Date.now();
        const last = lastFetch.get(path) || 0;
        if (now - last > 60_000) {
          lastFetch.set(path, now);
          await gitService.fetch(path);
        }

        const status = await gitService.getStatus(path);
        return status;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get<{ Params: { projectId: string }; Querystring: { file?: string; staged?: string; subrepo?: string } }>(
    '/api/projects/:projectId/git/diff',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.query.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const staged = request.query.staged === 'true';
        const diff = await gitService.getDiff(path, request.query.file, staged);
        return { diff };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get<{ Params: { projectId: string }; Querystring: { file: string; ref?: string; subrepo?: string } }>(
    '/api/projects/:projectId/git/show',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.query.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const content = await gitService.getFileAtRef(path, request.query.file, request.query.ref || 'HEAD');
        return { content };
      } catch (err: any) {
        // File may not exist in HEAD (new file) — various git error messages
        if (err.message?.includes('does not exist') || err.message?.includes('exists on disk') || err.message?.includes('fatal')) {
          return { content: '' };
        }
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { file: string; subrepo?: string } }>(
    '/api/projects/:projectId/git/stage',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.body.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.stageFile(path, request.body.file);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { subrepo?: string } }>(
    '/api/projects/:projectId/git/stage-all',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, (request.body as any)?.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.stageAll(path);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { file: string; subrepo?: string } }>(
    '/api/projects/:projectId/git/unstage',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.body.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.unstageFile(path, request.body.file);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { subrepo?: string } }>(
    '/api/projects/:projectId/git/unstage-all',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, (request.body as any)?.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.unstageAll(path);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { message: string; subrepo?: string } }>(
    '/api/projects/:projectId/git/commit',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.body.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const hash = await gitService.commit(path, request.body.message);
        log.info('git', `Commit created: ${hash}`, request.body.message.substring(0, 100), request.params.projectId);
        return { commit: hash };
      } catch (err: any) {
        log.error('git', `Commit failed`, err.message, request.params.projectId);
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { subrepo?: string } }>(
    '/api/projects/:projectId/git/push',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, (request.body as any)?.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        await gitService.push(path);
        log.info('git', 'Push completed', undefined, request.params.projectId);
        return { success: true };
      } catch (err: any) {
        log.error('git', 'Push failed', err.message, request.params.projectId);
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { subrepo?: string } }>(
    '/api/projects/:projectId/git/pull',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, (request.body as any)?.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        await gitService.pull(path);
        log.info('git', 'Pull completed', undefined, request.params.projectId);
        return { success: true };
      } catch (err: any) {
        log.error('git', 'Pull failed', err.message, request.params.projectId);
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get<{ Params: { projectId: string }; Querystring: { subrepo?: string } }>(
    '/api/projects/:projectId/git/log',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.query.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const log = await gitService.getLog(path);
        return log;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get<{ Params: { projectId: string }; Querystring: { subrepo?: string } }>(
    '/api/projects/:projectId/git/branches',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.query.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const branches = await gitService.getBranches(path);
        return branches;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { branch: string; subrepo?: string } }>(
    '/api/projects/:projectId/git/checkout',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.body.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      const { branch } = request.body;
      if (!branch || typeof branch !== 'string') {
        return reply.status(400).send({ error: 'Branch name is required' });
      }

      try {
        await gitService.checkoutBranch(path, branch);
        log.info('git', `Switched to branch: ${branch}`, undefined, request.params.projectId);
        return { success: true, branch };
      } catch (err: any) {
        log.error('git', `Checkout failed: ${branch}`, err.message, request.params.projectId);
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { file: string; type: 'staged' | 'unstaged' | 'untracked'; subrepo?: string } }>(
    '/api/projects/:projectId/git/discard',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.body.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });
      try {
        await gitService.discardFile(path, request.body.file, request.body.type);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { section: 'staged' | 'unstaged'; subrepo?: string } }>(
    '/api/projects/:projectId/git/discard-all',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.body.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });
      try {
        await gitService.discardAll(path, request.body.section);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { subrepo?: string } }>(
    '/api/projects/:projectId/git/undo-commit',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, (request.body as any)?.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        await gitService.undoLastCommit(path);
        return { success: true };
      } catch (err: any) {
        return reply.status(400).send({ error: err.message });
      }
    }
  );

  // Generate commit message via CLI (priority) or configured API key (fallback)
  app.post<{ Params: { projectId: string }; Body: { subrepo?: string } }>(
    '/api/projects/:projectId/git/generate-commit-message',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, (request.body as any)?.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      // Hard deadline for the entire handler — prevents infinite waits
      const DEADLINE = 60_000;
      const deadline = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Commit message generation timed out (60s)')), DEADLINE)
      );

      try {
        const result = await Promise.race([deadline, (async () => {
          const diff = await gitService.getDiff(path, undefined, true);
          if (!diff.trim()) {
            reply.status(400).send({ error: 'No staged changes' });
            return null;
          }

          // Get recent commit messages for style consistency (like VS Code extensions)
          let recentMessages = '';
          try {
            const logResult = await gitService.getLog(path, 10);
            recentMessages = logResult.all
              .map(c => c.message.split('\n')[0]) // subject lines only
              .join('\n');
          } catch { /* ignore — new repo with no commits */ }

          // Strip context lines (lines not starting with +/-) to reduce token count
          const compactDiff = compactGitDiff(diff, 12000);

          // Build prompt instructions (without diff — diff goes via temp file for CLI)
          const instructions = [
            'You are a git commit message generator. Write a commit message for the staged changes.',
            '',
            'Rules:',
            '- Subject line: concise, imperative mood ("Add feature" not "Added feature"), under 72 chars',
            '- If the change is small/single-purpose, output ONLY the subject line (no body)',
            '- If multiple unrelated changes, add a blank line then bullet points in the body',
            '- Output ONLY the raw commit message — no quotes, no markdown fences, no explanation',
            '- Language: match the language of the recent commits below (if available)',
          ];
          if (recentMessages) {
            instructions.push('', `Recent commits (match this style):\n${recentMessages}`);
          }
          const systemPrompt = instructions.join('\n');

          const cleanMsg = (s: string) => s.replace(/^["'`]+|["'`]+$/g, '').replace(/^```\w*\n?|\n?```$/g, '').trim();

          // Unified backend: CLI OAuth → CLI subprocess → configured API key
          try {
            const result = await aiBackend.generateText(systemPrompt, compactDiff, {
              maxTokens: 256,
              timeout: 25_000,
              cwd: path,
            });
            return { message: cleanMsg(result.text), source: result.source };
          } catch (aiErr: any) {
            if (aiErr instanceof aiBackend.NoAiAvailableError) {
              reply.status(503).send({ error: aiErr.message });
              return null;
            }
            throw aiErr;
          }
        })()]);

        if (result) return result;
      } catch (err: any) {
        log.error('git', 'Generate commit message failed', err.message, request.params.projectId);
        if (!reply.sent) {
          return reply.status(500).send({ error: err.message || 'Failed to generate commit message' });
        }
      }
    }
  );

  app.get<{ Params: { projectId: string }; Querystring: { hash: string; subrepo?: string } }>(
    '/api/projects/:projectId/git/commit-diff',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.query.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });
      const { hash } = request.query;
      if (!hash || typeof hash !== 'string') return reply.status(400).send({ error: 'Commit hash is required' });

      try {
        const result = await gitService.getCommitDiff(path, hash);
        return result;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  // Everything the task Review tab needs in one call: the branch the work
  // happened on, the commits inside the task's window, and what is still
  // uncommitted in the working tree.
  app.get<{ Params: { projectId: string }; Querystring: { since: string; until?: string; subrepo?: string } }>(
    '/api/projects/:projectId/git/task-review',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.query.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      const { since, until } = request.query;
      if (!since || isNaN(Date.parse(since))) {
        return reply.status(400).send({ error: 'since must be an ISO date' });
      }
      if (until && isNaN(Date.parse(until))) {
        return reply.status(400).send({ error: 'until must be an ISO date' });
      }

      try {
        const [status, commits] = await Promise.all([
          gitService.getStatus(path),
          gitService.getCommitsSince(path, since, until),
        ]);

        // One row per file across the whole window, so the reviewer sees the
        // surface area without expanding every commit.
        const byFile = new Map<string, { file: string; additions: number; deletions: number; commits: number }>();
        for (const commit of commits) {
          for (const file of commit.files) {
            const entry = byFile.get(file.file) || { file: file.file, additions: 0, deletions: 0, commits: 0 };
            entry.additions += file.additions;
            entry.deletions += file.deletions;
            entry.commits += 1;
            byFile.set(file.file, entry);
          }
        }
        const files = [...byFile.values()].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));

        return {
          available: true,
          branch: status.current || null,
          commits,
          files,
          additions: commits.reduce((sum, c) => sum + c.additions, 0),
          deletions: commits.reduce((sum, c) => sum + c.deletions, 0),
          working: {
            staged: status.staged.length,
            unstaged: status.modified.length + status.deleted.length,
            untracked: status.not_added.length,
          },
        };
      } catch {
        // Not a git repo (or git is unhappy) — the tab degrades to a notice
        return { available: false, branch: null, commits: [], files: [], additions: 0, deletions: 0, working: null };
      }
    }
  );

  app.get<{ Params: { projectId: string }; Querystring: { subrepo?: string } }>(
    '/api/projects/:projectId/git/main-commit',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId, request.query.subrepo);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const commit = await gitService.getMainBranchLastCommit(path);
        return { commit };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );
}
