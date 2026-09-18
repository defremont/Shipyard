import * as deployStore from './deployStore.js';
import * as railway from './railwayService.js';
import { getProjects } from './projectDiscovery.js';
import * as gitService from './gitService.js';
import { join } from 'path';
import * as log from './logService.js';

/**
 * "Did the last build go up?" for one project.
 *
 * Every open tab polls this, so the answer is cached per project: Railway is a
 * remote API and a deploy does not change from one second to the next. A build
 * in flight is worth watching more closely, so it gets a shorter cache.
 */

export type DeployState = 'success' | 'failed' | 'building' | 'idle' | 'unknown';

export interface DeployStatus {
  /** False when the project has no deploy linked — the UI shows nothing. */
  configured: boolean;
  provider?: deployStore.DeployProvider;
  state: DeployState;
  /** Railway's own word for it, kept for the tooltip. */
  rawStatus?: string;
  deployedAt?: string;
  url?: string;
  projectName?: string;
  environmentName?: string;
  serviceName?: string;
  commitMessage?: string;
  commitHash?: string;
  branch?: string;
  /** Link into the Railway dashboard for this project. */
  consoleUrl?: string;
  /** Set when the last read failed; the UI says so instead of lying. */
  error?: string;
  checkedAt: string;
}

const SETTLED_TTL_MS = 60_000;
const IN_FLIGHT_TTL_MS = 15_000;
const ERROR_TTL_MS = 30_000;

const cache = new Map<string, { at: number; ttl: number; status: DeployStatus }>();
const inFlight = new Map<string, Promise<DeployStatus>>();

/** Railway's states, folded into the four the UI draws. */
function toState(raw: string): DeployState {
  switch (raw) {
    case 'SUCCESS':
      return 'success';
    case 'FAILED':
    case 'CRASHED':
      return 'failed';
    case 'BUILDING':
    case 'DEPLOYING':
    case 'INITIALIZING':
    case 'QUEUED':
    case 'WAITING':
    case 'NEEDS_APPROVAL':
      return 'building';
    case 'REMOVED':
    case 'SKIPPED':
    case 'SLEEPING':
      return 'idle';
    default:
      return 'unknown';
  }
}

async function read(projectId: string): Promise<DeployStatus> {
  const link = await deployStore.getLink(projectId);
  const checkedAt = new Date().toISOString();

  if (!link) return { configured: false, state: 'unknown', checkedAt };

  const consoleUrl = `https://railway.com/project/${link.projectId}`;
  const base: DeployStatus = {
    configured: true,
    provider: link.provider,
    state: 'unknown',
    checkedAt,
    consoleUrl,
    ...(link.projectName ? { projectName: link.projectName } : {}),
    ...(link.environmentName ? { environmentName: link.environmentName } : {}),
    ...(link.serviceName ? { serviceName: link.serviceName } : {}),
  };

  try {
    const deployment = await railway.latestDeployment({
      projectId: link.projectId,
      environmentId: link.environmentId,
      serviceId: link.serviceId,
    });
    if (!deployment) return { ...base, state: 'idle' };

    return {
      ...base,
      state: toState(deployment.status),
      rawStatus: deployment.status,
      deployedAt: deployment.createdAt,
      ...(deployment.url || deployment.staticUrl
        ? { url: deployment.url || `https://${deployment.staticUrl}` }
        : {}),
      ...(deployment.commitMessage ? { commitMessage: deployment.commitMessage } : {}),
      ...(deployment.commitHash ? { commitHash: deployment.commitHash.slice(0, 7) } : {}),
      ...(deployment.branch ? { branch: deployment.branch } : {}),
    };
  } catch (err: any) {
    return { ...base, error: err?.message || 'Could not read the deploy status' };
  }
}

export async function getStatus(projectId: string): Promise<DeployStatus> {
  const cached = cache.get(projectId);
  if (cached && Date.now() - cached.at < cached.ttl) return cached.status;

  const running = inFlight.get(projectId);
  if (running) return running;

  const promise = read(projectId)
    .then(status => {
      const ttl = status.error
        ? ERROR_TTL_MS
        : status.state === 'building'
          ? IN_FLIGHT_TTL_MS
          : SETTLED_TTL_MS;
      cache.set(projectId, { at: Date.now(), ttl, status });
      return status;
    })
    .finally(() => {
      inFlight.delete(projectId);
    });

  inFlight.set(projectId, promise);
  return promise;
}

/** Drop a project's cached answer — after linking, unlinking or a token change. */
export function invalidate(projectId?: string): void {
  if (projectId) cache.delete(projectId);
  else cache.clear();
}

// ── Linking projects by their GitHub repository ──────────────────────────
//
// Picking the Railway project by hand, once per project, is the boring part.
// Both sides already know which GitHub repo they build from — Shipyard from
// the git remote, Railway from the service's source — so the match can be
// made for the user and only the genuinely ambiguous cases asked about.

export interface DeployCandidate {
  railwayProjectId: string;
  railwayProjectName: string;
  serviceId: string;
  serviceName: string;
  environmentId?: string;
  environmentName?: string;
}

export interface DeployMatch {
  projectId: string;
  projectName: string;
  repo: string;
  /** Set when the repo came from a sub-repository rather than the project root. */
  subrepo?: string;
  /** Already linked to something — a re-run leaves it alone. */
  linked: boolean;
  candidates: DeployCandidate[];
}

export interface MatchReport {
  /** False when Railway would not tell us each service's repo. */
  sourceAvailable: boolean;
  /** One candidate — these are what auto-link acts on. */
  matched: DeployMatch[];
  /** Several services build the same repo; the user picks. */
  ambiguous: DeployMatch[];
  /** No Railway service builds this repo. */
  unmatched: { projectId: string; projectName: string; repo: string | null }[];
}

/** `https://github.com/Owner/Repo.git` and `git@github.com:Owner/Repo` → `owner/repo`. */
export function repoKey(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = url.match(/github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (!match) return null;
  return `${match[1]}/${match[2]}`.toLowerCase();
}

/**
 * Every GitHub repo a project owns: its own remote, plus each sub-repository's.
 * A multi-repo project (a client folder holding a dozen checkouts) has no
 * remote of its own, and those are exactly the projects worth matching.
 */
const subRepoRemoteCache = new Map<string, string | null>();

export async function projectRepos(project: { path: string; gitRemoteUrl?: string; subRepos?: string[] }): Promise<
  { repo: string; subrepo?: string }[]
> {
  const found: { repo: string; subrepo?: string }[] = [];

  const rootKey = repoKey(project.gitRemoteUrl);
  if (rootKey) found.push({ repo: rootKey });

  for (const subrepo of project.subRepos || []) {
    const path = join(project.path, subrepo);
    let url: string | null;
    const cached = subRepoRemoteCache.get(path);
    if (cached !== undefined) {
      url = cached;
    } else {
      try {
        const remotes = await gitService.getRemotes(path);
        const origin = remotes.find((r: any) => r.name === 'origin') || remotes[0];
        url = (origin as any)?.refs?.push || (origin as any)?.refs?.fetch || null;
      } catch {
        url = null;
      }
      subRepoRemoteCache.set(path, url);
    }
    const key = repoKey(url);
    if (key && !found.some(entry => entry.repo === key)) found.push({ repo: key, subrepo });
  }

  return found;
}

export async function findMatches(): Promise<MatchReport> {
  const [projects, railwayProjects, links] = await Promise.all([
    getProjects(),
    railway.listProjects(),
    deployStore.listLinks(),
  ]);

  // Every Railway service that names a repo, indexed by that repo.
  const byRepo = new Map<string, DeployCandidate[]>();
  let sawAnyRepo = false;
  for (const project of railwayProjects) {
    const environment = project.environments.length === 1 ? project.environments[0] : undefined;
    for (const service of project.services) {
      const key = repoKey(service.repo ? `github.com/${service.repo}` : null);
      if (!key) continue;
      sawAnyRepo = true;
      const entry: DeployCandidate = {
        railwayProjectId: project.id,
        railwayProjectName: project.name,
        serviceId: service.id,
        serviceName: service.name,
        ...(environment ? { environmentId: environment.id, environmentName: environment.name } : {}),
      };
      const list = byRepo.get(key);
      if (list) list.push(entry);
      else byRepo.set(key, [entry]);
    }
  }

  const report: MatchReport = { sourceAvailable: sawAnyRepo, matched: [], ambiguous: [], unmatched: [] };

  for (const project of projects) {
    const repos = await projectRepos(project);

    // A project can own several repos (one per sub-repository); every service
    // building any of them is a candidate for this project's badge.
    const candidates: DeployCandidate[] = [];
    let firstRepo: { repo: string; subrepo?: string } | undefined;
    for (const entry of repos) {
      const found = byRepo.get(entry.repo);
      if (!found?.length) continue;
      if (!firstRepo) firstRepo = entry;
      for (const candidate of found) {
        if (!candidates.some(existing => existing.serviceId === candidate.serviceId)) {
          candidates.push(candidate);
        }
      }
    }

    if (candidates.length === 0) {
      report.unmatched.push({
        projectId: project.id,
        projectName: project.name,
        repo: repos[0]?.repo ?? null,
      });
      continue;
    }

    const match: DeployMatch = {
      projectId: project.id,
      projectName: project.name,
      repo: firstRepo!.repo,
      ...(firstRepo!.subrepo ? { subrepo: firstRepo!.subrepo } : {}),
      linked: !!links[project.id],
      candidates,
    };
    if (candidates.length === 1) report.matched.push(match);
    else report.ambiguous.push(match);
  }

  return report;
}

/**
 * Link every project whose repo matches exactly one Railway service.
 * Projects already linked are left alone unless `relink` says otherwise.
 */
export async function autoLink(options?: { only?: string[]; relink?: boolean }): Promise<{
  linked: { projectId: string; projectName: string; railwayProjectName: string; serviceName: string }[];
  report: MatchReport;
}> {
  const report = await findMatches();
  const only = options?.only?.length ? new Set(options.only) : null;
  const linked: { projectId: string; projectName: string; railwayProjectName: string; serviceName: string }[] = [];

  for (const match of report.matched) {
    if (only && !only.has(match.projectId)) continue;
    if (match.linked && !options?.relink) continue;

    const candidate = match.candidates[0];
    await deployStore.setLink(match.projectId, {
      provider: 'railway',
      projectId: candidate.railwayProjectId,
      projectName: candidate.railwayProjectName,
      serviceId: candidate.serviceId,
      serviceName: candidate.serviceName,
      ...(candidate.environmentId ? { environmentId: candidate.environmentId } : {}),
      ...(candidate.environmentName ? { environmentName: candidate.environmentName } : {}),
    });
    invalidate(match.projectId);
    linked.push({
      projectId: match.projectId,
      projectName: match.projectName,
      railwayProjectName: candidate.railwayProjectName,
      serviceName: candidate.serviceName,
    });
  }

  if (linked.length) {
    log.info('server', `Linked ${linked.length} project(s) to Railway by repository`,
      linked.map(l => `${l.projectName} → ${l.railwayProjectName}/${l.serviceName}`).join(', '));
  }
  return { linked, report };
}
