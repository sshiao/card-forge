// Joins two TripoSplat splats of one character: one from the approved front image, one from the
// sheet's back view. TripoSplat sees one image, so the front splat guesses the back of the
// character, and a cap or a hood can come out as a long wedge. The back splat saw the back.
//
// In the PLY files the character is upside down: the crown is at -Y and the feet at +Y. The face
// looks toward +X and the width runs along Z. The back splat also has its subject facing +X, so it
// is turned 180 degrees about the vertical axis and scaled to the front splat's height. The front
// splat keeps its front half and the shell the front camera sees. The back splat adds its back half
// inside the front outline, because the front and the back views see the same outline.

import type { Splat } from "./graft.ts";

export type JoinResult = { splat: Splat; scale: number; kept: { front: number; back: number } };

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

function columns(splat: Splat) {
  const at = (name: string) => {
    const index = splat.props.indexOf(name);
    if (index < 0) throw new Error(`PLY splat has no ${name} column.`);
    return index;
  };
  if (splat.props.some((name) => name.startsWith("f_rest_"))) throw new Error("Only splats with base colors (no higher SH bands) can be joined.");
  return {
    x: at("x"), y: at("y"), z: at("z"), opacity: at("opacity"),
    scales: ["scale_0", "scale_1", "scale_2"].map(at),
    rotation: ["rot_0", "rot_1", "rot_2", "rot_3"].map(at),
  };
}

// The crown, the feet and the middle of the solid Gaussians.
function measure(splat: Splat, at: ReturnType<typeof columns>) {
  const stride = splat.props.length;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < splat.count; i += 1) {
    const row = i * stride;
    if (sigmoid(splat.data[row + at.opacity]) <= 0.5) continue;
    xs.push(splat.data[row + at.x]);
    ys.push(splat.data[row + at.y]);
    zs.push(splat.data[row + at.z]);
  }
  if (ys.length < 100) throw new Error("The splat has too few solid Gaussians.");
  return { crown: quantile(ys, 0.002), feet: quantile(ys, 0.998), x: quantile(xs, 0.5), z: quantile(zs, 0.5) };
}

export function joinSides(front: Splat, back: Splat): JoinResult {
  if (front.props.join() !== back.props.join()) throw new Error("The two splats have different PLY columns.");
  const at = columns(front);
  const stride = front.props.length;

  // Turn the back splat 180 degrees about Y: x -> -x, z -> -z, and q -> (0, 0, 1, 0) * q.
  const turned = Float32Array.from(back.data);
  const [w, qx, qy, qz] = at.rotation;
  for (let i = 0; i < back.count; i += 1) {
    const row = i * stride;
    turned[row + at.x] = -turned[row + at.x];
    turned[row + at.z] = -turned[row + at.z];
    const q = [turned[row + w], turned[row + qx], turned[row + qy], turned[row + qz]];
    turned[row + w] = -q[2];
    turned[row + qx] = q[3];
    turned[row + qy] = q[0];
    turned[row + qz] = -q[1];
  }
  const turnedSplat = { ...back, data: turned };
  const f = measure(front, at);
  const b = measure(turnedSplat, at);
  const height = f.feet - f.crown;
  const scale = height / (b.feet - b.crown);
  if (!(scale > 0.7 && scale < 1.4)) throw new Error(`The front and back splats differ too much in height (${scale.toFixed(2)}x).`);
  const logScale = Math.log(scale);
  for (let i = 0; i < back.count; i += 1) {
    const row = i * stride;
    turned[row + at.x] = (turned[row + at.x] - b.x) * scale + f.x;
    turned[row + at.y] = (turned[row + at.y] - b.crown) * scale + f.crown;
    turned[row + at.z] = (turned[row + at.z] - b.z) * scale + f.z;
    for (const column of at.scales) turned[row + column] += logScale;
  }

  // The two splats guess depth on their own and disagree, most of all at a cap or a hood, so the
  // body is cut once, through its middle. The front splat also keeps the shell the front camera
  // sees, wherever it lies, so the front looks like the approved design. The back splat fills in
  // only behind that shell, and only inside the front outline.
  const cut = f.x;
  const band = height * 0.015;
  const shell = height * 0.03;
  // A shell far behind the middle is the front face of a guessed wedge, not a part the front sees.
  const deepest = cut - height * 0.2;
  const cell = height / 80;
  const key = (y: number, z: number) => `${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  // The front surface of each column of the front view, in cells of Y and Z.
  const surface = new Map<string, number>();
  for (let i = 0; i < front.count; i += 1) {
    const row = i * stride;
    if (sigmoid(front.data[row + at.opacity]) <= 0.5) continue;
    const k = key(front.data[row + at.y], front.data[row + at.z]);
    surface.set(k, Math.max(surface.get(k) ?? -Infinity, front.data[row + at.x]));
  }
  // The outline is one cell wider on every side, so its edge keeps the back's Gaussians.
  const outline = new Set<string>();
  for (const k of surface.keys()) {
    const [cy, cz] = k.split(",").map(Number);
    for (const dy of [-1, 0, 1]) for (const dz of [-1, 0, 1]) outline.add(`${cy + dy},${cz + dz}`);
  }

  const rows: Float32Array[] = [];
  for (let i = 0; i < front.count; i += 1) {
    const row = front.data.subarray(i * stride, (i + 1) * stride);
    const near = surface.get(key(row[at.y], row[at.z]));
    if (row[at.x] >= cut - band || (near !== undefined && row[at.x] >= near - shell && row[at.x] >= deepest)) rows.push(row);
  }
  const keptFront = rows.length;
  for (let i = 0; i < back.count; i += 1) {
    const row = turned.subarray(i * stride, (i + 1) * stride);
    const k = key(row[at.y], row[at.z]);
    if (row[at.x] > cut + band || !outline.has(k)) continue;
    const near = surface.get(k);
    if (near !== undefined && row[at.x] >= near - shell) continue;
    rows.push(row);
  }
  const data = new Float32Array(rows.length * stride);
  rows.forEach((row, index) => data.set(row, index * stride));
  return { splat: { header: front.header, props: front.props, count: rows.length, data }, scale, kept: { front: keptFront, back: rows.length - keptFront } };
}
