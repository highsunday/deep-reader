import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { LocalPracticeStore } from '../src/main/practice-store';
const modules = import.meta.glob('../src/main/practice-store.ts');
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
async function setup() {
  const loader = modules['../src/main/practice-store.ts'];
  expect(loader, 'F45 needs persistent practice pins').toBeTypeOf('function');
  const { LocalPracticeStore: Store } = await loader() as { LocalPracticeStore: typeof LocalPracticeStore };
  const directory = mkdtempSync(join(tmpdir(), 'f45-')); directories.push(directory);
  const notes = new Map(Array.from({ length: 7 }, (_, i) => [`n${i}`, { id: `n${i}`, trashedAt: undefined as number | undefined }]));
  let time = 1;
  const options = { getNote: (id: string) => notes.get(id), now: () => time++ };
  return { Store, directory, notes, options, store: new Store(directory, options) };
}
test('F45 T1: pins persist in order, idempotently, without a five-note limit or content copies', async () => {
  const { store, Store, directory, options } = await setup();
  expect(store.list()).toEqual({ version: 1, revision: 0, pins: [] });
  for (let i = 0; i < 7; i++) store.setPinned({ noteId: `n${i}`, pinned: true });
  const saved = store.list(); expect(saved.pins.map(p => p.noteId)).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
  expect(store.setPinned({ noteId: 'n0', pinned: true })).toEqual(saved);
  expect(new Store(directory, options).list()).toEqual(saved);
  expect(Object.keys(saved.pins[0]).sort()).toEqual(['noteId', 'pinnedAt']);
  saved.pins.length = 0; expect(store.list().pins).toHaveLength(7);
});
test('F45 T2: removing unavailable sources only changes pins and re-pinning appends', async () => {
  const { store, notes } = await setup();
  store.setPinned({ noteId: 'n0', pinned: true }); store.setPinned({ noteId: 'n1', pinned: true });
  notes.get('n0')!.trashedAt = 1;
  expect(store.list().pins).toHaveLength(2);
  store.setPinned({ noteId: 'n0', pinned: false });
  expect(() => store.setPinned({ noteId: 'n0', pinned: true })).toThrow(/cannot be pinned/);
  notes.get('n0')!.trashedAt = undefined;
  expect(store.setPinned({ noteId: 'n0', pinned: true }).pins.map(p => p.noteId)).toEqual(['n1', 'n0']);
  notes.delete('n0'); store.setPinned({ noteId: 'n0', pinned: false });
  const saved = store.list(); expect(store.setPinned({ noteId: 'n0', pinned: false })).toEqual(saved);
  expect(notes.has('n1')).toBe(true);
});
test('F45 T2: reject malformed commands and missing sources without modifying pins', async () => {
  const { store } = await setup();
  for (const value of [null, [], { noteId: '', pinned: true }, { noteId: 'n0', pinned: 'true' }, { noteId: '../a', pinned: 1 }, { noteId: 'missing', pinned: true }]) expect(() => store.setPinned(value)).toThrow();
  expect(store.list().revision).toBe(0);
});
test('F45 T3: failed writes preserve the last committed state and can be retried', async () => {
  const { Store, store, directory, options } = await setup();
  const saved = store.setPinned({ noteId: 'n0', pinned: true });
  const path = join(directory, 'practice.json'), before = readFileSync(path, 'utf8');
  let fail = true;
  const retry = new Store(directory, { ...options, write: (path: string, data: string) => { if (fail) throw new Error('disk full'); writeFileSync(path, data); } });
  expect(() => retry.setPinned({ noteId: 'n1', pinned: true })).toThrow('disk full');
  expect(retry.list()).toEqual(saved); expect(readFileSync(path, 'utf8')).toBe(before);
  fail = false; expect(retry.setPinned({ noteId: 'n1', pinned: true }).pins).toHaveLength(2);
});
test('F45 T3: corrupt files cannot be silently overwritten', async () => {
  const { Store, directory, options } = await setup();
  const path = join(directory, 'practice.json');
  for (const content of ['{broken', JSON.stringify({ version: 8, revision: 0, pins: [] }), JSON.stringify({ version: 1, revision: 1, pins: [{ noteId: 'n0', pinnedAt: 1 }, { noteId: 'n0', pinnedAt: 2 }] }), JSON.stringify({ version: 1, revision: -1, pins: [] })]) {
    writeFileSync(path, content);
    const corrupt = new Store(directory, options);
    expect(() => corrupt.list()).toThrow(/preserved/);
    expect(() => corrupt.setPinned({ noteId: 'n0', pinned: true })).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(content);
  }
});

function legacyState() {
  const practice = (id: string, noteId: string, status: string, createdAt: number) => ({ id, noteId, status, createdAt, updatedAt: createdAt, noteTitle: 'Original title', bookTitle: 'Book', reminder: 'Original reminder' });
  return { version: 1, revision: 3, practices: [
    practice('p0', 'n0', 'finished', 10),
    practice('p1', 'n0', 'active', 20),
    practice('p2', 'n0', 'active', 30),
    practice('p3', 'missing', 'active', 40),
    practice('p4', 'n1', 'finished', 50)
  ], records: [{ id: 'r1', practiceId: 'p0', content: 'Preserve this history' }] };
}
test('B51: migrate legacy practices into unique active pins and preserve the exact original backup', async () => {
  const { Store, directory, options } = await setup();
  const path = join(directory, 'practice.json'), original = JSON.stringify(legacyState(), null, 2);
  writeFileSync(path, original);
  const store = new Store(directory, options);
  expect(store.list()).toEqual({ version: 1, revision: 4, pins: [{ noteId: 'n0', pinnedAt: 20 }, { noteId: 'missing', pinnedAt: 40 }] });
  const backups = readdirSync(directory).filter(name => name.startsWith('practice.legacy-'));
  expect(backups).toHaveLength(1);
  expect(readFileSync(join(directory, backups[0]), 'utf8')).toBe(original);
  expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(store.list());
  expect(new Store(directory, options).list()).toEqual(store.list());
  expect(readdirSync(directory).filter(name => name.startsWith('practice.legacy-'))).toEqual(backups);
  store.setPinned({ noteId: 'missing', pinned: false });
  expect(new Store(directory, options).list().pins).toEqual([{ noteId: 'n0', pinnedAt: 20 }]);
  expect(readFileSync(join(directory, backups[0]), 'utf8')).toBe(original);
});
test('B51: legacy migration write failure preserves source, remains retryable and never caches unsaved migration', async () => {
  const { Store, directory, options } = await setup();
  const path = join(directory, 'practice.json'), original = JSON.stringify(legacyState());
  writeFileSync(path, original); let fail = true;
  const store = new Store(directory, { ...options, write: (path, data) => { if (fail) throw new Error('disk full'); writeFileSync(path, data); } });
  expect(() => store.list()).toThrow(/preserved/);
  expect(readFileSync(path, 'utf8')).toBe(original);
  expect(() => store.list()).toThrow(/preserved/);
  fail = false;
  expect(store.list().pins).toHaveLength(2);
  expect(new Store(directory, options).list()).toEqual(store.list());
});
test('B51: unknown or malformed legacy data is not converted or overwritten', async () => {
  const { Store, directory, options } = await setup();
  const path = join(directory, 'practice.json');
  const legacy = legacyState();
  for (const data of [{ ...legacy, version: 2 }, { ...legacy, records: null }, { ...legacy, pins: null },
    { ...legacy, practices: [{ ...legacy.practices[0], status: 'unknown' }] },
    { ...legacy, practices: [{ ...legacy.practices[0], createdAt: -1 }] },
    { ...legacy, practices: [{ ...legacy.practices[0], noteId: '' }] }]) {
    const original = JSON.stringify(data); writeFileSync(path, original);
    expect(() => new Store(directory, options).list()).toThrow(/preserved/);
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(readdirSync(directory)).toEqual(['practice.json']);
  }
});
test('B51: empty legacy data opens as an empty practice page', async () => {
  const { store, directory } = await setup();
  writeFileSync(join(directory, 'practice.json'), JSON.stringify({ version: 1, revision: 0, practices: [], records: [] }));
  expect(store.list()).toEqual({ version: 1, revision: 1, pins: [] });
});
