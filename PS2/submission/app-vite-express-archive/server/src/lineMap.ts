// Canonical line codes — TrainServiceAlerts and PCD (crowd density) use different
// codes for the same physical line on 5 of them. Everything joins through this table.
export const LINE_CODES = {
  NSL: { alerts: "NSL", crowd: "NSL", name: "North South Line" },
  EWL: { alerts: "EWL", crowd: "EWL", name: "East West Line" },
  CGL: { alerts: "EWL", crowd: "CGL", name: "Changi Extension" },
  CCL: { alerts: "CCL", crowd: "CCL", name: "Circle Line" },
  CEL: { alerts: "CCL", crowd: "CEL", name: "Circle Line Extension" },
  NEL: { alerts: "NEL", crowd: "NEL", name: "North East Line" },
  DTL: { alerts: "DTL", crowd: "DTL", name: "Downtown Line" },
  TEL: { alerts: "TEL", crowd: "TEL", name: "Thomson-East Coast Line" },
  BPL: { alerts: "BPL", crowd: "BPL", name: "Bukit Panjang LRT" },
  SLRT: { alerts: "STL", crowd: "SLRT", name: "Sengkang LRT" },
  PLRT: { alerts: "PTL", crowd: "PLRT", name: "Punggol LRT" },
} as const;

export type CanonicalLine = keyof typeof LINE_CODES;

export function alertsCodeFor(line: CanonicalLine): string {
  return LINE_CODES[line].alerts;
}
