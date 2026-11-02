// Mock mode (FORGE_MOCK=1) runs the whole app with no Comfy calls and no credits.
// Every step returns the files of a real run kept in examples/, after a short wait.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Media } from "./comfy.ts";
import type { Engine } from "./engine.ts";
import { SHEET_VIEWS, type SheetView } from "./workflows.ts";

export const MOCK = process.env.FORGE_MOCK === "1";

const SAMPLE = join(process.cwd(), "examples", "sky-pirate");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sample(name: string, type: string): Promise<Media> {
  return { bytes: new Uint8Array(await readFile(join(SAMPLE, name))), type, name };
}

export const mockEngine: Engine = {
  async mesh() {
    throw new Error("Mock mode contains legacy splat samples only. Use Comfy Cloud to generate a mesh.");
  },
  async headshot() {
    await pause(3000);
    return sample("head.png", "image/png");
  },
  async portrait() {
    await pause(3000);
    return sample("portrait.png", "image/png");
  },
  async canonical() {
    await pause(4000);
    return Promise.all([sample("candidate-1.png", "image/png"), sample("candidate-2.png", "image/png")]);
  },
  async sheet() {
    await pause(6000);
    const views = await Promise.all(SHEET_VIEWS.map((view) => sample(`view-${view.replace("_", "-")}.png`, "image/png")));
    return Object.fromEntries(SHEET_VIEWS.map((view, index) => [view, views[index]])) as Record<SheetView, Media>;
  },
  async splat(input) {
    await pause(5000);
    // The face pass sends head.png. Everything else is the body.
    const part = input.canonical.name.startsWith("head") ? "head" : "character";
    return { spz: await sample(`${part}.spz`, "application/octet-stream"), ply: null, orbit: await sample(part === "head" ? "head-orbit.mp4" : "orbit.mp4", "video/mp4") };
  },
};
