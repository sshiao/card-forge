// Reads the form the browser sends. Nothing here talks to the network.

import type { CardRequest } from "./card.ts";
import {
  ART_STYLE_IDS, clean, DEFAULT_OUTFIT, ELEMENT_IDS, FRAME_IDS, MAX_NAME, OUTFIT_IDS,
  type ArtStyleId, type ElementId, type FrameId, type OutfitId,
} from "./forge.ts";

export function readCardRequest(form: FormData): CardRequest {
  const value = (field: string) => String(form.get(field) ?? "");
  const name = clean(value("name"), MAX_NAME);
  const artStyle = value("artStyle");
  if (!(ART_STYLE_IDS as string[]).includes(artStyle)) throw new Error("Choose a supported art style.");
  const frame = value("frame");
  if (!(FRAME_IDS as string[]).includes(frame)) throw new Error("Choose a supported card frame.");
  const element = value("element") || "auto";
  if (element !== "auto" && !(ELEMENT_IDS as string[]).includes(element)) throw new Error("Choose a supported element.");
  const outfit = value("outfit") || DEFAULT_OUTFIT;
  if (!(OUTFIT_IDS as string[]).includes(outfit)) throw new Error("Choose a supported outfit.");
  return { name, artStyle: artStyle as ArtStyleId, frame: frame as FrameId, element: element as ElementId | "auto", outfit: outfit as OutfitId };
}
