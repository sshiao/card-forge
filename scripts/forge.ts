// Runs one workflow from the command line, without the app. Useful to test a workflow change.
//
//   npm run forge -- portrait "<description>" [out-dir]
//   npm run forge -- canonical <portrait.png> [out-dir]     (FORGE_STYLE and FORGE_NOTES set the style and the notes)
//   npm run forge -- sheet <canonical.png> [out-dir]
//   npm run forge -- splat <canonical.png> [out-dir]
//   npm run forge -- headshot .characters/<id> [out-dir]   (its portrait and canonical image)
//   npm run forge -- mesh <canonical.png> [out-dir]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { extension, runGraph, template, upload, type Media } from "../lib/comfy.ts";
import { comfyEngine } from "../lib/engine.ts";
import { canonicalPrompt, DEFAULT_STYLE, headshotPrompt, portraitPrompt, type StyleId } from "../lib/forge.ts";
import {
  CANONICAL_OUTPUT, SHEET_VIEWS, SPLAT_OUTPUTS, canonicalWorkflow, portraitWorkflow, randomSeed, sheetWorkflow, splatWorkflow,
} from "../lib/workflows.ts";

const [stage, input, outDir = join(".test-output", `${stage}-${Date.now().toString(36)}`)] = process.argv.slice(2);
if (!stage || !input) {
  console.error("Usage: npm run forge -- portrait|canonical|sheet|splat|headshot|mesh <image, description or character dir> [out-dir]");
  process.exit(1);
}

const media: Media | null = stage === "portrait" || stage === "headshot" ? null
  : { bytes: new Uint8Array(await readFile(input)), type: input.endsWith(".png") ? "image/png" : "image/jpeg", name: basename(input) };
let seed = randomSeed();
await mkdir(outDir, { recursive: true });
const started = Date.now();

let nodes: string[];
let outputs: Record<string, Media[]>;
const onSubmit = async (job: string) => {
  await writeFile(join(outDir, "run.json"), JSON.stringify({ job, stage, input, seed, started }, null, 2));
  console.log(`Submitted job ${job}`);
};
if (stage === "headshot") {
  // Input is a character directory: its portrait carries the face, its canonical image the design.
  const state = JSON.parse(await readFile(join(input, "character.json"), "utf8"));
  const read = async (name: string): Promise<Media> => ({ bytes: new Uint8Array(await readFile(join(input, name))), type: name.endsWith(".png") ? "image/png" : "image/jpeg", name });
  nodes = ["save"];
  const shot = await comfyEngine.headshot({
    portrait: await read(state.portrait), canonical: await read(state.canonical), prompt: headshotPrompt(state.request.style as StyleId), seed,
  }, { onSubmit });
  outputs = { save: [shot] };
} else if (stage === "portrait") {
  const graph = await template("portrait");
  nodes = ["save"];
  outputs = await runGraph(() => portraitWorkflow(graph, { prompt: portraitPrompt(input, DEFAULT_STYLE), seed }), nodes, { onSubmit });
} else if (!media) {
  throw new Error("Give an image.");
} else if (stage === "canonical") {
  const graph = await template("canonical");
  nodes = [CANONICAL_OUTPUT];
  const prompt = canonicalPrompt((process.env.FORGE_STYLE as StyleId | undefined) ?? DEFAULT_STYLE, process.env.FORGE_NOTES);
  outputs = await runGraph((api) => canonicalWorkflow(graph, { portrait: upload(api, media), prompt, seed, candidates: 2 }), nodes, { onSubmit });
} else if (stage === "sheet") {
  const graph = await template("sheet");
  nodes = [...SHEET_VIEWS];
  outputs = await runGraph((api) => sheetWorkflow(graph, { canonical: upload(api, media), seed }), nodes, { onSubmit });
} else if (stage === "mesh") {
  nodes = ["mesh"];
  const result = await comfyEngine.mesh({ canonical: media, seed }, { onSubmit });
  outputs = { mesh: [result.glb] };
} else if (stage === "splat") {
  const graph = await template("triposplat");
  nodes = Object.values(SPLAT_OUTPUTS);
  outputs = await runGraph((api) => splatWorkflow(graph, { canonical: upload(api, media), seed }), nodes, { onSubmit });
} else {
  throw new Error(`Unknown stage "${stage}".`);
}

for (const node of nodes) {
  for (const [index, file] of outputs[node].entries()) {
    const target = join(outDir, `${node}-${index + 1}.${extension(file.type, file.name)}`);
    await writeFile(target, file.bytes);
    console.log(`${target}  ${file.type}  ${(file.bytes.length / 1024).toFixed(0)} KB  (${file.name})`);
  }
}
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)} s, seed ${seed}.`);
