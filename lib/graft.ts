// Grafts the face-pass head onto the body splat, so one model has the sharp face.
//
// Both splats come from TripoSplat in the same frame. In the PLY file the character is upside
// down, as is usual for Gaussian splats: the crown is at -Y and the feet at +Y. The face looks
// toward +X, the width runs along Z, and each splat fills a unit box. The face-pass splat is a
// chest-up bust. Each splat's neck is the narrowest slice below the widest part of the head.
// The bust is scaled so its crown-to-neck height matches the body's, moved onto the body's head,
// and the two are cut at the neck with a small overlap. The files are standard 3DGS PLYs: log
// scales, logit opacity, so a scale by s adds ln(s) to each log scale.

export type Splat = { header: string; props: string[]; count: number; data: Float32Array };
export type Neck = { top: number; neck: number; width: number; x: number; z: number; found: boolean };

export function readPly(bytes: Uint8Array): Splat {
  const end = Buffer.from(bytes).indexOf("end_header\n");
  if (end < 0) throw new Error("Not a PLY file.");
  const header = Buffer.from(bytes.subarray(0, end)).toString("latin1");
  if (!header.includes("format binary_little_endian")) throw new Error("Only binary little-endian PLY splats can be grafted.");
  const count = Number(header.match(/element vertex (\d+)/)?.[1]);
  const props = [...header.matchAll(/^property (\w+) (\w+)$/gm)].map((match) => {
    if (match[1] !== "float") throw new Error(`PLY property ${match[2]} is ${match[1]}, not float.`);
    return match[2];
  });
  for (const name of ["x", "y", "z", "opacity", "scale_0", "scale_1", "scale_2"]) {
    if (!props.includes(name)) throw new Error(`PLY splat has no ${name} column.`);
  }
  const start = end + "end_header\n".length;
  const length = count * props.length;
  if (bytes.length - start < length * 4) throw new Error("PLY splat is truncated.");
  // Copy, so the floats are aligned whatever the byte offset of the input.
  const data = new Float32Array(new Uint8Array(bytes.subarray(start, start + length * 4)).buffer);
  return { header, props, count, data };
}

export function writePly(splat: Splat): Uint8Array {
  const header = `ply\nformat binary_little_endian 1.0\nelement vertex ${splat.count}\n${splat.props.map((name) => `property float ${name}`).join("\n")}\nend_header\n`;
  const head = Buffer.from(header, "latin1");
  const out = new Uint8Array(head.length + splat.data.byteLength);
  out.set(head, 0);
  out.set(new Uint8Array(splat.data.buffer, splat.data.byteOffset, splat.data.byteLength), head.length);
  return out;
}

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

function quantile(values: number[], q: number) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

// The solid Gaussians, as [x, y, z] rows. Faint ones are floaters and haze.
function solid(splat: Splat) {
  const stride = splat.props.length;
  const [ix, iy, iz, io] = ["x", "y", "z", "opacity"].map((name) => splat.props.indexOf(name));
  const points: [number, number, number][] = [];
  for (let i = 0; i < splat.count; i += 1) {
    const row = i * stride;
    if (sigmoid(splat.data[row + io]) > 0.5) points.push([splat.data[row + ix], splat.data[row + iy], splat.data[row + iz]]);
  }
  return points;
}

const SLICE = 0.01;

// Walks from the crown toward the feet and measures the width (along Z) of each slice. The head
// widens, then narrows at the chin or the neck, then the shoulders widen it again. The neck is the
// narrowest slice after the first narrowing, once the width grows 25% past it. A beard or a high
// collar can make that narrowing small, so 5% is enough to count. "found" is false when the width
// never narrows and widens again within maxDepth (a share of the splat's height).
export function findNeck(splat: Splat, maxDepth: number): Neck {
  const points = solid(splat);
  const crown = quantile(points.map((point) => point[1]), 0.001);
  let widest = 0;
  let narrowest = { y: NaN, width: Infinity };
  let found = false;
  for (let y = crown; y < crown + maxDepth; y += SLICE) {
    const zs = points.filter((point) => point[1] >= y && point[1] < y + SLICE).map((point) => point[2]);
    if (zs.length < 20) continue;
    const width = quantile(zs, 0.98) - quantile(zs, 0.02);
    if (!Number.isFinite(narrowest.y)) {
      widest = Math.max(widest, width);
      if (width > widest * 0.95) continue;
    }
    if (width < narrowest.width) narrowest = { y: y + SLICE / 2, width };
    else if (width > narrowest.width * 1.25) {
      found = true;
      break;
    }
  }
  const neck = found ? narrowest.y : crown + maxDepth;
  const head = points.filter((point) => point[1] < neck);
  return { top: crown, neck, width: widest, x: quantile(head.map((point) => point[0]), 0.5), z: quantile(head.map((point) => point[2]), 0.5), found };
}

export type GraftResult = { splat: Splat; scale: number; body: Neck; head: Neck; kept: { body: number; head: number } };

// overlap is a share of the body's head height that the bust keeps below the neck, so no gap opens.
// Body Gaussians inside the kept bust are removed too, so its coarse hair and neck cannot show through.
export function graft(body: Splat, head: Splat, overlap = 0.12): GraftResult {
  if (body.props.join() !== head.props.join()) throw new Error("The two splats have different PLY columns.");
  // Even a chibi head stays in the top half of the body. The bust is mostly head.
  const bodyNeck = findNeck(body, 0.5);
  const headNeck = findNeck(head, 0.95);
  if (!bodyNeck.found || !headNeck.found) throw new Error("Could not find the neck in one of the splats.");
  const bodyHeight = bodyNeck.neck - bodyNeck.top;
  const headHeight = headNeck.neck - headNeck.top;
  if (!(bodyHeight > 0.03) || !(headHeight > 0.05)) throw new Error("Could not find the head in one of the splats.");
  const scale = bodyHeight / headHeight;
  // A wrong neck shows as heads of different widths. Then a graft would look worse than none.
  const fit = (headNeck.width * scale) / bodyNeck.width;
  if (!(fit > 0.7 && fit < 1.4)) throw new Error(`The two heads do not match in size (${fit.toFixed(2)}x).`);
  const move = [bodyNeck.x - headNeck.x * scale, bodyNeck.top - headNeck.top * scale, bodyNeck.z - headNeck.z * scale];
  const band = bodyHeight * overlap;
  const stride = body.props.length;
  const [ix, iy, iz] = ["x", "y", "z"].map((name) => body.props.indexOf(name));
  const scales = ["scale_0", "scale_1", "scale_2"].map((name) => body.props.indexOf(name));
  const logScale = Math.log(scale);

  const headRows: Float32Array[] = [];
  for (let i = 0; i < head.count; i += 1) {
    const source = head.data.subarray(i * stride, (i + 1) * stride);
    const y = source[iy] * scale + move[1];
    if (y > bodyNeck.neck + band) continue;
    const row = Float32Array.from(source);
    row[ix] = source[ix] * scale + move[0];
    row[iy] = y;
    row[iz] = source[iz] * scale + move[2];
    for (const column of scales) row[column] = source[column] + logScale;
    headRows.push(row);
  }

  // A grid of the cells the bust fills, one cell wider on every side.
  const cell = bodyHeight / 40;
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const filled = new Set<string>();
  for (const row of headRows) {
    for (const dx of [-cell, 0, cell]) for (const dy of [-cell, 0, cell]) for (const dz of [-cell, 0, cell]) {
      filled.add(key(row[ix] + dx, row[iy] + dy, row[iz] + dz));
    }
  }
  const rows: Float32Array[] = [];
  for (let i = 0; i < body.count; i += 1) {
    const row = body.data.subarray(i * stride, (i + 1) * stride);
    if (row[iy] < bodyNeck.neck) continue;
    if (row[iy] < bodyNeck.neck + band * 2 && filled.has(key(row[ix], row[iy], row[iz]))) continue;
    rows.push(row);
  }
  const keptBody = rows.length;
  const keptHead = headRows.length;
  for (const row of headRows) rows.push(row);
  const data = new Float32Array(rows.length * stride);
  rows.forEach((row, index) => data.set(row, index * stride));
  return { splat: { header: body.header, props: body.props, count: rows.length, data }, scale, body: bodyNeck, head: headNeck, kept: { body: keptBody, head: keptHead } };
}
