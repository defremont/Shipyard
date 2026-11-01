// The API can read files and open a terminal, so reaching it is the same as
// running code on this machine. The boundary is the machine itself: the server
// listens on loopback only, which leaves one way in from outside, a web page
// open in the user's browser. Everything here exists to shut that door.
// A process running as this user needs no token: it can already read data/.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

const DEV_SERVER_PORT = 5420;
const DEV_CLIENT_PORT = 5421;

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** The pages allowed to call this server: its own, and Vite's in development. */
export function localOrigins(port: number): string[] {
  const ports = port === DEV_SERVER_PORT ? [port, DEV_CLIENT_PORT] : [port];
  return ports.flatMap(p => [`http://localhost:${p}`, `http://127.0.0.1:${p}`, `http://[::1]:${p}`]);
}

function hostnameOf(hostHeader: string): string {
  return hostHeader.replace(/:\d+$/, '');
}

type Headers = Record<string, string | string[] | undefined>;

/** Why a request must be refused, or null when it may go on. */
export function rejectionReason(method: string, headers: Headers, origins: string[]): string | null {
  // DNS rebinding: evil.example resolving to 127.0.0.1 passes as same-origin in
  // the browser, and only the Host header still names the attacker's domain.
  const host = headers.host;
  if (typeof host !== 'string' || !isLoopbackHost(hostnameOf(host))) return 'host not allowed';

  // Covers fetch, WebSocket upgrades (the browser's own same-origin policy does
  // not apply to them) and form posts. Sandboxed iframes, such as the editor's
  // HTML preview, send "null" and fall here too. Agents, hooks and curl send no
  // Origin at all.
  const origin = headers.origin;
  if (origin !== undefined && !origins.includes(origin as string)) return 'origin not allowed';

  // Requests with no Origin that a page can still trigger, like <img src>.
  // Following a link to the dashboard stays possible: a page cannot read the
  // result of a top-level navigation.
  const site = headers['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    const isNavigation = method === 'GET'
      && headers['sec-fetch-mode'] === 'navigate'
      && headers['sec-fetch-dest'] === 'document';
    if (!isNavigation) return 'cross-site request';
  }

  return null;
}
