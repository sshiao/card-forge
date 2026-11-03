// Mock mode (FORGE_MOCK=1) runs the whole app with no Comfy calls and no credits.
// Every step returns the files of a real run kept in examples/card/, after a short wait.
// Mara, in those files, is a generated person who does not exist.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Media } from "./comfy.ts";
import type { Engine } from "./engine.ts";

export const MOCK = process.env.FORGE_MOCK === "1";

const SAMPLE = join(process.cwd(), "examples", "card");
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sample(name: string): Promise<Media> {
  return { bytes: new Uint8Array(await readFile(join(SAMPLE, name))), type: "image/png", name };
}

export const mockEngine: Engine = {
  async text() {
    await pause(2500);
    return readFile(join(SAMPLE, "text.json"), "utf8");
  },
  async art(input) {
    await pause(3500);
    return Promise.all([sample(`art-${input.layout}-1.png`), sample(`art-${input.layout}-2.png`)]);
  },
};
