import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ART_SIZES, ART_STYLE_IDS, artPrompt, cardTextPrompt, ELEMENT_IDS, FRAME_IDS, FRAMES, parseCardText } from "../lib/forge.ts";
import { readCardRequest } from "../lib/requests.ts";
import { cardArtWorkflow, cardTextWorkflow, type Graph } from "../lib/workflows.ts";

const load = (name: string) => JSON.parse(readFileSync(new URL(`../workflows/${name}.api.json`, import.meta.url), "utf8")) as Graph;
const sample = JSON.parse(readFileSync(new URL("../examples/card/text.json", import.meta.url), "utf8"));
const auto = { name: "", element: "auto" as const };

test("the card text workflow sends the photo and the prompt to Qwen3-VL and saves its answer", () => {
  const template = load("card-text");
  const graph = cardTextWorkflow(template, { photo: "photo-asset", prompt: "Write a card.", seed: 0 });
  assert.equal(graph.photo.inputs.image, "photo-asset");
  assert.equal(graph.vlm.class_type, "AILab_QwenVL_Advanced");
  assert.equal(graph.vlm.inputs.custom_prompt, "Write a card.");
  assert.equal(graph.vlm.inputs.seed, 1, "the node takes seeds from 1");
  assert.deepEqual(graph.save.inputs.text, ["vlm", 0]);
  assert.equal(template.vlm.inputs.custom_prompt, "", "the template stays unchanged");
});

test("the card art workflow draws candidates in the size of the layout", () => {
  for (const frame of FRAME_IDS) {
    const layout = FRAMES[frame].layout;
    const size = ART_SIZES[layout];
    const graph = cardArtWorkflow(load(layout === "cutout" ? "card-cutout" : "card-art"), { photo: "photo-asset", prompt: "Paint.", seed: 9, candidates: 2, ...size });
    assert.equal(graph.photo.inputs.image, "photo-asset");
    assert.deepEqual(graph.latent.inputs, { width: size.width, height: size.height, batch_size: 2 });
    assert.equal(graph.sampler.inputs.seed, 9);
    assert.equal(graph.positive_text.inputs.prompt, "Paint.");
    assert.ok(size.width % 16 === 0 && size.height % 16 === 0, "Qwen Image sizes are multiples of 16");
  }
});

test("the cutout workflow cuts the person out with BiRefNet and saves PNGs with alpha", () => {
  const art = load("card-art");
  const cutout = load("card-cutout");
  for (const id of Object.keys(art).filter((id) => id !== "save")) assert.deepEqual(cutout[id], art[id], `${id} matches the art workflow`);
  assert.equal(cutout.bg_model.inputs.bg_removal_name, "birefnet.safetensors");
  assert.deepEqual(cutout.bg_mask.inputs.image, ["decode", 0]);
  // JoinImageWithAlpha treats its mask as the see-through part, so the person's mask is inverted first.
  assert.equal(cutout.alpha.class_type, "InvertMask");
  assert.deepEqual(cutout.cutout.inputs, { image: ["decode", 0], alpha: ["alpha", 0] });
  assert.deepEqual(cutout.save.inputs.images, ["cutout", 0]);
});

test("a fenced, wordy answer still reads as card text", () => {
  const text = parseCardText(`Here is your card:\n\`\`\`json\n${JSON.stringify(sample)}\n\`\`\``, auto);
  assert.equal(text.name, "Sunny Scribe");
  assert.equal(text.element, "light");
  assert.equal(text.hp, 170);
  assert.equal(text.attacks.length, 2);
  assert.equal(text.resistance, null, "\"none\" means no resistance");
  assert.equal(text.weakness, "shadow");
});

test("the person's name and element win over the model's", () => {
  const text = parseCardText(JSON.stringify(sample), { name: "Mara", element: "water" });
  assert.equal(text.name, "Mara");
  assert.equal(text.element, "water");
});

test("bad values become safe ones", () => {
  const text = parseCardText(JSON.stringify({
    name: "X", element: "plasma", hp: "999", attacks: [{ name: "Zap", cost: 9, damage: "a lot" }, {}, {}],
    weakness: "plasma", resistance: "plasma", retreat: -3,
  }), auto);
  assert.equal(text.element, "light");
  assert.equal(text.hp, 250);
  assert.equal(text.attacks.length, 2);
  assert.equal(text.attacks[0].cost, 4);
  assert.equal(text.attacks[0].damage, "");
  assert.ok(ELEMENT_IDS.includes(text.weakness) && text.weakness !== text.element);
  assert.equal(text.resistance, null);
  assert.equal(text.retreat, 0);
  assert.throws(() => parseCardText("I cannot help with that.", auto), /card text/);
});

test("the prompts carry the person's choices and avoid words that make Qwen draw a frame", () => {
  assert.match(cardTextPrompt({ name: "Mara", element: "fire" }), /"Mara"[\s\S]*"fire"/);
  assert.doesNotMatch(cardTextPrompt(auto), /name is|element is/);
  const text = parseCardText(JSON.stringify(sample), auto);
  for (const style of ART_STYLE_IDS) {
    for (const outfit of ["own", "hero"] as const) {
      const prompt = artPrompt(text, style, "framed", outfit, "add a cat");
      assert.match(prompt, /no frame, no border/);
      assert.doesNotMatch(prompt, /\bcard\b/i);
      assert.match(prompt, /add a cat\./);
    }
  }
  assert.match(artPrompt(text, "anime", "full", "own"), /tall portrait/);
  // The glass card's art has a plain background for BiRefNet, and no scene or effects to cut around.
  const cutout = artPrompt(text, "painted", "cutout", "own");
  assert.match(cutout, /plain flat gray studio background/);
  assert.match(cutout, /no frame, no border/);
  assert.doesNotMatch(cutout, /Background:|Surround them|detailed (scene|background)/);
  assert.doesNotMatch(cutout, /\bcard\b/i);
});

test("the art keeps the clothes from the photo unless the person asks for a hero outfit", () => {
  const text = parseCardText(JSON.stringify({ ...sample, outfit: "a sunlit scholar's coat with golden quills." }), auto);
  assert.equal(text.outfit, "a sunlit scholar's coat with golden quills.");
  const own = artPrompt(text, "anime", "framed", "own");
  assert.match(own, /same clothes as in the photo, unchanged/);
  assert.doesNotMatch(own, /scholar's coat|new outfit/);
  assert.match(artPrompt(text, "anime", "framed", "hero"), /new outfit in place of the clothes in the photo: a sunlit scholar's coat with golden quills\. /);
  // Cards written before the outfit field still get a hero outfit.
  const old = parseCardText(JSON.stringify(sample), auto);
  assert.equal(old.outfit, "");
  assert.match(artPrompt(old, "anime", "framed", "hero"), /a heroic adventurer outfit in light colors\./);
  assert.match(cardTextPrompt(auto), /"outfit"/);
  assert.match(cardTextPrompt(auto), /pose[^\n]*does not mention clothes/);
});

test("the form keeps the photo's clothes by default and checks the outfit", () => {
  const form = new FormData();
  form.set("artStyle", "anime");
  form.set("frame", "vintage");
  assert.equal(readCardRequest(form).outfit, "own");
  form.set("outfit", "hero");
  assert.equal(readCardRequest(form).outfit, "hero");
  form.set("outfit", "tuxedo");
  assert.throws(() => readCardRequest(form), /outfit/);
});
