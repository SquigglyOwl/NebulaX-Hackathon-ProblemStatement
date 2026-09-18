import { fetchStationCrowding, type CrowdLevel } from "./datamall";
import { RACHEL_JOURNEY } from "./rachel";
import { getJSON, setJSON } from "./store";

interface CrowdingRecord {
  levels: Record<string, CrowdLevel>;
  polledAt: string;
}

const STORE_KEY = "crowding:v1";
// PCDRealTime refreshes every 10 min per the API guide; re-fetching faster
// than that would just repeat the same reading.
const STALE_AFTER_MS = 10 * 60_000;

export async function getCrowding(): Promise<{
  levels: Record<string, CrowdLevel>;
  polledAt: string | null;
  error: string | null;
}> {
  const cached = await getJSON<CrowdingRecord>(STORE_KEY);
  const isStale = !cached || Date.now() - new Date(cached.polledAt).getTime() > STALE_AFTER_MS;

  if (!isStale && cached) {
    return { levels: cached.levels, polledAt: cached.polledAt, error: null };
  }

  try {
    const rows = await fetchStationCrowding(RACHEL_JOURNEY.line);
    const levels: Record<string, CrowdLevel> = {};
    for (const row of rows) levels[row.Station] = row.CrowdLevel;

    const record: CrowdingRecord = { levels, polledAt: new Date().toISOString() };
    await setJSON(STORE_KEY, record);
    return { levels, polledAt: record.polledAt, error: null };
  } catch (err) {
    // A failed refresh shouldn't erase what's already known — serve the
    // last good reading (even if stale) rather than going blank.
    if (cached) return { levels: cached.levels, polledAt: cached.polledAt, error: err instanceof Error ? err.message : String(err) };
    return { levels: {}, polledAt: null, error: err instanceof Error ? err.message : String(err) };
  }
}
