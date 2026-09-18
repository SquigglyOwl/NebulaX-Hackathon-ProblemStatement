import { NextResponse } from "next/server";
import { currentStatus } from "@/lib/state";

export async function GET() {
  const status = await currentStatus();
  return NextResponse.json(status);
}
