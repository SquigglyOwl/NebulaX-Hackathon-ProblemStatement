import { getAdvice } from "./advice";
import { getAlternateMinutes, getBusHopMinutes } from "./alternates";
import type { AffectedSegment, TrainServiceAlerts } from "./datamall";
import { extractDelayMinutes } from "./delayExtractor";
import type { RachelJourney } from "./rachel";

// Last-resort fallback only — used when a notice's text doesn't state a
// delay figure (delayExtractor.ts returns null) AND the LLM classifier
// (advice.ts) is unavailable or itself fails (no GEMINI_API_KEY set, quota
// exceeded, network error). When the text does state a number, that's used
// instead; see decide() below.
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
  // Set when the best reroute is to bus to this station (where trains resume)
  // and rejoin the line, rather than to abandon the MRT for the whole trip.
  rejoin?: { code: string; name: string };
}

// Getting back on the train after a bus hop: wait for the next EWL train and
// walk from the bus stop to the platform. An assumption, not a measurement.
const REJOIN_BUFFER_MINUTES = 4;

export interface DelayRange {
  low: number;
  high: number;
}

export interface Decision {
  interrupt: boolean;
  predictedDelayMinutes: number;
  predictedDelayRange: DelayRange | null;
  delaySource: "message-text" | "llm-advice" | "status-fallback" | "none";
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
  if (source === "llm-advice") {
    // Between message-text and status-fallback: an informed estimate from
    // fault-type/context, but not a number LTA actually stated.
    return { low: Math.max(1, Math.round(minutes * 0.4)), high: Math.round(minutes * 1.6) };
  }
  if (source === "status-fallback") {
    return { low: Math.max(1, Math.round(minutes * 0.3)), high: Math.round(minutes * 2) };
  }
  return null;
}

// Walks Rachel's route in travel order and finds the last station at which
// switching to an alternate route still beats riding out the delay — i.e.
// the "commit point": past it, staying on the train is faster than rerouting.
// Pure arithmetic over the segment/alternate-route times — deliberately not a
// model, see WRITEUP.md.
//
// Async here (unlike the original Express version) because alternates.ts's
// cache now lives in the shared store (Redis in production), not a
// module-level variable — see store.ts.
//
// The delay is only still ahead of the rider at stations *before* the end of
// the disrupted segment: once past it, staying on the train costs just the
// remaining ride. Without that, real alternate times made a delay between
// Paya Lebar and Kallang yield "switch by City Hall" — a station beyond the
// disruption, where there is nothing left to avoid.
//
// Two reroutes are weighed at each station before that point: a bus all the
// way to the destination, and a *bypass* — a bus to the station where trains
// resume (the last affected one), then the train for the rest. The bypass is
// usually far better because the line is only broken along one stretch; a
// whole-trip-by-bus comparison alone made even a 30-minute delay look like
// "just stay on the train".
//
// `affectedStationCodes` omitted means no segment info: the delay applies at
// every station and only the whole-trip bus is considered (the old behaviour).
export async function computeCommitPoint(
  journey: RachelJourney,
  predictedDelayMinutes: number,
  affectedStationCodes?: string[],
): Promise<CommitStation | null> {
  const stations = journey.stations;
  const destCumMinutes = stations[stations.length - 1].cumMinutes;
  const affected = new Set(affectedStationCodes);
  const lastAffectedIdx = affectedStationCodes
    ? stations.reduce((last, s, i) => (affected.has(s.code) ? i : last), -1)
    : stations.length; // no info: treat every station as before the disruption
  const rejoin = lastAffectedIdx >= 0 && lastAffectedIdx < stations.length ? stations[lastAffectedIdx] : null;

  // Reroute options are independent OneMap lookups (cached after the first
  // disruption), so fetch them in parallel rather than station by station.
  const reroutes = await Promise.all(
    stations.map(async (station, i) => {
      const wholeTripByBus = await getAlternateMinutes(station.code);
      if (!rejoin || i >= lastAffectedIdx) return { minutes: wholeTripByBus, viaRejoin: false };
      const hop = await getBusHopMinutes(station.code, rejoin.code);
      const bypass = hop + REJOIN_BUFFER_MINUTES + (destCumMinutes - rejoin.cumMinutes);
      return bypass < wholeTripByBus ? { minutes: bypass, viaRejoin: true } : { minutes: wholeTripByBus, viaRejoin: false };
    }),
  );

  let commit: CommitStation | null = null;
  for (const [i, station] of stations.entries()) {
    const remaining = destCumMinutes - station.cumMinutes;
    const delayAhead = i < lastAffectedIdx ? predictedDelayMinutes : 0;
    if (reroutes[i].minutes < delayAhead + remaining) {
      commit = { code: station.code, name: station.name };
      if (reroutes[i].viaRejoin && rejoin) commit.rejoin = { code: rejoin.code, name: rejoin.name };
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
  // Regex first (a stated number is ground truth, not a guess). Only when
  // that fails do we spend an LLM call — e.g. a flat "No train service
  // between X and Y" with no duration stated. See advice.ts.
  const llmAdvice = !extracted && messages[0]?.Content ? await getAdvice(messages[0].Content) : null;
  const predictedDelayMinutes = extracted?.minutes ?? llmAdvice?.delayMinutes ?? DELAY_MINUTES_BY_STATUS[status];
  const delaySource: Decision["delaySource"] = extracted
    ? "message-text"
    : llmAdvice
      ? "llm-advice"
      : "status-fallback";
  const predictedDelayRange = delayRange(predictedDelayMinutes, delaySource);
  const affectedStationCodes = relevant.flatMap((seg) =>
    seg.Stations.split(",").map((s) => s.trim()),
  );
  const interrupt = predictedDelayMinutes > slack;
  const commitStation = interrupt
    ? await computeCommitPoint(journey, predictedDelayMinutes, affectedStationCodes)
    : null;

  const mitigation = relevant.find((s) => s.FreeMRTShuttle || s.FreePublicBus);
  const action = mitigation?.FreeMRTShuttle
    ? `Free MRT shuttle available (${mitigation.MRTShuttleDirection}).`
    : mitigation?.FreePublicBus
      ? `Free boarding on public buses at ${mitigation.FreePublicBus}.`
      : (llmAdvice?.oneLineAction ?? "Consider an alternative route.");

  const commitClause = commitStation
    ? commitStation.rejoin
      ? ` Switch by ${commitStation.name}: take a bus to ${commitStation.rejoin.name}, then rejoin the train — after that, staying on this train is faster.`
      : ` Switch by ${commitStation.name} — after that, staying on this train is faster.`
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
