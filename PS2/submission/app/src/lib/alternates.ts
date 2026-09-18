// Alternate-route travel time (minutes) from each station straight to Rachel's
// destination station, used by the commit-point detector in engine.ts.
//
// "Alternate" means a route that does NOT use the disrupted line. OneMap knows
// nothing about the disruption, so an unrestricted public-transport query from
// Bedok to Raffles Place would just tell you to ride the EWL (verified live:
// it returns SUBWAY:EW, 19 min). We therefore ask for bus-only itineraries
// (mode=BUS) — the realistic bridge when an MRT line is down, and guaranteed
// EWL-free.
//
// With OneMap credentials set (free registration at onemap.gov.sg — see
// onemap.ts), the times are real routing results, cached in the shared store.
// Without them, or if OneMap is unreachable, this falls back to
// FALLBACK_ALT_MINUTES below — a hand-picked placeholder, not a measured route
// — and reports source "fallback" so the UI never presents it as real routing.
import { clockTime, getToken, nextWeekdaySgt, oneMapConfigured, oneMapPtRoute } from "./onemap";
import { RACHEL_JOURNEY } from "./rachel";
import { getJSON, setJSON } from "./store";

const FALLBACK_ALT_MINUTES: Record<string, number> = {
  EW2: 60,
  EW3: 58,
  EW4: 55,
  EW5: 52,
  EW6: 50,
  EW7: 48,
  EW8: 46,
  EW9: 48,
  EW10: 46,
  EW11: 44,
  EW12: 42,
  EW13: 40,
};

const stations = RACHEL_JOURNEY.stations;
const destination = stations[stations.length - 1];

export interface AlternatesResult {
  // Minutes to reach the destination station from each station by a non-EWL
  // route; null = OneMap found no such route (i.e. nothing beats staying put).
  minutes: Record<string, number | null>;
  source: "onemap" | "fallback";
  fetchedAt: string | null;
  error: string | null;
}

interface AlternatesRecord {
  minutes: Record<string, number | null>;
  fetchedAt: string;
}

const ALTERNATES_KEY = "alternates:v1";
// Bus timetables barely move week to week, and each refresh is 12 OneMap calls.
const ALTERNATES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// A resolved result is memoised in-process briefly, because engine.ts asks for
// each station one by one in a loop — without this that's 13 cache round-trips.
const MEMO_MS = 60 * 1000;

let memo: { at: number; promise: Promise<AlternatesResult> } | null = null;

// --- pure helpers (exported so scripts/checkAlternates.ts can test them) ---

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// Fastest itinerary's duration in minutes, or null if OneMap found no route.
// OpenTripPlanner reports itinerary `duration` in seconds (confirmed live).
// Throws on a shape we don't recognise or an implausible result (see speed
// check in fetchStationMinutes) so a wrong assumption degrades to the
// fallback table instead of silently producing confident nonsense.
export function parseItineraryMinutes(body: unknown): number | null {
  const b = body as { plan?: { itineraries?: { duration?: number }[] }; error?: unknown } | null;
  const itineraries = b?.plan?.itineraries;
  if (!Array.isArray(itineraries)) {
    if (b && b.error) return null; // OTP's "no path found" style response
    throw new Error("unrecognised OneMap routing response shape");
  }
  const seconds = itineraries
    .map((i) => i.duration)
    .filter((d): d is number => typeof d === "number" && d > 0);
  return seconds.length ? Math.min(...seconds) / 60 : null;
}

// --- OneMap client ---

async function fetchStationMinutes(
  token: string,
  from: { code: string; lat: number; lng: number; cumMinutes: number },
  when: { date: string },
): Promise<number | null> {
  // Time the rider would actually be at this station on a normal day.
  const [h, m] = RACHEL_JOURNEY.departAt.split(":").map(Number);
  const departMinutes = h * 60 + m + RACHEL_JOURNEY.walk.home.minutes + from.cumMinutes;

  const body = await oneMapPtRoute(token, from.code, {
    from,
    to: destination,
    mode: "BUS",
    date: when.date,
    time: clockTime(departMinutes),
  });

  const minutes = parseItineraryMinutes(body);
  if (minutes === null) return null;

  // Guard against a wrong duration-unit assumption: a bus route averaging
  // >60 km/h door to door is impossible in Singapore, so treat it as a parse
  // error rather than trust it.
  const km = haversineKm(from, destination);
  if (km / (minutes / 60) > 60) {
    throw new Error(`implausible OneMap duration for ${from.code}: ${minutes.toFixed(1)} min over ${km.toFixed(1)} km`);
  }
  return Math.max(1, Math.round(minutes));
}

async function fetchFromOneMap(): Promise<AlternatesRecord> {
  const token = await getToken();
  const when = nextWeekdaySgt();
  const origins = stations.filter((s) => s.code !== destination.code);
  // 12 stations well inside OneMap's rate limit (250 calls/min).
  const results = await Promise.all(origins.map((s) => fetchStationMinutes(token, s, when)));
  const minutes: Record<string, number | null> = {};
  origins.forEach((s, i) => (minutes[s.code] = results[i]));
  return { minutes, fetchedAt: new Date().toISOString() };
}

async function resolveAlternates(): Promise<AlternatesResult> {
  const cached = await getJSON<AlternatesRecord>(ALTERNATES_KEY);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < ALTERNATES_TTL_MS) {
    return { minutes: cached.minutes, source: "onemap", fetchedAt: cached.fetchedAt, error: null };
  }

  const fallback = (error: string | null): AlternatesResult => ({
    minutes: FALLBACK_ALT_MINUTES,
    source: "fallback",
    fetchedAt: null,
    error,
  });

  if (!oneMapConfigured()) {
    return fallback("ONEMAP_TOKEN (or ONEMAP_EMAIL / ONEMAP_PASSWORD) not set — using placeholder alternate times");
  }

  try {
    const record = await fetchFromOneMap();
    await setJSON(ALTERNATES_KEY, record);
    return { minutes: record.minutes, source: "onemap", fetchedAt: record.fetchedAt, error: null };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  }
}

export function getAlternates(): Promise<AlternatesResult> {
  if (!memo || Date.now() - memo.at > MEMO_MS) {
    memo = { at: Date.now(), promise: resolveAlternates() };
  }
  return memo.promise;
}

// Test hook — clears the in-process memo so a script can re-run resolution.
export function resetAlternatesMemo(): void {
  memo = null;
}

// --- bus hops between two stations (for the "bypass" reroute) ---
//
// A disruption usually covers one stretch of the line, not all of it, so the
// realistic reroute is: leave the train before the stretch, take a bus to where
// trains resume, and rejoin — not a bus all the way to work. engine.ts adds the
// rejoin wait and the remaining EWL ride; this returns only the bus part.
// Fetched on demand per (from, to) pair and cached, since which pairs matter
// depends on where the disruption is.

interface HopRecord {
  minutes: number | null; // null = OneMap found no route
  fetchedAt: string;
}

const HOP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const stationByCode = new Map(stations.map((s) => [s.code, s]));

// Bus minutes from one station to another, or Infinity when there is no
// route, OneMap isn't configured, or the call fails. A failure is
// deliberately not fatal: it just means that hop isn't credited as an
// alternative, so the advice degrades to "stay on the train" rather than
// breaking the whole status response.
export async function getBusHopMinutes(fromCode: string, toCode: string): Promise<number> {
  const from = stationByCode.get(fromCode);
  const to = stationByCode.get(toCode);
  if (!from || !to || fromCode === toCode) return Infinity;

  const key = `busHop:v1:${fromCode}:${toCode}`;
  const cached = await getJSON<HopRecord>(key);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < HOP_TTL_MS) return cached.minutes ?? Infinity;

  if (!oneMapConfigured()) return Infinity;

  try {
    const token = await getToken();
    const [h, m] = RACHEL_JOURNEY.departAt.split(":").map(Number);
    const body = await oneMapPtRoute(token, `${fromCode}->${toCode}`, {
      from,
      to,
      mode: "BUS",
      date: nextWeekdaySgt().date,
      time: clockTime(h * 60 + m + RACHEL_JOURNEY.walk.home.minutes + from.cumMinutes),
    });
    const raw = parseItineraryMinutes(body);
    let minutes: number | null = null;
    if (raw !== null) {
      const km = haversineKm(from, to);
      // Same wrong-unit guard as the full-trip query.
      if (km / (raw / 60) > 60) throw new Error(`implausible OneMap duration for ${fromCode}->${toCode}`);
      minutes = Math.max(1, Math.round(raw));
    }
    await setJSON(key, { minutes, fetchedAt: new Date().toISOString() } satisfies HopRecord);
    return minutes ?? Infinity;
  } catch (err) {
    console.warn(`[alternates] bus hop ${fromCode}->${toCode} unavailable:`, err instanceof Error ? err.message : err);
    return Infinity;
  }
}

export async function getAlternateMinutes(stationCode: string): Promise<number> {
  // Already at the destination: there is nothing to reroute to. (The old
  // placeholder table returned 38 here, which could wrongly make the
  // destination itself the "commit point" for a long delay.)
  if (stationCode === destination.code) return Infinity;
  const { minutes } = await getAlternates();
  return minutes[stationCode] ?? Infinity;
}
