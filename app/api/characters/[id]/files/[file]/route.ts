import { readFile } from "node:fs/promises";
import { filePath, readCharacter } from "../../../../../../lib/character";

export const runtime = "nodejs";

const TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", mp4: "video/mp4",
  html: "text/html; charset=utf-8", spz: "application/octet-stream", ply: "application/octet-stream", sog: "application/octet-stream",
  glb: "model/gltf-binary",
};

function slug(name: string) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "character";
}

// Serves one file of a character. Browsers seek in video with Range requests, so those get a 206.
// With ?download=1 the file comes with the character's name, for example "nova-sheet.png".
export async function GET(request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath(id, file));
  } catch {
    return Response.json({ error: "Unknown file." }, { status: 404 });
  }
  const ext = file.split(".").pop() ?? "";
  const headers: Record<string, string> = { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  if (new URL(request.url).searchParams.get("download") === "1") {
    const character = await readCharacter(id);
    const base = file.replace(/\.[^.]+$/, "").replace(/^character$/, "");
    headers["Content-Disposition"] = `attachment; filename="${slug(character?.request.name ?? "character")}${base ? `-${base}` : ""}.${ext}"`;
  }
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Length": String(bytes.length) } });
  const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
  const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
  if (start > end || start >= bytes.length) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${bytes.length}` } });
  }
  return new Response(new Uint8Array(bytes.subarray(start, end + 1)), {
    status: 206,
    headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": String(end - start + 1) },
  });
}
