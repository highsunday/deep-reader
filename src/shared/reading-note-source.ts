import type { ReadingNote } from './contracts';
export type NoteSource = Pick<ReadingNote, 'bookTitle' | 'chapterTitle'> & { bookId?: string; chapterId?: string };
export type SourceBooks = readonly { id: string; title: string; chapters: readonly { id: string; title: string }[] }[];
export function resolveReadingNoteSource(note: NoteSource, books: SourceBooks): { target?: { bookId: string; chapterId: string }; reason?: string } {
  const candidates = books.filter(book => note.bookId ? book.id === note.bookId : book.title === note.bookTitle)
    .flatMap(book => book.chapters.filter(chapter => note.chapterId ? chapter.id === note.chapterId : chapter.title === note.chapterTitle)
      .map(chapter => ({ bookId: book.id, chapterId: chapter.id })));
  if (candidates.length === 1) return { target: candidates[0] };
  return { reason: candidates.length ? '有多個相同名稱的來源，無法確定原文章節。' : '來源書籍或章節已不存在，無法開啟原文。' };
}
