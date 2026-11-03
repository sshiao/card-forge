// The card rules: art styles, elements, frames, the two prompts, and the limits of a request.
// The card is an original design in the style of creature-battle trading cards. It copies no
// real game's name, logo, frames or symbols.

export const MAX_NAME = 40;
export const MAX_NOTES = 300;
// Cards are numbered within one made-up set of this size.
export const SET_SIZE = 120;

export const ART_STYLES = {
  anime: {
    label: "Anime",
    hint: "Cel-shaded, bold colors",
    prompt: "Clean anime illustration: cel shading, crisp line art, bold saturated colors, expressive eyes.",
  },
  painted: {
    label: "Painted",
    hint: "Classic fantasy card art",
    prompt: "Hand-painted fantasy illustration: rich painterly brushwork, dramatic lighting.",
  },
  animated: {
    label: "3D animated",
    hint: "Soft, rounded, cinematic",
    prompt: "Stylized 3D animated film look: soft rounded forms, smooth materials, cinematic lighting.",
  },
  photo: {
    label: "Photo-real",
    hint: "Like a movie still",
    prompt: "Photorealistic fantasy illustration, like a movie still, with real skin, hair and fabric.",
  },
} as const;

export type ArtStyleId = keyof typeof ART_STYLES;
export const ART_STYLE_IDS = Object.keys(ART_STYLES) as ArtStyleId[];
export const DEFAULT_ART_STYLE: ArtStyleId = "anime";

// What the hero wears in the art. By default the art keeps the clothes from the photo.
export const OUTFITS = {
  own: { label: "Own clothes", hint: "What they wear in the photo" },
  hero: { label: "Hero outfit", hint: "New clothes that fit the card" },
} as const;

export type OutfitId = keyof typeof OUTFITS;
export const OUTFIT_IDS = Object.keys(OUTFITS) as OutfitId[];
export const DEFAULT_OUTFIT: OutfitId = "own";

// Each element has a color for the frame and the cost badges, and effects for the art.
export const ELEMENTS = {
  fire: { label: "Fire", color: "#e2553a", light: "#f8b27a", art: "swirling flames and glowing embers" },
  water: { label: "Water", color: "#2f86de", light: "#a6d0f7", art: "crashing waves and floating water droplets" },
  nature: { label: "Nature", color: "#3f9f4a", light: "#addc9e", art: "leaves, vines and blooming flowers" },
  lightning: { label: "Lightning", color: "#e9b413", light: "#fbe58a", art: "crackling lightning bolts and bright sparks" },
  psychic: { label: "Psychic", color: "#9b4fe0", light: "#dcbaf8", art: "glowing violet waves and floating runes" },
  earth: { label: "Earth", color: "#a96b35", light: "#e6c79f", art: "flying rocks, dust and cracked stone" },
  shadow: { label: "Shadow", color: "#4a4466", light: "#a29dc0", art: "dark smoke, moonlight and deep purple shadows" },
  metal: { label: "Metal", color: "#7d8a99", light: "#d3dae2", art: "polished steel shards and turning gears" },
  air: { label: "Air", color: "#38b6c6", light: "#b5ebf1", art: "rushing wind streams and swirling clouds" },
  light: { label: "Light", color: "#e4a93a", light: "#fbe6b0", art: "radiant golden light rays and sparkles" },
} as const;

export type ElementId = keyof typeof ELEMENTS;
export const ELEMENT_IDS = Object.keys(ELEMENTS) as ElementId[];

// Framed cards show the art in a window, so it is drawn wide. Full-art cards show it edge to edge.
// The glass card shows the person cut out of the art, inside a 3D glass card.
// Battle cards show the HP and the moves. Sports cards show only the name, the title and the
// element on the front, like a ball card. The glass card shows the name, the title, the element and the HP.
export const FRAMES = {
  vintage: { label: "Vintage holo", hint: "Warm border, holo art window", layout: "framed", face: "battle" },
  modern: { label: "Modern", hint: "Silver border, clean layout", layout: "framed", face: "battle" },
  full: { label: "Full art", hint: "Art from edge to edge", layout: "full", face: "battle" },
  gold: { label: "Gold rare", hint: "Gold frame, gold foil", layout: "full", face: "battle" },
  illustration: { label: "Illustration rare", hint: "Art fills the card, text on the art", layout: "full", face: "battle" },
  rainbow: { label: "Rainbow rare", hint: "Pastel rainbow over the whole card", layout: "full", face: "battle" },
  chrome: { label: "Chrome refractor", hint: "Prospect card, rainbow chrome", layout: "full", face: "sports" },
  retro: { label: "Retro cardboard", hint: "Classic ball card, name banner", layout: "full", face: "sports" },
  glass: { label: "Future glass", hint: "See-through sci-fi card in 3D", layout: "cutout", face: "glass" },
} as const;

export type FrameId = keyof typeof FRAMES;
export type Layout = (typeof FRAMES)[FrameId]["layout"];
export const FRAME_IDS = Object.keys(FRAMES) as FrameId[];
export const DEFAULT_FRAME: FrameId = "vintage";
export const ART_SIZES: Record<Layout, { width: number; height: number }> = {
  framed: { width: 1184, height: 816 },
  full: { width: 880, height: 1232 },
  cutout: { width: 880, height: 1232 },
};

export type Attack = { name: string; cost: number; damage: string; text: string };
export type CardText = {
  name: string;
  title: string;
  element: ElementId;
  hp: number;
  ability: { name: string; text: string } | null;
  attacks: Attack[];
  weakness: ElementId;
  resistance: ElementId | null;
  retreat: number;
  flavor: string;
  pose: string;
  scene: string;
  // The new clothes for the hero outfit. Cards from before the outfit choice have none.
  outfit?: string;
};

export function clean(value: string, max: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// Qwen3-VL looks at the photo and writes the card. It answers in JSON, read by parseCardText.
export function cardTextPrompt(input: { name: string; element: ElementId | "auto" }) {
  return [
    "You design a trading card for the person in this photo. They are the hero of the card.",
    "Look at their clothes, colors, expression, setting and anything they hold. Pick moves that fit them, with warm, playful humor. Never mock their looks, body, age or background.",
    input.name ? `The hero's name is "${input.name}". Use it as the name.` : "",
    input.element === "auto"
      ? "Pick the element from their strongest colors, clothes, setting or vibe: red or orange is fire, blue is water, green is nature, yellow is lightning, purple or pink is psychic, brown or tan is earth, black is shadow, gray or silver is metal, white or pale blue is air, gold or cream is light."
      : `Their element is "${input.element}".`,
    "Answer with JSON only, no other text, in exactly this shape:",
    `{"name": "a catchy, playful hero name of 1 to 3 words that fits their look, like 'Captain Cardigan' or 'Espresso Knight', never a plain word like 'Sage'",
 "title": "a 2 to 5 word title, like 'Midnight Code Wizard'",
 "element": one of ${ELEMENT_IDS.map((id) => `"${id}"`).join(", ")},
 "hp": a multiple of 10 from 60 to 220, most often between 80 and 160,
 "ability": {"name": "2 to 4 words", "text": "one sentence, at most 18 words"},
 "attacks": [{"name": "2 to 4 words", "cost": 1 to 4, "damage": "a number like 30, or 60+, or empty", "text": "one sentence, at most 16 words, or empty"}],
 "weakness": an element from the list,
 "resistance": an element from the list, or "none",
 "retreat": 0 to 4,
 "flavor": "one or two sentences of flavor text, at most 30 words",
 "pose": "an action pose for the illustration that does not mention clothes, 6 to 14 words",
 "scene": "a background scene for the illustration that fits the element and the person, 8 to 20 words",
 "outfit": "a new hero outfit for the illustration that fits the element and their style, 8 to 16 words, with clothes and gear only and nothing about the face, hair or beard"}`,
    "Give exactly two attacks, the second stronger than the first.",
  ].filter(Boolean).join("\n");
}

// Qwen Image Edit draws the person as the hero. The word "card" makes it draw its own frame
// around the art, and a list of face features makes it add glasses or a beard, so the prompt
// avoids both. It names only the clothes to wear, never the clothes to leave out.
// The glass card cuts the person out of the art, so its art has a plain background and no
// effects around the person.
export function artPrompt(text: CardText, style: ArtStyleId, layout: Layout, outfit: OutfitId, notes = "") {
  const cutout = layout === "cutout";
  const framing = cutout
    ? "A tall portrait composition: the whole person from head to feet, standing in the center, with room above the head and at both sides. A plain flat gray studio background with nothing else on it: no scene, no floor, no effects."
    : layout === "full"
      ? "A tall portrait composition that fills the whole picture: the person from the knees up in the center, with room above the head, and the scene behind them reaching every edge."
      : "A wide landscape composition: the person from the waist up, near the center, with the scene spreading to both sides.";
  return [
    "Turn the person in the photo into the hero of a fantasy illustration.",
    "Keep their face exactly as it is in the photo, so friends recognize them at once, with nothing added to it or removed from it. Keep their hairstyle and hair color.",
    `${text.pose.replace(/\.$/, "")}.`,
    cutout ? "" : `Background: ${text.scene.replace(/\.$/, "")}.`,
    cutout ? "" : `Surround them with ${ELEMENTS[text.element].art}.`,
    outfit === "own"
      ? "They wear the same clothes as in the photo, unchanged: the same garments, colors, patterns and fit."
      : `Dress them in a new outfit in place of the clothes in the photo: ${(text.outfit || `a heroic adventurer outfit in ${ELEMENTS[text.element].label.toLowerCase()} colors`).replace(/\.$/, "")}.`,
    notes ? `Follow these notes from the person: ${/[.!?]$/.test(notes) ? notes : `${notes}.`}` : "",
    ART_STYLES[style].prompt,
    framing,
    cutout
      ? "One person only, with a clean, sharp outline against the background. The picture is the illustration alone: no frame, no border, no ornament at the edges, no text, no letters, no logos."
      : "One person only, dramatic rim light, a rich detailed scene. The picture is the illustration alone, edge to edge: no frame, no border, no ornament at the edges, no text, no letters, no logos.",
  ].filter(Boolean).join(" ");
}

const OPPOSITE: Record<ElementId, ElementId> = {
  fire: "water", water: "lightning", nature: "fire", lightning: "earth", psychic: "shadow",
  earth: "nature", shadow: "light", metal: "fire", air: "lightning", light: "shadow",
};

const asElement = (value: unknown): ElementId | null =>
  typeof value === "string" && (ELEMENT_IDS as string[]).includes(value.toLowerCase().trim()) ? value.toLowerCase().trim() as ElementId : null;
const asText = (value: unknown, max: number) => (typeof value === "string" ? clean(value, max) : "");
const asNumber = (value: unknown) => (typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

// Reads the model's answer. It may wrap the JSON in a code fence or add words around it, and it
// may leave fields out, so every field is checked and given a safe value.
export function parseCardText(raw: string, request: { name: string; element: ElementId | "auto" }): CardText {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Qwen3-VL did not answer with card text.");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("Qwen3-VL answered with card text that is not valid JSON.");
  }
  const element = request.element !== "auto" ? request.element : asElement(data.element) ?? "light";
  const hp = asNumber(data.hp);
  const attacks = (Array.isArray(data.attacks) ? data.attacks : []).slice(0, 2).map((item, index): Attack => {
    const attack = (item ?? {}) as Record<string, unknown>;
    const cost = asNumber(attack.cost);
    const damage = asText(String(attack.damage ?? ""), 6).replace(/[^0-9+×x-]/g, "").slice(0, 4);
    return {
      name: asText(attack.name, 28) || (index === 0 ? "Quick Strike" : "Big Finish"),
      cost: Number.isFinite(cost) ? clamp(Math.round(cost), 1, 4) : index + 1,
      damage: /^\d/.test(damage) ? damage : "",
      text: asText(attack.text, 120),
    };
  });
  if (!attacks.length) attacks.push({ name: "Quick Strike", cost: 1, damage: "30", text: "" });
  const ability = (data.ability ?? null) as Record<string, unknown> | null;
  const abilityName = ability ? asText(ability.name, 28) : "";
  const weakness = asElement(data.weakness);
  const resistance = asElement(data.resistance);
  const retreat = asNumber(data.retreat);
  return {
    name: request.name || asText(data.name, MAX_NAME) || "Mystery Hero",
    title: asText(data.title, 40),
    element,
    hp: Number.isFinite(hp) ? clamp(Math.round(hp / 10) * 10, 30, 250) : 120,
    ability: abilityName ? { name: abilityName, text: asText(ability?.text, 120) } : null,
    attacks,
    weakness: weakness && weakness !== element ? weakness : OPPOSITE[element],
    resistance: resistance && resistance !== element ? resistance : null,
    retreat: Number.isFinite(retreat) ? clamp(Math.round(retreat), 0, 4) : 1,
    flavor: asText(data.flavor, 200),
    pose: asText(data.pose, 160) || "Striking a confident hero pose",
    scene: asText(data.scene, 200) || `A dramatic landscape full of ${ELEMENTS[element].art}`,
    outfit: asText(data.outfit, 160),
  };
}
