import { NextResponse } from "next/server";
import { clearMockComfortTip, injectMockComfortTip } from "@/lib/comfort";
import { currentStatus } from "@/lib/state";

// Demo-only: forces the "unusually busy — here's a quieter alternative"
// comfort tip (comfort.ts) on demand, since the real trigger depends on
// live crowding AND the real PV/Train baseline lining up, which isn't
// guaranteed to be true at demo time — same reasoning as /api/mock/inject
// for disruptions. DELETE clears it.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { stationCode, stationName, extraMinutes, minutesActive } = body ?? {};

  if (typeof stationCode !== "string" || typeof stationName !== "string" || typeof extraMinutes !== "number") {
    return NextResponse.json(
      { error: "stationCode, stationName (string) and extraMinutes (number) are required" },
      { status: 400 },
    );
  }

  await injectMockComfortTip({ stationCode, stationName, extraMinutes }, minutesActive);
  return NextResponse.json(await currentStatus());
}

export async function DELETE() {
  await clearMockComfortTip();
  return NextResponse.json(await currentStatus());
}
