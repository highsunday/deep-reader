import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
const loaders = import.meta.glob('../src/main/concept-video-generator.ts');
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
async function setup(render?: import('../src/main/concept-video-generator').VideoRenderOptions['render'], options: ConstructorParameters<typeof LocalConceptVideoStore>[1] = {}, capability: import('../src/main/concept-video-generator').VideoRenderOptions['capability'] = async () => ({ generationAllowed: true, narrationAllowed: true, reason: '' })) {
  const directory = mkdtempSync(join(tmpdir(), 'f53-generation-')); directories.push(directory);
  const store = new LocalConceptVideoStore(directory, options);
  const created = store.create({ source: { bookId: 'b1', chapterId: 'c1', bookTitle: '書', chapterTitle: '章', range: { start: 0, end: 5 }, readingSegment: '明確的來源快照', images: [] }, question: '看懂流程' });
  const video = store.save({ id: created.id, baseRevision: created.revision, plan: { ...created.plan, scenes: [{ ...created.plan.scenes[0], visual: '依序連結概念' }] } });
  const loader = loaders['../src/main/concept-video-generator.ts']; expect(loader, 'needs a local generation controller').toBeTypeOf('function');
  const { ConceptVideoGenerator } = await loader!() as typeof import('../src/main/concept-video-generator');
  const output = { durationSeconds: 5, bytes: 100, scenes: [{ id: video.plan.scenes[0].id, start: 0, end: 5 }] };
  const generator = new ConceptVideoGenerator(store, { capability, render: render ?? vi.fn(async () => output) });
  return { store, video, generator, directory, output };
}
test('TC07/11/13: local generation persists versions, preserves adopted version, and restarts offline', async () => {
  const { store, video, generator, directory } = await setup();
  await generator.generate({ id: video.id, baseRevision: video.revision }); await generator.waitForIdle();
  const first = store.get(video.id); expect(first.status).toBe('completed'); expect(first.versions).toHaveLength(1); expect(first.currentVersionId).toBe(first.versions[0].id);
  await generator.generate({ id: first.id, baseRevision: first.revision }); await generator.waitForIdle();
  const second = store.get(first.id); expect(second.versions).toHaveLength(2); expect(second.currentVersionId).toBe(first.currentVersionId);
  const adopted = store.adopt({ id: second.id, baseRevision: second.revision, versionId: second.versions[1].id });
  expect(new LocalConceptVideoStore(directory).get(video.id).currentVersionId).toBe(adopted.currentVersionId);
  expect(store.list({ status: 'completed' })).toHaveLength(1); expect(store.list({ status: 'draft' })).toHaveLength(0);
});
test('TC07/08: duplicate job and stale edit rejected; cancellation ignores late render success', async () => {
  let resolve!: (value: any) => void;
  const { store, video, generator, output } = await setup(async () => new Promise(r => { resolve = r; }));
  await generator.generate({ id: video.id, baseRevision: video.revision });
  await expect(generator.generate({ id: video.id, baseRevision: store.get(video.id).revision })).rejects.toThrow(/generat/i);
  expect(() => store.save({ id: video.id, baseRevision: store.get(video.id).revision, plan: video.plan })).toThrow(/generat/i);
  await generator.cancel(video.id); resolve(output); await generator.waitForIdle();
  expect(store.get(video.id).generation!.status).toBe('cancelled'); expect(store.get(video.id).versions).toHaveLength(0);
});
test('TC09/10/19: failed render retains draft; restarting marks an unfinished job interrupted', async () => {
  const { store, video, generator, directory } = await setup(async () => { throw Error('編碼失敗'); });
  await generator.generate({ id: video.id, baseRevision: video.revision }); await generator.waitForIdle();
  expect(store.get(video.id).generation).toMatchObject({ status: 'failed', error: '編碼失敗' }); expect(store.get(video.id).plan).toEqual(video.plan);
  const pending = store.startGeneration({ id: video.id, baseRevision: store.get(video.id).revision });
  store.interruptGenerations(); expect(new LocalConceptVideoStore(directory).get(pending.id).generation!.status).toBe('interrupted');
});
test('TC09: failed version persistence reports not saved instead of leaving UI generating forever', async () => {
  let diskFull = false;
  const { store, video, generator } = await setup(async video => { diskFull = true; return { durationSeconds: 5, bytes: 100, scenes: [{ id: video.plan.scenes[0].id, start: 0, end: 5 }] }; }, { write: (path, data) => { if (diskFull) throw Error('磁碟已滿'); writeFileSync(path, data); } });
  await generator.generate({ id: video.id, baseRevision: video.revision }); await generator.waitForIdle();
  expect(generator.get(video.id).generation).toMatchObject({ status: 'failed', stage: 'Not saved. Reload and try again.' });
  expect(generator.get(video.id).generation?.error).toContain('磁碟已滿'); expect(store.get(video.id).versions).toHaveLength(0);
});
test('TC19: missing local renderer or narration does not create a job or fall back to AI', async () => {
  let generationAllowed = false;
  const { store, video, generator } = await setup(undefined, {}, async () => ({ generationAllowed, narrationAllowed: false, reason: generationAllowed ? '缺少中文旁白' : '缺少 FFmpeg' }));
  await expect(generator.generate({ id: video.id, baseRevision: video.revision })).rejects.toThrow('缺少 FFmpeg');
  expect(store.get(video.id).generation).toBeUndefined();
  generationAllowed = true;
  await expect(generator.generate({ id: video.id, baseRevision: video.revision })).rejects.toThrow('缺少中文旁白');
  expect(store.get(video.id).generation).toBeUndefined();
});

test('B55 TC1/2: preparation is a durable background job and cancellation rejects late preparation', async () => {
  let finish!: (video: any) => void;
  const render = vi.fn(async () => ({ durationSeconds: 5, bytes: 100, scenes: [] }));
  const { store, video, generator } = await setup(render);
  const prepare = vi.fn((_video: any, signal: AbortSignal) => new Promise<any>(resolve => { finish = resolve; expect(signal.aborted).toBe(false); }));
  const running = await (generator.generate as any)({ id: video.id, baseRevision: video.revision }, prepare);
  expect(running.generation).toMatchObject({ status: 'running', stage: 'Codex is designing the animation…' });
  expect(generator.list()[0].generation?.status).toBe('running');
  expect(render).not.toHaveBeenCalled();
  await generator.cancel(video.id);
  finish(running);
  await generator.waitForIdle();
  expect(render).not.toHaveBeenCalled();
  expect(store.get(video.id).generation?.status).toBe('cancelled');
  expect(store.get(video.id).versions).toHaveLength(0);
});

test('B55 TC2: preparation failure persists and restart interrupts preparation', async () => {
  const { store, video, generator } = await setup();
  await (generator.generate as any)({ id: video.id, baseRevision: video.revision }, async () => { throw Error('AI preparation failed'); });
  await generator.waitForIdle();
  expect(store.get(video.id).generation).toMatchObject({ status: 'failed', error: 'AI preparation failed' });
});

test('B55 TC2: a saved preparation becomes interrupted after restart and rejects a stale program', async () => {
  const { store, video } = await setup();
  const running = store.startGeneration({ id: video.id, baseRevision: video.revision }, 'Codex is designing the animation…');
  store.interruptGenerations();
  expect(store.get(video.id).generation?.status).toBe('interrupted');
  expect(() => store.updateGeneration(video.id, running.generation!.id, 'Rendering')).toThrow(/stopped/);
});


test('B64: polling detects an unsaved terminal overlay without a disk revision change', async () => {
  let finish!: (value: any) => void, diskFull = false;
  const { store, video, generator, output } = await setup(async () => new Promise(resolve => { finish = resolve; }), {
    write: (path, data) => { if (diskFull) throw Error('磁碟已滿'); writeFileSync(path, data); }
  });
  await generator.generate({ id: video.id, baseRevision: video.revision });
  const running = generator.poll();
  expect(running.videos![0].generation?.status).toBe('running');
  expect(generator.poll(running.token)).toEqual({ token: running.token });
  diskFull = true; finish(output); await generator.waitForIdle();
  const failed = generator.poll(running.token);
  expect(failed.token).not.toBe(running.token);
  expect(failed.videos![0].revision).toBe(running.videos![0].revision);
  expect(failed.videos![0].generation?.status).toBe('failed');
  expect(store.get(video.id).generation?.status).toBe('running');
  expect(generator.poll(failed.token)).toEqual({ token: failed.token });
});
