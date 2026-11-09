import { expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveReadingNoteSource } from '../src/shared/reading-note-source';
import { LocalReadingNoteStore } from '../src/main/reading-note-store';
import { markdownToReadingNoteDocument } from '../src/shared/reading-note-document';
const books = [{ id: 'b', title: 'Book', chapters: [{ id: 'c', title: 'Chapter' }] }];
test('resolves unique legacy sources, rejects ambiguity and never replaces missing IDs with names', () => {
  const source = { bookTitle: 'Book', chapterTitle: 'Chapter' };
  expect(resolveReadingNoteSource(source, books).target).toEqual({ bookId: 'b', chapterId: 'c' });
  expect(resolveReadingNoteSource(source, [...books, { ...books[0], id: 'other' }]).target).toBeUndefined();
  expect(resolveReadingNoteSource({ ...source, bookId: 'gone', chapterId: 'c' }, books).target).toBeUndefined();
  expect(resolveReadingNoteSource({ ...source, bookId: 'b', chapterId: 'gone' }, books).target).toBeUndefined();
  expect(resolveReadingNoteSource({ ...source, bookId: 'b', chapterId: 'c' }, [{ ...books[0], title: 'Renamed' }]).target).toEqual({ bookId: 'b', chapterId: 'c' });
});
test('source IDs survive restart and edits without becoming note content', () => {
  const path = mkdtempSync(join(tmpdir(), 'note-source-'));
  try {
    let store = new LocalReadingNoteStore(path);
    const note = store.create({ sourceDraftId: 'draft', title: 'Note', content: markdownToReadingNoteDocument('Text'), bookTitle: 'Book', chapterTitle: 'Chapter', bookId: 'b', chapterId: 'c' });
    store.update({ id: note.id, baseRevision: note.revision, title: 'Edited', content: note.content });
    store = new LocalReadingNoteStore(path);
    expect(store.get(note.id)).toMatchObject({ bookId: 'b', chapterId: 'c', title: 'Edited' });
  } finally { rmSync(path, { recursive: true, force: true }); }
});

test('draft creation retains its original source after caller changes the input', async () => {
  const { ReadingNoteDraftController } = await import('../src/main/reading-note-draft-controller');
  const path = mkdtempSync(join(tmpdir(), 'note-draft-source-'));
  try {
    const store = new LocalReadingNoteStore(path);
    const controller = new ReadingNoteDraftController(store);
    const input = { bookId: 'b', chapterId: 'c', bookTitle: 'Book', chapterTitle: 'Chapter', readingSegment: 'Original text' };
    const { draftId } = controller.begin(input);
    input.chapterId = 'other'; input.bookId = 'other';
    const note = controller.create({ draftId, title: 'Note', content: markdownToReadingNoteDocument('Understanding') });
    expect(note).toMatchObject({ bookId: 'b', chapterId: 'c' });
    expect(note.content).not.toHaveProperty('bookId');
  } finally { rmSync(path, { recursive: true, force: true }); }
});

test('source snapshots keep chapter identity for conversation-created notes', async () => {
  const { readingSourceSnapshot } = await import('../src/renderer/reading-segment-delivery');
  expect(readingSourceSnapshot({ bookId: 'b', chapterId: 'c', bookTitle: 'Book', chapterTitle: 'Chapter', readingSegment: 'Text', range: { start: 0, end: 4 } }))
    .toMatchObject({ bookId: 'b', chapterId: 'c' });
});

test('ambiguous chapters are unavailable and persisted invalid IDs are rejected', () => {
  expect(resolveReadingNoteSource({ bookTitle: 'Book', chapterTitle: 'Chapter' }, [{ ...books[0], chapters: [...books[0].chapters, { id: 'duplicate', title: 'Chapter' }] }]).reason).toContain('多個');
  const path = mkdtempSync(join(tmpdir(), 'note-source-invalid-'));
  try {
    const store = new LocalReadingNoteStore(path);
    expect(() => store.create({ sourceDraftId: 'bad', title: 'Note', content: markdownToReadingNoteDocument('Text'), bookTitle: 'Book', chapterTitle: 'Chapter', chapterId: ' ' })).toThrow(/source identity/);
  } finally { rmSync(path, { recursive: true, force: true }); }
});
