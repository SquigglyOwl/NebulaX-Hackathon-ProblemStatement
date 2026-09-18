import stationCoords from "./stationCoords.json";

// Station lat/lng come from the provided AmendmenttoMP2014RailStation.geojson
// (polygon centroids of the station footprints, not exits), generated into
// stationCoords.json by `npm run build:stations` — see scripts/buildStationCoords.ts
// for how each EW code is pinned to its polygon. Names and cumMinutes below are
// still hand-set.
function coords(code: keyof typeof stationCoords): { lat: number; lng: number } {
  const { lat, lng } = stationCoords[code];
  return { lat, lng };
}

// Rachel's fixed daily journey — hardcoded for this prototype (see PS2_README §2.2).
export const RACHEL_JOURNEY = {
  line: "EWL" as const,
  direction: "westbound" as const, // Tampines -> Raffles Place runs towards Tuas Link
  departAt: "07:40", // she leaves HOME at this time — door to door, not platform to platform
  arriveByDeadline: "08:45",
  // Fallback door-to-door total (walk + MRT ride + walk) — only used before
  // walkRouting.ts's real OSRM fetch completes, or if it fails. state.ts
  // recomputes this from the actual routed walking minutes on every request.
  normalJourneyMinutes: 4 + 38 + 6,
  bufferMinutes: 5,
  // Endpoint coordinates for the two walking legs — fictional persona points,
  // placed so the real foot-routing API (routing.openstreetmap.de) returns
  // ~4 min (home -> Tampines) and ~6 min (Raffles Place -> office) against
  // the geojson-derived station coordinates below (re-checked when those
  // replaced the hand-placed ones: 4.1 and 5.9 min). Straight-line guesses
  // don't work — real footpaths aren't beelines, and an earlier guess pushed
  // slack negative. `minutes` is only the last-resort fallback used before
  // walkRouting.ts's real fetch completes (or if it fails) — see state.ts,
  // which overrides this with the actual routed time once available.
  walk: {
    home: {
      name: "Home (near Tampines)",
      lat: 1.3553,
      lng: 103.945,
      minutes: 4,
    },
    office: {
      name: "Office (near Raffles Place)",
      lat: 1.282,
      lng: 103.8512,
      minutes: 6,
    },
  },
  // cumMinutes = minutes from Tampines to this station, hand-picked to sum to
  // normalJourneyMinutes (38) with plausible per-segment spacing — not derived
  // from a published EWL timetable or PV/ODTrain data yet. Swap for a measured
  // figure before relying on the commit-point detector for real advice.
  stations: [
    { code: "EW2", name: "Tampines", ...coords("EW2"), cumMinutes: 0 },
    { code: "EW3", name: "Simei", ...coords("EW3"), cumMinutes: 4 },
    { code: "EW4", name: "Tanah Merah", ...coords("EW4"), cumMinutes: 8 },
    { code: "EW5", name: "Bedok", ...coords("EW5"), cumMinutes: 11 },
    { code: "EW6", name: "Kembangan", ...coords("EW6"), cumMinutes: 14 },
    { code: "EW7", name: "Eunos", ...coords("EW7"), cumMinutes: 16 },
    { code: "EW8", name: "Paya Lebar", ...coords("EW8"), cumMinutes: 19 },
    { code: "EW9", name: "Aljunied", ...coords("EW9"), cumMinutes: 21 },
    { code: "EW10", name: "Kallang", ...coords("EW10"), cumMinutes: 24 },
    { code: "EW11", name: "Lavender", ...coords("EW11"), cumMinutes: 27 },
    { code: "EW12", name: "Bugis", ...coords("EW12"), cumMinutes: 30 },
    { code: "EW13", name: "City Hall", ...coords("EW13"), cumMinutes: 34 },
    { code: "EW14", name: "Raffles Place", ...coords("EW14"), cumMinutes: 38 },
  ],
};

export type RachelJourney = typeof RACHEL_JOURNEY;
