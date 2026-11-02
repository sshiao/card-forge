import assert from "node:assert/strict";
import { test } from "node:test";
import type { Splat } from "../lib/graft.ts";
import { joinSides } from "../lib/two-sided.ts";

const PROPS = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];

// Plates of solid Gaussians, upside down like a TripoSplat PLY: the crown at -Y, the face toward +X.
// Each plate is [x, from y, to y, from z, to z, color].
function plates(list: [number, number, number, number, number, number][]): Splat {
  const rows: number[][] = [];
  for (const [x, y0, y1, z0, z1, color] of list) {
    for (let y = y0; y <= y1; y += 0.01) for (let z = z0; z <= z1; z += 0.01) rows.push([x, y, z, 0, 0, 0, color, color, color, 6, -6, -6, -6, 1, 0, 0, 0]);
  }
  return { header: "", props: PROPS, count: rows.length, data: Float32Array.from(rows.flat()) };
}

const FACE = 1, WEDGE = 2, BACK = 3, STRAY = 4;
// The front splat: its front surface, and a long wedge it guessed far behind the head.
const front = plates([[0.1, -0.5, 0.5, -0.2, 0.2, FACE], [-0.1, -0.5, 0.5, -0.2, 0.2, FACE], [-0.45, -0.5, -0.3, -0.1, 0.1, WEDGE]]);
// The back splat in its own frame: the character's back toward +X, and a panel outside the outline.
const back = plates([[0.1, -0.5, 0.5, -0.2, 0.2, BACK], [-0.1, -0.5, 0.5, -0.2, 0.2, BACK], [0.1, -0.5, -0.3, 0.3, 0.45, STRAY]]);

const colors = (splat: Splat) => {
  const found = new Map<number, number[]>();
  for (let i = 0; i < splat.count; i += 1) {
    const row = splat.data.subarray(i * PROPS.length, (i + 1) * PROPS.length);
    found.set(row[6], [...(found.get(row[6]) ?? []), row[0]]);
  }
  return found;
};

test("the join keeps the front splat's front and the back splat's back, turned", () => {
  const result = joinSides(front, back);
  const found = colors(result.splat);
  assert.ok(Math.abs(result.scale - 1) < 0.05, `scale ${result.scale}`);
  assert.ok(found.get(FACE)?.some((x) => x > 0.05), "the face stays");
  assert.ok(!found.has(WEDGE), "the guessed wedge behind the head is gone");
  // Turned 180 degrees, the back splat's front plate is now behind the body.
  assert.ok(found.get(BACK)?.every((x) => x < 0), "the back is behind the body");
  assert.ok(!found.has(STRAY), "nothing from the back outside the front outline");
});

test("a turned Gaussian keeps a unit rotation", () => {
  const result = joinSides(front, back);
  const stride = PROPS.length;
  for (let i = 0; i < result.splat.count; i += 1) {
    const row = result.splat.data.subarray(i * stride, (i + 1) * stride);
    if (row[6] !== BACK) continue;
    // The identity turned 180 degrees about Y is (0, 0, 1, 0).
    assert.deepEqual(Array.from(row.subarray(13, 17)), [-0, 0, 1, -0]);
    break;
  }
});

test("a join refuses splats of very different heights", () => {
  const short = plates([[0.1, -0.2, 0.2, -0.2, 0.2, BACK], [-0.1, -0.2, 0.2, -0.2, 0.2, BACK]]);
  assert.throws(() => joinSides(front, short), /height/);
});
