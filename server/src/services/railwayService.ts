import * as deployStore from './deployStore.js';
import * as log from './logService.js';

/**
 * Railway deploys, read through the public GraphQL API.
 *
 * The point is to answer one question from inside Shipyard: did the last build
 * go up or not. So this only reads — it never redeploys, never rolls back.
 */

const ENDPOINT = 'https://backboard.railway.com/graphql/v2';
const REQUEST_TIMEOUT_MS = 15_000;

/** Every state Railway reports for a deployment. */
export type RailwayStatus =
  | 'BUILDING' | 'DEPLOYING' | 'SUCCESS' | 'FAILED' | 'CRASHED'
  | 'REMOVED' | 'SLEEPING' | 'SKIPPED' | 'WAITING' | 'QUEUED'
  | 'INITIALIZING' | 'NEEDS_APPROVAL';

export interface RailwayDeployment {
  id: string;
  status: RailwayStatus | string;
  createdAt: string;
  url?: string;
  staticUrl?: string;
  /** Commit behind the deploy, when Railway built it from a repo. */
  commitMessage?: string;
  commitHash?: string;
  branch?: string;
  repo?: string;
}

export interface RailwayService {
  id: string;
  name: string;
  /** GitHub repo the service builds from, as `owner/name`, when it has one. */
  repo?: string;
}

export interface RailwayProjectSummary {
  id: string;
  name: string;
  environments: { id: string; name: string }[];
  services: RailwayService[];
}

export class RailwayError extends Error {}

async function graphql<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });
  } catch (err: any) {
    throw new RailwayError(
      err?.name === 'AbortError' ? 'Railway did not answer in time' : `Could not reach Railway: ${err.message}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) {
    throw new RailwayError('Railway rejected the token');
  }
  if (!response.ok) {
    throw new RailwayError(`Railway answered ${response.status}`);
  }

  const body = await response.json() as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) {
    throw new RailwayError(body.errors.map(e => e.message).join('; '));
  }
  if (!body.data) throw new RailwayError('Railway returned no data');
  return body.data;
}

async function requireToken(): Promise<string> {
  const token = await deployStore.getToken('railway');
  if (!token) throw new RailwayError('No Railway token saved');
  return token;
}

/** The account behind the saved token — used to check it works. */
export async function whoami(token: string): Promise<{ name?: string; email?: string }> {
  const data = await graphql<{ me: { name?: string; email?: string } }>(
    'query { me { name email } }', {}, token
  );
  return data.me || {};
}

// The same question asked two ways, because projects reach an account by two
// routes: owned personally (`me.projects`) and through a workspace the account
// belongs to (`me.workspaces[].team.projects`). A personal-token account that
// works inside a team sees nothing under the first, so both are asked and the
// results merged.
//
// Each shape also has a rich and a plain form. The rich one asks which GitHub
// repo every service builds from — that is what lets Shipyard link projects on
// its own — and a renamed field there would fail the whole query, so failure
// falls back to the plain form and linking stays manual.
const PROJECT_FIELDS_WITH_SOURCE = `
  id
  name
  environments { edges { node { id name } } }
  services {
    edges {
      node {
        id
        name
        serviceInstances { edges { node { source { repo } } } }
      }
    }
  }
`;

const PROJECT_FIELDS_PLAIN = `
  id
  name
  environments { edges { node { id name } } }
  services { edges { node { id name } } }
`;

const meQuery = (fields: string) => `query { me { projects { edges { node { ${fields} } } } } }`;
const workspaceQuery = (fields: string) => `
  query {
    me {
      workspaces {
        id
        name
        team { projects { edges { node { ${fields} } } } }
      }
    }
  }
`;

interface ProjectNode {
  id: string;
  name: string;
  environments?: { edges: { node: { id: string; name: string } }[] };
  services?: {
    edges: {
      node: {
        id: string;
        name: string;
        serviceInstances?: { edges: { node: { source?: { repo?: string | null } | null } }[] };
      };
    }[];
  };
}

type MeProjectsResponse = { me?: { projects?: { edges: { node: ProjectNode }[] } } };
type WorkspaceProjectsResponse = {
  me?: { workspaces?: { id: string; name: string; team?: { projects?: { edges: { node: ProjectNode }[] } } | null }[] };
};

/** Remembered across calls: asking for a field Railway rejected is wasted work. */
let sourceFieldUsable = true;

function toSummary(node: ProjectNode): RailwayProjectSummary {
  return {
    id: node.id,
    name: node.name,
    environments: (node.environments?.edges || []).map(e => ({ id: e.node.id, name: e.node.name })),
    services: (node.services?.edges || []).map(e => {
      const repo = e.node.serviceInstances?.edges
        ?.map(instance => instance.node.source?.repo)
        .find(value => !!value);
      return { id: e.node.id, name: e.node.name, ...(repo ? { repo } : {}) };
    }),
  };
}

/**
 * Run one shape, rich first. Returns null when Railway refuses the shape
 * itself — a workspace token has no `me`, and that is not an error worth
 * showing as long as the other shape answers.
 */
async function runShape(
  build: (fields: string) => string,
  extract: (data: any) => ProjectNode[],
  token: string,
): Promise<RailwayProjectSummary[] | null> {
  if (sourceFieldUsable) {
    try {
      return extract(await graphql<any>(build(PROJECT_FIELDS_WITH_SOURCE), {}, token)).map(toSummary);
    } catch (err: any) {
      if (/token/i.test(err?.message || '')) throw err;
      // Could be the source field or the shape; the plain form below tells which.
      sourceFieldUsable = false;
      log.warn('server', 'Railway rejected the service-source query', err?.message);
    }
  }

  try {
    return extract(await graphql<any>(build(PROJECT_FIELDS_PLAIN), {}, token)).map(toSummary);
  } catch (err: any) {
    if (/token/i.test(err?.message || '')) throw err;
    return null;
  }
}

/** Projects the token can see, personal and through every workspace. */
export async function listProjects(): Promise<RailwayProjectSummary[]> {
  const token = await requireToken();

  const [own, shared] = await Promise.all([
    runShape(meQuery, (data: MeProjectsResponse) => (data.me?.projects?.edges || []).map(e => e.node), token),
    runShape(
      workspaceQuery,
      (data: WorkspaceProjectsResponse) =>
        (data.me?.workspaces || []).flatMap(w => (w.team?.projects?.edges || []).map(e => e.node)),
      token,
    ),
  ]);

  if (own === null && shared === null) {
    throw new RailwayError('Railway did not return any projects for this token');
  }

  // A project reachable both ways must not be listed twice.
  const byId = new Map<string, RailwayProjectSummary>();
  for (const project of [...(own || []), ...(shared || [])]) {
    if (!byId.has(project.id)) byId.set(project.id, project);
  }
  return [...byId.values()];
}

// The input type is filled inline so this never has to name Railway's own input
// type — a renamed type would otherwise fail the whole query.
const DEPLOYMENTS_QUERY = `
  query($projectId: String!, $environmentId: String, $serviceId: String) {
    deployments(
      first: 1
      input: { projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId }
    ) {
      edges {
        node {
          id
          status
          createdAt
          url
          staticUrl
          meta
        }
      }
    }
  }
`;

type DeploymentsResponse = {
  deployments: {
    edges: {
      node: {
        id: string;
        status: string;
        createdAt: string;
        url?: string | null;
        staticUrl?: string | null;
        meta?: Record<string, any> | null;
      };
    }[];
  };
};

/** The latest deployment of a project (optionally narrowed to one service). */
export async function latestDeployment(input: {
  projectId: string;
  environmentId?: string;
  serviceId?: string;
}): Promise<RailwayDeployment | null> {
  const token = await requireToken();
  const data = await graphql<DeploymentsResponse>(DEPLOYMENTS_QUERY, {
    projectId: input.projectId,
    environmentId: input.environmentId ?? null,
    serviceId: input.serviceId ?? null,
  }, token);

  const node = data.deployments?.edges?.[0]?.node;
  if (!node) return null;

  const meta = node.meta || {};
  return {
    id: node.id,
    status: node.status,
    createdAt: node.createdAt,
    ...(node.url ? { url: node.url } : {}),
    ...(node.staticUrl ? { staticUrl: node.staticUrl } : {}),
    ...(meta.commitMessage ? { commitMessage: String(meta.commitMessage).split('\n')[0] } : {}),
    ...(meta.commitHash ? { commitHash: String(meta.commitHash) } : {}),
    ...(meta.branch ? { branch: String(meta.branch) } : {}),
    ...(meta.repo ? { repo: String(meta.repo) } : {}),
  };
}

/**
 * A token scoped to one workspace answers neither `me` nor the project lists —
 * Railway only takes it on `workspace(workspaceId:)`, and a workspace id is not
 * something anyone has to hand. Rather than repeat Railway's bare
 * "Not Authorized", say which token to make.
 */
function explainRefusal(message: string | undefined): string {
  const raw = message || 'Railway refused the token';
  if (/not authorized|unauthorized|rejected the token|no projects/i.test(raw)) {
    return `${raw}. If this token was created for a single workspace, make one with Workspace set to "No workspace" instead — an account token covers every workspace.`;
  }
  return raw;
}

/**
 * Save a token once it has answered a real call.
 *
 * `me` is an account-token query: a workspace token has no personal account
 * behind it and Railway refuses that field. So a refusal there is not a verdict
 * on the token — listing projects is. The token has to be stored for that
 * second attempt (the API client reads it from the store), and is removed again
 * if it turns out to be no good.
 */
export async function connect(token: string): Promise<{ name?: string; email?: string }> {
  const trimmed = token.trim();

  try {
    const account = await whoami(trimmed);
    await deployStore.setToken('railway', trimmed);
    log.info('server', 'Railway connected', account.email || account.name || 'account');
    return account;
  } catch (err: any) {
    if (/rejected the token/i.test(err?.message || '')) throw err;

    await deployStore.setToken('railway', trimmed);
    try {
      const projects = await listProjects();
      log.info('server', 'Railway connected (workspace token)', `${projects.length} project(s)`);
      return {};
    } catch (second: any) {
      await deployStore.clearToken('railway');
      throw new RailwayError(explainRefusal(second?.message || err?.message));
    }
  }
}
