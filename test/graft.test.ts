import assert from "node:assert/strict";
import { test } from "node:test";
import { findNeck, graft, readPly, writePly, type Splat } from "../lib/graft.ts";

const PROPS = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];

// A column of solid Gaussians, upside down like a TripoSplat PLY: the crown at -Y.
// Each band is [from y, to y, width along Z].
function column(bands: [number, number, number][], color: number): Splat {
  const rows: number[][] = [];
  for (const [from, to, width] of bands) {
    for (let y = from; y < to; y += 0.002) {
      for (let z = -width / 2; z <= width / 2; z += 0.004) {
        rows.push([0, y, z, 0, 0, 0, color, color, color, 6, -7, -7, -7, 1, 0, 0, 0]);
      }
    }
  }
  return { header: "", props: PROPS, count: rows.length, data: Float32Array.from(rows.flat()) };
}

const body = column([[-0.5, -0.38, 0.12], [-0.38, -0.35, 0.05], [-0.35, 0.5, 0.3]], 0);
const bust = column([[-0.5, 0.2, 0.6], [0.2, 0.3, 0.25], [0.3, 0.5, 0.7]], 1);
// Shoulders straight after the head, as with a high collar: no neck to find.
const collar = column([[-0.5, -0.38, 0.12], [-0.38, 0.5, 0.3]], 0);

test("the neck is the narrow slice between the head and the shoulders", () => {
  const neck = findNeck(body, 0.5);
  assert.ok(neck.found);
  assert.ok(Math.abs(neck.top + 0.5) < 0.01, `crown ${neck.top}`);
  assert.ok(neck.neck > -0.39 && neck.neck < -0.34, `neck ${neck.neck}`);
  const bustNeck = findNeck(bust, 0.95);
  assert.ok(bustNeck.neck > 0.19 && bustNeck.neck < 0.31, `bust neck ${bustNeck.neck}`);
});

test("the graft scales the bust onto the body's head and keeps the body below the neck", () => {
  const result = graft(body, bust);
  const [b, h] = [findNeck(body, 0.5), findNeck(bust, 0.95)];
  const expected = (b.neck - b.top) / (h.neck - h.top);
  assert.ok(Math.abs(result.scale - expected) < 1e-6);
  const stride = PROPS.length;
  let crown = Infinity;
  for (let i = 0; i < result.splat.count; i += 1) {
    const row = result.splat.data.subarray(i * stride, (i + 1) * stride);
    if (row[6] === 1) {
      crown = Math.min(crown, row[1]);
      // A log scale grows by ln(scale).
      assert.ok(Math.abs(row[10] - (-7 + Math.log(result.scale))) < 1e-4);
    } else {
      assert.ok(row[1] >= result.body.neck, "no body Gaussian above the neck");
    }
  }
  assert.ok(Math.abs(crown + 0.5) < 0.01, `grafted crown ${crown}`);
  assert.ok(result.kept.head > 0 && result.kept.body > 0);
});

test("a graft refuses a body without a neck", () => {
  assert.equal(findNeck(collar, 0.5).found, false);
  assert.throws(() => graft(collar, bust), /neck/);
});

test("a PLY survives a write and a read", () => {
  const again = readPly(writePly(body));
  assert.equal(again.count, body.count);
  assert.deepEqual(again.props, PROPS);
  assert.deepEqual(Array.from(again.data.subarray(0, 34)), Array.from(body.data.subarray(0, 34)));
});
