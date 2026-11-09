import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { LocalWhiteboardStore } from '../src/main/whiteboard-store';
const modules = import.meta.glob('../src/main/whiteboard-store.ts');
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
async function setup() {
  const loader = modules['../src/main/whiteboard-store.ts'];
  expect(loader, 'F43 must provide a persistent whiteboard store').toBeTypeOf('function');
  const { LocalWhiteboardStore: Store } = await loader() as { LocalWhiteboardStore: typeof LocalWhiteboardStore };
  const directory = mkdtempSync(join(tmpdir(), 'f43-')); directories.push(directory);
  const notes = new Map<string, { id: string; trashedAt?: number }>([['n1', { id: 'n1' }], ['n2', { id: 'n2' }]]);
  let time = 1;
  const store = new Store(directory, { getNote: id => notes.get(id), now: () => time++ });
  return { Store, store, directory, notes };
}
test('TC1–3: create, search, rename and remove boards without deleting notes', async () => {
  const { store, notes } = await setup();
  expect(() => store.create('  ')).toThrow();
  const a = store.create('  Systems 系統  '), b = store.create('Learning');
  expect(store.list(' SYSTEMS ').map(x => x.id)).toEqual([a.id]);
  expect(store.list().map(x => x.id)).toEqual([b.id, a.id]);
  store.save({ ...a, baseRevision: a.revision, title: 'New title' });
  expect(store.list()[0].title).toBe('New title');
  store.remove(a.id); expect(store.list()).toHaveLength(1); expect(notes.size).toBe(2);
});
test('TC4,7,9,11,13: persist graph and viewport, references shared across boards', async () => {
  const { store, Store, directory, notes } = await setup();
  const a = store.create('A'), b = store.create('B');
  const graph = { notes: [{ id: 'p1', noteId: 'n1', x: 10, y: 20 }, { id: 'p2', noteId: 'n2', x: 400, y: 100 }], texts: [{ id: 't1', text: '<b>Reason</b>\nSecond line', x: -10, y: 0 }], edges: [{ id: 'e1', source: 'p1', target: 'p2', label: 'causes', arrow: true }], viewport: { x: -120, y: 50, zoom: 0.5 } };
  const saved = store.save({ ...a, ...graph, baseRevision: a.revision });
  store.save({ ...b, notes: [graph.notes[0]], baseRevision: b.revision });
  const restored = new Store(directory, { getNote: id => notes.get(id) });
  expect(restored.get(a.id)).toEqual(saved);
  store.save({ ...saved, notes: [graph.notes[1]], edges: [], baseRevision: saved.revision });
  expect(store.get(b.id).notes[0].noteId).toBe('n1'); expect(notes.has('n1')).toBe(true);
});
test('TC8: reject stale revisions, invalid geometry and invalid graph references', async () => {
  const { store } = await setup(); const a = store.create('A');
  for (const patch of [
    { viewport: { x: NaN, y: 0, zoom: 1 } },
    { viewport: { x: 0, y: 0, zoom: 0 } },
    { notes: [{ id: 'p', noteId: 'missing', x: 0, y: 0 }] },
    { notes: [{ id: 'p', noteId: 'n1', x: 0, y: 0 }, { id: 'q', noteId: 'n1', x: 0, y: 0 }] },
    { edges: [{ id: 'e', source: 'x', target: 'x', label: '', arrow: false }] }
  ]) expect(() => store.save({ ...a, ...patch, baseRevision: a.revision })).toThrow();
  store.save({ ...a, baseRevision: a.revision });
  expect(() => store.save({ ...a, baseRevision: a.revision })).toThrow(/changed|version/i);
});
test('TC10,12: store only references, permit existing unavailable notes but reject new ones', async () => {
  const { store, notes, directory } = await setup();
  let a = store.create('A'); a = store.save({ ...a, baseRevision: a.revision, notes: [{ id: 'p', noteId: 'n1', x: 0, y: 0 }] });
  notes.set('n1', { id: 'n1', trashedAt: 4 });
  a = store.save({ ...a, baseRevision: a.revision, title: 'Renamed' });
  const b = store.create('B');
  expect(() => store.save({ ...b, baseRevision: b.revision, notes: a.notes })).toThrow(/unavailable/i);
  notes.delete('n1'); expect(store.save({ ...a, baseRevision: a.revision }).notes).toEqual(a.notes);
  expect(readFileSync(join(directory, 'whiteboards.json'), 'utf8')).not.toContain('trashedAt');
});
test('TC14: corrupt files and failed writes preserve committed state and original bytes', async () => {
  const { store, Store, directory, notes } = await setup(); const a = store.create('A');
  const failing = new Store(directory, { getNote: id => notes.get(id), write: () => { throw new Error('disk full'); } });
  const before = readFileSync(join(directory, 'whiteboards.json'), 'utf8');
  expect(() => failing.save({ ...a, title: 'Lost', baseRevision: a.revision })).toThrow('disk full');
  expect(failing.get(a.id)).toEqual(a); expect(readFileSync(join(directory, 'whiteboards.json'), 'utf8')).toBe(before);
  writeFileSync(join(directory, 'whiteboards.json'), '{broken');
  const corrupt = new Store(directory, { getNote: id => notes.get(id) });
  expect(() => corrupt.list()).toThrow(/read|data/i); expect(() => corrupt.create('Overwrite')).toThrow();
  expect(readFileSync(join(directory, 'whiteboards.json'), 'utf8')).toBe('{broken');
});

test('TC7: connection sides persist, legacy edges load, and invalid sides are rejected', async () => {
  const { store, Store, directory, notes } = await setup();
  const a = store.create('Sides');
  const graph = { notes: [{ id: 'p1', noteId: 'n1', x: 0, y: 0 }, { id: 'p2', noteId: 'n2', x: 0, y: 600 }], edges: [{ id: 'e', source: 'p1', target: 'p2', sourceSide: 'bottom' as const, targetSide: 'top' as const, label: '', arrow: true }] };
  const saved = store.save({ ...a, ...graph, baseRevision: a.revision });
  expect(new Store(directory, { getNote: id => notes.get(id) }).get(a.id).edges[0]).toMatchObject({ sourceSide: 'bottom', targetSide: 'top' });
  expect(() => store.save({ ...saved, baseRevision: saved.revision, edges: [{ ...graph.edges[0], sourceSide: 'invalid' as never }] })).toThrow();
});

test('image-sized card heights survive reopening; invalid heights are rejected', async () => {
  const { store, Store, directory, notes } = await setup();
  const a = store.create('Image sizes');
  const saved = store.save({ ...a, baseRevision: a.revision, notes: [{ id: 'p', noteId: 'n1', x: 10, y: 20, height: 340 }] });
  expect(new Store(directory, { getNote: id => notes.get(id) }).get(a.id).notes[0].height).toBe(340);
  for (const height of [0, -1, NaN, Infinity, 1_000_001]) {
    expect(() => store.save({ ...saved, baseRevision: saved.revision, notes: [{ ...saved.notes[0], height }] })).toThrow(/height/);
  }
});
