import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { validateGlb } from "../lib/trellis.ts";
import { trellisWorkflow, type Graph } from "../lib/workflows.ts";

const template = () => JSON.parse(readFileSync("workflows/trellis2.api.json", "utf8")) as Graph;

test("TRELLIS uses the approved image and seed in all four diffusion stages", () => {
  const original = template();
  const graph = trellisWorkflow(original, { canonical: "uploaded.png", seed: 99 });
  assert.equal(graph.image.inputs.image, "uploaded.png");
  for (const stage of ["structure", "shape", "upsample", "texture"]) assert.equal(graph[`${stage}_sampler`].inputs.seed, 99);
  assert.equal(original.image.inputs.image, "canonical.png");
  assert.equal(original.structure_sampler.inputs.seed, 42);
  assert.equal(graph.condition.class_type, "Trellis2Conditioning");
  assert.equal(graph.unet.inputs.unet_name, "trellis_2_int8_convrot.safetensors");
});

test("TRELLIS exports geometry with UVs and all five PBR maps", () => {
  const graph = template();
  assert.equal(graph.upsample_stage.inputs.target_resolution, 1536);
  assert.equal(graph.bake.inputs.texture_size, 4096);
  assert.equal(graph.decimate.inputs.target_face_count, 1000000);
  assert.equal(graph.remesh.inputs.smooth_iters, 0, "do not smooth away character details");
  assert.equal(graph.remesh.inputs.drop_small_components, 0, "preserve small props and accessories");
  assert.deepEqual(graph.material.inputs.mesh, ["unwrap", 0]);
  for (const field of ["base_color", "metallic", "roughness", "occlusion", "normal_map"]) assert.ok(graph.material.inputs[field]);
  assert.deepEqual(graph.to_glb.inputs.mesh, ["material", 0]);
  assert.deepEqual(graph.mesh.inputs.mesh, ["to_glb", 0]);
  assert.equal(graph.mesh.class_type, "SaveGLB");
  assert.ok(!Object.values(graph).some((node) => /Pixal|MoGe|CharacterForgeTrellis/.test(node.class_type)));
});

test("TRELLIS gets the approved front image only", () => {
  const graph = trellisWorkflow(template(), { canonical: "front.png", seed: 7 });
  assert.equal(graph.image.inputs.image, "front.png");
  assert.ok(!Object.keys(graph).some((id) => id.startsWith("mv_")));
  assert.deepEqual(graph.structure_sampler.inputs.positive, ["condition", 0]);
});

test("GLB validation accepts binary glTF 2 and rejects error pages and truncated downloads", () => {
  const bytes = Buffer.alloc(20);
  bytes.write("glTF"); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(20, 8);
  assert.doesNotThrow(() => validateGlb(bytes));
  assert.throws(() => validateGlb(new TextEncoder().encode("<html>server error</html>")), /invalid GLB/);
  assert.throws(() => validateGlb(new Uint8Array([1, 2, 3])), /invalid GLB/);
  bytes.writeUInt32LE(100, 8);
  assert.throws(() => validateGlb(bytes), /invalid GLB/);
});
