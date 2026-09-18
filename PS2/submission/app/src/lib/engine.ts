import { getAlternateMinutes } from "./alternates";
import type { AffectedSegment, TrainServiceAlerts } from "./datamall";
import { extractDelayMinutes } from "./delayExtractor";
import type { RachelJourney } from "./rachel";

// Fallback only — used when a notice's text doesn't state a delay figure
// (delayExtractor.ts returns null), e.g. a flat "No train service between X
// and Y" with no stated duration. When the text does state a number, that's
// used instead; see decide() below.
const DELAY_MINUTES_BY_STATUS: Record<1 | 2, number> = {
  1: 5, // "minor delays" — status 1 but a Message was posted
  2: 30, // "disrupted service / major delays"
};

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function slackMinutes(journey: RachelJourney): number {
  const depart = timeToMinutes(journey.departAt);
  const deadline = timeToMinutes(journey.arriveByDeadline);
  return deadline - depart - journey.normalJourneyMinutes - journey.bufferMinutes;
}

export interface CommitStation {
  code: string;
  name: string;
}

export interface DelayRange {
  low: number;
  high: number;
}

export interface Decision {
  interrupt: boolean;
  predictedDelayMinutes: number;
  predictedDelayRange: DelayRange | null;
  delaySource: "message-text" | "status-fallback" | "none";
  slackMinutes: number;
  affectedStationCodes: string[];
  commitStation: CommitStation | null;
  message: string;
}

// Turns a single point estimate into a range instead of a false-precision
// number — PS2_README §3.2.1: "realistic timing, with the uncertainty made
// visible rather than hidden behind a single confident number." The bounds
// are a deliberately simple, non-ML heuristic (not a model — see
// WRITEUP.md), asymmetric because the official Annex C worked example shows
// a stated figure ("40 min") resolving well before that ("service resumes"
// only ~17 real minutes after the escalated notice) — actual outcomes skew
// faster than the stated number, but can still run over it.
// `status-fallback` gets a much wider band: there's no stated number at all
// behind it, just a status code, so confidence in the point estimate is
// lower.
function delayRange(minutes: number, source: Decision["delaySource"]): DelayRange | null {
  if (source === "message-text") {
    return { low: Math.max(1, Math.round(minutes * 0.5)), high: Math.round(minutes * 1.3) };
  }
  if (source === "status-fallback") {
    return { low: Math.max(1, Math.round(minutes * 0.3)), high: Math.round(minutes * 2) };
  }
  return null;
}

// Walks Rachel's route in travel order and finds the last station at which
// switching to an alternate route still beats riding out the delay — i.e.
// the "commit point": past it, staying on the train is faster than rerouting.
// Pure arithmetic over the (currently hand-picked) segment/alternate tables —
// deliberately not a model, see WRITEUP.md.
//
// Async here (unlike the original Express version) because alternates.ts's
// cache now lives in the shared store (Redis in production), not a
// module-level variable — see store.ts.
export async function computeCommitPoint(
  journey: RachelJourney,
  predictedDelayMinutes: number,
): Promise<CommitStation | null> {
  const destCumMinutes = journey.stations[journey.stations.length - 1].cumMinutes;
  let commit: CommitStation | null = null;
  for (const station of journey.stations) {
    const remaining = destCumMinutes - station.cumMinutes;
    const stayTime = predictedDelayMinutes + remaining;
    const rerouteTime = await getAlternateMinutes(station.code);
    if (rerouteTime < stayTime) {
      commit = { code: station.code, name: station.name };
    }
  }
  return commit;
}

export async function decide(
  journey: RachelJourney,
  status: 1 | 2,
  segments: AffectedSegment[],
  messages: TrainServiceAlerts["Message"] = [],
): Promise<Decision> {
  const slack = slackMinutes(journey);
  const journeyStationCodes = new Set(journey.stations.map((s) => s.code));

  const relevant = segments.filter((seg) => {
    const segStations = seg.Stations.split(",").map((s) => s.trim());
    return segStations.some((code) => journeyStationCodes.has(code));
  });

  if (relevant.length === 0) {
    return {
      interrupt: false,
      predictedDelayMinutes: 0,
      predictedDelayRange: null,
      delaySource: "none",
      slackMinutes: slack,
      affectedStationCodes: [],
      commitStation: null,
      message: "Normal service on the East West Line. No action needed.",
    };
  }

  const extracted = extractDelayMinutes(messages);
  const predictedDelayMinutes = extracted?.minutes ?? DELAY_MINUTES_BY_STATUS[status];
  const delaySource: Decision["delaySource"] = extracted ? "message-text" : "status-fallback";
  const predictedDelayRange = delayRange(predictedDelayMinutes, delaySource);
  const affectedStationCodes = relevant.flatMap((seg) =>
    seg.Stations.split(",").map((s) => s.trim()),
  );
  const interrupt = predictedDelayMinutes > slack;
  const commitStation = interrupt ? await computeCommitPoint(journey, predictedDelayMinutes) : null;

  const mitigation = relevant.find((s) => s.FreeMRTShuttle || s.FreePublicBus);
  const action = mitigation?.FreeMRTShuttle
    ? `Free MRT shuttle available (${mitigation.MRTShuttleDirection}).`
    : mitigation?.FreePublicBus
      ? `Free boarding on public buses at ${mitigation.FreePublicBus}.`
      : "Consider an alternative route.";

  const commitClause = commitStation
    ? ` Switch by ${commitStation.name} — after that, staying on this train is faster.`
    : interrupt
      ? " No alternate beats riding this one out — stay on this train."
      : "";

  const delayText = predictedDelayRange
    ? `+${predictedDelayRange.low}–${predictedDelayRange.high} min`
    : `+${predictedDelayMinutes} min`;

  const message = interrupt
    ? `${delayText} expected on your EWL journey. ${action}${commitClause}`
    : `Minor delay on EWL (${delayText.replace("+", "~")}) — within your buffer, no action needed.`;

  return {
    interrupt,
    predictedDelayMinutes,
    predictedDelayRange,
    delaySource,
    slackMinutes: slack,
    affectedStationCodes,
    commitStation,
    message,
  };
}
