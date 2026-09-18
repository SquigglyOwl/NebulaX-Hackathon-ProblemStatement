import { RACHEL_JOURNEY } from "./rachel.js";

export interface WalkRoute {
  // [lat, lng] pairs, in walking order.
  coordinates: [number, number][];
  minutes: number;
  source: "osm" | "fallback";
}

type Leg = "home" | "office";

const firstStation = RACHEL_JOURNEY.stations[0];
const lastStation = RACHEL_JOURNEY.stations[RACHEL_JOURNEY.stations.length - 1];

// Straight-line placeholder — used until the OSRM fetch below succeeds (or if
// it fails, e.g. no network in a sandboxed environment). Same shape as a real
// route, just two points instead of a real footpath.
const FALLBACK: Record<Leg, WalkRoute> = {
  home: {
    coordinates: [
      [RACHEL_JOURNEY.walk.home.lat, RACHEL_JOURNEY.walk.home.lng],
      [firstStation.lat, firstStation.lng],
    ],
    minutes: RACHEL_JOURNEY.walk.home.minutes,
    source: "fallback",
  },
  office: {
    coordinates: [
      [lastStation.lat, lastStation.lng],
      [RACHEL_JOURNEY.walk.office.lat, RACHEL_JOURNEY.walk.office.lng],
    ],
    minutes: RACHEL_JOURNEY.walk.office.minutes,
    source: "fallback",
  },
};

let cache: Record<Leg, WalkRoute> = { ...FALLBACK };
let lastWarmedAt: string | null = null;
let lastWarmError: string | null = null;

export function getWalkRoute(leg: Leg): WalkRoute {
  return cache[leg];
}

export function walkRoutingStatus() {
  return { lastWarmedAt, lastWarmError };
}

// Public foot-routing OSRM instance run by OpenStreetMap.de/FOSSGIS — real
// pedestrian routing (footways, crossings, shortcuts cars can't take), not
// just tiles. Verified before wiring this in: router.project-osrm.org's own
// public demo *looks* like it supports `/foot` but silently only serves its
// driving profile regardless of the URL — a test call there returned 997.9m
// in 105.1s (~34 km/h, obviously a car speed). This instance checks out: the
// same test route returned 719.4m in 577.5s (~4.5 km/h, a genuine walking
// pace) — so both its geometry and duration are trusted here. (Its URL keeps
// the literal `/driving` path segment even for the foot profile — that's
// this host's own routing convention, not a mistake.)
//
// Called once at server startup, not per-request — light, cached, one-off
// use in line with a public demo instance's fair-use expectations. For
// production use, self-host OSRM or swap in OneMap's routing API instead —
// see PS2_README §2.3.
const OSRM_FOOT_BASE = "https://routing.openstreetmap.de/routed-foot/route/v1/driving";

async function fetchOsrmFootRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<WalkRoute | null> {
  const url = `${OSRM_FOOT_BASE}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OSRM ${res.status} ${res.statusText}`);
  const body = await res.json();
  const route = body.routes?.[0];
  if (!route) return null;

  // GeoJSON coordinates are [lng, lat]; flip to the [lat, lng] pairs Leaflet
  // (and the rest of this codebase) expects.
  const coordinates: [number, number][] = route.geometry.coordinates.map(
    ([lng, lat]: [number, number]) => [lat, lng],
  );
  const minutes = Math.max(1, Math.round(route.duration / 60));
  return { coordinates, minutes, source: "osm" };
}

export async function warmWalkRoutes() {
  try {
    const [home, office] = await Promise.all([
      fetchOsrmFootRoute(RACHEL_JOURNEY.walk.home, firstStation),
      fetchOsrmFootRoute(lastStation, RACHEL_JOURNEY.walk.office),
    ]);
    cache = { home: home ?? FALLBACK.home, office: office ?? FALLBACK.office };
    lastWarmedAt = new Date().toISOString();
    lastWarmError = null;
  } catch (err) {
    lastWarmError = err instanceof Error ? err.message : String(err);
    // keep whatever was cached before (fallback straight lines on first run)
  }
}
