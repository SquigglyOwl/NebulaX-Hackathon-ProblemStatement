// Measured EWL in-vehicle time (minutes from Tampines) to each of Rachel's
// stations — the real replacement for rachel.ts's hand-picked cumMinutes.
//
// For each station we ask OneMap for a Tampines -> station itinerary and read
// the duration of its SUBWAY leg on the EW line: in-vehicle time only, so no
// platform wait or walking is baked in. (Verified live: Tampines -> Raffles
// Place is 1673 s ≈ 28 min, vs the 38 min that had been hand-picked.)
// Querying from Tampines every time (rather than summing adjacent hops)
// avoids accumulating per-hop rounding error and needs no per-segment data.
//
// Every leg is validated (right line, right endpoints, plausible speed) and the
// whole set must be strictly increasing along the route; anything else falls
// back to rachel.ts's table and reports source "fallback", exactly like
// alternates.ts, so a surprise in OneMap's data can't silently skew the advice.
import { clockTime, getToken, nextWeekdaySgt, oneMapConfigured, oneMapPtRoute } from "./onemap";
import { RACHEL_JOURNEY } from "./rachel";
import { getJSON, setJSON } from "./store";

const stations = RACHEL_JOURNEY.stations;
const origin = stations[0];

export interface RideTimesResult {
  cumMinutes: Record<string, number>;
  source: "onemap" | "fallback";
  fetchedAt: string | null;
  error: string | null;
}

interface RideTimesRecord {
  cumMinutes: Record<string, number>;
  fetchedAt: string;
}

const RIDE_TIMES_KEY = "rideTimes:v1";
// Rail running times change with timetable revisions, not week to week.
const RIDE_TIMES_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MEMO_MS = 60 * 1000;

let memo: { at: number; promise: Promise<RideTimesResult> } | null = null;

const HARDCODED: Record<string, number> = Object.fromEntries(stations.map((s) => [s.code, s.cumMinutes]));

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

interface Leg {
  mode?: string;
  route?: string;
  duration?: number;
  from?: { name?: string };
  to?: { name?: string };
}

// In-vehicle seconds of the EW-line SUBWAY leg that runs from `fromName` to
// `toName`, or null if no itinerary has one (e.g. OneMap chose a different
// line). Matching by station name: leg endpoints read like "BUGIS MRT STATION".
export function parseEwlRideSeconds(body: unknown, fromName: string, toName: string): number | null {
  const itineraries = (body as { plan?: { itineraries?: { legs?: Leg[] }[] } } | null)?.plan?.itineraries;
  if (!Array.isArray(itineraries)) {
    if ((body as { error?: unknown } | null)?.error) return null;
    throw new Error("unrecognised OneMap routing response shape");
  }
  const from = fromName.toUpperCase();
  const to = toName.toUpperCase();
  const seconds = itineraries
    .flatMap((it) => it.legs ?? [])
    .filter(
      (l) =>
        l.mode === "SUBWAY" &&
        l.route === "EW" &&
        (l.from?.name ?? "").toUpperCase().includes(from) &&
        (l.to?.name ?? "").toUpperCase().includes(to) &&
        typeof l.duration === "number" &&
        l.duration > 0,
    )
    .map((l) => l.duration as number);
  return seconds.length ? Math.min(...seconds) : null;
}

async function fetchFromOneMap(): Promise<RideTimesRecord> {
  const token = await getToken();
  const when = nextWeekdaySgt();
  const [h, m] = RACHEL_JOURNEY.departAt.split(":").map(Number);
  const time = clockTime(h * 60 + m + RACHEL_JOURNEY.walk.home.minutes);

  const targets = stations.slice(1);
  const results = await Promise.all(
    targets.map(async (s) => {
      const body = await oneMapPtRoute(token, `ride ${s.code}`, { from: origin, to: s, mode: "TRANSIT", date: when.date, time });
      const seconds = parseEwlRideSeconds(body, origin.name, s.name);
      if (seconds === null) throw new Error(`no EW-line leg from ${origin.name} to ${s.name} in OneMap's itineraries`);
      // A train averaging outside 15-90 km/h means a unit or leg mix-up, not a real segment.
      const kmh = haversineKm(origin, s) / (seconds / 3600);
      if (kmh < 15 || kmh > 90) throw new Error(`implausible ride time to ${s.code}: ${(seconds / 60).toFixed(1)} min over ${haversineKm(origin, s).toFixed(1)} km`);
      return Math.max(1, Math.round(seconds / 60));
    }),
  );

  const cumMinutes: Record<string, number> = { [origin.code]: 0 };
  targets.forEach((s, i) => (cumMinutes[s.code] = results[i]));

  // Farther along the line must take strictly longer, or the set is unusable.
  const ordered = stations.map((s) => cumMinutes[s.code]);
  if (ordered.some((v, i) => i > 0 && v <= ordered[i - 1])) {
    throw new Error(`ride times not increasing along the line: ${ordered.join(", ")}`);
  }
  return { cumMinutes, fetchedAt: new Date().toISOString() };
}

async function resolveRideTimes(): Promise<RideTimesResult> {
  const cached = await getJSON<RideTimesRecord>(RIDE_TIMES_KEY);
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < RIDE_TIMES_TTL_MS) {
    return { cumMinutes: cached.cumMinutes, source: "onemap", fetchedAt: cached.fetchedAt, error: null };
  }

  const fallback = (error: string | null): RideTimesResult => ({
    cumMinutes: HARDCODED,
    source: "fallback",
    fetchedAt: null,
    error,
  });

  if (!oneMapConfigured()) {
    return fallback("ONEMAP_TOKEN (or ONEMAP_EMAIL / ONEMAP_PASSWORD) not set — using hand-picked ride times");
  }

  try {
    const record = await fetchFromOneMap();
    await setJSON(RIDE_TIMES_KEY, record);
    return { cumMinutes: record.cumMinutes, source: "onemap", fetchedAt: record.fetchedAt, error: null };
  } catch (err) {
    return fallback(err instanceof Error ? err.message : String(err));
  }
}

export function getRideTimes(): Promise<RideTimesResult> {
  if (!memo || Date.now() - memo.at > MEMO_MS) {
    memo = { at: Date.now(), promise: resolveRideTimes() };
  }
  return memo.promise;
}

// Test hook — clears the in-process memo so a script can re-run resolution.
export function resetRideTimesMemo(): void {
  memo = null;
}
