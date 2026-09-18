import { getAlternates } from "./alternates";
import { computeComfortTip } from "./comfort";
import { getCrowding } from "./crowding";
import { decide, type Decision } from "./engine";
import { getActiveMock } from "./mockState";
import { getBaseline, type BaselineLabel } from "./pvTrainBaseline";
import { RACHEL_JOURNEY } from "./rachel";
import { getRideTimes } from "./rideTimes";
import { getJSON, incr } from "./store";
import { getLatestAlerts } from "./trainAlerts";
import type { CrowdLevel } from "./types";
import { getWalkRoutes } from "./walkRouting";

export async function currentStatus() {
  const mockFeed = await getActiveMock();
  const [live, walkRoutes, crowding, baseline, alternates, rideTimes] = await Promise.all([
    mockFeed ? Promise.resolve({ feed: mockFeed, polledAt: null, error: null }) : getLatestAlerts(),
    getWalkRoutes(),
    getCrowding(),
    getBaseline(),
    // These two warm the OneMap caches (and report their provenance)
    // whether or not there's a disruption right now.
    getAlternates(),
    getRideTimes(),
  ]);
  const source: "live" | "mock" = mockFeed ? "mock" : "live";

  // Real (or fallback straight-line, until the OSRM fetch has run) walking
  // routes — normalJourneyMinutes is recomputed from them rather than
  // trusting the static estimate baked into rachel.ts, so the slack/
  // interrupt decision reflects genuinely routed walking times.
  // The MRT leg likewise uses OneMap's measured in-vehicle times when
  // available (rideTimes.ts), else rachel.ts's hand-picked cumMinutes.
  const stations = RACHEL_JOURNEY.stations.map((s) => ({
    ...s,
    cumMinutes: rideTimes.cumMinutes[s.code] ?? s.cumMinutes,
  }));
  const mrtMinutes = stations[stations.length - 1].cumMinutes;
  const journey = {
    ...RACHEL_JOURNEY,
    stations,
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
  const crowdingLevels: Record<string, CrowdLevel> = {};
  const crowdingBaseline: Record<string, BaselineLabel> = {};
  for (const station of RACHEL_JOURNEY.stations) {
    crowdingLevels[station.code] = crowding.levels[station.code] ?? "NA";
    crowdingBaseline[station.code] = baseline.labelByStationHour[station.code]?.[sgtHour] ?? "unknown";
  }

  // Surfaces a "quieter, longer" suggestion on an ordinary day, not just
  // when a disruption interrupts — see comfort.ts. Independent of
  // decision.interrupt: a disruption day can still have this be relevant
  // (crowding and delays are different problems), so it's not gated behind
  // "no disruption today".
  const comfortTip = await computeComfortTip(
    RACHEL_JOURNEY.stations,
    journey.normalJourneyMinutes,
    RACHEL_JOURNEY.stations[0].code,
    crowdingLevels,
    crowdingBaseline,
  );

  return {
    checkedAt: new Date().toISOString(),
    source,
    journey,
    decision,
    crowding: crowdingLevels,
    crowdingBaseline,
    comfortTip,
    liveFeed: { lastPolledAt: live.polledAt, lastPollError: live.error },
    crowdingFeed: { lastPolledAt: crowding.polledAt, lastPollError: crowding.error },
    walkRoutingFeed: { lastWarmedAt: walkRoutes.fetchedAt, lastWarmError: walkRoutes.error },
    alternatesFeed: {
      source: alternates.source,
      lastWarmedAt: alternates.fetchedAt,
      lastWarmError: alternates.error,
    },
    rideTimesFeed: {
      source: rideTimes.source,
      lastWarmedAt: rideTimes.fetchedAt,
      lastWarmError: rideTimes.error,
    },
    pvTrainBaselineFeed: { lastWarmedAt: baseline.fetchedAt, lastWarmError: baseline.error },
    stats: { totalChecks, interruptsFired },
  };
}

// incr() always increments — for the non-interrupt case we just need the
// current value, not to bump it. A separate get avoids a fake increment.
async function peekInterruptsFired(): Promise<number> {
  return (await getJSON<number>("stats:interruptsFired")) ?? 0;
}
