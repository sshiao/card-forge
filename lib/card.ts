// Makes a card in the background and keeps its state in .cards/<id>/card.json, next to its files.
// The page polls that state.
//
//   photo -> Qwen3-VL writes the card: name, element, HP, attacks, flavor, and a pose and a scene
//         -> Qwen Image Edit 2511 draws two art candidates of the person as the hero
//            (for the glass card, BiRefNet then cuts the person out)
//         -> the person picks one, or writes notes and draws two more
// The page draws the frame around the art and exports the finished card as a PNG.

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { JobFailed } from "@comfyorg/sdk";
import { comfyErrorMessage, extension, hasApiKey, isFinal, type Media } from "./comfy.ts";
import { comfyEngine, type Engine } from "./engine.ts";
import {
  ART_SIZES, DEFAULT_OUTFIT, FRAME_IDS, FRAMES, MAX_NOTES, OUTFIT_IDS, SET_SIZE, artPrompt, cardTextPrompt, clean, parseCardText,
  type ArtStyleId, type CardText, type ElementId, type FrameId, type Layout, type OutfitId,
} from "./forge.ts";
import { MOCK, mockEngine } from "./mock.ts";
import { randomSeed } from "./workflows.ts";

// FORGE_CARDS_DIR moves the cards to another folder, for example for a second server that records a demo.
export const CARDS_DIR = process.env.FORGE_CARDS_DIR ? resolve(process.env.FORGE_CARDS_DIR) : join(process.cwd(), ".cards");
// A job can wait in the Comfy Cloud queue, but no step should leave the state untouched this long.
const STALE_MS = 15 * 60_000;
const CANDIDATES = 2;

export type CardRequest = { name: string; artStyle: ArtStyleId; frame: FrameId; element: ElementId | "auto"; outfit: OutfitId };
export type Stage = "writing" | "drawing" | "review" | "done" | "failed";
export type StepId = "text" | "art";
export type StepStatus = "waiting" | "running" | "done" | "failed";

export type Card = {
  id: string;
  request: CardRequest;
  stage: Stage;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  seed: number;
  photo: string;
  text: CardText | null;
  // The person's notes for the next art candidates, from "Draw two more". Retries use them too.
  notes?: string;
  candidates: string[];
  // The layout the candidates were drawn for: wide for a framed card, tall for full art, and a
  // tall cutout with a transparent background for the glass card.
  layout: Layout;
  chosen: number | null;
  art: string | null;
  frame: FrameId;
  // What the hero wears in the next art candidates. Cards from before this choice have none,
  // and keep the clothes from the photo.
  outfit?: OutfitId;
  number: number;
  steps: Record<StepId, StepStatus>;
  // The Comfy job of each step, so a resumed card fetches it instead of paying for it again.
  jobs: Partial<Record<StepId, string>>;
  timeline: { step: StepId; start: number; end: number | null }[];
  warnings: string[];
  error: string | null;
};

export function isConfigured() {
  return MOCK || hasApiKey();
}

export function configurationError() {
  if (MOCK) return null;
  if (!hasApiKey()) return "Set COMFY_API_KEY in .env.local to make cards on Comfy Cloud, or FORGE_MOCK=1 to try the app with sample files.";
  return null;
}

function engine(): Engine {
  return MOCK ? mockEngine : comfyEngine;
}

const ID = /^[a-z0-9]{6,16}-[a-f0-9]{6}$/;
const FILE = /^[a-z0-9-]+\.(png|jpg|jpeg|webp)$/;

function dirOf(id: string) {
  if (!ID.test(id)) throw new Error("Unknown card.");
  return join(CARDS_DIR, id);
}

export function filePath(id: string, name: string) {
  if (!FILE.test(name)) throw new Error("Unknown file.");
  return join(dirOf(id), name);
}

// Saves go one at a time, so an older snapshot never overwrites a newer one.
const saving = new Map<string, Promise<void>>();
// The cards this server is making right now.
const running = new Set<string>();

function save(card: Card) {
  card.updatedAt = Date.now();
  const snapshot = JSON.stringify(card, null, 2);
  const previous = saving.get(card.id) ?? Promise.resolve();
  const next = previous.then(async () => {
    const target = join(dirOf(card.id), "card.json");
    const temp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temp, snapshot);
    await rename(temp, target);
  });
  saving.set(card.id, next.catch(() => undefined));
  return next;
}

const active = (card: Card) => card.stage === "writing" || card.stage === "drawing";

export async function readCard(id: string): Promise<Card | null> {
  try {
    const card = JSON.parse(await readFile(join(dirOf(id), "card.json"), "utf8")) as Card;
    // A card whose producer stopped, for example when the server restarted, is marked failed, so it can resume.
    if (active(card) && !running.has(id) && Date.now() - card.updatedAt > STALE_MS) {
      card.stage = "failed";
      card.error = "The server stopped before the card was finished. Resume it.";
      await save(card);
    }
    return card;
  } catch {
    return null;
  }
}

export async function listCards(limit = 36): Promise<Card[]> {
  let ids: string[] = [];
  try {
    ids = (await readdir(CARDS_DIR)).filter((id) => ID.test(id));
  } catch {
    return [];
  }
  const cards = await Promise.all(ids.map(readCard));
  return cards.filter((card): card is Card => card !== null).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

async function store(card: Card, name: string, media: Media) {
  await writeFile(join(dirOf(card.id), name), media.bytes);
  return name;
}

async function load(card: Card, name: string): Promise<Media> {
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { bytes: new Uint8Array(await readFile(join(dirOf(card.id), name))), type, name };
}

// Runs one step: marks it, times it, remembers its Comfy job, and marks it failed on an error.
async function step<T>(card: Card, id: StepId, task: (options: { job: string | null; onSubmit: (job: string) => Promise<void> }) => Promise<T>): Promise<T> {
  card.steps[id] = "running";
  const entry = { step: id, start: Date.now(), end: null as number | null };
  card.timeline = card.timeline.filter((item) => item.step !== id).concat(entry);
  await save(card);
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // A short pause before a retry rides out a brief network failure.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    try {
      const result = await task({
        job: card.jobs[id] ?? null,
        onSubmit: async (job) => { card.jobs[id] = job; await save(card); },
      });
      card.steps[id] = "done";
      entry.end = Date.now();
      await save(card);
      return result;
    } catch (error) {
      last = error;
      console.error(`[forge] ${card.id} ${id} attempt ${attempt + 1} failed:`, error, (error as { cause?: unknown })?.cause ?? "");
      // A job that failed on Comfy is not fetched again: the retry submits a new one.
      // A job that only lost its connection is kept, so the retry waits for it instead of paying twice.
      if (error instanceof JobFailed) delete card.jobs[id];
      if (isFinal(error)) break;
    }
  }
  card.steps[id] = "failed";
  entry.end = Date.now();
  await save(card);
  throw last;
}

async function fail(card: Card, error: unknown) {
  card.stage = "failed";
  card.error = comfyErrorMessage(error);
  await save(card);
}

// Writes the card text if there is none, then draws two art candidates.
async function make(card: Card) {
  const photo = await load(card, card.photo);
  if (!card.text) {
    card.stage = "writing";
    const raw = await step(card, "text", (options) => engine().text({ photo, prompt: cardTextPrompt(card.request), seed: card.seed }, options));
    try {
      card.text = parseCardText(raw, card.request);
    } catch (error) {
      // The same job would give the same answer, so a resume asks again with a new seed.
      delete card.jobs.text;
      card.seed = randomSeed();
      card.steps.text = "failed";
      throw error;
    }
    await save(card);
  }
  card.stage = "drawing";
  const layout = FRAMES[card.frame].layout;
  const candidates = await step(card, "art", (options) => engine().art({
    photo, prompt: artPrompt(card.text!, card.request.artStyle, layout, card.outfit ?? DEFAULT_OUTFIT, card.notes), seed: card.seed, candidates: CANDIDATES, ...ART_SIZES[layout], layout,
  }, options));
  // Each round gets new file names, so the page never shows an old candidate from its cache.
  const round = Date.now().toString(36);
  card.candidates = await Promise.all(candidates.map((media, index) => store(card, `art-${round}-${index + 1}.png`, media)));
  card.layout = layout;
  card.chosen = null;
  card.stage = "review";
  card.error = null;
  await save(card);
}

function produce(card: Card, task: (card: Card) => Promise<void>) {
  if (running.has(card.id)) throw new Error("This card is already being made.");
  running.add(card.id);
  void task(card)
    .catch((error) => fail(card, error))
    .finally(() => running.delete(card.id));
}

export async function createCard(request: CardRequest, photo: Media): Promise<Card> {
  const id = `${Date.now().toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  await mkdir(dirOf(id), { recursive: true });
  const card: Card = {
    id,
    request,
    stage: "writing",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    seed: randomSeed(),
    photo: `photo.${extension(photo.type, photo.name)}`,
    text: null,
    candidates: [],
    layout: FRAMES[request.frame].layout,
    chosen: null,
    art: null,
    frame: request.frame,
    outfit: request.outfit,
    number: (Number.parseInt(id.slice(-6), 16) % SET_SIZE) + 1,
    steps: { text: "waiting", art: "waiting" },
    jobs: {},
    timeline: [],
    warnings: [],
    error: null,
  };
  await store(card, card.photo, photo);
  await save(card);
  produce(card, make);
  return card;
}

async function idle(id: string) {
  const card = await readCard(id);
  if (!card) throw new Error("Unknown card.");
  if (running.has(id)) throw new Error("This card is already being made.");
  return card;
}

// Draws two new art candidates with a new seed. New notes replace the old ones, and an empty note
// removes them. A new frame with another layout gets art in its own shape. A new outfit choice
// applies to these candidates and the ones after. "rewrite" also asks Qwen3-VL for new card text.
export async function recast(id: string, options: { notes?: string; frame?: string; outfit?: string; rewrite?: boolean }): Promise<Card> {
  const card = await idle(id);
  if (card.stage === "writing" || card.stage === "drawing") throw new Error("This card is already being made.");
  if (options.notes !== undefined) {
    const notes = clean(options.notes, MAX_NOTES);
    if (notes) card.notes = notes;
    else delete card.notes;
  }
  if (options.frame !== undefined) {
    if (!(FRAME_IDS as string[]).includes(options.frame)) throw new Error("Choose a supported frame.");
    card.frame = options.frame as FrameId;
  }
  if (options.outfit !== undefined) {
    if (!(OUTFIT_IDS as string[]).includes(options.outfit)) throw new Error("Choose a supported outfit.");
    card.outfit = options.outfit as OutfitId;
  }
  if (options.rewrite) {
    card.text = null;
    card.steps.text = "waiting";
    delete card.jobs.text;
  }
  card.seed = randomSeed();
  card.steps.art = "waiting";
  delete card.jobs.art;
  card.finishedAt = null;
  // The page polls only while the card is in the works, so the answer must already say so.
  card.stage = card.text ? "drawing" : "writing";
  await save(card);
  produce(card, make);
  return card;
}

export async function approve(id: string, index: number): Promise<Card> {
  const card = await idle(id);
  if (card.stage !== "review") throw new Error("This card is not waiting for a pick.");
  const candidate = card.candidates[index];
  if (!candidate) throw new Error("Choose one of the candidates.");
  card.chosen = index;
  card.art = candidate;
  card.stage = "done";
  card.finishedAt = Date.now();
  await save(card);
  return card;
}

// Changes the frame or the text of a card. Edited text goes through the same checks as Qwen's.
export async function updateCard(id: string, patch: { frame?: unknown; text?: unknown }): Promise<Card> {
  const card = await idle(id);
  if (!card.text) throw new Error("This card has no text yet.");
  if (patch.frame !== undefined) {
    if (!(FRAME_IDS as unknown[]).includes(patch.frame)) throw new Error("Choose a supported frame.");
    card.frame = patch.frame as FrameId;
  }
  if (patch.text !== undefined) {
    const edited = parseCardText(JSON.stringify({ ...card.text, ...(patch.text as object) }), { name: "", element: "auto" });
    card.text = { ...edited, pose: card.text.pose, scene: card.text.scene, outfit: card.text.outfit };
  }
  await save(card);
  return card;
}

// Starts a failed card again from the step that failed. Finished steps and submitted jobs are kept.
export async function resume(id: string): Promise<Card> {
  const card = await idle(id);
  if (card.stage !== "failed") throw new Error("Only a failed card can resume.");
  card.error = null;
  card.stage = card.text ? "drawing" : "writing";
  await save(card);
  produce(card, make);
  return card;
}
