// TRELLIS.2 outputs a standard binary glTF mesh with embedded textures.
import type { Media } from "./comfy.ts";

export type MeshFiles = { glb: Media };

export function validateGlb(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) {
    throw new Error("TRELLIS.2 returned an invalid GLB file.");
  }
}
