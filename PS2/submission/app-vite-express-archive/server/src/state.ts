import { crowdingStatus, getCrowdLevel } from "./crowding.js";
import { fetchTrainServiceAlerts, type AffectedSegment, type TrainServiceAlerts } from "./datamall.js";
import { decide, type Decision } from "./engine.js";
import { getBaselineLabel, pvTrainBaselineStatus } from "./pvTrainBaseline.js";
import { RACHEL_JOURNEY } from "./rachel.js";
import { getWalkRoute, walkRoutingStatus } from "./walkRouting.js";

const EMPTY_FEED: TrainServiceAlerts = { Status: 1, AffectedSegments: [], Message: [] };

let latestFeed: TrainServiceAlerts = EMPTY_FEED;
let lastPolledAt: string | null = null;
let lastPollError: string | null = null;

// Labelled injected/replay data for demo purposes (PS2_README §2.6 explicitly
// permits this — the real feed's AffectedSegments is empty most days). Never
// presented to a judge as live data: the /api/status response tags its source.
let mockOverride: { feed: TrainServiceAlerts; expiresAt: number } | null = null;

const decisionLog: { at: string; interrupt: boolean }[] = [];
const MAX_LOG = 500;

export function injectMock(input: {
  severity: 1 | 2;
  stationCodes: string[];
  freeMRTShuttle?: string;
  freePublicBus?: string;
  message?: string;
  minutesActive?: number;
}) {
  const segment: AffectedSegment = {
    Line: "EWL",
    Direction: "Both",
    Stations: input.stationCodes.join(","),
    FreePublicBus: input.freePublicBus ?? "",
    FreeMRTShuttle: input.freeMRTShuttle ?? "",
    MRTShuttleDirection: input.freeMRTShuttle ? "Both" : "",
  };
  mockOverride = {
    feed: {
      Status: input.severity,
      AffectedSegments: [segment],
      Message: [{ Content: input.message ?? "Injected demo disruption.", CreatedDate: new Date().toISOString() }],
    },
    expiresAt: Date.now() + (input.minutesActive ?? 15) * 60_000,
  };
}

export function clearMock() {
  mockOverride = null;
}

function effectiveFeed(): { feed: TrainServiceAlerts; source: "live" | "mock" } {
  if (mockOverride && mockOverride.expiresAt > Date.now()) {
    return { feed: mockOverride.feed, source: "mock" };
  }
  if (mockOverride) mockOverride = null; // expired
  return { feed: latestFeed, source: "live" };
}

export function currentStatus() {
  const { feed, source } = effectiveFeed();

  // Real (or, until the OSRM fetch has run, fallback straight-line) walking
  // routes — see walkRouting.ts. normalJourneyMinutes is recomputed from
  // them rather than trusting the static estimate baked into rachel.ts, so
  // the slack/interrupt decision reflects genuinely routed walking times
  // once they're available.
  const homeRoute = getWalkRoute("home");
  const officeRoute = getWalkRoute("office");
  const mrtMinutes = RACHEL_JOURNEY.stations[RACHEL_JOURNEY.stations.length - 1].cumMinutes;
  const journey = {
    ...RACHEL_JOURNEY,
    normalJourneyMinutes: homeRoute.minutes + mrtMinutes + officeRoute.minutes,
    walk: {
      home: {
        ...RACHEL_JOURNEY.walk.home,
        minutes: homeRoute.minutes,
        route: homeRoute.coordinates,
        routeSource: homeRoute.source,
      },
      office: {
        ...RACHEL_JOURNEY.walk.office,
        minutes: officeRoute.minutes,
        route: officeRoute.coordinates,
        routeSource: officeRoute.source,
      },
    },
  };

  const decision: Decision = decide(journey, feed.Status, feed.AffectedSegments, feed.Message);

  decisionLog.push({ at: new Date().toISOString(), interrupt: decision.interrupt });
  if (decisionLog.length > MAX_LOG) decisionLog.shift();

  const crowding: Record<string, string> = {};
  const crowdingBaseline: Record<string, string> = {};
  const sgtHour = (new Date().getUTCHours() + 8) % 24; // PV/Train's TIME_PER_HOUR is SGT
  for (const station of RACHEL_JOURNEY.stations) {
    crowding[station.code] = getCrowdLevel(station.code);
    crowdingBaseline[station.code] = getBaselineLabel(station.code, sgtHour);
  }

  return {
    checkedAt: new Date().toISOString(),
    source,
    journey,
    decision,
    crowding,
    crowdingBaseline,
    liveFeed: { lastPolledAt, lastPollError },
    crowdingFeed: crowdingStatus(),
    walkRoutingFeed: walkRoutingStatus(),
    pvTrainBaselineFeed: pvTrainBaselineStatus(),
    stats: {
      totalChecks: decisionLog.length,
      interruptsFired: decisionLog.filter((d) => d.interrupt).length,
    },
  };
}

export async function pollOnce() {
  try {
    latestFeed = await fetchTrainServiceAlerts();
    lastPolledAt = new Date().toISOString();
    lastPollError = null;
  } catch (err) {
    lastPollError = err instanceof Error ? err.message : String(err);
    // keep previous latestFeed — a failed poll should not fabricate "all clear"
  }
}

export function startPolling(intervalMs = 60_000) {
  pollOnce();
  setInterval(pollOnce, intervalMs);
}
