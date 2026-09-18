// Alternate-route travel time (minutes) from each station straight to Rachel's
// destination, used by the commit-point detector. Real routing (OneMap's
// routing API) is an async fetch per station, so it's warmed once at server
// startup into this in-memory cache rather than looked up per-request.
//
// FALLBACK_ALT_MINUTES below is a hand-picked placeholder, not a measured
// route — chosen so a major disruption's commit point lands at a plausible
// mid-route station for the demo. Replace warmAlternatesCache() with real
// OneMap calls once you have credentials (see WRITEUP.md "Known gaps").
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
  EW14: 38,
};

let cache: Record<string, number> = { ...FALLBACK_ALT_MINUTES };

export function getAlternateMinutes(stationCode: string): number {
  return cache[stationCode] ?? Infinity;
}

export async function warmAlternatesCache() {
  // TODO: if ONEMAP_EMAIL / ONEMAP_PASSWORD are set, authenticate against
  // OneMap, call its routing API once per station in RACHEL_JOURNEY.stations,
  // and replace `cache` with the real minutes. Falls back to the hand-picked
  // table above otherwise.
  cache = { ...FALLBACK_ALT_MINUTES };
}
