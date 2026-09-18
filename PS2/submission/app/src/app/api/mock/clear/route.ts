import { NextResponse } from "next/server";
import { clearMock } from "@/lib/mockState";
import { currentStatus } from "@/lib/state";

export async function POST() {
  await clearMock();
  return NextResponse.json(await currentStatus());
}
