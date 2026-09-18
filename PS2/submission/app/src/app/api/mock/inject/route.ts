import { NextResponse } from "next/server";
import { injectMock } from "@/lib/mockState";
import { currentStatus } from "@/lib/state";

// Demo-only: simulate a disruption since TrainServiceAlerts.AffectedSegments
// is empty on an ordinary day (PS2_README §2.6). Labelled via `source: "mock"`
// in /api/status so it's never mistaken for live data.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { severity, stationCodes, freeMRTShuttle, freePublicBus, message, minutesActive } = body ?? {};

  if (![1, 2].includes(severity) || !Array.isArray(stationCodes) || stationCodes.length === 0) {
    return NextResponse.json(
      { error: "severity (1|2) and non-empty stationCodes[] are required" },
      { status: 400 },
    );
  }

  await injectMock({ severity, stationCodes, freeMRTShuttle, freePublicBus, message, minutesActive });
  return NextResponse.json(await currentStatus());
}
