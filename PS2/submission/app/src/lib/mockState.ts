import type { AffectedSegment, TrainServiceAlerts } from "./datamall";
import { deleteKey, getJSON, setJSON } from "./store";

// Labelled injected/replay data for demo purposes (PS2_README §2.6 explicitly
// permits this — the real feed's AffectedSegments is empty most days). Never
// presented to a judge as live data: the /api/status response tags its
// source. Store-backed (not a module variable) because the POST that sets
// this and the GET that reads it can land on different serverless instances.
interface MockRecord {
  feed: TrainServiceAlerts;
  expiresAt: number;
}

const STORE_KEY = "mockOverride:v1";

export async function injectMock(input: {
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
  const record: MockRecord = {
    feed: {
      Status: input.severity,
      AffectedSegments: [segment],
      Message: [{ Content: input.message ?? "Injected demo disruption.", CreatedDate: new Date().toISOString() }],
    },
    expiresAt: Date.now() + (input.minutesActive ?? 15) * 60_000,
  };
  await setJSON(STORE_KEY, record);
}

export async function clearMock() {
  await deleteKey(STORE_KEY);
}

export async function getActiveMock(): Promise<TrainServiceAlerts | null> {
  const record = await getJSON<MockRecord>(STORE_KEY);
  if (!record) return null;
  if (record.expiresAt <= Date.now()) {
    await deleteKey(STORE_KEY);
    return null;
  }
  return record.feed;
}
