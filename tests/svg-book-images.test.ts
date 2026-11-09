import { expect, test, vi } from 'vitest';
import { prepareBookImagesForIpc } from '../src/preload/svg-book-images';
import { BOOK_IMAGE_MAX_BYTES, parseChatImages } from '../src/shared/chat-images';
const svg = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');
const png = 'data:image/png;base64,iVBORw0KGgo=';
test('B79 TC1/2 converts SVG at all book-image request locations, retaining ordering and input', async () => {
  const input = { text: 'question', context: { readingSegment: '[Book image 1] [Book image 2]', images: [{ dataUrl: svg }, { dataUrl: png }] }, source: { images: [{ dataUrl: svg }] }, images: [{ dataUrl: svg }] };
  expect(() => parseChatImages(input.context.images, 'book', undefined, BOOK_IMAGE_MAX_BYTES)).toThrow('Unsupported or invalid book image');
  const original = structuredClone(input);
  const rasterize = vi.fn(async () => png);
  const result = await prepareBookImagesForIpc(input, rasterize);
  expect(rasterize).toHaveBeenCalledTimes(1);
  expect(input).toEqual(original);
  expect(result.context.readingSegment).toBe(input.context.readingSegment);
  expect(result.context.images).toEqual([{ dataUrl: png }, { dataUrl: png }]);
  expect(result.source.images[0].dataUrl).toBe(png);
  expect(result.images[0].dataUrl).toBe(png);
  expect(parseChatImages(result.context.images, 'book', undefined, BOOK_IMAGE_MAX_BYTES)).toHaveLength(2);
});
test('B79 TC3 keeps no-image and raster-only requests intact', async () => {
  const rasterize = vi.fn();
  expect(await prepareBookImagesForIpc({ text: 'hello' }, rasterize)).toEqual({ text: 'hello' });
  expect(await prepareBookImagesForIpc({ images: [{ dataUrl: png }] }, rasterize)).toEqual({ images: [{ dataUrl: png }] });
  expect(rasterize).not.toHaveBeenCalled();
});
test('B79 TC3 rejects failed conversion without changing original or silently dropping image', async () => {
  const input = { context: { images: [{ dataUrl: svg }] } };
  await expect(prepareBookImagesForIpc(input, async () => { throw Error('SVG conversion failed'); })).rejects.toThrow('SVG conversion failed');
  expect(input.context.images[0].dataUrl).toBe(svg);
});
