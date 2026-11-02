// Grafts a face-pass head onto a body splat from the command line, and renders a check sheet.
//
//   node scripts/graft.ts <body.ply> <head.ply> <out-dir>

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { graft, readPly, writePly } from "../lib/graft.ts";

const [bodyPath, headPath, outDir] = process.argv.slice(2);
if (!bodyPath || !headPath || !outDir) {
  console.error("Usage: node scripts/graft.ts <body.ply> <head.ply> <out-dir>");
  process.exit(1);
}
await mkdir(outDir, { recursive: true });
const result = graft(readPly(new Uint8Array(await readFile(bodyPath))), readPly(new Uint8Array(await readFile(headPath))));
const output = join(outDir, "graft.ply");
await writeFile(output, writePly(result.splat));
const round = (value: number) => Math.round(value * 1000) / 1000;
console.log(JSON.stringify({
  scale: round(result.scale), kept: result.kept,
  body: Object.fromEntries(Object.entries(result.body).map(([key, value]) => [key, typeof value === "number" ? round(value) : value])),
  head: Object.fromEntries(Object.entries(result.head).map(([key, value]) => [key, typeof value === "number" ? round(value) : value])),
}));

// Renders the head from the front, three-quarter and side, and the whole body from the front.
const transform = join(process.cwd(), "node_modules", ".bin", "splat-transform");
// The renderer turns the PLY upright, so the crown at -Y in the file is at +Y in its view.
const { top, neck } = result.body;
const height = neck - top;
const center = -(top + height * 0.45);
const distance = height * 4.4;
const shots: [string, string, string][] = [
  ["front", `${-distance},${center},0`, `0,${center},0`],
  ["three-quarter", `${-distance * 0.71},${center},${-distance * 0.71}`, `0,${center},0`],
  ["side", `0,${center},${-distance}`, `0,${center},0`],
  ["body", "-3.2,0,0", "0,0,0"],
];
for (const [name, position, target] of shots) {
  spawnSync(transform, ["-q", "-w", output, "--camera-pos", position, "--camera-target", target, "--camera-up", "0,1,0",
    "--camera-fov", "20", "--resolution", "420x420", "--background", "0.05,0.06,0.09", join(outDir, `${name}.webp`)], { stdio: "ignore" });
}
console.log(`Wrote ${output} and renders in ${outDir}`);
