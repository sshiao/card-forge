// Produces a character in the background and keeps its state in .characters/<id>/character.json,
// next to every file it makes. The page polls that state.
//
//   portrait (uploaded, or drawn from a description)
//     -> canonical: two full-body candidates          -> the person approves one
//     -> at the same time: the sheet (three more views) and then a splat of its back view, the body
//        splat, and for photos the face pass (a front-facing head and shoulders from the portrait,
//        rebuilt by TripoSplat at full resolution)
//     -> locally: the front and back splats joined, the face grafted on, a contact sheet, SOG and
//        a standalone viewer
//   A TRELLIS.2 mesh of the approved front image is optional, on request.

import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JobFailed } from "@comfyorg/sdk";
import { comfyErrorMessage, extension, hasApiKey, isFinal, runGraph, upload, type Media } from "./comfy.ts";
import { composeSheet, convertSplat, posterFrame } from "./convert.ts";
import { comfyEngine, type Engine } from "./engine.ts";
import { graft, readPly, writePly } from "./graft.ts";
import { canonicalPrompt, clean, facePassByDefault, headshotPrompt, MAX_NOTES, portraitPrompt, type StyleId } from "./forge.ts";
import { joinSides } from "./two-sided.ts";
import { MOCK, mockEngine } from "./mock.ts";
import { MAX_SEED, randomSeed, SHEET_VIEWS } from "./workflows.ts";
import { refinementBundle, refinementResult, sha256, type RefinementRecord, type RefinementView } from "./modelsheet.ts";

export const CHARACTERS_DIR = join(process.cwd(), ".characters");
// A job can wait in the Comfy Cloud queue, but no step should leave the state untouched this long.
const STALE_MS = 30 * 60_000;
const CANDIDATES = 2;

export type CharacterRequest = { name: string; style: StyleId; description: string };
export type Stage = "portrait" | "casting" | "review" | "forging" | "done" | "failed";
export type StepId = "portrait" | "canonical" | "sheet" | "splat" | "back" | "headshot" | "head" | "mesh";
export type StepStatus = "waiting" | "running" | "done" | "failed" | "skipped";
export type ViewId = "front" | (typeof SHEET_VIEWS)[number];

export const VIEW_LABELS: Record<ViewId, string> = { front: "Front", three_quarter: "Three-quarter", side: "Side", back: "Back" };
export const VIEW_IDS: ViewId[] = ["front", ...SHEET_VIEWS];

// The face pass. Absent on characters made before it existed; "Add face close-up" adds it.
export type HeadRecord = { image: string | null; spz: string | null; ply: string | null; sog: string | null; orbit: string | null };
// The body splat with the face-pass head grafted on. Absent when the graft could not find a neck.
export type GraftRecord = { ply: string; sog: string; html: string };
// TripoSplat of the sheet's back view, and the body joined from the front and back splats.
// Absent on characters made before it existed; "Add back from sheet" adds it.
export type BackRecord = { spz: string | null; ply: string | null };
export type TwoSidedRecord = { ply: string; sog: string; html: string };

export type MeshRecord = { glb: string | null; model: "TRELLIS.2" | "Pixal3D" | "ModelSheetTo3D"; input: "canonical" | "multiview"; part?: "head" | "full"; seed?: number; job?: string };

export type Character = {
  id: string;
  request: CharacterRequest;
  stage: Stage;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  seed: number;
  portrait: string | null;
  candidates: string[];
  // The person's notes for the next candidates, from "Draw two more". Retries use them too.
  notes?: string;
  chosen: number | null;
  canonical: string | null;
  views: Partial<Record<ViewId, string>>;
  sheet: string | null;
  // Absent on legacy characters. Existing splats remain available after a mesh rebuild.
  mesh?: MeshRecord & { previous?: MeshRecord };
  refinement?: RefinementRecord;
  head?: HeadRecord;
  graft?: GraftRecord | null;
  back?: BackRecord;
  twoSided?: TwoSidedRecord | null;
  splat: { spz: string | null; ply: string | null; sog: string | null; html: string | null; orbit: string | null; poster: string | null };
  // Characters made before the face pass have no "headshot" or "head" entry.
  steps: Partial<Record<StepId, StepStatus>>;
  // The Comfy job of each step, so a resumed character fetches it instead of paying for it again.
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
  if (!hasApiKey()) return "Set COMFY_API_KEY for the portrait and character sheet workflows.";
  return null;
}

function engine(): Engine {
  return MOCK ? mockEngine : comfyEngine;
}

const ID = /^[a-z0-9]{6,16}-[a-f0-9]{6}$/;
const FILE = /^[a-z0-9-]+\.(png|jpg|jpeg|webp|mp4|spz|ply|sog|html|glb)$/;

function dirOf(id: string) {
  if (!ID.test(id)) throw new Error("Unknown character.");
  return join(CHARACTERS_DIR, id);
}

export function filePath(id: string, name: string) {
  if (!FILE.test(name)) throw new Error("Unknown file.");
  return join(dirOf(id), name);
}

// Two steps run at the same time and change the same object, so saves go one at a time.
const saving = new Map<string, Promise<void>>();
// The characters this server is producing right now.
const running = new Set<string>();

function save(character: Character) {
  character.updatedAt = Date.now();
  const snapshot = JSON.stringify(character, null, 2);
  const previous = saving.get(character.id) ?? Promise.resolve();
  const next = previous.then(async () => {
    const target = join(dirOf(character.id), "character.json");
    const temp = `${target}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temp, snapshot);
    await rename(temp, target);
  });
  saving.set(character.id, next.catch(() => undefined));
  return next;
}

const active = (character: Character) => character.stage !== "done" && character.stage !== "failed" && character.stage !== "review";

export async function readCharacter(id: string): Promise<Character | null> {
  try {
    const character = JSON.parse(await readFile(join(dirOf(id), "character.json"), "utf8")) as Character;
    // A character whose producer stopped, for example when the server restarted, is marked failed, so it can resume.
    if (active(character) && !running.has(id) && Date.now() - character.updatedAt > STALE_MS) {
      character.stage = "failed";
      character.error = "Production stopped before the character was finished. Resume it.";
      await save(character);
    }
    if (character.refinement?.state === "running" && !running.has(id) && Date.now() - character.updatedAt > STALE_MS) {
      character.refinement.state = "failed";
      character.refinement.error = "Connection to refinement stopped. Resume to reconnect to the saved GPU job.";
      await save(character);
    }
    return character;
  } catch {
    return null;
  }
}

export async function listCharacters(limit = 24): Promise<Character[]> {
  let ids: string[] = [];
  try {
    ids = (await readdir(CHARACTERS_DIR)).filter((id) => ID.test(id));
  } catch {
    return [];
  }
  const characters = await Promise.all(ids.map(readCharacter));
  return characters.filter((character): character is Character => character !== null).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
}

async function store(character: Character, name: string, media: Media | Uint8Array) {
  await writeFile(join(dirOf(character.id), name), media instanceof Uint8Array ? media : media.bytes);
  return name;
}

async function load(character: Character, name: string): Promise<Media> {
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return { bytes: new Uint8Array(await readFile(join(dirOf(character.id), name))), type, name };
}

// Runs one step: marks it, times it, remembers its Comfy job, and marks it failed on an error.
async function step<T>(character: Character, id: StepId, task: (options: { job: string | null; onSubmit: (job: string) => Promise<void> }) => Promise<T>): Promise<T> {
  character.steps[id] = "running";
  const entry = { step: id, start: Date.now(), end: null as number | null };
  character.timeline = character.timeline.filter((item) => item.step !== id).concat(entry);
  await save(character);
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // A short pause before a retry rides out a brief network failure.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
    try {
      const result = await task({
        job: character.jobs[id] ?? null,
        onSubmit: async (job) => { character.jobs[id] = job; await save(character); },
      });
      character.steps[id] = "done";
      entry.end = Date.now();
      await save(character);
      return result;
    } catch (error) {
      last = error;
      console.error(`[forge] ${character.id} ${id} attempt ${attempt + 1} failed:`, error, (error as { cause?: unknown })?.cause ?? "");
      // A job that failed on Comfy is not fetched again: the retry submits a new one.
      // A job that only lost its connection is kept, so the retry waits for it instead of paying twice.
      if (error instanceof JobFailed) delete character.jobs[id];
      if (isFinal(error)) break;
    }
  }
  character.steps[id] = "failed";
  entry.end = Date.now();
  await save(character);
  throw last;
}

async function fail(character: Character, error: unknown) {
  character.stage = "failed";
  character.error = comfyErrorMessage(error);
  await save(character);
}

// Draws the portrait if there is none, then two canonical candidates.
async function cast(character: Character) {
  if (!character.portrait) {
    character.stage = "portrait";
    const portrait = await step(character, "portrait", (options) =>
      engine().portrait({ prompt: portraitPrompt(character.request.description, character.request.style), seed: character.seed }, options));
    character.portrait = await store(character, `portrait.${extension(portrait.type, portrait.name)}`, portrait);
  }
  character.stage = "casting";
  const portrait = await load(character, character.portrait);
  const candidates = await step(character, "canonical", (options) => engine().canonical({
    portrait, prompt: canonicalPrompt(character.request.style, character.notes), seed: character.seed, candidates: CANDIDATES,
  }, options));
  if (!candidates.length) throw new Error("Qwen Image Edit returned no candidates.");
  // Each casting gets new file names, so the page never shows an old candidate from its cache.
  const round = Date.now().toString(36);
  character.candidates = await Promise.all(candidates.map((media, index) => store(character, `candidate-${round}-${index + 1}.png`, media)));
  character.chosen = null;
  character.stage = "review";
  character.error = null;
  await save(character);
}

// The sheet and 3D generation both start from the approved canonical image.
async function forge(character: Character) {
  if (!character.canonical) throw new Error("Approve a character first.");
  character.stage = "forging";
  character.error = null;
  await save(character);
  const canonical = await load(character, character.canonical);
  const dir = dirOf(character.id);

  // A step whose files are already here is not run again. Only the local work after it is.
  const sheet = async () => {
    if (character.sheet) return;
    if (character.steps.sheet !== "done" || !SHEET_VIEWS.every((view) => character.views[view])) {
      const views = await step(character, "sheet", (options) => engine().sheet({ canonical, seed: character.seed }, options));
      character.views = { front: character.canonical! };
      for (const view of SHEET_VIEWS) character.views[view] = await store(character, `view-${view.replace("_", "-")}.png`, views[view]);
      await save(character);
    }
    await composeSheet(VIEW_IDS.map((view) => join(dir, character.views[view]!)), join(dir, "sheet.png"));
    character.sheet = "sheet.png";
    await save(character);
  };

  const splat = async () => {
    if (character.splat.sog) return;
    if (character.steps.splat !== "done" || !character.splat.spz) {
      const files = await step(character, "splat", (options) => engine().splat({ canonical, seed: character.seed }, options));
      character.splat.spz = await store(character, "character.spz", files.spz);
      if (files.ply) character.splat.ply = await store(character, "character.ply", files.ply);
      if (files.orbit) character.splat.orbit = await store(character, "orbit.mp4", files.orbit);
      await save(character);
    }
    if (character.splat.orbit && !character.splat.poster) {
      await posterFrame(join(dir, "orbit.mp4"), join(dir, "poster.png"))
        .then(() => { character.splat.poster = "poster.png"; })
        .catch((error) => { character.warnings.push(`No poster: ${comfyErrorMessage(error)}`); });
    }
    const source = join(dir, character.splat.ply ?? character.splat.spz);
    await convertSplat(source, [join(dir, "character.sog"), join(dir, "character.html")]);
    character.splat.sog = "character.sog";
    character.splat.html = "character.html";
    await save(character);
  };

  const mesh = async () => {
    if (!character.mesh || character.mesh.glb) return;
    character.mesh.seed ??= character.seed;
    const files = await step(character, "mesh", (options) => engine().mesh({ canonical, seed: character.mesh!.seed! }, options));
    character.mesh.glb = await store(character, `mesh-${Date.now().toString(36)}.glb`, files.glb);
    character.mesh.job = character.jobs.mesh;
    await save(character);
  };

  const head = async () => {
    const record = character.head;
    if (!record || record.sog) return;
    if (!record.image) {
      if (!character.portrait) throw new Error("The face pass needs the portrait.");
      const portrait = await load(character, character.portrait);
      const shot = await step(character, "headshot", (options) => engine().headshot({
        portrait, canonical, prompt: headshotPrompt(character.request.style), seed: character.seed,
      }, options));
      record.image = await store(character, "head.png", shot);
      await save(character);
    }
    if (!record.spz) {
      const image = await load(character, record.image);
      const files = await step(character, "head", (options) => engine().splat({ canonical: image, seed: character.seed }, options));
      record.spz = await store(character, "head.spz", files.spz);
      if (files.ply) record.ply = await store(character, "head.ply", files.ply);
      if (files.orbit) record.orbit = await store(character, "head-orbit.mp4", files.orbit);
      await save(character);
    }
    await convertSplat(join(dir, record.ply ?? record.spz), [join(dir, "head.sog")]);
    record.sog = "head.sog";
    await save(character);
  };

  // TripoSplat on the sheet's back view, so the body's back comes from a picture of the back.
  const back = async () => {
    const record = character.back;
    if (!record || record.spz) return;
    const view = await load(character, character.views.back!);
    const files = await step(character, "back", (options) => engine().splat({ canonical: view, seed: character.seed }, options));
    record.spz = await store(character, "back.spz", files.spz);
    if (files.ply) record.ply = await store(character, "back.ply", files.ply);
    await save(character);
  };

  const tasks = [(async () => { await sheet(); await back(); })(), head()];
  if (character.steps.splat !== "skipped") tasks.push(splat());
  if (character.mesh && !character.mesh.glb) tasks.push(mesh());
  const results = await Promise.allSettled(tasks);
  const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failed) throw failed.reason;
  // The join and the graft are local and optional. Without them, the viewer shows the front splat.
  await joinBack(character).catch(async (error) => {
    character.twoSided = null;
    character.warnings.push(`Two-sided body skipped: ${comfyErrorMessage(error)}`);
    await save(character);
  });
  await graftHead(character).catch(async (error) => {
    character.graft = null;
    character.warnings.push(`Face graft skipped: ${comfyErrorMessage(error)}`);
    await save(character);
  });
  character.stage = "done";
  character.finishedAt = Date.now();
  await save(character);
}

// A PLY of a splat. TripoSplat sends one. Mock mode only has SPZ, so SplatTransform makes it.
async function plyOf(character: Character, ply: string | null, spz: string | null, name: string) {
  if (ply) return ply;
  if (!spz) throw new Error("The splat has no file.");
  const target = join(dirOf(character.id), name);
  await access(target).catch(() => convertSplat(join(dirOf(character.id), spz), [target]));
  return name;
}

async function joinBack(character: Character) {
  const back = character.back;
  if (character.twoSided || !back?.spz || !character.splat.spz) return;
  const dir = dirOf(character.id);
  const frontPly = await plyOf(character, character.splat.ply, character.splat.spz, "body-source.ply");
  const backPly = await plyOf(character, back.ply, back.spz, "back-source.ply");
  const result = joinSides(readPly(new Uint8Array(await readFile(join(dir, frontPly)))), readPly(new Uint8Array(await readFile(join(dir, backPly)))));
  await writeFile(join(dir, "two-sided.ply"), writePly(result.splat));
  await convertSplat(join(dir, "two-sided.ply"), [join(dir, "two-sided.sog"), join(dir, "two-sided.html")]);
  character.twoSided = { ply: "two-sided.ply", sog: "two-sided.sog", html: "two-sided.html" };
  await save(character);
}

async function graftHead(character: Character) {
  const head = character.head;
  if (character.graft || !head?.sog || !character.splat.sog) return;
  const dir = dirOf(character.id);
  // The face goes onto the two-sided body when there is one.
  const bodyPly = character.twoSided?.ply ?? await plyOf(character, character.splat.ply, character.splat.spz, "body-source.ply");
  const headPly = await plyOf(character, head.ply, head.spz, "head-source.ply");
  const result = graft(readPly(new Uint8Array(await readFile(join(dir, bodyPly)))), readPly(new Uint8Array(await readFile(join(dir, headPly)))));
  await writeFile(join(dir, "graft.ply"), writePly(result.splat));
  await convertSplat(join(dir, "graft.ply"), [join(dir, "graft.sog"), join(dir, "graft.html")]);
  character.graft = { ply: "graft.ply", sog: "graft.sog", html: "graft.html" };
  await save(character);
}

function produce(character: Character, task: (character: Character) => Promise<void>) {
  if (running.has(character.id)) throw new Error("This character is already being made.");
  running.add(character.id);
  void task(character)
    .catch((error) => fail(character, error))
    .finally(() => running.delete(character.id));
}

export async function createCharacter(request: CharacterRequest, photo: Media | null): Promise<Character> {
  if (!photo && !request.description) throw new Error("Add a picture of your character, or describe them.");
  const id = `${Date.now().toString(36)}-${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  await mkdir(dirOf(id), { recursive: true });
  const character: Character = {
    id,
    request,
    stage: photo ? "casting" : "portrait",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    finishedAt: null,
    seed: randomSeed(),
    portrait: null,
    candidates: [],
    chosen: null,
    canonical: null,
    views: {},
    sheet: null,
    head: facePassByDefault(request.style) ? { image: null, spz: null, ply: null, sog: null, orbit: null } : undefined,
    back: { spz: null, ply: null },
    splat: { spz: null, ply: null, sog: null, html: null, orbit: null, poster: null },
    steps: {
      portrait: photo ? "skipped" : "waiting", canonical: "waiting", sheet: "waiting", splat: "waiting", back: "waiting",
      headshot: facePassByDefault(request.style) ? "waiting" : "skipped", head: facePassByDefault(request.style) ? "waiting" : "skipped", mesh: "skipped",
    },
    jobs: {},
    timeline: [],
    warnings: [],
    error: null,
  };
  if (photo) character.portrait = await store(character, `portrait.${extension(photo.type, photo.name)}`, photo);
  await save(character);
  produce(character, cast);
  return character;
}

async function idle(id: string) {
  const character = await readCharacter(id);
  if (!character) throw new Error("Unknown character.");
  if (running.has(id)) throw new Error("This character is already being made.");
  return character;
}

// Draws two new candidates with a new seed. New notes replace the old ones, and an empty note
// removes them. With no notes given, the last ones stay.
export async function recast(id: string, notes?: string): Promise<Character> {
  const character = await idle(id);
  if (character.stage !== "review" && character.stage !== "failed") throw new Error("This character is past the casting step.");
  if (notes !== undefined) {
    const cleaned = clean(notes, MAX_NOTES);
    if (cleaned) character.notes = cleaned;
    else delete character.notes;
  }
  character.seed = randomSeed();
  character.steps.canonical = "waiting";
  delete character.jobs.canonical;
  produce(character, cast);
  return character;
}

export async function approve(id: string, index: number): Promise<Character> {
  const character = await idle(id);
  if (character.stage !== "review") throw new Error("This character is not waiting for approval.");
  const candidate = character.candidates[index];
  if (!candidate) throw new Error("Choose one of the candidates.");
  await copyFile(join(dirOf(id), candidate), join(dirOf(id), "canonical.png"));
  character.chosen = index;
  character.canonical = "canonical.png";
  // A different seed for the views and the splat than for the candidates.
  character.seed = (character.seed + 1000) % (MAX_SEED + 1);
  produce(character, forge);
  return character;
}

// Starts a failed character again from the step that failed. Finished steps and submitted jobs are kept.
export async function resume(id: string): Promise<Character> {
  const character = await idle(id);
  if (character.stage !== "failed") throw new Error("Only a failed character can resume.");
  character.error = null;
  produce(character, character.canonical ? forge : cast);
  return character;
}

// Builds, or builds again, an optional TRELLIS.2 mesh from the approved front image. The splats stay.
export async function rebuildMesh(id: string): Promise<Character> {
  const character = await idle(id);
  if (!character.canonical || (character.stage !== "done" && character.stage !== "failed")) {
    throw new Error("Finish or resume the approved character before rebuilding its mesh.");
  }
  if (MOCK) throw new Error("Disable FORGE_MOCK and use Comfy Cloud to rebuild a character.");
  if (!hasApiKey()) throw new Error("Set COMFY_API_KEY before rebuilding a mesh.");
  // produce() locks this character synchronously before starting the background job.
  let previous = character.mesh?.previous;
  if (character.mesh?.glb) {
    const { previous: _older, ...record } = character.mesh;
    previous = { ...record, job: character.jobs.mesh };
  }
  character.mesh = { glb: null, model: "TRELLIS.2", input: "canonical", part: character.mesh?.part, seed: character.seed, previous };
  character.steps.mesh = "waiting";
  delete character.jobs.mesh;
  character.finishedAt = null;
  produce(character, forge);
  return character;
}

// Adds the face pass to a finished character made before it existed, or draws it again.
export async function addHead(id: string): Promise<Character> {
  const character = await idle(id);
  if (!character.canonical || !character.portrait || (character.stage !== "done" && character.stage !== "failed")) {
    throw new Error("Finish the character before adding a face close-up.");
  }
  if (!MOCK && !hasApiKey()) throw new Error("Set COMFY_API_KEY before adding a face close-up.");
  character.head = { image: null, spz: null, ply: null, sog: null, orbit: null };
  delete character.graft;
  character.steps.headshot = "waiting";
  character.steps.head = "waiting";
  delete character.jobs.headshot;
  delete character.jobs.head;
  character.finishedAt = null;
  produce(character, forge);
  return character;
}

// Adds the back from the sheet to a finished character made before it existed, or makes it again.
// The face is grafted again, onto the new body.
export async function addBack(id: string): Promise<Character> {
  const character = await idle(id);
  if (!character.views.back || !character.splat.spz || (character.stage !== "done" && character.stage !== "failed")) {
    throw new Error("Finish the character and its sheet before adding the back.");
  }
  if (!MOCK && !hasApiKey()) throw new Error("Set COMFY_API_KEY before adding the back.");
  character.back = { spz: null, ply: null };
  delete character.twoSided;
  delete character.graft;
  character.steps.back = "waiting";
  delete character.jobs.back;
  character.finishedAt = null;
  produce(character, forge);
  return character;
}

// Refinement runs on an external CUDA host. Preparing is never presented as a GPU job.
// Both operations lock before the first await so another request cannot replace their inputs.
export async function prepareRefinement(id: string, settings: unknown) {
  if (running.has(id)) throw new Error("This character is already being made.");
  running.add(id);
  try {
    const character = await readCharacter(id);
    if (!character || character.stage !== "done" || !character.mesh?.glb) throw new Error("Finish the textured mesh before refining it.");
    if (!VIEW_IDS.every((view) => character.views[view])) throw new Error("Refinement needs all four character sheet views.");
    if (character.mesh.model === "ModelSheetTo3D") throw new Error("Rebuild a TRELLIS.2 base before preparing another refinement.");
    const views = Object.fromEntries(await Promise.all(VIEW_IDS.map(async (view) => [view, (await load(character, character.views[view]!)).bytes]))) as Record<RefinementView, Uint8Array>;
    const bundle = refinementBundle({
      character: id, sourceGlb: character.mesh.glb, seed: character.mesh.seed ?? character.seed, settings,
      mesh: new Uint8Array(await readFile(filePath(id, character.mesh.glb))), views,
      runner: new Uint8Array(await readFile(join(process.cwd(), "integrations/modelsheetto3d/run.py"))),
      instructions: new Uint8Array(await readFile(join(process.cwd(), "integrations/modelsheetto3d/README.md"))),
    });
    const inputName = `refinement-input-${bundle.manifest.job}.zip`;
    await writeFile(join(dirOf(id), inputName), bundle.bytes);
    character.refinement = { manifest: bundle.manifest, bundle: inputName, state: "prepared", preparedAt: Date.now() };
    await save(character);
    return bundle;
  } finally { running.delete(id); }
}

export async function importRefinement(id: string, bytes: Uint8Array) {
  if (running.has(id)) throw new Error("This character is already being made.");
  running.add(id);
  try {
    const character = await readCharacter(id);
    if (!character || character.refinement?.state !== "prepared") throw new Error("Prepare a refinement bundle for this character first.");
    return await applyRefinement(character, bytes);
  } finally { running.delete(id); }
}

async function applyRefinement(character: Character, bytes: Uint8Array) {
    const id = character.id;
    const refinement = character.refinement;
    if (character.stage !== "done" || !character.mesh?.glb || !refinement) throw new Error("Finish a textured base before refinement.");
    const source = new Uint8Array(await readFile(filePath(id, character.mesh.glb)));
    if (character.mesh.glb !== refinement.manifest.sourceGlb || sha256(source) !== refinement.manifest.baseSha256) throw new Error("The base mesh has changed. Prepare a fresh refinement bundle.");
    const files = refinementResult(bytes, refinement.manifest);
    const suffix = randomUUID().slice(0, 8);
    const outputs = { glb: `refined-${suffix}.glb`, ply: `refined-${suffix}.ply`, decal: `decal-${suffix}.ply`, preview: `refined-preview-${suffix}.png` };
    await store(character, outputs.glb, files["refined.glb"]);
    await store(character, outputs.ply, files["refined.ply"]);
    await store(character, outputs.decal, files["decal.ply"]);
    await store(character, outputs.preview, files["preview.png"]);
    const { previous: _older, ...previous } = character.mesh;
    character.mesh = { glb: outputs.glb, model: "ModelSheetTo3D", input: "multiview", seed: refinement.manifest.seed, previous };
    character.refinement = { ...refinement, state: "imported", importedAt: Date.now(), ply: outputs.ply, decal: outputs.decal, preview: outputs.preview };
    await save(character);
    return character;
}

export const refinementConfigured = () => Boolean(process.env.MODELSHEET_COMFY_URL?.trim() && hasApiKey());

export async function startRefinement(id: string, settings: unknown, reconnect = false) {
  if (!reconnect) {
    if (!refinementConfigured()) throw new Error("The ModelSheetTo3D GPU deployment is not ready yet.");
    await prepareRefinement(id, settings);
  }
  if (running.has(id)) throw new Error("This character is already being made.");
  running.add(id);
  let character: Character;
  try {
    const found = await readCharacter(id);
    if (!found?.refinement || (reconnect && found.refinement.state !== "failed")) throw new Error("No interrupted refinement to resume.");
    character = found;
    character.refinement!.endpoint ??= process.env.MODELSHEET_COMFY_URL?.trim();
    if (!character.refinement!.endpoint) throw new Error("The ModelSheetTo3D GPU deployment is not ready yet.");
    character.refinement!.state = "running";
    delete character.refinement!.error;
    await save(character);
  } catch (error) { running.delete(id); throw error; }
  const record = character.refinement!;
  void (async () => {
    const bytes = new Uint8Array(await readFile(join(dirOf(id), record.bundle)));
    const outputs = await runGraph((api) => ({ refine: { class_type: "CharacterForgeModelSheetRefine", inputs: {
      bundle: upload(api, { bytes, type: "application/zip", name: `${record.manifest.job}.zip` }),
    } } }), ["refine"], {
      job: record.cloudJob,
      onSubmit: async (job) => { record.cloudJob = job; await save(character); },
    }, record.endpoint);
    const result = outputs.refine.find((file) => file.name.toLowerCase().endsWith(".zip"));
    if (!result) throw new Error("ModelSheetTo3D returned no result archive.");
    await applyRefinement(character, result.bytes);
  })().catch(async (error) => {
    record.state = "failed";
    record.error = comfyErrorMessage(error);
    // A terminal GPU failure can be retried; transport failures reconnect to the same job.
    if (error instanceof JobFailed) delete record.cloudJob;
    await save(character);
  }).finally(() => running.delete(id));
  return character;
}
