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

export interface RailwayProjectSummary {
  id: string;
  name: string;
  environments: { id: string; name: string }[];
  services: { id: string; name: string }[];
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

const PROJECTS_QUERY = `
  query {
    me {
      projects {
        edges {
          node {
            id
            name
            environments { edges { node { id name } } }
            services { edges { node { id name } } }
          }
        }
      }
    }
  }
`;

type ProjectsResponse = {
  me: {
    projects: {
      edges: {
        node: {
          id: string;
          name: string;
          environments?: { edges: { node: { id: string; name: string } }[] };
          services?: { edges: { node: { id: string; name: string } }[] };
        };
      }[];
    };
  };
};

/** Projects the token can see, with their environments and services. */
export async function listProjects(): Promise<RailwayProjectSummary[]> {
  const token = await requireToken();
  const data = await graphql<ProjectsResponse>(PROJECTS_QUERY, {}, token);
  return (data.me?.projects?.edges || []).map(({ node }) => ({
    id: node.id,
    name: node.name,
    environments: (node.environments?.edges || []).map(e => ({ id: e.node.id, name: e.node.name })),
    services: (node.services?.edges || []).map(e => ({ id: e.node.id, name: e.node.name })),
  }));
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

/** Save a token only once it has answered a real call. */
export async function connect(token: string): Promise<{ name?: string; email?: string }> {
  const account = await whoami(token.trim());
  await deployStore.setToken('railway', token.trim());
  log.info('server', 'Railway connected', account.email || account.name || 'account');
  return account;
}
