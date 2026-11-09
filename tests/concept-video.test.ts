import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
const modules = import.meta.glob('../src/main/concept-video-store.ts');
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
const source = { bookId: 'b1', chapterId: 'c1', bookTitle: '微積分', chapterTitle: '導數', range: { start: 2, end: 30 }, readingSegment: '兩點逐漸靠近，割線斜率趨近切線斜率。', images: [] };
async function setup(options = {}) {
  const loader = modules['../src/main/concept-video-store.ts'];
  expect(loader, 'F53 needs an independent persistent video store').toBeTypeOf('function');
  const { LocalConceptVideoStore } = await loader!() as typeof import('../src/main/concept-video-store');
  const directory = mkdtempSync(join(tmpdir(), 'f53-')); directories.push(directory);
  return { store: new LocalConceptVideoStore(directory, options), directory, LocalConceptVideoStore };
}
test('TC02/03/04/16: first reader requirement persists an immutable source independently across restart', async () => {
  const { store, directory, LocalConceptVideoStore } = await setup();
  expect(store.list()).toEqual([]);
  expect(() => store.create({ source: { ...source, range: { start: 2, end: 2 } }, question: '為什麼？' })).toThrow();
  const original = structuredClone(source);
  const video = store.create({ source: original, question: '斜率如何改變？' });
  original.readingSegment = '別本書';
  expect(video.source.readingSegment).toBe(source.readingSegment);
  expect(new LocalConceptVideoStore(directory).get(video.id)).toEqual(video);
  expect(video.discussion).toMatchObject([{ role: 'user', text: '斜率如何改變？' }]);
  expect(video.status).toBe('draft');
});
test('TC06/09/17: manual edits commit atomically, stale edits preserve a recoverable copy', async () => {
  const { store, directory, LocalConceptVideoStore } = await setup();
  const initial = store.create({ source, question: '看不懂斜率' });
  const otherWindow = new LocalConceptVideoStore(directory);
  const updated = store.save({ id: initial.id, baseRevision: initial.revision, plan: { ...initial.plan, title: '斜率的變化' } });
  expect(updated.revision).toBe(2);
  expect(() => otherWindow.save({ id: initial.id, baseRevision: 1, plan: { ...initial.plan, title: '另一個想法' } })).toThrow(/conflict/i);
  expect(store.get(initial.id).plan.title).toBe('斜率的變化');
  expect(store.get(initial.id).conflicts[0].plan?.title).toBe('另一個想法');
  const fail = new LocalConceptVideoStore(directory, { write: () => { throw new Error('磁碟已滿'); } });
  const revision = store.get(initial.id).revision;
  expect(() => fail.save({ id: initial.id, baseRevision: revision, plan: { ...updated.plan, title: '未保存' } })).toThrow(/磁碟/);
  expect(new LocalConceptVideoStore(directory).get(initial.id).plan.title).toBe('斜率的變化');
});
test('TC14/21: filter by stable book ID, search goal, and show drafts without fake completed media', async () => {
  const { store } = await setup();
  const a = store.create({ source, question: '看懂變化' });
  store.create({ source: { ...source, bookId: 'b2' }, question: '同名書的另一問題' });
  expect(store.list({ bookId: 'b1', search: ' 看懂 ' })).toHaveLength(1);
  expect(store.list({ status: 'completed' })).toEqual([]);
  expect(store.list({ status: 'draft' })).toHaveLength(2);
  store.remove({ id: a.id, baseRevision: a.revision });
  expect(store.list()).toHaveLength(1);
});
test('TC18: discussion and generate requests are blocked by hard billing policy, without making AI calls', async () => {
  const { store } = await setup();
  const a = store.create({ source, question: '我想理解導數' });
  expect(store.capability()).toMatchObject({ aiAllowed: false, generationAllowed: false });
  expect(() => store.requestAi({ id: a.id, operation: 'discuss' })).toThrow(/unavailable/);
  expect(() => store.requestAi({ id: a.id, operation: 'generate' })).toThrow(/unavailable/);
  expect(store.get(a.id)).toEqual(a);
});
test('TC09: malformed storage is preserved and never overwritten', async () => {
  const { store, directory, LocalConceptVideoStore } = await setup();
  store.create({ source, question: '問題' });
  const path = join(directory, 'concept-videos.json');
  writeFileSync(path, '{broken');
  expect(() => new LocalConceptVideoStore(directory).create({ source, question: '新問題' })).toThrow(/original data/);
  expect(readFileSync(path, 'utf8')).toBe('{broken');
});

test('TC03/16: source image bytes survive restart and arbitrary paths or invalid expanded ranges are rejected', async () => {
  const { store, directory, LocalConceptVideoStore } = await setup();
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const video = store.create({ source: { ...source, images: [{ dataUrl: image }] }, question: '圖片裡的公式' });
  expect(new LocalConceptVideoStore(directory).get(video.id).source.images).toEqual([{ dataUrl: image }]);
  expect(() => store.create({ source: { ...source, images: [{ dataUrl: '/private/user/image.png' }] }, question: '問題' })).toThrow(/image/);
  expect(() => store.create({ source: { ...source, contextRange: { start: 3, end: 40 } }, question: '問題' })).toThrow(/boundaries/);
});

test('saved video cover reads only the selected version preview', async () => {
  const { store, LocalConceptVideoStore, directory: libraryDirectory } = await setup();
  const draft = store.create({ source, question: '理解斜率' });
  const running = store.startGeneration({ id: draft.id, baseRevision: draft.revision });
  const versionId = '11111111-1111-4111-8111-111111111111';
  store.finishGeneration(draft.id, running.generation!.id, { status: 'completed', stage: 'Video generated', version: { id: versionId, createdAt: 1, plan: draft.plan, durationSeconds: 5, bytes: 8, scenes: [{ id: draft.plan.scenes[0].id, start: 0, end: 5 }] } });
  const directory = store.artifactDirectory(draft.id, versionId);
  mkdirSync(directory, { recursive: true });
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
  writeFileSync(join(directory, 'preview-1.png'), png);
  const [saved] = store.list();
  const parse = vi.spyOn(JSON, 'parse');
  try {
    expect(store.readPoster({ id: draft.id, versionId })).toEqual(png);
    expect(parse).not.toHaveBeenCalled();
  } finally { parse.mockRestore(); }
  expect(() => store.readPoster({ id: draft.id, versionId: '../../private' })).toThrow(/version/);
  writeFileSync(join(directory, 'preview-1.png'), 'invalid');
  expect(() => store.readPoster({ id: draft.id, versionId })).toThrow(/cover/);
  new LocalConceptVideoStore(libraryDirectory).remove({ id: draft.id, baseRevision: saved.revision });
  expect(() => store.readPoster({ id: draft.id, versionId })).toThrow(/not found/i);
});


test('B64: unchanged polling skips image loading; external writes and deletion invalidate the token', async () => {
  const { store, directory, LocalConceptVideoStore } = await setup();
  const empty = store.poll();
  expect(empty.videos).toEqual([]);
  const other = new LocalConceptVideoStore(directory);
  const created = other.create({ source: { ...source, images: [{ dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }] }, question: '比較' });
  const list = vi.spyOn(store, 'list');
  const first = store.poll(empty.token);
  expect(first.videos).toEqual([created]);
  for (let i = 0; i < 10; i++) expect(store.poll(first.token)).toEqual({ token: first.token });
  expect(list).toHaveBeenCalledTimes(1);
  const updated = other.append({ id: created.id, baseRevision: created.revision, question: '再解釋' });
  const changed = store.poll(first.token);
  expect(changed.videos).toEqual([updated]);
  other.remove({ id: updated.id, baseRevision: updated.revision });
  const removed = store.poll(changed.token);
  expect(removed.videos).toEqual([]);
  expect(store.poll(removed.token)).toEqual({ token: removed.token });
});
