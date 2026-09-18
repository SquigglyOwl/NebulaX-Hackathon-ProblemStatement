import { getAlternateMinutes } from "./alternates";
import { isUnusualCrowding } from "./crowdingRules";
import { deleteKey, getJSON, setJSON } from "./store";
import type { BaselineLabel, ComfortTip, CrowdLevel, Station } from "./types";

// Answers the NebulaX PS2 FAQ's "what else can I build beyond direction
// information" prompt directly: a least-crowded-even-if-longer suggestion,
// surfaced on an ORDINARY day — not gated behind a disruption the way the
// rest of engine.ts is. Reuses alternates.ts (already built for the
// commit-point detector) rather than modelling new route topology, and the
// same "unusually busy for this hour" signal CrowdingStrip.tsx already
// shows as a small dot — this promotes that signal into an actual
// suggestion instead of just a visual flag.

// Demo-only, same reasoning as mockState.ts's disruption injector: a
// genuine "high crowding at a normally-quiet hour" moment is real but not
// guaranteed to be happening at demo time. Deliberately overrides the
// *tip itself* rather than faking a live crowding level, because "unusual"
// depends on both the live reading AND the real PV/Train baseline for the
// current hour lining up — faking only the live half wouldn't reliably
// trigger it. The CrowdingStrip badge won't show "unusual" while this mock
// is active (that part stays real) — a minor, clearly-a-demo-action
// inconsistency, not a correctness issue.
interface MockComfortRecord {
  tip: ComfortTip;
  expiresAt: number;
}

const MOCK_STORE_KEY = "mockComfortTip:v1";

export async function injectMockComfortTip(tip: ComfortTip, minutesActive = 15) {
  await setJSON<MockComfortRecord>(MOCK_STORE_KEY, { tip, expiresAt: Date.now() + minutesActive * 60_000 });
}

export async function clearMockComfortTip() {
  await deleteKey(MOCK_STORE_KEY);
}

async function getMockComfortTip(): Promise<ComfortTip | null> {
  const record = await getJSON<MockComfortRecord>(MOCK_STORE_KEY);
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    await deleteKey(MOCK_STORE_KEY);
    return null;
  }
  return record.tip;
}

export async function computeComfortTip(
  stations: Station[],
  normalJourneyMinutes: number,
  originStationCode: string,
  crowdingLevels: Record<string, CrowdLevel>,
  crowdingBaseline: Record<string, BaselineLabel>,
): Promise<ComfortTip | null> {
  const mock = await getMockComfortTip();
  if (mock) return mock;

  const unusual = stations.find((s) => isUnusualCrowding(crowdingLevels[s.code] ?? "NA", crowdingBaseline[s.code] ?? "unknown"));
  if (!unusual) return null;

  // The full alternate-route time from Rachel's own origin — same function
  // and data the commit-point detector uses for "switch by X station", just
  // triggered by unusual crowding instead of a disruption. Only worth
  // showing when it's genuinely a "longer but quieter" tradeoff, not a
  // free lunch (which the hand-picked FALLBACK_ALT_MINUTES table
  // shouldn't produce, but don't show a nonsensical suggestion if it did).
  const altMinutes = await getAlternateMinutes(originStationCode);
  const extraMinutes = Math.round(altMinutes - normalJourneyMinutes);
  if (!Number.isFinite(extraMinutes) || extraMinutes <= 0) return null;

  return { stationCode: unusual.code, stationName: unusual.name, extraMinutes };
}
