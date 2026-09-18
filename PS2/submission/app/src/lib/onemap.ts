// Shared OneMap (onemap.gov.sg) client: auth plus the public-transport routing
// call. Used by alternates.ts (bus-only reroutes) and rideTimes.ts (measured
// EWL in-vehicle times). Behaviour below was checked against the live API.
import { getJSON, setJSON } from "./store";

const ONEMAP_BASE = "https://www.onemap.gov.sg/api";
const TOKEN_KEY = "onemap:token:v1";

export function oneMapConfigured(): boolean {
  return Boolean(process.env.ONEMAP_TOKEN || (process.env.ONEMAP_EMAIL && process.env.ONEMAP_PASSWORD));
}

// Callers fetch routes in parallel; without this each would log in separately
// on a cold cache.
let tokenInflight: Promise<string> | null = null;

export function getToken(): Promise<string> {
  // A pre-issued token (from registration) skips the login call. It expires
  // after ~3 days and can't self-refresh, so email/password is the durable
  // setup — this is the quick path for a demo or while debugging auth.
  if (process.env.ONEMAP_TOKEN) return Promise.resolve(process.env.ONEMAP_TOKEN);
  tokenInflight ??= fetchToken().finally(() => {
    tokenInflight = null;
  });
  return tokenInflight;
}

async function fetchToken(): Promise<string> {
  const cached = await getJSON<{ token: string; expiresAt: number }>(TOKEN_KEY);
  // Reuse until an hour before expiry so a token can't lapse mid-batch.
  if (cached && cached.expiresAt - Date.now() > 60 * 60 * 1000) return cached.token;

  const res = await fetch(`${ONEMAP_BASE}/auth/post/getToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ONEMAP_EMAIL,
      password: process.env.ONEMAP_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`OneMap auth ${res.status} ${res.statusText}`);
  const body = (await res.json()) as { access_token?: string; expiry_timestamp?: string | number };
  if (!body.access_token) throw new Error("OneMap auth returned no access_token");

  // expiry_timestamp is epoch seconds; tokens last ~3 days. Default to a
  // conservative 2 days if it's missing or not a plausible epoch.
  const epochSeconds = Number(body.expiry_timestamp);
  const expiresAt = epochSeconds > 1e9 ? epochSeconds * 1000 : Date.now() + 2 * 24 * 60 * 60 * 1000;
  await setJSON(TOKEN_KEY, { token: body.access_token, expiresAt });
  return body.access_token;
}

// The next weekday after today in Singapore time, as OneMap's MM-DD-YYYY. Any
// representative weekday morning will do — we're asking "how long does this
// take at Rachel's commute hour", not routing for right now, and a query for
// 07:40 at 2am (or on a Sunday) would return an unrepresentative timetable.
export function nextWeekdaySgt(now: Date = new Date()): { date: string; iso: string } {
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  do {
    sgt.setUTCDate(sgt.getUTCDate() + 1);
  } while (sgt.getUTCDay() === 0 || sgt.getUTCDay() === 6);
  const y = sgt.getUTCFullYear();
  const m = String(sgt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(sgt.getUTCDate()).padStart(2, "0");
  return { date: `${m}-${d}-${y}`, iso: `${y}-${m}-${d}` };
}

export function clockTime(totalMinutes: number): string {
  const h = String(Math.floor(totalMinutes / 60) % 24).padStart(2, "0");
  const m = String(Math.round(totalMinutes % 60)).padStart(2, "0");
  return `${h}:${m}:00`;
}

export interface PtRouteQuery {
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  mode: "BUS" | "TRANSIT" | "RAIL";
  date: string; // MM-DD-YYYY
  time: string; // HH:MM:SS
}

// OneMap rate-limits bursts with HTTP 429 (seen live: ~30 lookups fired in one
// second — the alternates + ride-time warm-up plus bus hops — pushed the last
// few over). So requests share a small concurrency cap, and a 429 is retried
// with backoff, honouring Retry-After if sent. Other errors are not retried.
const MAX_CONCURRENT = 6;
const MAX_RETRIES_ON_429 = 3;
let active = 0;
const waiters: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiters.push(resolve)); // slot handed over
  else active++;
  try {
    return await fn();
  } finally {
    const next = waiters.shift();
    if (next) next();
    else active--;
  }
}

function retryDelayMs(res: Response, attempt: number): number {
  const base = Number(process.env.ONEMAP_RETRY_BASE_MS) || 1000; // overridable so tests needn't wait
  const retryAfterSeconds = Number(res.headers.get("retry-after"));
  const ms = retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : base * 2 ** attempt;
  return Math.min(ms, 8000);
}

// Raw routing response (shape verified live: plan.itineraries[].legs[], with
// durations in seconds). `label` only tags the error message. OneMap caps
// numItineraries at 3.
export function oneMapPtRoute(token: string, label: string, q: PtRouteQuery): Promise<unknown> {
  const params = new URLSearchParams({
    start: `${q.from.lat},${q.from.lng}`,
    end: `${q.to.lat},${q.to.lng}`,
    routeType: "pt",
    mode: q.mode,
    date: q.date,
    time: q.time,
    maxWalkDistance: "1000",
    numItineraries: "3",
  });
  return withSlot(async () => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${ONEMAP_BASE}/public/routingsvc/route?${params}`, {
        headers: { Authorization: token },
      });
      if (res.status === 429 && attempt < MAX_RETRIES_ON_429) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(res, attempt)));
        continue;
      }
      if (!res.ok) throw new Error(`OneMap route ${label} ${res.status} ${res.statusText}`);
      return res.json();
    }
  });
}
