import { fetchTrainServiceAlerts, type TrainServiceAlerts } from "./datamall";
import { getJSON, setJSON } from "./store";

interface AlertsRecord {
  feed: TrainServiceAlerts;
  polledAt: string;
}

const STORE_KEY = "trainAlerts:v1";
const STALE_AFTER_MS = 60_000; // matches the original 60s poll interval

const EMPTY_FEED: TrainServiceAlerts = { Status: 1, AffectedSegments: [], Message: [] };

export async function getLatestAlerts(): Promise<{
  feed: TrainServiceAlerts;
  polledAt: string | null;
  error: string | null;
}> {
  const cached = await getJSON<AlertsRecord>(STORE_KEY);
  const isStale = !cached || Date.now() - new Date(cached.polledAt).getTime() > STALE_AFTER_MS;

  if (!isStale && cached) {
    return { feed: cached.feed, polledAt: cached.polledAt, error: null };
  }

  try {
    const feed = await fetchTrainServiceAlerts();
    const record: AlertsRecord = { feed, polledAt: new Date().toISOString() };
    await setJSON(STORE_KEY, record);
    return { feed, polledAt: record.polledAt, error: null };
  } catch (err) {
    // A failed poll should not fabricate "all clear" — serve the last good
    // feed (even if stale) rather than silently going quiet, and surface
    // the error so the UI/status endpoint can show it.
    if (cached) return { feed: cached.feed, polledAt: cached.polledAt, error: err instanceof Error ? err.message : String(err) };
    return { feed: EMPTY_FEED, polledAt: null, error: err instanceof Error ? err.message : String(err) };
  }
}
