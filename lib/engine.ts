// Generation steps on Comfy. Each one fills a workflow template, submits it, and returns its files.
// "job" resumes a job an earlier attempt submitted, so a lost connection does not pay twice.

import { runGraph, template, upload, type Media, type RunOptions } from "./comfy.ts";
import { validateGlb, type MeshFiles } from "./trellis.ts";
import {
  CANONICAL_OUTPUT, SHEET_VIEWS, SPLAT_OUTPUTS,
  canonicalWorkflow, headshotWorkflow, portraitWorkflow, sheetWorkflow, splatWorkflow, trellisWorkflow,
  type SheetView,
} from "./workflows.ts";

export type SplatFiles = { spz: Media; ply: Media | null; orbit: Media | null };

export type Engine = {
  portrait(input: { prompt: string; seed: number }, options: RunOptions): Promise<Media>;
  canonical(input: { portrait: Media; prompt: string; seed: number; candidates: number }, options: RunOptions): Promise<Media[]>;
  sheet(input: { canonical: Media; seed: number }, options: RunOptions): Promise<Record<SheetView, Media>>;
  splat(input: { canonical: Media; seed: number }, options: RunOptions): Promise<SplatFiles>;
  headshot(input: { portrait: Media; canonical: Media; prompt: string; seed: number }, options: RunOptions): Promise<Media>;
  mesh(input: { canonical: Media; seed: number }, options: RunOptions): Promise<MeshFiles>;
};

export const comfyEngine: Engine = {
  async mesh(input, options) {
    const graph = await template("trellis2");
    const outputs = await runGraph((api) => trellisWorkflow(graph, { canonical: upload(api, input.canonical), seed: input.seed }), ["mesh"], options);
    const glb = outputs.mesh.find((file) => file.name.toLowerCase().endsWith(".glb"));
    if (!glb) throw new Error("TRELLIS.2 finished without a GLB file.");
    validateGlb(glb.bytes);
    return { glb };
  },
  async headshot(input, options) {
    const graph = await template("headshot");
    const outputs = await runGraph((api) => headshotWorkflow(graph, {
      ...input, portrait: upload(api, input.portrait), canonical: upload(api, input.canonical),
    }), ["save"], options);
    return outputs.save[0];
  },

  async portrait(input, options) {
    const graph = await template("portrait");
    const outputs = await runGraph(() => portraitWorkflow(graph, input), ["save"], options);
    return outputs.save[0];
  },

  async canonical(input, options) {
    const graph = await template("canonical");
    const outputs = await runGraph((api) => canonicalWorkflow(graph, { ...input, portrait: upload(api, input.portrait) }), [CANONICAL_OUTPUT], options);
    return outputs[CANONICAL_OUTPUT];
  },

  async sheet(input, options) {
    const graph = await template("sheet");
    const outputs = await runGraph((api) => sheetWorkflow(graph, { ...input, canonical: upload(api, input.canonical) }), [...SHEET_VIEWS], options);
    const missing = SHEET_VIEWS.filter((view) => !outputs[view][0]);
    if (missing.length) throw new Error(`The character sheet came back without the ${missing.join(", ")} view.`);
    return Object.fromEntries(SHEET_VIEWS.map((view) => [view, outputs[view][0]])) as Record<SheetView, Media>;
  },

  async splat(input, options) {
    const graph = await template("triposplat");
    const nodes = Object.values(SPLAT_OUTPUTS);
    const outputs = await runGraph((api) => splatWorkflow(graph, { ...input, canonical: upload(api, input.canonical) }), nodes, options);
    const spz = outputs[SPLAT_OUTPUTS.spz][0];
    if (!spz) throw new Error("TripoSplat finished without a splat file.");
    return { spz, ply: outputs[SPLAT_OUTPUTS.ply][0] ?? null, orbit: outputs[SPLAT_OUTPUTS.orbit][0] ?? null };
  },
};
