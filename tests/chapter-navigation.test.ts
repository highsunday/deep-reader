import { test, expect } from 'vitest';
import { readingChapters, readingChapterId, adjacentReadingChapters } from '../src/shared/chapter-navigation';
const book = { chapters: [
  { id: 'a', title: 'A', href: 'a', order: 0, depth: 0 },
  { id: 'a1', title: 'A1', href: 'a', order: 1, depth: 1 },
  { id: 'a11', title: 'A11', href: 'child', order: 2, depth: 2 },
  { id: 'b', title: 'B', href: 'b', order: 3 },
] };
test('B76 TC2: adjacent chapters keep sections and skip deeper levels, including a historical active section', () => {
  expect(adjacentReadingChapters(book, 'a').next?.id).toBe('a1');
  expect(adjacentReadingChapters(book, 'a11').next?.id).toBe('b');
  expect(adjacentReadingChapters(book, 'b').previous?.id).toBe('a1');
  expect(adjacentReadingChapters(book, 'missing')).toEqual({previous: undefined, next: undefined});
});
test('B76 TC3/TC5: historical sections resolve to the parent without modifying source records', () => {
  expect(readingChapterId(book, 'a11')).toBe('a1');
  expect(readingChapterId(book, 'missing')).toBeUndefined();
  expect(readingChapters(book).map(c => c.id)).toEqual(['a', 'a1', 'b']);
  expect(book.chapters).toHaveLength(4);
});
