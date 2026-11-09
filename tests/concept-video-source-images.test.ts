// @vitest-environment jsdom
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { extractReadingSegmentWithImages } from '../src/renderer/reading-range';
import { registerConceptVideoIpc } from '../src/main/concept-video-ipc';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { parseVideoSource, type ConceptVideo } from '../src/shared/concept-video';

function png(bytes: number, index = 0): string {
  const data = Buffer.alloc(bytes);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
  if (bytes > 8) data[8] = index;
  return `data:image/png;base64,${data.toString('base64')}`;
}

const source = { bookId: 'b', chapterId: 'c', bookTitle: 'Robot control', chapterTitle: 'Control law', range: { start: 0, end: 32 }, readingSegment: 'Equations', images: [] };

test('B63 large original source creates a video and preserves original images across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'video-large-source-'));
  try {
    const images = Array.from({ length: 16 }, (_, i) => ({
      dataUrl: png(2 * 1024 * 1024, i)
    }));
    const largeSource = { ...source, images, readingSegment: images.map((_, i) => `[Book image ${i + 1}]`).join('\n') };
    const store = new LocalConceptVideoStore(directory);
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const trusted = {};
    registerConceptVideoIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, store, {
      trusted: event => event === trusted, sourceExists: async () => true, getMessages: () => []
    });
    const video = await handlers.get('concept-videos:create')!(trusted, { source: largeSource, question: 'Explain the two methods', engine: 'remotion' }) as ConceptVideo;
    expect(video.source).toEqual(largeSource);
    expect(new LocalConceptVideoStore(directory).get(video.id).source).toEqual(largeSource);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('equation-heavy reading segment creates a video through IPC and preserves all image markers across restart', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'video-source-images-'));
  try {
    const article = document.createElement('article');
    const images = Array.from({ length: 32 }, (_, i) => ({ dataUrl: png(32, i) }));
    article.innerHTML = images.map(image => `<span>x<img src="${image.dataUrl}"></span>`).join('');
    const extracted = extractReadingSegmentWithImages(article, source.range);
    expect(extracted.images).toEqual(images);
    const store = new LocalConceptVideoStore(directory);
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const trusted = {};
    registerConceptVideoIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, store, {
      trusted: event => event === trusted, sourceExists: async () => true, getMessages: () => []
    });
    const video = await handlers.get('concept-videos:create')!(trusted, { source: { ...source, ...extracted }, question: 'Explain stability', engine: 'remotion' }) as ConceptVideo;
    expect(video.source).toEqual({ ...source, ...extracted });
    expect(video.source.readingSegment).toContain('[Book image 32]');
    expect(new LocalConceptVideoStore(directory).get(video.id).source).toEqual(video.source);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('B63 source snapshots preserve aggregate originals while keeping per-image validation', () => {
  const exact = Array.from({ length: 4 }, (_, i) => ({ dataUrl: png(5 * 1024 * 1024, i) }));
  expect(parseVideoSource({ ...source, images: exact }).images).toEqual(exact);
  expect(parseVideoSource({ ...source, images: [...exact, { dataUrl: png(8) }] }).images).toHaveLength(5);
  expect(() => parseVideoSource({ ...source, images: [{ dataUrl: png(5 * 1024 * 1024 + 1) }] })).toThrow();
});

test('video source still rejects malformed image payloads', () => {
  expect(() => parseVideoSource({ ...source, images: null })).toThrow(/images/i);
  expect(() => parseVideoSource({ ...source, images: [{ dataUrl: '/private/formula.png' }] })).toThrow(/image/i);
  expect(() => parseVideoSource({ ...source, images: [{ dataUrl: 'data:image/png;base64,AAAA' }] })).toThrow(/image/i);
  expect(() => parseVideoSource({ ...source, images: [{ dataUrl: 'data:image/png;base64,iVBORw0KGgp=' }] })).toThrow(/image/i);
});
