import { RACHEL_JOURNEY } from "./rachel";
import { getJSON, setJSON } from "./store";

export interface WalkRoute {
  // [lat, lng] pairs, in walking order.
  coordinates: [number, number][];
  minutes: number;
  source: "osm" | "fallback";
}

interface WalkRoutesRecord {
  home: WalkRoute;
  office: WalkRoute;
  fetchedAt: string;
}

// Rachel's home/office coordinates never change, so the routed walk never
// needs re-fetching once cached — one key, fetched lazily on first request
// rather than at a "server startup" that doesn't exist in serverless.
const STORE_KEY = "walkRoutes:v1";

const firstStation = RACHEL_JOURNEY.stations[0];
const lastStation = RACHEL_JOURNEY.stations[RACHEL_JOURNEY.stations.length - 1];

// Straight-line placeholder — used if the OSRM fetch below fails (e.g. no
// network reachability from wherever this is deployed). Same shape as a
// real route, just two points instead of a real footpath.
const FALLBACK: { home: WalkRoute; office: WalkRoute } = {
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

export async function getWalkRoutes(): Promise<{
  home: WalkRoute;
  office: WalkRoute;
  fetchedAt: string | null;
  error: string | null;
}> {
  const cached = await getJSON<WalkRoutesRecord>(STORE_KEY);
  if (cached) return { ...cached, error: null };

  try {
    const [home, office] = await Promise.all([
      fetchOsrmFootRoute(RACHEL_JOURNEY.walk.home, firstStation),
      fetchOsrmFootRoute(lastStation, RACHEL_JOURNEY.walk.office),
    ]);
    const record: WalkRoutesRecord = {
      home: home ?? FALLBACK.home,
      office: office ?? FALLBACK.office,
      fetchedAt: new Date().toISOString(),
    };
    await setJSON(STORE_KEY, record);
    return { ...record, error: null };
  } catch (err) {
    return {
      ...FALLBACK,
      fetchedAt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
