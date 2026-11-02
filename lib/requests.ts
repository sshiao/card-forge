// Reads the form the browser sends. Nothing here talks to the network.

import type { CharacterRequest } from "./character.ts";
import { clean, MAX_DESCRIPTION, MAX_NAME, STYLE_IDS, type StyleId } from "./forge.ts";

export function readCharacterRequest(form: FormData): CharacterRequest {
  const text = (field: string, max: number) => {
    const value = form.get(field);
    return typeof value === "string" ? clean(value, max) : "";
  };
  const name = text("name", MAX_NAME);
  if (!name) throw new Error("Give your character a name.");
  const style = String(form.get("style") ?? "");
  if (!STYLE_IDS.includes(style as StyleId)) throw new Error("Choose a supported style.");
  return { name, style: style as StyleId, description: text("description", MAX_DESCRIPTION) };
}
