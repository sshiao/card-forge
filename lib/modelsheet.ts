import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { validateGlb } from "./trellis.ts";

export const MODELSHEET_REVISION = "569363513b6f847b2363ea71b6bcdbff2bcb3c3e";
export const REFINEMENT_VIEWS = ["front", "three_quarter", "side", "back"] as const;
export type RefinementView = typeof REFINEMENT_VIEWS[number];
export type RefinementSettings = {
  angles: Record<RefinementView, number>;
  face: [number, number][]; // Coordinates in the original front image, normalized to [0,1].
  meshYaw: number;
};
export type RefinementManifest = {
  format: "character-forge-modelsheet-v1";
  job: string;
  character: string;
  revision: string;
  sourceGlb: string;
  baseSha256: string;
  seed: number;
  settings: RefinementSettings;
  inputs: Record<string, string>;
};
export type RefinementRecord = {
  manifest: RefinementManifest;
  state: "prepared" | "running" | "failed" | "imported";
  bundle: string;
  endpoint?: string;
  cloudJob?: string;
  error?: string;
  preparedAt: number;
  importedAt?: number;
  ply?: string;
  decal?: string;
  preview?: string;
};

export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function refinementSettings(value: unknown): RefinementSettings {
  const v = value as Partial<RefinementSettings> | null;
  if (!v || !v.angles || !REFINEMENT_VIEWS.every((view) => Number.isFinite(v.angles?.[view]) && Math.abs(v.angles![view]) <= 360)) {
    throw new Error("Set a camera yaw between -360 and 360 degrees for each view.");
  }
  // Upstream sorts views and uses the first view for decals. Keep front first.
  if (v.angles.front !== 0 || REFINEMENT_VIEWS.slice(1).some((view) => v.angles![view] <= 0) || new Set(Object.values(v.angles)).size !== 4) {
    throw new Error("Front yaw must be 0; the other three yaws must be distinct and positive (use 270 instead of -90).");
  }
  if (!Number.isFinite(v.meshYaw) || Math.abs(v.meshYaw!) > 360) throw new Error("Set the base mesh yaw between -360 and 360 degrees.");
  if (!Array.isArray(v.face) || v.face.length < 3 || v.face.length > 100 || v.face.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((n) => !Number.isFinite(n) || n < 0 || n > 1))) {
    throw new Error("Outline the face with at least three points inside the front image.");
  }
  let area = 0;
  for (let i = 0; i < v.face.length; i++) {
    const a = v.face[i], b = v.face[(i + 1) % v.face.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 0.00001) throw new Error("The face outline must enclose an area.");
  return { angles: Object.fromEntries(REFINEMENT_VIEWS.map((view) => [view, v.angles![view]])) as RefinementSettings["angles"], face: v.face.map(([x, y]) => [x, y]), meshYaw: v.meshYaw! };
}

export function refinementBundle(input: { character: string; sourceGlb: string; seed: number; settings: unknown; mesh: Uint8Array; views: Record<RefinementView, Uint8Array>; runner: Uint8Array; instructions: Uint8Array }) {
  validateGlb(input.mesh);
  const settings = refinementSettings(input.settings);
  const files: Record<string, Uint8Array> = { "base.glb": input.mesh };
  REFINEMENT_VIEWS.forEach((view, index) => { files[`views/${String(index).padStart(3, "0")}.png`] = input.views[view]; });
  const manifest: RefinementManifest = {
    format: "character-forge-modelsheet-v1", job: randomUUID(), character: input.character,
    revision: MODELSHEET_REVISION, sourceGlb: input.sourceGlb, baseSha256: sha256(input.mesh), seed: input.seed, settings,
    inputs: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha256(bytes)])),
  };
  const bytes = zipSync({ ...files, "manifest.json": strToU8(JSON.stringify(manifest, null, 2)), "run.py": input.runner, "README.md": input.instructions }, { level: 0 });
  return { manifest, bytes };
}

export const MAX_REFINEMENT_BYTES = 250 * 1024 * 1024;
// Only decompress known result files, with a total uncompressed bound.
export function refinementResult(bytes: Uint8Array, expected: RefinementManifest) {
  if (bytes.length > MAX_REFINEMENT_BYTES) throw new Error("Result ZIP must be under 250 MB.");
  const allowed = new Set(["result.json", "refined.glb", "refined.ply", "decal.ply", "preview.png"]);
  let size = 0;
  const seen = new Set<string>();
  const files = unzipSync(bytes, { filter: (file) => {
    if (!allowed.has(file.name) || seen.has(file.name)) throw new Error("Unexpected or duplicate file in the refinement result.");
    seen.add(file.name);
    size += file.originalSize;
    if (size > MAX_REFINEMENT_BYTES) throw new Error("Expanded result exceeds 250 MB.");
    return true;
  } });
  if (!files["result.json"] || !files["refined.glb"] || !files["refined.ply"] || !files["decal.ply"] || !files["preview.png"]) throw new Error("The result ZIP is incomplete. Import the ZIP produced by run.py.");
  const result = JSON.parse(strFromU8(files["result.json"])) as { status?: string; manifest?: RefinementManifest };
  if (result.status !== "complete" || !isDeepStrictEqual(result.manifest, expected)) {
    throw new Error("This result belongs to a different preparation. Import the result for the current refinement bundle.");
  }
  validateGlb(files["refined.glb"]);
  for (const name of ["refined.ply", "decal.ply"]) if (!strFromU8(files[name].subarray(0, 4)).startsWith("ply\n") && !strFromU8(files[name].subarray(0, 5)).startsWith("ply\r\n")) throw new Error(`Invalid ${name}.`);
  if (!Buffer.from(files["preview.png"].subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Invalid preview PNG.");
  return files;
}
