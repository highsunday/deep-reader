import { IMAGE_DATA_URL_MAX_LENGTH, IMAGE_MAX_BYTES } from '../shared/chat-images';

/** SVG is decoded as an inert image document, never inserted into the page DOM. */
export async function rasterizeBookSvg(dataUrl: string): Promise<string> {
  if (dataUrl.length > IMAGE_DATA_URL_MAX_LENGTH ||
    !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) {
    throw new Error('書內 SVG 公式格式無效或過大，無法提供給 AI。');
  }
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { image.src = ''; reject(new Error('書內 SVG 公式轉換逾時，請重試。')); }, 10000);
    image.onload = () => { clearTimeout(timer); resolve(); };
    image.onerror = () => { clearTimeout(timer); reject(new Error('無法讀取書內 SVG 公式，請檢查圖片是否損壞。')); };
    image.src = dataUrl;
  });
  if (!image.naturalWidth || !image.naturalHeight) throw new Error('書內 SVG 公式沒有有效尺寸。');
  const canvas = document.createElement('canvas');
  // Render small vector glyphs with enough resolution for vision, bounded in memory.
  let scale = Math.min(4, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  for (let attempt = 0; attempt < 4; attempt++, scale *= .7) {
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('無法轉換書內 SVG 公式。');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png');
    if (png.startsWith('data:image/png;base64,') && (png.length - 22) * .75 <= IMAGE_MAX_BYTES) return png;
  }
  throw new Error('書內 SVG 公式轉換後仍過大，請縮小閱讀範圍。');
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Convert only source image slots of supported IPC requests; preserve input and numbering. */
export async function prepareBookImagesForIpc<T>(input: T, rasterize = rasterizeBookSvg): Promise<T> {
  if (!record(input)) return input;
  const cache = new Map<string, string>();
  const convert = async (container: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (!Array.isArray(container.images)) return container;
    const images: unknown[] = [];
    // Sequential conversion bounds peak canvas memory for formula-heavy chapters.
    for (const image of container.images) {
      if (!record(image) || typeof image.dataUrl !== 'string' || !image.dataUrl.startsWith('data:image/svg+xml;')) {
        images.push(image);
        continue;
      }
      let dataUrl = cache.get(image.dataUrl);
      if (!dataUrl) {
        dataUrl = await rasterize(image.dataUrl);
        cache.set(image.dataUrl, dataUrl);
      }
      images.push({ ...image, dataUrl });
    }
    return { ...container, images };
  };
  const result = await convert(input);
  const output = { ...result };
  for (const key of ['context', 'source']) {
    if (record(output[key])) output[key] = await convert(output[key]);
  }
  return output as T;
}
