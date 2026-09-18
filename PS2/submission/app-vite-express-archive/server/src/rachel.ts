// Rachel's fixed daily journey — hardcoded for this prototype (see PS2_README §2.2).
// Station coordinates are approximate (hand-placed from public knowledge of EWL
// station locations), good enough for a demo map. Before relying on this for real
// routing, replace with AmendmenttoMP2014RailStation.geojson centroids or OneMap
// geocoding — see WRITEUP.md.
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
  // Endpoint coordinates for the two walking legs, calibrated against the
  // real foot-routing API (routing.openstreetmap.de) rather than guessed
  // from a straight-line distance — an earlier guess based on straight-line
  // distance produced real walking routes 2x longer than expected (real
  // footpaths aren't beelines), which pushed slack negative. These points
  // were checked to return ~4 min and ~6 min real routes before being used
  // here. `minutes` below is only the last-resort fallback used before
  // walkRouting.ts's real fetch completes (or if it fails) — see state.ts,
  // which overrides this with the actual routed time once available.
  walk: {
    home: {
      name: "Home (near Tampines)",
      lat: 1.3565,
      lng: 103.9445,
      minutes: 4,
    },
    office: {
      name: "Office (near Raffles Place)",
      lat: 1.281,
      lng: 103.851,
      minutes: 6,
    },
  },
  // cumMinutes = minutes from Tampines to this station, hand-picked to sum to
  // normalJourneyMinutes (38) with plausible per-segment spacing — not derived
  // from a published EWL timetable or PV/ODTrain data yet. Swap for a measured
  // figure before relying on the commit-point detector for real advice.
  stations: [
    { code: "EW2", name: "Tampines", lat: 1.3546, lng: 103.9437, cumMinutes: 0 },
    { code: "EW3", name: "Simei", lat: 1.3430, lng: 103.953, cumMinutes: 4 },
    { code: "EW4", name: "Tanah Merah", lat: 1.3272, lng: 103.9463, cumMinutes: 8 },
    { code: "EW5", name: "Bedok", lat: 1.324, lng: 103.93, cumMinutes: 11 },
    { code: "EW6", name: "Kembangan", lat: 1.3208, lng: 103.9127, cumMinutes: 14 },
    { code: "EW7", name: "Eunos", lat: 1.3197, lng: 103.903, cumMinutes: 16 },
    { code: "EW8", name: "Paya Lebar", lat: 1.3177, lng: 103.8925, cumMinutes: 19 },
    { code: "EW9", name: "Aljunied", lat: 1.3164, lng: 103.8827, cumMinutes: 21 },
    { code: "EW10", name: "Kallang", lat: 1.3117, lng: 103.8713, cumMinutes: 24 },
    { code: "EW11", name: "Lavender", lat: 1.3072, lng: 103.863, cumMinutes: 27 },
    { code: "EW12", name: "Bugis", lat: 1.3007, lng: 103.856, cumMinutes: 30 },
    { code: "EW13", name: "City Hall", lat: 1.2931, lng: 103.852, cumMinutes: 34 },
    { code: "EW14", name: "Raffles Place", lat: 1.2836, lng: 103.8514, cumMinutes: 38 },
  ],
};

export type RachelJourney = typeof RACHEL_JOURNEY;
