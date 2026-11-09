import { createContext } from 'react';
import type { SourceBooks } from '../shared/reading-note-source';
/** The app owns reader navigation; every shared note canvas consumes this capability. */
export const ReadingNoteSourceContext = createContext<{
  books: SourceBooks;
  open(target: { bookId: string; chapterId: string }): void;
} | undefined>(undefined);
