export interface Station {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

export interface WalkPoint {
  name: string;
  lat: number;
  lng: number;
  minutes: number;
  route: [number, number][];
  routeSource: "osm" | "fallback";
}

export interface Journey {
  line: string;
  direction: string;
  departAt: string;
  arriveByDeadline: string;
  normalJourneyMinutes: number;
  bufferMinutes: number;
  walk: { home: WalkPoint; office: WalkPoint };
  stations: Station[];
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
  delaySource: "message-text" | "llm-advice" | "status-fallback" | "none";
  slackMinutes: number;
  affectedStationCodes: string[];
  commitStation: CommitStation | null;
  message: string;
}

export type CrowdLevel = "l" | "m" | "h" | "NA";
export type BaselineLabel = "low" | "typical" | "high" | "unknown";

export interface StatusResponse {
  checkedAt: string;
  source: "live" | "mock";
  journey: Journey;
  decision: Decision;
  crowding: Record<string, CrowdLevel>;
  crowdingBaseline: Record<string, BaselineLabel>;
  liveFeed: { lastPolledAt: string | null; lastPollError: string | null };
  crowdingFeed: { lastPolledAt: string | null; lastPollError: string | null };
  pvTrainBaselineFeed: { lastWarmedAt: string | null; lastWarmError: string | null };
  stats: { totalChecks: number; interruptsFired: number };
}
