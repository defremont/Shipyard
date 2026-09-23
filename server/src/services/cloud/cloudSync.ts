import { readFile, writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { hostname } from 'os';
import { randomBytes } from 'crypto';
import chokidar, { type FSWatcher } from 'chokidar';
import { DATA_DIR } from '../dataDir.js';
import { writeJsonAtomic } from '../atomicJson.js';
import * as log from '../logService.js';
import {
  deriveKeys, newSalt, newDataKey, seal, open, encryptRecord, decryptRecord, hashData, type KdfParams,
} from './cloudCrypto.js';
import { applyRemote, collectLocal, recordUpdatedAt, type LocalRecords, type ProjectRecord, type RemoteRecord } from './cloudRecords.js';

/**
 * Shipyard Cloud: keeps this machine's data in step with the user's other
 * machines through the hosted sync service.
 *
 * Local JSON stays the source every screen reads from — the app works the same
 * offline. This engine only watches the data dir, works out which records
 * changed since the last sync (by hash, so no store has to report its own
 * changes and a delete is simply "gone since last time"), pushes those, and
 * pulls what other machines wrote. Conflicts: the later change wins, per record.
 */

export const DEFAULT_CLOUD_URL = process.env.SHIPYARD_CLOUD_URL || 'https://shipyard-cloud-production.up.railway.app';

const CONFIG_FILE = join(DATA_DIR, 'cloud-sync.json');
const KEY_FILE = join(DATA_DIR, '.claude-key');
const BATCH = 200;
const POLL_MS = 60_000;
const WATCH_DEBOUNCE_MS = 1500;

/** Files whose content the cloud sync covers; any other write is ignored. */
const WATCHED = /[\\/](tasks[\\/][^\\/]+\.json|projects\.json|settings\.json|sync-config\.json|deploy-config\.json|ai-config\.json)$/;

interface PlanInfo {
  plan: string;
  active: boolean;
  planExpiresAt: string | null;
  upgradeUrl: string | null;
}

interface CloudConfig {
  serverUrl: string;
  email: string;
  deviceName: string;
  /** Device token and data key, both sealed with this machine's .claude-key. */
  token: string;
  dataKey: string;
  cursor: number;
  /** False until the first full pull — see `join()`. */
  joined: boolean;
  /** key → hash of the data last agreed with the server. */
  synced: Record<string, string>;
  /** key → when the local change was noticed; that is its clock in a conflict. */
  pending: Record<string, string>;
  /** Projects other machines have that this one has no folder for. */
  missing: Record<string, ProjectRecord>;
  lastSyncAt: string | null;
  lastError: string | null;
  plan: PlanInfo | null;
}

interface Session {
  serverUrl: string;
  token: string;
  dataKey: Buffer;
}

let config: CloudConfig | null = null;
let session: Session | null = null;
let chain: Promise<unknown> = Promise.resolve();
let watcher: FSWatcher | null = null;
let watchTimer: NodeJS.Timeout | null = null;
let pollTimer: NodeJS.Timeout | null = null;
let events: AbortController | null = null;
let syncing = false;
let accountCache: { at: number; data: any } | null = null;
/** Hash of each record at the previous scan: a new edit restarts its clock. */
const seenHashes = new Map<string, string>();

// ── Local persistence ───────────────────────────────────────────────────

async function localKey(): Promise<Buffer> {
  try {
    return Buffer.from((await readFile(KEY_FILE, 'utf-8')).trim(), 'hex');
  } catch {
    const key = randomBytes(32);
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(KEY_FILE, key.toString('hex'), 'utf-8');
    return key;
  }
}

let saveChain: Promise<unknown> = Promise.resolve();
function save(): Promise<void> {
  const snapshot = config;
  const run = saveChain.then(() => (snapshot ? writeJsonAtomic(CONFIG_FILE, snapshot) : undefined));
  saveChain = run.catch(() => {});
  return run;
}

/** Serialize everything that touches the sync state. */
function run<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

// ── Server calls ────────────────────────────────────────────────────────

class CloudError extends Error {
  constructor(message: string, public status: number, public body?: any) {
    super(message);
  }
}

async function request<T = any>(serverUrl: string, path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl.replace(/\/+$/, '')}${path}`, {
      method: init.method || (init.body ? 'POST' : 'GET'),
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err: any) {
    throw new CloudError(`Could not reach ${serverUrl}: ${err?.message || err}`, 0);
  }
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new CloudError(body?.error || `HTTP ${res.status}`, res.status, body);
  return body as T;
}

function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  if (!session) throw new CloudError('Not connected', 0);
  return request<T>(session.serverUrl, path, { body, method, token: session.token });
}

/** A revoked device or deleted account: stop, keep local data, tell the user. */
async function onAuthLost(): Promise<void> {
  stopEngine();
  if (config) {
    config.lastError = 'This device was signed out of Shipyard Cloud. Sign in again to resume syncing.';
    await save();
  }
  session = null;
}

// ── Sync steps ──────────────────────────────────────────────────────────

/** Compare local data to the last synced state and queue what changed. */
async function scan(): Promise<LocalRecords> {
  const cfg = config!;
  const local = await collectLocal();
  const now = new Date().toISOString();
  for (const [key, data] of local) {
    const h = hashData(data);
    if (cfg.synced[key] === h) {
      delete cfg.pending[key];
    } else if (!cfg.pending[key] || seenHashes.get(key) !== h) {
      cfg.pending[key] = now;
    }
    seenHashes.set(key, h);
  }
  for (const key of Object.keys(cfg.synced)) {
    if (!local.has(key) && !cfg.pending[key]) cfg.pending[key] = now;
  }
  for (const id of Object.keys(cfg.missing)) {
    if (local.has(`project/${id}`)) delete cfg.missing[id];
  }
  return local;
}

interface WireRecord {
  key: string;
  rev: number;
  updatedAt: string;
  deleted: boolean;
  payload: string | null;
}

/** Decrypt and apply records from the server, skipping ones this machine changed later. */
async function applyPulled(records: WireRecord[], joinLocal?: LocalRecords): Promise<void> {
  const cfg = config!;
  const toApply: RemoteRecord[] = [];
  for (const r of records) {
    const mine = cfg.pending[r.key];
    if (mine && Date.parse(mine) > Date.parse(r.updatedAt)) continue;
    let data: unknown = null;
    if (!r.deleted) {
      try {
        data = decryptRecord(session!.dataKey, r.key, r.payload!);
      } catch {
        log.error('sync', `Could not decrypt ${r.key}; skipped`);
        continue;
      }
    }
    // First sync of a machine that already had data: a task edited here more
    // recently than the cloud copy keeps the local version.
    if (joinLocal && !r.deleted && joinLocal.has(r.key)) {
      const localAt = recordUpdatedAt(joinLocal.get(r.key));
      const remoteAt = recordUpdatedAt(data);
      if (localAt !== null && remoteAt !== null && localAt > remoteAt) {
        cfg.pending[r.key] = new Date().toISOString();
        continue;
      }
    }
    toApply.push({ key: r.key, deleted: r.deleted, data });
  }
  if (toApply.length === 0) return;

  const { missing, found } = await applyRemote(toApply);
  for (const [id, rec] of Object.entries(missing)) cfg.missing[id] = rec;
  for (const r of toApply) {
    if (r.deleted && r.key.startsWith('project/')) delete cfg.missing[r.key.slice(8)];
  }
  if (found.length > 0) log.info('sync', `Found ${found.length} project folder(s) from other machines: ${found.join(', ')}`);

  // Hash what actually landed on disk: stores normalize on the way in, and
  // hashing the wire copy would make the next scan see a change that isn't one.
  const local = await collectLocal();
  for (const r of toApply) {
    delete cfg.pending[r.key];
    const here = local.get(r.key);
    if (here === undefined) delete cfg.synced[r.key];
    else {
      const h = hashData(here);
      cfg.synced[r.key] = h;
      seenHashes.set(r.key, h);
    }
  }
}

async function pull(joinLocal?: LocalRecords): Promise<void> {
  const cfg = config!;
  for (;;) {
    const res = await api<{ rev: number; more: boolean; records: WireRecord[] }>(`/v1/sync/pull?since=${cfg.cursor}&limit=500`);
    await applyPulled(res.records, joinLocal);
    cfg.cursor = res.rev;
    await save();
    if (!res.more) break;
  }
}

async function push(local: LocalRecords): Promise<void> {
  const cfg = config!;
  const keys = Object.keys(cfg.pending);
  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const records = batch.map(key => local.has(key)
      ? { key, updatedAt: cfg.pending[key], payload: encryptRecord(session!.dataKey, key, local.get(key)) }
      : { key, updatedAt: cfg.pending[key], deleted: true });
    let res: { rev: number; results: Array<{ key: string; status: 'ok' | 'stale'; current?: WireRecord }> };
    try {
      res = await api('/v1/sync/push', { records });
    } catch (err) {
      if (err instanceof CloudError && err.status === 402) {
        cfg.plan = pickPlan(err.body);
        throw new CloudError('Your Shipyard Cloud plan is not active. Changes are kept here and sync as soon as it is.', 402);
      }
      throw err;
    }
    const stale: WireRecord[] = [];
    for (const r of res.results) {
      if (r.status === 'ok') {
        if (local.has(r.key)) cfg.synced[r.key] = hashData(local.get(r.key));
        else delete cfg.synced[r.key];
        delete cfg.pending[r.key];
      } else {
        // Another machine changed it later: take theirs.
        delete cfg.pending[r.key];
        if (r.current) stale.push(r.current);
      }
    }
    if (stale.length > 0) await applyPulled(stale);
    await save();
  }
}

/**
 * One round: note local changes, take the server's, send ours.
 *
 * The scan has to come before the pull. A local edit the watcher has not
 * reported yet has no clock of its own, so a record pulled in that window
 * would overwrite it without a contest.
 */
async function syncOnce(): Promise<void> {
  if (!session || !config) return;
  syncing = true;
  try {
    if (!config.joined) {
      // A machine joining with data of its own: take the cloud copy first,
      // then send only what the cloud did not have.
      const before = await collectLocal();
      await pull(before);
      config.joined = true;
      await save();
    } else {
      await scan();
      await pull();
    }
    await push(await scan());
    accountCache = null;
    config.lastSyncAt = new Date().toISOString();
    config.lastError = null;
    await save();
  } catch (err: any) {
    if (err instanceof CloudError && err.status === 401) return onAuthLost();
    config.lastError = err?.message || String(err);
    await save();
    log.error('sync', `Sync failed: ${config.lastError}`);
  } finally {
    syncing = false;
  }
}

// ── Triggers ────────────────────────────────────────────────────────────

function scheduleLocalSync(): void {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    watchTimer = null;
    void run(() => syncOnce());
  }, WATCH_DEBOUNCE_MS);
}

/** Server-sent events: the server says "rev N" when another machine wrote. */
async function listen(signal: AbortSignal): Promise<void> {
  let backoff = 2000;
  while (!signal.aborted && session) {
    try {
      const res = await fetch(`${session.serverUrl.replace(/\/+$/, '')}/v1/sync/events`, {
        headers: { Authorization: `Bearer ${session.token}`, Accept: 'text/event-stream' },
        signal,
      });
      if (res.status === 401) { await onAuthLost(); return; }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      backoff = 2000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const data = frame.split('\n').find(l => l.startsWith('data:'));
          const rev = data ? parseInt(data.slice(5).trim(), 10) : NaN;
          if (Number.isFinite(rev) && config && rev > config.cursor) {
            void run(() => syncOnce());
          }
        }
      }
    } catch {
      if (signal.aborted) return;
    }
    await new Promise(r => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 60_000);
  }
}

function startEngine(): void {
  stopEngine();
  watcher = chokidar.watch(DATA_DIR, {
    ignoreInitial: true,
    depth: 1,
    ignored: (path, stats) => !!stats?.isFile() && !WATCHED.test(path),
  });
  watcher.on('add', p => WATCHED.test(p) && scheduleLocalSync());
  watcher.on('change', p => WATCHED.test(p) && scheduleLocalSync());
  watcher.on('unlink', p => WATCHED.test(p) && scheduleLocalSync());
  pollTimer = setInterval(() => void run(() => syncOnce()), POLL_MS);
  events = new AbortController();
  void listen(events.signal);
  void run(() => syncOnce());
}

function stopEngine(): void {
  void watcher?.close();
  watcher = null;
  if (watchTimer) clearTimeout(watchTimer);
  if (pollTimer) clearInterval(pollTimer);
  watchTimer = pollTimer = null;
  events?.abort();
  events = null;
}

// ── Public API ──────────────────────────────────────────────────────────

export async function initCloudSync(): Promise<void> {
  try {
    config = JSON.parse(await readFile(CONFIG_FILE, 'utf-8'));
  } catch {
    return; // Not connected on this machine.
  }
  if (!config?.token) return;
  try {
    const key = await localKey();
    session = {
      serverUrl: config.serverUrl,
      token: open(key, config.token).toString('utf-8'),
      dataKey: open(key, config.dataKey),
    };
  } catch {
    config.lastError = 'Could not read the saved Shipyard Cloud session. Sign in again.';
    return;
  }
  startEngine();
  log.info('sync', `Shipyard Cloud connected as ${config.email}`);
}

async function connect(serverUrl: string, email: string, deviceName: string, token: string, dataKey: Buffer, plan: PlanInfo): Promise<void> {
  const key = await localKey();
  config = {
    serverUrl,
    email,
    deviceName,
    token: seal(key, Buffer.from(token)),
    dataKey: seal(key, dataKey),
    cursor: 0,
    joined: false,
    synced: {},
    pending: {},
    missing: {},
    lastSyncAt: null,
    lastError: null,
    plan,
  };
  session = { serverUrl, token, dataKey };
  seenHashes.clear();
  await save();
  startEngine();
}

function pickPlan(body: any): PlanInfo {
  return { plan: body.plan, active: !!body.active, planExpiresAt: body.planExpiresAt ?? null, upgradeUrl: body.upgradeUrl ?? null };
}

export async function signup(input: { serverUrl?: string; email: string; password: string; deviceName?: string }): Promise<void> {
  const serverUrl = (input.serverUrl || DEFAULT_CLOUD_URL).replace(/\/+$/, '');
  const deviceName = input.deviceName?.trim() || hostname();
  const pre = await request<{ kdf: KdfParams }>(serverUrl, '/v1/auth/prelogin', { body: { email: input.email } });
  const kdfSalt = newSalt();
  const { authKey, kek } = await deriveKeys(input.password, kdfSalt, pre.kdf);
  const dataKey = newDataKey();
  const res = await request(serverUrl, '/v1/auth/signup', {
    body: { email: input.email, authKey, kdfSalt, wrappedKey: seal(kek, dataKey, 'data-key'), deviceName },
  });
  await connect(serverUrl, res.email, deviceName, res.token, dataKey, pickPlan(res));
}

export async function login(input: { serverUrl?: string; email: string; password: string; deviceName?: string }): Promise<void> {
  const serverUrl = (input.serverUrl || DEFAULT_CLOUD_URL).replace(/\/+$/, '');
  const deviceName = input.deviceName?.trim() || hostname();
  const pre = await request<{ kdf: KdfParams; kdfSalt: string }>(serverUrl, '/v1/auth/prelogin', { body: { email: input.email } });
  const { authKey, kek } = await deriveKeys(input.password, pre.kdfSalt, pre.kdf);
  const res = await request(serverUrl, '/v1/auth/login', { body: { email: input.email, authKey, deviceName } });
  let dataKey: Buffer;
  try {
    dataKey = open(kek, res.wrappedKey, 'data-key');
  } catch {
    throw new CloudError('Could not unlock the account data with this password', 401);
  }
  await connect(serverUrl, res.email, deviceName, res.token, dataKey, pickPlan(res));
}

/** Sign this machine out. Local data stays exactly as it is. */
export async function logout(): Promise<void> {
  await run(async () => {
    stopEngine();
    if (session) {
      try { await api('/v1/auth/logout', {}); } catch { /* signing out locally is what matters */ }
    }
    session = null;
    config = null;
    seenHashes.clear();
    try { await unlink(CONFIG_FILE); } catch { /* already gone */ }
  });
}

export function syncNow(): Promise<void> {
  return run(() => syncOnce());
}

export function isCloudError(err: unknown): err is CloudError {
  return err instanceof CloudError;
}

export async function getStatus(): Promise<Record<string, unknown>> {
  if (!config) return { connected: false, defaultServerUrl: DEFAULT_CLOUD_URL };
  let account: any = null;
  if (session) {
    if (accountCache && Date.now() - accountCache.at < 30_000) {
      account = accountCache.data;
    } else {
      try {
        account = await api('/v1/account');
        accountCache = { at: Date.now(), data: account };
        config.plan = pickPlan(account);
      } catch (err) {
        if (err instanceof CloudError && err.status === 401) await onAuthLost();
      }
    }
  }
  return {
    connected: !!session,
    defaultServerUrl: DEFAULT_CLOUD_URL,
    serverUrl: config.serverUrl,
    email: config.email,
    deviceName: config.deviceName,
    syncing,
    lastSyncAt: config.lastSyncAt,
    lastError: config.lastError,
    pending: Object.keys(config.pending).length,
    synced: Object.keys(config.synced).length,
    plan: config.plan,
    usage: account?.usage ?? null,
    devices: account?.devices ?? [],
    missingProjects: Object.entries(config.missing).map(([id, p]) => ({ id, name: p.name, folder: p.folder, remote: p.remote })),
  };
}
