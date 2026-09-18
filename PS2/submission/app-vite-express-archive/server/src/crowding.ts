import { fetchStationCrowding, type CrowdLevel } from "./datamall.js";
import { RACHEL_JOURNEY } from "./rachel.js";

let cache: Record<string, CrowdLevel> = {};
let lastPolledAt: string | null = null;
let lastPollError: string | null = null;

export function getCrowdLevel(stationCode: string): CrowdLevel {
  return cache[stationCode] ?? "NA";
}

export function crowdingStatus() {
  return { lastPolledAt, lastPollError };
}

export async function pollCrowdingOnce() {
  try {
    const rows = await fetchStationCrowding(RACHEL_JOURNEY.line);
    const next: Record<string, CrowdLevel> = {};
    for (const row of rows) {
      next[row.Station] = row.CrowdLevel;
    }
    cache = next;
    lastPolledAt = new Date().toISOString();
    lastPollError = null;
  } catch (err) {
    lastPollError = err instanceof Error ? err.message : String(err);
    // keep previous cache — a failed poll shouldn't erase what we already know
  }
}

// PCDRealTime refreshes every 10 min per the API guide; polling faster than
// that would just repeat the same reading.
export function startCrowdingPolling(intervalMs = 10 * 60_000) {
  pollCrowdingOnce();
  setInterval(pollCrowdingOnce, intervalMs);
}
