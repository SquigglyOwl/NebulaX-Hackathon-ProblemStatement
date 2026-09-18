import { getCrowding } from "./crowding";
import { decide, type Decision } from "./engine";
import { getActiveMock } from "./mockState";
import { getBaseline, type BaselineLabel } from "./pvTrainBaseline";
import { RACHEL_JOURNEY } from "./rachel";
import { getJSON, incr } from "./store";
import { getLatestAlerts } from "./trainAlerts";
import { getWalkRoutes } from "./walkRouting";

export async function currentStatus() {
  const mockFeed = await getActiveMock();
  const [live, walkRoutes, crowding, baseline] = await Promise.all([
    mockFeed ? Promise.resolve({ feed: mockFeed, polledAt: null, error: null }) : getLatestAlerts(),
    getWalkRoutes(),
    getCrowding(),
    getBaseline(),
  ]);
  const source: "live" | "mock" = mockFeed ? "mock" : "live";

  // Real (or fallback straight-line, until the OSRM fetch has run) walking
  // routes — normalJourneyMinutes is recomputed from them rather than
  // trusting the static estimate baked into rachel.ts, so the slack/
  // interrupt decision reflects genuinely routed walking times.
  const mrtMinutes = RACHEL_JOURNEY.stations[RACHEL_JOURNEY.stations.length - 1].cumMinutes;
  const journey = {
    ...RACHEL_JOURNEY,
    normalJourneyMinutes: walkRoutes.home.minutes + mrtMinutes + walkRoutes.office.minutes,
    walk: {
      // WalkRoute's own field names (coordinates/source) don't match what
      // the frontend expects (route/routeSource) — this remapping was
      // present in the original Express version and got silently dropped
      // in an earlier draft of this file when the spread was "simplified".
      // Caught by actually curling /api/status and checking the shape
      // rather than trusting it compiled.
      home: {
        ...RACHEL_JOURNEY.walk.home,
        minutes: walkRoutes.home.minutes,
        route: walkRoutes.home.coordinates,
        routeSource: walkRoutes.home.source,
      },
      office: {
        ...RACHEL_JOURNEY.walk.office,
        minutes: walkRoutes.office.minutes,
        route: walkRoutes.office.coordinates,
        routeSource: walkRoutes.office.source,
      },
    },
  };

  const decision: Decision = await decide(journey, live.feed.Status, live.feed.AffectedSegments, live.feed.Message);

  const totalChecks = await incr("stats:totalChecks");
  const interruptsFired = decision.interrupt ? await incr("stats:interruptsFired") : await peekInterruptsFired();

  const sgtHour = (new Date().getUTCHours() + 8) % 24; // PV/Train's TIME_PER_HOUR is SGT
  const crowdingLevels: Record<string, string> = {};
  const crowdingBaseline: Record<string, BaselineLabel> = {};
  for (const station of RACHEL_JOURNEY.stations) {
    crowdingLevels[station.code] = crowding.levels[station.code] ?? "NA";
    crowdingBaseline[station.code] = baseline.labelByStationHour[station.code]?.[sgtHour] ?? "unknown";
  }

  return {
    checkedAt: new Date().toISOString(),
    source,
    journey,
    decision,
    crowding: crowdingLevels,
    crowdingBaseline,
    liveFeed: { lastPolledAt: live.polledAt, lastPollError: live.error },
    crowdingFeed: { lastPolledAt: crowding.polledAt, lastPollError: crowding.error },
    walkRoutingFeed: { lastWarmedAt: walkRoutes.fetchedAt, lastWarmError: walkRoutes.error },
    pvTrainBaselineFeed: { lastWarmedAt: baseline.fetchedAt, lastWarmError: baseline.error },
    stats: { totalChecks, interruptsFired },
  };
}

// incr() always increments — for the non-interrupt case we just need the
// current value, not to bump it. A separate get avoids a fake increment.
async function peekInterruptsFired(): Promise<number> {
  return (await getJSON<number>("stats:interruptsFired")) ?? 0;
}
