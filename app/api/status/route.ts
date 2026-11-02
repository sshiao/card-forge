import { NextResponse } from "next/server";
import { configurationError, isConfigured, refinementConfigured } from "../../../lib/character";
import { MOCK } from "../../../lib/mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ configured: isConfigured(), mock: MOCK, trellis: isConfigured() && !MOCK, refinement: refinementConfigured() && !MOCK, error: configurationError() });
}
