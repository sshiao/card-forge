import { NextResponse } from "next/server";
import { approve, readCard, recast, resume, updateCard } from "../../../../lib/card";
import { comfyErrorMessage } from "../../../../lib/comfy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const card = await readCard((await params).id);
  return card ? NextResponse.json(card) : NextResponse.json({ error: "Unknown card." }, { status: 404 });
}

// { "approve": n } picks candidate n (from 0).
// { "recast": true, "notes"?: "...", "frame"?: "full", "outfit"?: "hero", "rewrite"?: true } draws two new candidates.
// { "frame": "gold" } or { "text": {...} } changes a card. An empty body resumes a failed card.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const body = await request.json().catch(() => ({})) as { approve?: unknown; recast?: unknown; notes?: unknown; frame?: unknown; outfit?: unknown; rewrite?: unknown; text?: unknown };
    const card = Number.isInteger(body.approve) ? await approve(id, body.approve as number)
      : body.recast === true ? await recast(id, {
        notes: typeof body.notes === "string" ? body.notes : undefined,
        frame: typeof body.frame === "string" ? body.frame : undefined,
        outfit: typeof body.outfit === "string" ? body.outfit : undefined,
        rewrite: body.rewrite === true,
      })
      : body.frame !== undefined || body.text !== undefined ? await updateCard(id, { frame: body.frame, text: body.text })
      : await resume(id);
    return NextResponse.json(card, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: comfyErrorMessage(error) }, { status: 400 });
  }
}
