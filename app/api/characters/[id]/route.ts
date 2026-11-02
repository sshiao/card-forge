import { NextResponse } from "next/server";
import { addBack, addHead, approve, readCharacter, recast, rebuildMesh, resume } from "../../../../lib/character";
import { comfyErrorMessage } from "../../../../lib/comfy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const character = await readCharacter((await params).id);
  return character ? NextResponse.json(character) : NextResponse.json({ error: "Unknown character." }, { status: 404 });
}

// { "approve": n } forges candidate n (from 0). { "recast": true, "notes"?: "..." } draws two new
// candidates, with the notes added to the prompt.
// { "head": true } adds the face close-up. { "back": true } adds the back from the sheet.
// { "mesh": true } builds a TRELLIS.2 mesh.
// An empty body resumes a failed character.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    const body = await request.json().catch(() => ({})) as { approve?: unknown; recast?: unknown; notes?: unknown; mesh?: unknown; head?: unknown; back?: unknown };
    const character = Number.isInteger(body.approve) ? await approve(id, body.approve as number)
      : body.recast === true ? await recast(id, typeof body.notes === "string" ? body.notes : undefined)
      : body.mesh === true ? await rebuildMesh(id)
      : body.head === true ? await addHead(id)
      : body.back === true ? await addBack(id)
      : await resume(id);
    return NextResponse.json(character, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: comfyErrorMessage(error) }, { status: 400 });
  }
}
