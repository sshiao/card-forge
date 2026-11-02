import { NextResponse } from "next/server";
import { configurationError, createCharacter, isConfigured, listCharacters } from "../../../lib/character";
import { comfyErrorMessage } from "../../../lib/comfy";
import { readCharacterRequest } from "../../../lib/requests";
import { readImage } from "../../../lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await listCharacters());
}

// Starts a character from a picture, or from a description when there is no picture.
export async function POST(request: Request) {
  if (!isConfigured()) return NextResponse.json({ error: configurationError() }, { status: 503 });
  try {
    const form = await request.formData();
    const upload = form.get("photo");
    const photo = upload instanceof File && upload.size > 0 ? readImage(upload, "the character's picture") : null;
    const character = await createCharacter(
      readCharacterRequest(form),
      photo ? { bytes: new Uint8Array(await photo.arrayBuffer()), type: photo.type, name: photo.name } : null,
    );
    return NextResponse.json(character, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: comfyErrorMessage(error) }, { status: 400 });
  }
}
