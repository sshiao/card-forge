import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { refinementBundle, refinementResult, refinementSettings, sha256, type RefinementManifest } from "../lib/modelsheet.ts";
import { CHARACTERS_DIR, importRefinement, prepareRefinement, readCharacter, type Character } from "../lib/character.ts";

const settings = { angles: { front: 0, three_quarter: 45, side: 90, back: 180 }, meshYaw: 0, face: [[.4, .1], [.6, .1], [.5, .2]] };
// A real glTF triangle, so fixtures also work in an actual GLB viewer.
function glb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 }));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
  const b = Buffer.alloc(12 + 8 + padded.length + 8 + 36);
  b.write("glTF"); b.writeUInt32LE(2, 4); b.writeUInt32LE(b.length, 8);
  b.writeUInt32LE(padded.length, 12); b.write("JSON", 16); padded.copy(b, 20);
  const offset = 20 + padded.length;
  b.writeUInt32LE(36, offset); b.write("BIN\0", offset + 4);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((v, i) => b.writeFloatLE(v, offset + 8 + i * 4));
  return b;
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1sAAAAASUVORK5CYII=", "base64");
const views = { front: png, three_quarter: png, side: png, back: png };
function bundle() { return refinementBundle({ character: "testmod3d-123abc", sourceGlb: "base.glb", seed: 42, settings, mesh: glb(), views, runner: strToU8("# runner"), instructions: strToU8("guide") }); }
const resultFiles = (manifest: RefinementManifest) => ({ "result.json": strToU8(JSON.stringify({ status: "complete", manifest })), "refined.glb": glb(), "refined.ply": strToU8("ply\nformat ascii 1.0\nend_header\n"), "decal.ply": strToU8("ply\nformat ascii 1.0\nend_header\n"), "preview.png": png });

test("refinement bundle binds every input and carries the runner without credentials", () => {
  const { manifest, bytes } = bundle();
  const files = unzipSync(bytes);
  assert.deepEqual(JSON.parse(strFromU8(files["manifest.json"])), manifest);
  assert.equal(manifest.baseSha256, sha256(glb()));
  assert.equal(Object.keys(manifest.inputs).length, 5);
  for (const [name, hash] of Object.entries(manifest.inputs)) assert.equal(sha256(files[name]), hash);
  assert.ok(files["run.py"] && files["README.md"]);
  assert.equal(Object.keys(files).length, 8);
  assert.ok(!Object.keys(files).some((name) => /env|key|portrait|character\.json/.test(name)));
});

test("refinement rejects missing, degenerate or out-of-frame masks and ambiguous front cameras", () => {
  assert.throws(() => refinementSettings({ ...settings, face: [] }), /Outline/);
  assert.throws(() => refinementSettings({ ...settings, face: [[0, 0], [.5, .5], [1, 1]] }), /enclose/);
  assert.throws(() => refinementSettings({ ...settings, face: [[0, 0], [2, .5], [1, 1]] }), /Outline/);
  assert.throws(() => refinementSettings({ ...settings, angles: { ...settings.angles, side: -90 } }), /positive/);
  assert.throws(() => refinementSettings({ ...settings, angles: { ...settings.angles, front: 180 } }), /Front yaw/);
  assert.throws(() => refinementSettings({ ...settings, angles: { ...settings.angles, back: 90 } }), /distinct/);
  assert.throws(() => refinementSettings({ ...settings, meshYaw: NaN }), /mesh yaw/);
});

test("result import rejects stale jobs, missing layers, invalid GLB and unexpected archive entries", () => {
  const { manifest } = bundle();
  assert.ok(refinementResult(zipSync(resultFiles(manifest)), manifest)["refined.glb"]);
  assert.throws(() => refinementResult(zipSync(resultFiles({ ...manifest, job: "old-job" })), manifest), /different preparation/);
  const incomplete: Record<string, Uint8Array> = resultFiles(manifest); delete incomplete["decal.ply"];
  assert.throws(() => refinementResult(zipSync(incomplete), manifest), /incomplete/);
  assert.throws(() => refinementResult(zipSync({ ...resultFiles(manifest), "refined.glb": strToU8("error page") }), manifest), /invalid GLB/);
  assert.throws(() => refinementResult(zipSync({ ...resultFiles(manifest), "../escape": png }), manifest), /Unexpected/);
  assert.throws(() => refinementResult(zipSync({ ...resultFiles(manifest), "preview.png": strToU8("error page") }), manifest), /PNG/);
});

test("preparation/import keeps the base, rejects mismatches without state changes, and blocks duplicate imports", async () => {
  const id = `testmod3d-${randomBytes(3).toString("hex")}`;
  const dir = join(CHARACTERS_DIR, id);
  const character = {
    id, request: { name: "Refinement test", style: "animated", description: "" }, stage: "done", createdAt: Date.now(), updatedAt: Date.now(), finishedAt: Date.now(), seed: 42,
    portrait: null, candidates: [], chosen: 0, canonical: "front.png", views: { front: "front.png", three_quarter: "quarter.png", side: "side.png", back: "back.png" }, sheet: "sheet.png",
    mesh: { glb: "base.glb", model: "TRELLIS.2", input: "multiview", job: "existing-cloud-job" },
    splat: { spz: null, ply: null, sog: null, html: null, orbit: null, poster: null }, steps: { portrait: "skipped", canonical: "done", sheet: "done", mesh: "done", splat: "skipped" }, jobs: { mesh: "existing-cloud-job" }, timeline: [], warnings: [], error: null,
  } as Character;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "character.json"), JSON.stringify(character));
    await writeFile(join(dir, "base.glb"), glb());
    for (const name of Object.values(character.views)) await writeFile(join(dir, name), png);
    const preparing = prepareRefinement(id, settings);
    await assert.rejects(prepareRefinement(id, settings), /already being made/);
    const { manifest } = await preparing;
    assert.equal((await readCharacter(id))?.stage, "done", "preparation must not pretend a GPU run is active");
    const before = await readFile(join(dir, "character.json"), "utf8");
    await assert.rejects(importRefinement(id, zipSync(resultFiles({ ...manifest, seed: 2 }))), /different preparation/);
    assert.equal(await readFile(join(dir, "character.json"), "utf8"), before);
    const refined = await importRefinement(id, zipSync(resultFiles(manifest)));
    assert.equal(refined.mesh?.model, "ModelSheetTo3D");
    assert.deepEqual(refined.mesh?.previous, character.mesh);
    assert.equal(refined.refinement?.state, "imported");
    assert.deepEqual(await readFile(join(dir, "base.glb")), glb());
    assert.ok(refined.refinement?.decal && refined.refinement?.preview);
    await assert.rejects(importRefinement(id, zipSync(resultFiles(manifest))), /Prepare/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
