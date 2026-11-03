import { readFile } from "node:fs/promises";
import { filePath, readCard } from "../../../../../../lib/card";

export const runtime = "nodejs";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

function slug(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
}

// Serves one file of a card. With ?download=1 it comes with the card's name, for example "sunny-scribe-art.png".
export async function GET(request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath(id, file));
  } catch {
    return Response.json({ error: "Unknown file." }, { status: 404 });
  }
  const ext = file.split(".").pop() ?? "";
  const headers: Record<string, string> = { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, max-age=3600", "Content-Length": String(bytes.length) };
  if (new URL(request.url).searchParams.get("download") === "1") {
    const card = await readCard(id);
    headers["Content-Disposition"] = `attachment; filename="${slug(card?.text?.name ?? card?.request.name ?? "card")}-${file.startsWith("photo") ? "photo" : "art"}.${ext}"`;
  }
  return new Response(new Uint8Array(bytes), { headers });
}
