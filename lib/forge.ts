// The character design rules: styles, the canonical prompt, and the limits of a request.

export const MAX_NAME = 40;
export const MAX_DESCRIPTION = 400;
export const MAX_NOTES = 300;

export const STYLES = {
  animated: {
    label: "3D animated",
    hint: "Soft, rounded, made for 3D",
    prompt: "Render the character as a stylized 3D animated feature character: clean shapes, soft rounded forms, smooth materials, slightly exaggerated proportions.",
  },
  anime: {
    label: "Anime",
    hint: "Cel-shaded hero",
    prompt: "Render the character in a clean anime style: cel shading, crisp outlines, bold flat colors, expressive eyes.",
  },
  painted: {
    label: "Fantasy game",
    hint: "Hand-painted RPG art",
    prompt: "Render the character as hand-painted fantasy game art: painterly textures, rich costume details, readable shapes.",
  },
  photo: {
    label: "As photographed",
    hint: "Keep the photo's look",
    prompt: "Keep the realistic photographic style of the reference.",
  },
} as const;

export type StyleId = keyof typeof STYLES;

// The face pass runs by itself only for photos. Other styles can add it from the viewer.
export const facePassByDefault = (style: StyleId) => style === "photo";
export const STYLE_IDS = Object.keys(STYLES) as StyleId[];
export const DEFAULT_STYLE: StyleId = "animated";

// TripoSplat sees one image. A full body in a neutral pose, with nothing in front of it
// and an even light, gives it the most to rebuild. A character in costume tends to turn into the
// better-known character it dresses as, so the prompt keeps the wearer. The person's notes from
// "Draw two more" come right after, so they can correct what the last two designs got wrong.
export function canonicalPrompt(style: StyleId, notes = "") {
  return [
    "Create a full-body standing reference of the same character. Preserve the facial identity, hair, defining features and outfit of the reference.",
    "Keep the character's own species, face and body shape, with any animal ears, tail, fur and markings. A costume stays a costume: never replace the character with the one it dresses as.",
    notes ? `Follow these notes from the person who made the character: ${/[.!?]$/.test(notes) ? notes : `${notes}.`}` : "",
    STYLES[style].prompt,
    "Neutral A-pose, facing directly forward, looking at the camera, arms slightly away from the body, both feet fully visible, the whole body in frame with a small margin.",
    "One character only, a clear silhouette, a flat light gray studio background, even diffuse lighting, no cast shadows, orthographic-like camera at chest height, nothing covering the body, no crop, no text.",
  ].filter(Boolean).join(" ");
}

// The face pass: image 1 is the portrait and carries the identity, image 2 is the approved design.
// The face fills the frame, so TripoSplat sees it at full resolution. The prompt describes a human
// face, and Qwen follows it even when both images show an animal, so the pass runs by itself only
// for the "As photographed" style.
export function headshotPrompt(style: StyleId) {
  return [
    "Head and shoulders close-up of the character in image 2, facing the camera directly, eyes looking at the camera, a neutral relaxed expression.",
    "Give the character the face of image 1 with every facial feature: the same face shape, eyes, eyebrows, nose, mouth, skin tone, freckles, marks and wrinkles, any beard, mustache or stubble, any glasses, makeup and piercings, and the same hair color and hairline.",
    "Keep the hairstyle, headwear, collar and art style of image 2.",
    STYLES[style].prompt,
    "Frame it like a passport photo taken from a little farther back: the whole head and all of the hair inside the frame, with clear empty space above the top of the hair and beside the hair, and the frame ending at mid-chest.",
    "A flat light gray studio background, soft even light, no cast shadows, no hands, no text.",
  ].join(" ");
}

// A described character gets a portrait first, so it goes through the same steps as an uploaded one.
export function portraitPrompt(description: string, style: StyleId) {
  return [
    `Character portrait of ${description}.`,
    STYLES[style].prompt,
    "Head and shoulders, facing the camera, a neutral expression, a plain light gray background, soft even studio light, sharp focus, no text.",
  ].join(" ");
}

export function clean(value: string, max: number) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
