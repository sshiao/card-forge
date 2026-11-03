// Runs one card step from the command line, without the app. Useful to test a prompt or a workflow.
//
//   npm run forge -- text <photo> [name] [element]                         writes the card text as JSON
//   npm run forge -- art <photo> <text.json> [frame] [art style] [outfit]  paints two art candidates
//
// The outfit is "own" (the clothes from the photo, by default) or "hero" (a new outfit).
//
// Files go to .test-output/<step>-<time>/.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Media } from "../lib/comfy.ts";
import { comfyEngine } from "../lib/engine.ts";
import {
  ART_SIZES, DEFAULT_ART_STYLE, DEFAULT_FRAME, DEFAULT_OUTFIT, FRAMES, artPrompt, cardTextPrompt, parseCardText,
  type ArtStyleId, type CardText, type ElementId, type FrameId, type OutfitId,
} from "../lib/forge.ts";
import { randomSeed } from "../lib/workflows.ts";

const [stage, photoPath, ...rest] = process.argv.slice(2);
if ((stage !== "text" && stage !== "art") || !photoPath) {
  console.error("Usage: npm run forge -- text <photo> [name] [element]\n       npm run forge -- art <photo> <text.json> [frame] [art style] [outfit]");
  process.exit(1);
}
const photo: Media = { bytes: new Uint8Array(await readFile(photoPath)), type: photoPath.endsWith(".png") ? "image/png" : "image/jpeg", name: basename(photoPath) };
const out = join(".test-output", `${stage}-${Date.now().toString(36)}`);
await mkdir(out, { recursive: true });
const seed = randomSeed();
const started = Date.now();
const options = { onSubmit: async (job: string) => console.log(`Submitted job ${job}`) };

if (stage === "text") {
  const request = { name: rest[0] ?? "", element: (rest[1] ?? "auto") as ElementId | "auto" };
  const raw = await comfyEngine.text({ photo, prompt: cardTextPrompt(request), seed }, options);
  await writeFile(join(out, "raw.txt"), raw);
  const text = parseCardText(raw, request);
  await writeFile(join(out, "text.json"), JSON.stringify(text, null, 2));
  console.log(JSON.stringify(text, null, 2));
} else {
  const text = parseCardText(await readFile(rest[0], "utf8"), { name: "", element: "auto" }) as CardText;
  const frame = (rest[1] ?? DEFAULT_FRAME) as FrameId;
  const layout = FRAMES[frame].layout;
  const art = await comfyEngine.art({ photo, prompt: artPrompt(text, (rest[2] ?? DEFAULT_ART_STYLE) as ArtStyleId, layout, (rest[3] ?? DEFAULT_OUTFIT) as OutfitId), seed, candidates: 2, ...ART_SIZES[layout], layout }, options);
  for (const [index, file] of art.entries()) await writeFile(join(out, `art-${index + 1}.png`), file.bytes);
}
console.log(`Wrote ${out} in ${Math.round((Date.now() - started) / 1000)} s, seed ${seed}.`);
