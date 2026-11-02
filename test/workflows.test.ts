import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { canonicalPrompt, headshotPrompt, portraitPrompt, STYLE_IDS } from "../lib/forge.ts";
import {
  CANONICAL_OUTPUT, SHEET_VIEWS, SPLAT_OUTPUTS,
  canonicalWorkflow, headshotWorkflow, portraitWorkflow, sheetWorkflow, splatWorkflow,
  type Graph,
} from "../lib/workflows.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../workflows/${name}.api.json`, import.meta.url), "utf8")) as Graph;

// Every link must point at a node of the same graph.
function assertLinked(graph: Graph) {
  for (const [id, node] of Object.entries(graph)) {
    for (const [input, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number") {
        assert.ok(graph[value[0]], `${id}.${input} links to missing node ${value[0]}`);
      }
    }
  }
}

test("all workflows are linked and only use open-weights nodes", () => {
  for (const name of ["portrait", "headshot", "canonical", "sheet", "triposplat", "trellis2"]) {
    const graph = load(name);
    assertLinked(graph);
    for (const node of Object.values(graph)) assert.doesNotMatch(node.class_type, /Api$|Node$/, `${name} uses ${node.class_type}`);
  }
});

test("canonical workflow takes the portrait, the prompt, the seed and the candidate count", () => {
  const graph = canonicalWorkflow(load("canonical"), { portrait: "asset", prompt: "make a body", seed: 7, candidates: 2 });
  assert.equal(graph.portrait.inputs.image, "asset");
  assert.equal(graph.positive_text.inputs.prompt, "make a body");
  assert.equal(graph.latent.inputs.batch_size, 2);
  assert.equal(graph.sampler.inputs.seed, 7);
  assert.equal(graph[CANONICAL_OUTPUT].class_type, "SaveImage");
});

test("headshot workflow takes the face from the portrait and the look from the design", () => {
  const graph = headshotWorkflow(load("headshot"), { portrait: "face", canonical: "design", prompt: "a close-up", seed: 5 });
  assert.equal(graph.portrait.inputs.image, "face");
  assert.equal(graph.canonical.inputs.image, "design");
  assert.deepEqual(graph.positive_text.inputs.image1, ["portrait_scaled", 0]);
  assert.deepEqual(graph.positive_text.inputs.image2, ["canonical_scaled", 0]);
  assert.equal(graph.positive_text.inputs.prompt, "a close-up");
  assert.equal(graph.latent.inputs.batch_size, 1);
  assert.equal(graph.sampler.inputs.seed, 5);
  for (const style of STYLE_IDS) assert.match(headshotPrompt(style), /image 1/);
});

test("sheet workflow saves three views with their own seeds", () => {
  const graph = sheetWorkflow(load("sheet"), { canonical: "asset", seed: 2 ** 32 - 1 });
  assert.equal(graph.canonical.inputs.image, "asset");
  const seeds = SHEET_VIEWS.map((view) => graph[`${view}_sampler`].inputs.seed);
  assert.deepEqual(seeds, [2 ** 32 - 1, 0, 1]);
  for (const view of SHEET_VIEWS) {
    assert.equal(graph[view].class_type, "SaveImage");
    assert.match(String(graph[`${view}_text`].inputs.prompt), /^<sks> /);
  }
});

test("splat workflow exports SPZ, PLY and an orbit video from the canonical image", () => {
  const graph = splatWorkflow(load("triposplat"), { canonical: "asset", seed: 99, gaussians: 131072 });
  assert.equal(graph.image.inputs.image, "asset");
  assert.equal(graph.sampler.inputs.seed, 99);
  assert.equal(graph.decode.inputs.num_gaussians, 131072);
  assert.equal(graph.to_spz.inputs.format, "spz");
  assert.equal(graph.to_ply.inputs.format, "ply");
  for (const node of Object.values(SPLAT_OUTPUTS)) assert.ok(graph[node], `missing ${node}`);
  assert.equal(graph.camera.inputs.mode, "orbit");
});

test("filling a template leaves the template unchanged", () => {
  const template = load("portrait");
  portraitWorkflow(template, { prompt: "a knight", seed: 3 });
  assert.equal(template.positive.inputs.text, "");
});

test("every style has a canonical and a portrait prompt", () => {
  for (const style of STYLE_IDS) {
    assert.match(canonicalPrompt(style), /full-body/);
    assert.match(portraitPrompt("a knight", style), /a knight/);
  }
});

test("the person's notes go into the canonical prompt, and no notes add nothing", () => {
  const notes = canonicalPrompt("anime", "keep the long ears and the tail");
  assert.match(notes, /Follow these notes from the person who made the character: keep the long ears and the tail\. /);
  assert.ok(!canonicalPrompt("anime").includes("notes"));
  assert.ok(!canonicalPrompt("anime").includes("  "));
});
