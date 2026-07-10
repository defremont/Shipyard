/**
 * Subscription usage meter for the Claude CLI's OAuth session.
 *
 * Reads GET https://api.anthropic.com/api/oauth/usage — the same endpoint the
 * CLI's own `/usage` command calls, authenticated with the token already in
 * ~/.claude/.credentials.json.
 *
 * This endpoint is NOT part of the public, documented Anthropic API: it exists
 * for the CLI and may change shape or disappear without notice. Every failure
 * path here degrades to `{ available: false }` so the UI can hide the widget
 * instead of surfacing an error.
 *
 * It reports utilization as a percentage only — `limit_dollars`/`used_dollars`
 * come back null on subscription plans, so there are no token or dollar counts
 * to show.
 */
import * as claudeCliService from './claudeCliService.js';
import * as log from './logService.js';

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const CACHE_TTL = 60_000;
/** How long a cached reading stays servable once refreshes start failing. */
const STALE_TTL = 10 * 60_000;

export type Severity = 'normal' | 'warning' | 'critical';

export interface UsageWindow {
  percent: number;
  /** ISO 8601, or null when the endpoint omits it */
  resetsAt: string | null;
}

export interface ScopedWindow extends UsageWindow {
  /** Model or surface the sub-limit applies to, e.g. 'Opus' */
  label: string;
}

export interface ClaudeUsage {
  available: true;
  /** From the credentials file, e.g. 'max' */
  plan: string | null;
  /** Rolling 5-hour window */
  session: UsageWindow | null;
  /** 7-day window across all models */
  weekly: UsageWindow | null;
  /** Per-model or per-surface weekly sub-limits, when present */
  scoped: ScopedWindow[];
  /** Worst severity across session + weekly */
  severity: Severity;
  extraCredits: { enabled: boolean; percent: number | null } | null;
  fetchedAt: string;
  /** True when serving a cached reading because the last refresh failed */
  stale: boolean;
}

export interface UsageUnavailable {
  available: false;
  reason: 'no-oauth' | 'request-failed';
}

export type UsageResult = ClaudeUsage | UsageUnavailable;

function severityFor(percent: number): Severity {
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'warning';
  return 'normal';
}

const RANK: Record<Severity, number> = { normal: 0, warning: 1, critical: 2 };

function worst(a: Severity, b: Severity): Severity {
  return RANK[a] >= RANK[b] ? a : b;
}

/** The API sends its own severity; trust it when it is more alarming than ours. */
function apiSeverity(raw: unknown): Severity {
  return raw === 'warning' || raw === 'critical' ? raw : 'normal';
}

function toWindow(raw: any): UsageWindow | null {
  const percent = typeof raw?.percent === 'number' ? raw.percent
    : typeof raw?.utilization === 'number' ? raw.utilization
    : null;
  if (percent === null) return null;
  return { percent, resetsAt: raw.resets_at ?? null };
}

/**
 * Prefer the generic `limits[]` array over the named top-level keys: alongside
 * `five_hour`/`seven_day` the payload carries internal codenames (`tangelo`,
 * `iguana_necktie`, …) that arrive null and have no stable meaning.
 */
function parseUsage(body: any, plan: string | null): ClaudeUsage {
  const limits: any[] = Array.isArray(body?.limits) ? body.limits : [];

  const sessionRaw = limits.find(l => l?.kind === 'session');
  const weeklyRaw = limits.find(l => l?.kind === 'weekly_all');

  const session = toWindow(sessionRaw) ?? toWindow(body?.five_hour);
  const weekly = toWindow(weeklyRaw) ?? toWindow(body?.seven_day);

  const scoped: ScopedWindow[] = limits
    .filter(l => l?.kind === 'weekly_scoped')
    .map(l => {
      const w = toWindow(l);
      if (!w) return null;
      const label = l.scope?.model?.display_name ?? l.scope?.surface ?? 'Scoped';
      return { ...w, label };
    })
    .filter((w): w is ScopedWindow => w !== null);

  let severity: Severity = 'normal';
  for (const [win, raw] of [[session, sessionRaw], [weekly, weeklyRaw]] as const) {
    if (!win) continue;
    severity = worst(severity, worst(severityFor(win.percent), apiSeverity(raw?.severity)));
  }

  const extra = body?.extra_usage;
  const extraCredits = extra
    ? {
        enabled: !!extra.is_enabled,
        percent: typeof extra.utilization === 'number' ? extra.utilization : null,
      }
    : null;

  return {
    available: true,
    plan,
    session,
    weekly,
    scoped,
    severity,
    extraCredits,
    fetchedAt: new Date().toISOString(),
    stale: false,
  };
}

let cached: ClaudeUsage | null = null;
let cachedAt = 0;
let inFlight: Promise<UsageResult> | null = null;

async function fetchUsage(): Promise<UsageResult> {
  const token = await claudeCliService.getOAuthToken();
  if (!token) return { available: false, reason: 'no-oauth' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(USAGE_URL, {
      headers: claudeCliService.oauthHeaders(token),
      signal: controller.signal,
    });
    if (!res.ok) {
      // A 429 here is the meter endpoint throttling us, not the plan running
      // out. Never let it read as "limit reached".
      throw new Error(`HTTP ${res.status}`);
    }
    const body = await res.json();
    const usage = parseUsage(body, claudeCliService.getOAuthPlan()?.subscriptionType ?? null);
    cached = usage;
    cachedAt = Date.now();
    return usage;
  } catch (err: any) {
    const detail = err?.name === 'AbortError' ? 'timeout' : err?.message;
    log.warn('claude', 'Usage lookup failed', detail);
    // Serve the last good reading for a while so the meter does not flicker.
    if (cached && Date.now() - cachedAt < STALE_TTL) {
      return { ...cached, stale: true };
    }
    return { available: false, reason: 'request-failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function getUsage(): Promise<UsageResult> {
  if (cached && Date.now() - cachedAt < CACHE_TTL) return cached;
  // Collapse concurrent callers onto one request.
  if (!inFlight) {
    inFlight = fetchUsage().finally(() => { inFlight = null; });
  }
  return inFlight;
}
