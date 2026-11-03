import { NextResponse } from "next/server";
import { configurationError, createCard, isConfigured, listCards } from "../../../lib/card";
import { comfyErrorMessage } from "../../../lib/comfy";
import { readCardRequest } from "../../../lib/requests";
import { readImage } from "../../../lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listCards());
}

// Starts a card from a photo.
export async function POST(request: Request) {
  if (!isConfigured()) return NextResponse.json({ error: configurationError() }, { status: 503 });
  try {
    const form = await request.formData();
    const photo = readImage(form.get("photo"), "a photo");
    const card = await createCard(readCardRequest(form), { bytes: new Uint8Array(await photo.arrayBuffer()), type: photo.type, name: photo.name });
    return NextResponse.json(card, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: comfyErrorMessage(error) }, { status: 400 });
  }
}
