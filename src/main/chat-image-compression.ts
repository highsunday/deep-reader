interface DecodedChatImage {
  isEmpty(): boolean;
  toBitmap(): Buffer;
  getSize(): { width: number; height: number };
  resize(options: { width: number; quality: "best" }): DecodedChatImage;
  toJPEG(quality: number): Buffer;
}

/** Compress wire attachments only; originals remain available for reading and notes. */
export function createChatImageCompressor(
  decode: (dataUrl: string) => DecodedChatImage
): (dataUrl: string) => string {
  return dataUrl => {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match) return dataUrl;
    const originalBytes = Buffer.byteLength(match[2]!, "base64");
    if (originalBytes <= 512 * 1024) return dataUrl;
    try {
      const image = decode(dataUrl);
      if (image.isEmpty()) return dataUrl;
      // JPEG cannot preserve transparency. Electron bitmaps store alpha in byte 4.
      const bitmap = image.toBitmap();
      if (!bitmap.length || bitmap.length % 4 !== 0) return dataUrl;
      for (let offset = 3; offset < bitmap.length; offset += 4) {
        if (bitmap[offset] !== 255) return dataUrl;
      }
      // Use the measured compromise for dense book figures; never upscale.
      const encodedImage = image.getSize().width > 1600
        ? image.resize({ width: 1600, quality: "best" })
        : image;
      const jpeg = encodedImage.toJPEG(80);
      if (!jpeg.length || jpeg.length >= originalBytes) return dataUrl;
      return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    } catch {
      return dataUrl;
    }
  };
}
