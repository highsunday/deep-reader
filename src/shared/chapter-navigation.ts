import type { BookChapter, LibraryBook } from './contracts';

/** Deep TOC entries remain available as historical sources, outside chapter navigation. */
export function readingChapters(book: Pick<LibraryBook, 'chapters'>): BookChapter[] {
  return book.chapters.filter(chapter => (chapter.depth ?? 0) <= 1);
}

export function readingChapterId(book: Pick<LibraryBook, 'chapters'>, id?: string | null): string | undefined {
  const index = book.chapters.findIndex(chapter => chapter.id === id);
  for (let i = index; i >= 0; i--) {
    if ((book.chapters[i].depth ?? 0) <= 1) return book.chapters[i].id;
  }
  return undefined;
}

export function adjacentReadingChapters(book: Pick<LibraryBook, 'chapters'>, id?: string) {
  const chapters = readingChapters(book);
  const index = chapters.findIndex(chapter => chapter.id === readingChapterId(book, id));
  return {
    previous: index > 0 ? chapters[index - 1] : undefined,
    next: index >= 0 ? chapters[index + 1] : undefined
  };
}
