import * as deployStore from './deployStore.js';
import * as railway from './railwayService.js';

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
