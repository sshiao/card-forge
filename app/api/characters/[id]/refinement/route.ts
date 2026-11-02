import { NextResponse } from "next/server";
import { importRefinement, prepareRefinement, startRefinement } from "../../../../../lib/character";
import { MAX_REFINEMENT_BYTES } from "../../../../../lib/modelsheet";
import { comfyErrorMessage } from "../../../../../lib/comfy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const id = (await params).id;
    if (request.headers.get("content-type")?.startsWith("application/zip")) {
      const reader = request.body?.getReader();
      if (!reader) throw new Error("Choose the result ZIP from the GPU runner.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_REFINEMENT_BYTES) { await reader.cancel(); throw new Error("Result ZIP must be under 250 MB."); }
        chunks.push(value);
      }
      return NextResponse.json(await importRefinement(id, Buffer.concat(chunks)));
    }
    const settings: unknown = await request.json();
    if ((settings as { run?: unknown })?.run === true) return NextResponse.json(await startRefinement(id, settings), { status: 202 });
    if ((settings as { resume?: unknown })?.resume === true) return NextResponse.json(await startRefinement(id, null, true), { status: 202 });
    const bundle = await prepareRefinement(id, settings);
    return new Response(Buffer.from(bundle.bytes), { headers: {
      "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="modelsheet-${id}.zip"`, "Cache-Control": "no-store",
    } });
  } catch (error) {
    return NextResponse.json({ error: comfyErrorMessage(error) }, { status: 400 });
  }
}
