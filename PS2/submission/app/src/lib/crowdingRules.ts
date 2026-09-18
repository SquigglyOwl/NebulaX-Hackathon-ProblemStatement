import type { BaselineLabel, CrowdLevel } from "./types";

// Deliberately its own file with zero other imports: shared between
// CrowdingStrip.tsx (client bundle) and comfort.ts (server-only, pulls in
// alternates.ts). Keeping this pure and dependency-free means the "unusual
// crowding" definition can't drift between the badge dot and the comfort
// tip, without ever risking a server-only module reaching the client
// bundle transitively.
export function isUnusualCrowding(level: CrowdLevel, baseline: BaselineLabel): boolean {
  return level === "h" && baseline === "low";
}
