import { NextResponse } from "next/server";
import { configurationError, isConfigured } from "../../../lib/card";
import { MOCK } from "../../../lib/mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ configured: isConfigured(), mock: MOCK, error: configurationError() });
}
