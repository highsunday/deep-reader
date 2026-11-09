import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalReadingNoteStore } from '../src/main/reading-note-store';
import { markdownToReadingNoteDocument } from '../src/shared/reading-note-document';
const directories: string[] = [];
function fixture(count = 2) {
  const directory = mkdtempSync(join(tmpdir(), 'note-tags-')); directories.push(directory);
  const store = new LocalReadingNoteStore(directory);
  const notes = Array.from({ length: count }, (_, i) => store.create({ sourceDraftId: `draft-${i}`, title: `Note ${i}`, content: markdownToReadingNoteDocument('Content'), bookTitle: i % 2 ? 'B' : 'A', chapterTitle: 'Chapter' }));
  return { store, notes, directory };
}
afterEach(() => directories.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })));
test('TC1: old notes migrate, tags persist and names are normalized and deduplicated', () => {
  const { store, notes, directory } = fixture();
  writeFileSync(join(directory, 'reading-notes.json'), JSON.stringify({ version: 7, notes }));
  const migrated = new LocalReadingNoteStore(directory);
  expect(migrated.listTags()).toEqual([]);
  const tag = migrated.createTag(' Communication ');
  expect(migrated.createTag('communication')).toEqual(tag);
  expect(() => migrated.createTag(' ')).toThrow();
  expect(() => migrated.createTag('x'.repeat(81))).toThrow();
  expect(new LocalReadingNoteStore(directory).listTags()).toEqual([tag]);
});
test('TC2: batch add and remove preserve other tags, content revision and current edits', () => {
  const { store, notes, directory } = fixture();
  const a = store.createTag('A'); const b = store.createTag('B');
  store.changeTags({ noteIds: [notes[0].id], tagId: a.id, action: 'add' });
  store.changeTags({ noteIds: notes.map(n => n.id), tagId: b.id, action: 'add' });
  store.changeTags({ noteIds: notes.map(n => n.id), tagId: b.id, action: 'add' });
  expect(store.get(notes[0].id)?.tagIds).toEqual([a.id, b.id]);
  expect(store.get(notes[0].id)?.revision).toBe(notes[0].revision);
  store.update({ id: notes[0].id, baseRevision: notes[0].revision, title: 'Edited', content: notes[0].content });
  store.changeTags({ noteIds: notes.map(n => n.id), tagId: b.id, action: 'remove' });
  expect(store.get(notes[0].id)?.tagIds).toEqual([a.id]);
  expect(store.get(notes[0].id)?.title).toBe('Edited');
  expect(new LocalReadingNoteStore(directory).get(notes[0].id)?.tagIds).toEqual([a.id]);
  expect(() => store.changeTags({ noteIds: [notes[0].id, 'missing'], tagId: b.id, action: 'add' })).toThrow();
  expect(store.get(notes[0].id)?.tagIds).toEqual([a.id]);
});
test('TC3: rename is global and preserves trashed associations; invalid input is atomic', () => {
  const { store, notes, directory } = fixture(); const tag = store.createTag('Old'); store.createTag('Other');
  store.changeTags({ noteIds: notes.map(n => n.id), tagId: tag.id, action: 'add' });
  store.trash(notes[1].id);
  expect(() => store.renameTag({ id: tag.id, name: 'other' })).toThrow();
  expect(() => store.renameTag({ id: tag.id, name: ' ' })).toThrow();
  store.renameTag({ id: tag.id, name: 'New' });
  const reopened = new LocalReadingNoteStore(directory);
  expect(reopened.listTags().find(t => t.id === tag.id)?.name).toBe('New');
  expect(reopened.restore(notes[1].id).tagIds).toEqual([tag.id]);
  expect(() => store.changeTags({ noteIds: [notes[0].id], tagId: 'missing', action: 'add' })).toThrow();
});
test('TC4: query-wide IDs span unloaded pages; tag OR combines with book and search', () => {
  const { store, notes } = fixture(123); const a = store.createTag('A'); const b = store.createTag('B');
  const query = { status: 'active' as const, sort: 'recent' as const, bookTitle: 'A' };
  const ids = store.matchingIds(query);
  expect(ids).toHaveLength(62);
  expect(store.listPage(query).items).toHaveLength(50);
  store.changeTags({ noteIds: ids, tagId: a.id, action: 'add' });
  store.changeTags({ noteIds: [notes[1].id], tagId: b.id, action: 'add' });
  expect(store.matchingIds({ status: 'active', sort: 'recent', tagIds: [a.id, b.id] })).toHaveLength(63);
  expect(store.matchingIds({ ...query, tagIds: [a.id, b.id] })).toHaveLength(62);
  expect(store.matchingIds({ ...query, search: 'Note 122', tagIds: [a.id] })).toEqual([notes[122].id]);
  expect(store.listPage({ ...query, tagIds: [b.id] }).items).toEqual([]);
});

test('tag IPC validates input and keeps tag filters when crossing the bridge', async () => {
  const { registerReadingNoteTagsIpc } = await import('../src/main/reading-note-tags-ipc');
  const { parseReadingNoteListInput } = await import('../src/main/app-ipc');
  const { store, notes } = fixture();
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  registerReadingNoteTagsIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, store);
  const call = (channel: string, value?: unknown) => handlers.get(`reading-notes:tags-${channel}`)!(null, value);
  const tag = call('create', 'Communication') as { id: string; name: string };
  call('change', { noteIds: [notes[0].id], tagId: tag.id, action: 'add' });
  const query = { status: 'active', sort: 'recent', tagIds: [tag.id] };
  expect(parseReadingNoteListInput(query)).toEqual(query);
  expect(call('matching-ids', query)).toEqual([notes[0].id]);
  expect(() => call('matching-ids', { ...query, tagIds: 42 })).toThrow();
  expect(() => call('rename', null)).toThrow();
  expect(() => call('change', { noteIds: [notes[0].id], tagId: tag.id, action: 'replace' })).toThrow();
  expect(store.get(notes[0].id)?.tagIds).toEqual([tag.id]);
});


test('TC2: failed atomic save rolls back tag catalog and all note associations', () => {
  const { store, notes, directory } = fixture();
  const tag = store.createTag('Existing');
  mkdirSync(join(directory, 'reading-notes.json.next'));
  expect(() => store.changeBookTag({ bookId: 'book', tagId: tag.id, action: 'add' })).toThrow();
  expect(store.bookTags()).toEqual({});
  expect(() => store.createTag('Failed')).toThrow();
  expect(() => store.renameTag({ id: tag.id, name: 'Failed rename' })).toThrow();
  expect(store.listTags()).toEqual([tag]);
  expect(() => store.changeTags({ noteIds: notes.map(n => n.id), tagId: tag.id, action: 'add' })).toThrow();
  expect(store.list().every(note => !note.tagIds?.length)).toBe(true);
  expect(new LocalReadingNoteStore(directory).list().every(note => !note.tagIds?.length)).toBe(true);
});

test('F76: new notes copy only their source book tags and edits stay independent across restart', () => {
  const { store, directory, notes } = fixture(1);
  const tag = store.createTag('Decision');
  store.changeBookTag({ bookId: 'first', tagId: tag.id, action: 'add' });
  const input = { title: 'New', content: notes[0].content, bookTitle: 'Shared title', chapterTitle: 'Chapter' };
  const reopened = new LocalReadingNoteStore(directory);
  const first = reopened.create({ ...input, bookId: 'first', sourceDraftId: 'first-draft' });
  expect(first.tagIds).toEqual([tag.id]);
  expect(reopened.create({ ...input, bookId: 'second', sourceDraftId: 'other-draft' }).tagIds ?? []).toEqual([]);
  reopened.changeTags({ noteIds: [first.id], tagId: tag.id, action: 'remove' });
  expect(reopened.bookTags().first).toEqual([tag.id]);
  const next = reopened.create({ ...input, bookId: 'first', sourceDraftId: 'next' });
  reopened.changeBookTag({ bookId: 'first', tagId: tag.id, action: 'remove' });
  expect(new LocalReadingNoteStore(directory).get(next.id)?.tagIds).toEqual([tag.id]);
  expect(reopened.bookTags()).toEqual({});
});
