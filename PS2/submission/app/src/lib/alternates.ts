// Alternate-route travel time (minutes) from each station straight to Rachel's
// destination, used by the commit-point detector.
//
// FALLBACK_ALT_MINUTES below is a hand-picked placeholder, not a measured
// route — chosen so a major disruption's commit point lands at a plausible
// mid-route station for the demo. Replace getAlternateMinutes() with real
// OneMap routing calls once you have credentials (see WRITEUP.md "Known
// gaps") — it's already `async` in anticipation of that, even though today
// it's just a constant lookup with nothing to actually fetch or cache.
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

export async function getAlternateMinutes(stationCode: string): Promise<number> {
  // TODO: if ONEMAP_EMAIL / ONEMAP_PASSWORD are set, authenticate against
  // OneMap, call its routing API, and cache the real minutes via store.ts
  // (same pattern as walkRouting.ts) instead of returning this table.
  return FALLBACK_ALT_MINUTES[stationCode] ?? Infinity;
}
