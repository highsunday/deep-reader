/** Shared limits and validation for reading and video conversation images. */
export const BOOK_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_DATA_URL_MAX_LENGTH = 7_000_000;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseChatImages(value: unknown, label: "book" | "reader", maxCount: number | undefined, maxBytes: number): Array<{ dataUrl: string }> {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label} images.`);
  if (maxCount !== undefined && value.length > maxCount) throw new Error(`每則訊息最多 ${maxCount} 張圖片。`);
  let totalBytes = 0;
  return value.map(image => {
    if (!object(image) || typeof image.dataUrl !== "string" || image.dataUrl.length > IMAGE_DATA_URL_MAX_LENGTH) {
      throw new Error(`Invalid or oversized ${label} image.`);
    }
    const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if (!match || match[2]!.length % 4 !== 0) {
      throw new Error(`Unsupported or invalid ${label} image. Use PNG, JPEG, WebP, or GIF.`);
    }
    const bytes = atob(match[2]!);
    if (!bytes.length || bytes.length > IMAGE_MAX_BYTES || btoa(bytes) !== match[2]) {
      throw new Error(`Invalid or oversized ${label} image.`);
    }
    const mime = match[1];
    const valid = mime === "png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes.charCodeAt(i) === byte)
      : mime === "jpeg" ? bytes.length >= 3 && bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216 && bytes.charCodeAt(2) === 255
      : mime === "webp" ? bytes.slice(0, 4) === "RIFF" && bytes.slice(8, 12) === "WEBP"
      : bytes.slice(0, 6) === "GIF87a" || bytes.slice(0, 6) === "GIF89a";
    if (!valid) throw new Error(`Invalid ${label} image data.`);
    totalBytes += bytes.length;
    if (totalBytes > maxBytes) throw new Error(`Too many ${label} image bytes.`);
    return { dataUrl: image.dataUrl };
  });
}
