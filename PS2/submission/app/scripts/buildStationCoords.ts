// Derives Rachel's EWL station coordinates from the provided
// AmendmenttoMP2014RailStation.geojson (area-weighted polygon centroids) and
// writes src/lib/stationCoords.json. Run: npm run build:stations
//
// Why a build step instead of reading the geojson at runtime: it's 500 KB of
// polygons for all 208 rail stations, lives outside this app's directory, and
// we only need 13 points — a small committed JSON is what actually ships to
// Vercel's serverless bundle.
//
// The geojson carries no EW codes and repeats interchange names across lines
// (Tampines has an elevated EWL polygon and an underground DTL one), so each
// code is pinned to an explicit OBJECTID and the name/grounding is asserted —
// a wrong id fails loudly here instead of silently routing from the wrong
// station.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const GEOJSON = resolve(__dirname, "../../../data/AmendmenttoMP2014RailStation.geojson");
const OUT = resolve(__dirname, "../src/lib/stationCoords.json");

const EWL_STATIONS: { code: string; objectId: number; name: RegExp; ground: string }[] = [
  { code: "EW2", objectId: 692, name: /^TAMPINES STATION$/, ground: "ABOVEGROUND" }, // 784 is the underground DTL station
  { code: "EW3", objectId: 693, name: /^SIMEI/, ground: "ABOVEGROUND" },
  { code: "EW4", objectId: 694, name: /^TANAH MERAH/, ground: "ABOVEGROUND" },
  { code: "EW5", objectId: 757, name: /^BEDOK$/, ground: "ABOVEGROUND" },
  { code: "EW6", objectId: 695, name: /^KEMBANGAN$/, ground: "ABOVEGROUND" },
  { code: "EW7", objectId: 805, name: /^EUNOS$/, ground: "ABOVEGROUND" },
  { code: "EW8", objectId: 769, name: /^PAYA LEBAR/, ground: "ABOVEGROUND" }, // 696 is the underground CCL platform
  { code: "EW9", objectId: 803, name: /^ALJUNIED$/, ground: "ABOVEGROUND" },
  { code: "EW10", objectId: 819, name: /^KALLANG$/, ground: "ABOVEGROUND" },
  { code: "EW11", objectId: 816, name: /^LAVENDER$/, ground: "UNDERGROUND" },
  { code: "EW12", objectId: 650, name: /^BUGIS/, ground: "UNDERGROUND" }, // 709 (TYPE CCL) is the other Bugis platform
  { code: "EW13", objectId: 649, name: /^CITY HALL/, ground: "UNDERGROUND" },
  { code: "EW14", objectId: 797, name: /^RAFFLES PLACE/, ground: "UNDERGROUND" },
];

interface Feature {
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
  properties: { OBJECTID: number; NAME: string | null; GRND_LEVEL: string };
}

// Standard shoelace centroid over the outer ring ([lng, lat] pairs).
function centroid(ring: [number, number][]): { lat: number; lng: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area /= 2;
  return { lng: cx / (6 * area), lat: cy / (6 * area) };
}

const geojson = JSON.parse(readFileSync(GEOJSON, "utf-8")) as { features: Feature[] };
const byId = new Map(geojson.features.map((f) => [f.properties.OBJECTID, f]));

const out: Record<string, { name: string; lat: number; lng: number; objectId: number }> = {};
for (const s of EWL_STATIONS) {
  const f = byId.get(s.objectId);
  if (!f) throw new Error(`${s.code}: OBJECTID ${s.objectId} not in geojson`);
  const name = f.properties.NAME ?? "";
  if (!s.name.test(name) || f.properties.GRND_LEVEL !== s.ground) {
    throw new Error(
      `${s.code}: OBJECTID ${s.objectId} is "${name}" (${f.properties.GRND_LEVEL}), expected ${s.name} (${s.ground})`,
    );
  }
  const { lat, lng } = centroid(f.geometry.coordinates[0]);
  out[s.code] = { name, lat: +lat.toFixed(5), lng: +lng.toFixed(5), objectId: s.objectId };
}

writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
console.log(`Wrote ${Object.keys(out).length} stations to ${OUT}`);
for (const [code, s] of Object.entries(out)) console.log(`  ${code.padEnd(5)} ${s.lat}, ${s.lng}  ${s.name}`);
