import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Mock mode and a temporary cards folder, set before the card module loads.
process.env.FORGE_MOCK = "1";
process.env.FORGE_CARDS_DIR = await mkdtemp(join(tmpdir(), "card-forge-test-"));
const { approve, createCard, readCard, recast } = await import("../lib/card.ts");

async function until(id: string, stage: string) {
  for (let i = 0; i < 100; i += 1) {
    if ((await readCard(id))?.stage === stage) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`The card never reached ${stage}.`);
}

test("a redraw answers with a card in the works, so the page keeps polling", async () => {
  const photo = { bytes: new Uint8Array(await readFile(new URL("../examples/card/photo.png", import.meta.url))), type: "image/png", name: "photo.png" };
  const card = await createCard({ name: "", artStyle: "anime", frame: "gold", element: "auto", outfit: "own" }, photo);
  assert.equal(card.stage, "writing");
  await until(card.id, "review");
  assert.equal((await approve(card.id, 0)).stage, "done");
  const redraw = await recast(card.id, { frame: "glass" });
  assert.equal(redraw.stage, "drawing");
  assert.equal((await readCard(card.id))?.stage, "drawing");
  await until(card.id, "review");
  assert.equal((await readCard(card.id))?.layout, "cutout");
  await rm(process.env.FORGE_CARDS_DIR!, { recursive: true, force: true });
});
