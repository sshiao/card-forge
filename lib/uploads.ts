export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export function readImage(value: FormDataEntryValue | null, what: string): File {
  if (!(value instanceof File) || value.size === 0) throw new Error(`Choose ${what}.`);
  if (!IMAGE_TYPES.includes(value.type)) throw new Error(`Use a PNG, JPEG or WebP for ${what}.`);
  if (value.size > MAX_IMAGE_BYTES) throw new Error(`Keep ${what} under 20 MB.`);
  return value;
}
