import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Comfy, Forbidden, InsufficientCredits, JobFailed, MissingCredentials, Unauthorized, type Job } from "@comfyorg/sdk";
import type { Graph } from "./workflows.ts";

export type Media = { bytes: Uint8Array; type: string; name: string };
export type WorkflowName = "card-text" | "card-art" | "card-cutout";

function apiKey() {
  const key = process.env.COMFY_API_KEY?.trim();
  if (!key) throw new Error("COMFY_API_KEY is not configured.");
  return key;
}

export function hasApiKey() {
  return Boolean(process.env.COMFY_API_KEY?.trim());
}

// The SDK reads COMFY_BASE_URL itself. Blank means Comfy Cloud.
function client() {
  return new Comfy({ apiKey: apiKey(), clientInfo: "card-forge" });
}

export function extension(type: string, name = "") {
  const known: Record<string, string> = {
    "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "application/json": "json", "text/plain": "txt",
  };
  const fromName = name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return fromName ?? known[type] ?? type.split("/")[1]?.replace(/[^a-z0-9]/g, "") ?? "bin";
}

export async function template(name: WorkflowName) {
  return JSON.parse(await readFile(join(process.cwd(), "workflows", `${name}.api.json`), "utf8")) as Graph;
}

// An uploaded input, ready to put in a LoadImage node.
export function upload(api: Comfy, media: Media) {
  return api.assets.fromBytes(media.bytes, { filename: media.name, contentType: media.type });
}

// A cold Qwen model can wait in the Comfy Cloud queue for a while.
const WAIT_MS = 30 * 60_000;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Waits for a job and downloads what the named save nodes made. A network error while
// waiting or downloading does not lose the job: after a pause, the wait starts again on it.
async function finish(api: Comfy, id: string, nodes: string[], submitted?: Job): Promise<Record<string, Media[]>> {
  let job = submitted;
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      job ??= await api.jobs.get(id);
      await job.wait(WAIT_MS);
      await job.result();
      const found: Record<string, Media[]> = {};
      for (const node of nodes) {
        found[node] = await Promise.all(job.getOutputs(node).map(async (output) => ({
          bytes: await output.toBytes(), type: output.contentType, name: output.name,
        })));
      }
      if (nodes.every((node) => found[node].length === 0)) throw new JobFailed(`Comfy job ${id} finished without an output.`);
      return found;
    } catch (error) {
      if (isFinal(error) || error instanceof JobFailed || (error instanceof Error && error.name === "TimeoutError")) throw error;
      last = error;
      job = undefined;
      await pause(10_000 * (attempt + 1));
    }
  }
  throw last;
}

export type RunOptions = { job?: string | null; onSubmit?: (job: string) => Promise<void> };

// Submits a graph (or picks up a job an earlier attempt submitted) and returns the files of each save node.
export async function runGraph(build: (api: Comfy) => Graph, nodes: string[], options: RunOptions = {}) {
  const api = client();
  if (options.job) return finish(api, options.job, nodes);
  const job = await api.submit(api.workflows.fromJson(build(api)));
  await options.onSubmit?.(job.id);
  return finish(api, job.id, nodes, job);
}

// A retry cannot fix these.
export function isFinal(error: unknown) {
  return error instanceof InsufficientCredits || error instanceof Unauthorized || error instanceof MissingCredentials || error instanceof Forbidden;
}

export function comfyErrorMessage(error: unknown): string {
  if (error instanceof InsufficientCredits) return "Your Comfy account is out of credits. Add credits at platform.comfy.org and try again.";
  if (error instanceof Unauthorized || error instanceof MissingCredentials) return "Comfy did not accept the API key. Check COMFY_API_KEY in .env.local.";
  if (error instanceof Error && /free tier/i.test(error.message)) {
    return "Comfy Cloud API access needs a paid Comfy Cloud plan on the workspace that owns this API key. See comfy.org/cloud/pricing.";
  }
  return error instanceof Error && error.message ? error.message : "Comfy could not finish the job. Try again.";
}
