// Generation steps on Comfy. Each one fills a workflow template, submits it, and returns what it made.
// "job" resumes a job an earlier attempt submitted, so a lost connection does not pay twice.

import { runGraph, template, upload, type Media, type RunOptions } from "./comfy.ts";
import type { Layout } from "./forge.ts";
import { cardArtWorkflow, cardTextWorkflow } from "./workflows.ts";

export type Engine = {
  // The raw answer of Qwen3-VL. parseCardText in lib/forge.ts reads it.
  text(input: { photo: Media; prompt: string; seed: number }, options: RunOptions): Promise<string>;
  // The glass card's art comes from the cutout workflow: PNGs with a transparent background.
  art(input: { photo: Media; prompt: string; seed: number; candidates: number; width: number; height: number; layout: Layout }, options: RunOptions): Promise<Media[]>;
};

export const comfyEngine: Engine = {
  async text(input, options) {
    const graph = await template("card-text");
    const outputs = await runGraph((api) => cardTextWorkflow(graph, { ...input, photo: upload(api, input.photo) }), ["save"], options);
    const file = outputs.save[0];
    if (!file) throw new Error("Qwen3-VL finished without card text.");
    return new TextDecoder().decode(file.bytes);
  },

  async art(input, options) {
    const graph = await template(input.layout === "cutout" ? "card-cutout" : "card-art");
    const outputs = await runGraph((api) => cardArtWorkflow(graph, { ...input, photo: upload(api, input.photo) }), ["save"], options);
    if (!outputs.save.length) throw new Error("Qwen Image Edit finished without art.");
    return outputs.save;
  },
};
