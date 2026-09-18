const BASE = "https://datamall2.mytransport.sg/ltaodataservice";

export interface AffectedSegment {
  Line: string;
  Direction: string;
  Stations: string;
  FreePublicBus: string;
  FreeMRTShuttle: string;
  MRTShuttleDirection: string;
}

export interface TrainServiceAlerts {
  Status: 1 | 2;
  AffectedSegments: AffectedSegment[];
  Message: { Content: string; CreatedDate: string }[];
}

export async function fetchTrainServiceAlerts(): Promise<TrainServiceAlerts> {
  const key = process.env.DATAMALL_ACCOUNT_KEY;
  if (!key) throw new Error("DATAMALL_ACCOUNT_KEY not set");

  const res = await fetch(`${BASE}/TrainServiceAlerts`, {
    headers: { AccountKey: key, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`TrainServiceAlerts ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  // Live shape nests the payload under `value`, per DataMall convention.
  return body.value ?? body;
}

export type CrowdLevel = "l" | "m" | "h" | "NA";

export interface StationCrowd {
  Station: string;
  StartTime: string;
  EndTime: string;
  CrowdLevel: CrowdLevel;
}

// PCDRealTime — despite the URL, this is the "Station Crowd Density Real
// Time" API (renamed from "Platform" Crowd Density; URL unchanged). One call
// per line, refreshed every 10 min per the API guide.
export async function fetchStationCrowding(trainLine: string): Promise<StationCrowd[]> {
  const key = process.env.DATAMALL_ACCOUNT_KEY;
  if (!key) throw new Error("DATAMALL_ACCOUNT_KEY not set");

  const res = await fetch(`${BASE}/PCDRealTime?TrainLine=${trainLine}`, {
    headers: { AccountKey: key, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`PCDRealTime ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  return body.value ?? body;
}

// PV/Train — monthly tap-in/tap-out passenger volume per station. The
// response isn't the data itself, just a short-lived (5 min) link to a ZIP
// containing the real CSV — see pvTrainBaseline.ts for the download+unzip.
export async function fetchPvTrainLink(yearMonth: string): Promise<string> {
  const key = process.env.DATAMALL_ACCOUNT_KEY;
  if (!key) throw new Error("DATAMALL_ACCOUNT_KEY not set");

  const res = await fetch(`${BASE}/PV/Train?Date=${yearMonth}`, {
    headers: { AccountKey: key, accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`PV/Train ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  const rows = body.value ?? body;
  const link = rows?.[0]?.Link;
  if (!link) throw new Error(`PV/Train returned no Link for ${yearMonth}`);
  return link;
}
