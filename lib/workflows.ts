// Fills the three Comfy workflow templates in workflows/. Nothing here talks to the network.
// Each template is an API-format export, and these functions set its inputs by node id.

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export const MAX_SEED = 2 ** 32 - 1;

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

// The save nodes of each workflow, by id.
export const CANONICAL_OUTPUT = "save";
export const SHEET_VIEWS = ["three_quarter", "side", "back"] as const;
export const SPLAT_OUTPUTS = { spz: "save_spz", ply: "save_ply", orbit: "save_orbit" } as const;

export type SheetView = (typeof SHEET_VIEWS)[number];

// workflows/trellis2.api.json: the approved front image -> TRELLIS.2 -> a textured GLB mesh.
// TRELLIS.2 takes one image. Averaging the conditions of several views blurs the face, so it gets the front only.
export function trellisWorkflow(template: Graph, input: { canonical: unknown; seed: number }): Graph {
  const graph = structuredClone(template);
  graph.image.inputs.image = input.canonical;
  for (const name of ["structure_sampler", "shape_sampler", "upsample_sampler", "texture_sampler"]) {
    graph[name].inputs.seed = input.seed;
  }
  return graph;
}

// workflows/portrait.api.json: a description -> Qwen Image 2512 (Lightning, 4 steps) -> a portrait,
// for people who have no picture of their character.
export function portraitWorkflow(template: Graph, input: { prompt: string; seed: number }): Graph {
  const graph: Graph = structuredClone(template);
  graph.positive.inputs.text = input.prompt;
  graph.sampler.inputs.seed = input.seed;
  return graph;
}

// workflows/canonical.api.json: portrait -> Qwen Image Edit 2511 (Lightning, 4 steps) -> two candidates.
export function canonicalWorkflow(template: Graph, input: { portrait: unknown; prompt: string; seed: number; candidates: number }): Graph {
  const graph: Graph = structuredClone(template);
  graph.portrait.inputs.image = input.portrait;
  graph.positive_text.inputs.prompt = input.prompt;
  graph.latent.inputs.batch_size = input.candidates;
  graph.sampler.inputs.seed = input.seed;
  return graph;
}

// workflows/headshot.api.json: portrait (the face) + approved design (hair, outfit, style) ->
// Qwen Image Edit 2511 -> one front-facing head and shoulders. In the full-body design the face is
// only about 90 px tall, so the face pass starts again from the portrait.
export function headshotWorkflow(template: Graph, input: { portrait: unknown; canonical: unknown; prompt: string; seed: number }): Graph {
  const graph: Graph = structuredClone(template);
  graph.portrait.inputs.image = input.portrait;
  graph.canonical.inputs.image = input.canonical;
  graph.positive_text.inputs.prompt = input.prompt;
  graph.sampler.inputs.seed = input.seed;
  return graph;
}

// workflows/sheet.api.json: canonical -> Qwen Image Edit 2511 with the multiple-angles LoRA ->
// three-quarter, side and back views. The canonical image is the front view.
export function sheetWorkflow(template: Graph, input: { canonical: unknown; seed: number }): Graph {
  const graph: Graph = structuredClone(template);
  graph.canonical.inputs.image = input.canonical;
  SHEET_VIEWS.forEach((view, index) => {
    graph[`${view}_sampler`].inputs.seed = (input.seed + index) % (MAX_SEED + 1);
  });
  return graph;
}

// workflows/triposplat.api.json: canonical -> BiRefNet cutout -> TripoSplat -> SPZ, PLY and an orbit video.
export function splatWorkflow(template: Graph, input: { canonical: unknown; seed: number; gaussians?: number }): Graph {
  const graph: Graph = structuredClone(template);
  graph.image.inputs.image = input.canonical;
  graph.sampler.inputs.seed = input.seed;
  graph.decode.inputs.seed = input.seed;
  if (input.gaussians) graph.decode.inputs.num_gaussians = input.gaussians;
  return graph;
}
