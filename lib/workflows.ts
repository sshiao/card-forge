// Fills the ComfyUI API-format workflows in workflows/ by node id. The templates stay unchanged.

export type Graph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }>;

export const MAX_SEED = 2 ** 32 - 1;

export function randomSeed(): number {
  return Math.floor(Math.random() * MAX_SEED);
}

// workflows/card-text.api.json: photo -> Qwen3-VL-8B, sampled at temperature 0.9 so cards differ ->
// the card text as JSON, saved by SaveText.
export function cardTextWorkflow(template: Graph, input: { photo: unknown; prompt: string; seed: number }): Graph {
  const graph: Graph = structuredClone(template);
  graph.photo.inputs.image = input.photo;
  graph.vlm.inputs.custom_prompt = input.prompt;
  // The node takes seeds from 1.
  graph.vlm.inputs.seed = Math.max(1, input.seed);
  return graph;
}

// workflows/card-art.api.json: photo -> Qwen Image Edit 2511 with the Lightning 4-step LoRA ->
// art candidates in the size of the card layout.
// workflows/card-cutout.api.json has the same nodes, then BiRefNet cuts the person out of each
// candidate, and the PNGs keep a transparent background.
export function cardArtWorkflow(template: Graph, input: { photo: unknown; prompt: string; seed: number; candidates: number; width: number; height: number }): Graph {
  const graph: Graph = structuredClone(template);
  graph.photo.inputs.image = input.photo;
  graph.positive_text.inputs.prompt = input.prompt;
  graph.latent.inputs = { ...graph.latent.inputs, width: input.width, height: input.height, batch_size: input.candidates };
  graph.sampler.inputs.seed = input.seed;
  return graph;
}
