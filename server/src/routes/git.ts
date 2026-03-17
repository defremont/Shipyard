import { FastifyInstance } from 'fastify';
import * as gitService from '../services/gitService.js';
import * as claudeCliService from '../services/claudeCliService.js';
import * as claudeService from '../services/claudeService.js';
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

async function getProjectPath(projectId: string): Promise<string | null> {
  const projects = await getProjects();
  const project = projects.find(p => p.id === projectId);
  return project?.path || null;
}

export async function gitRoutes(app: FastifyInstance) {
  // Track last fetch time per project to avoid fetching too often
  const lastFetch = new Map<string, number>();

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/status',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
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

  app.get<{ Params: { projectId: string }; Querystring: { file?: string; staged?: string } }>(
    '/api/projects/:projectId/git/diff',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
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

  app.post<{ Params: { projectId: string }; Body: { file: string } }>(
    '/api/projects/:projectId/git/stage',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.stageFile(path, request.body.file);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/stage-all',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.stageAll(path);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { file: string } }>(
    '/api/projects/:projectId/git/unstage',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.unstageFile(path, request.body.file);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/unstage-all',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      await gitService.unstageAll(path);
      return { success: true };
    }
  );

  app.post<{ Params: { projectId: string }; Body: { message: string } }>(
    '/api/projects/:projectId/git/commit',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
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

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/push',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
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

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/pull',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
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

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/log',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const log = await gitService.getLog(path);
        return log;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/branches',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });

      try {
        const branches = await gitService.getBranches(path);
        return branches;
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { file: string; type: 'staged' | 'unstaged' | 'untracked' } }>(
    '/api/projects/:projectId/git/discard',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });
      try {
        await gitService.discardFile(path, request.body.file, request.body.type);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string }; Body: { section: 'staged' | 'unstaged' } }>(
    '/api/projects/:projectId/git/discard-all',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
      if (!path) return reply.status(404).send({ error: 'Project not found' });
      try {
        await gitService.discardAll(path, request.body.section);
        return { success: true };
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/undo-commit',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
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
  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/generate-commit-message',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
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

          // Strip context lines (lines not starting with +/-) to reduce token count
          const compactDiff = compactGitDiff(diff, 15000);
          const prompt = 'Write a concise git commit message for this diff. Subject line under 72 chars. If multiple changes, add bullet points in body. Output ONLY the message, no quotes, no markdown fences, no explanation.';
          const commitModel = 'claude-haiku-4-5-20251001';

          // Priority: CLI first (uses Max subscription) → configured API key → error
          const cliOk = await claudeCliService.getCliStatus();
          if (cliOk) {
            try {
              const message = await claudeCliService.runPrompt(prompt, {
                input: compactDiff,
                model: 'haiku',
                maxTurns: 1,
                outputFormat: 'text',
                timeout: 30_000,
                hardTimeout: 45_000,
                cwd: path,
              });
              return { message, source: 'cli' as const };
            } catch (cliErr: any) {
              log.warn('git', 'Commit message CLI failed, trying API', cliErr.message, request.params.projectId);
              // Fall through to configured API key
            }
          }

          // Fallback: configured API key only (not env key)
          const apiKey = (await claudeService.loadClaudeConfig())?.apiKey;
          if (apiKey) {
            try {
              const { default: Anthropic } = await import('@anthropic-ai/sdk');
              const client = new Anthropic({ apiKey, timeout: 20_000 });
              const response = await client.messages.create({
                model: commitModel,
                max_tokens: 256,
                system: prompt,
                messages: [{ role: 'user', content: compactDiff }],
              });
              const text = response.content[0].type === 'text' ? response.content[0].text : '';
              return { message: text.trim(), source: 'api' as const };
            } catch (apiErr: any) {
              log.error('git', 'Commit message API also failed', apiErr.message, request.params.projectId);
              throw apiErr;
            }
          }

          reply.status(503).send({ error: 'No AI available. Install Claude CLI or configure API key.' });
          return null;
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

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/main-commit',
    async (request, reply) => {
      const path = await getProjectPath(request.params.projectId);
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
