// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { App, ChatMessageList } from "../src/renderer/App";
import type {
  ChatSnapshot,
  ChapterContent,
  LibraryBook,
  ReaderDesktopApi,
  ReadingNote,
  SaveAnnotationsInput
} from "../src/shared/contracts";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import { BUILT_IN_MEMORY_IMAGE_PURPOSES, BUILT_IN_MEMORY_IMAGE_STYLES } from "../src/shared/memory-image-templates";
import type { Whiteboard } from "../src/shared/whiteboard";

// Give each semantic block its own visual lines, including wrapped inline text.
function mockSegmentLines(width = 10) {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    const block = this.startContainer.parentElement?.closest('p,h2,h3');
    if (!block) return new DOMRect();
    const prefix = document.createRange();
    prefix.selectNodeContents(block);
    prefix.setEnd(this.startContainer, this.startOffset);
    const order = [...block.parentElement!.children].indexOf(block);
    return new DOMRect(0, order * 300 + Math.floor(prefix.toString().length / width) * 20, 10, 18);
  });
}

test.each(['saved', 'manual-end', 'manual-start'] as const)('B72 TC1/2/4/5: %s short section advances through whole longer sections', async source => {
  mockSegmentLines();
  const custom = { ...chapter, contentHtml: `<h2>A</h2><p>${'甲'.repeat(10)}</p><h2>B</h2><p>${'乙'.repeat(10)}</p><p>${'丙'.repeat(10)}</p><p>${'丁'.repeat(80)}</p><h3>B.1</h3><p>子節</p><h2>C</h2><p>下一整節</p><h2>D</h2><p>最後</p>` };
  let rangedBook = { ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: source === 'saved' ? 10 : 11 } } };
  const api = readerApi(rangedBook, custom);
  api.library.saveReadingRange = vi.fn(async input => {
    rangedBook = { ...rangedBook, chapterRanges: { [chapter.chapterId]: input.range } };
    return rangedBook;
  });
  window.readerExample = api;
  render(<App />);
  const article = await screen.findByLabelText('Read This First chapter content');
  const next = screen.getByRole('button', { name: /Next segment/ });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  if (source !== 'saved') {
    const paragraph = article.querySelector('p')!;
    Object.defineProperty(document, 'caretPositionFromPoint', {
      configurable: true, value: () => ({ offsetNode: paragraph.firstChild!, offset: source === 'manual-start' ? 1 : 9 })
    });
    try {
      fireEvent.contextMenu(paragraph, { clientX: 120, clientY: 180 });
      fireEvent.click(screen.getByRole('menuitem', { name: source === 'manual-start' ? /Move start here/ : /Move end here/ }));
      await act(async () => {});
    } finally {
      Reflect.deleteProperty(document, 'caretPositionFromPoint');
    }
  }
  const text = article.textContent!;
  fireEvent.click(next);
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: text.indexOf('B'), end: text.indexOf('C') } }));
  await act(async () => {});
  fireEvent.click(next);
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: text.indexOf('C'), end: text.indexOf('D') } }));
});

test('B72 TC3: a short section with a whole unread line retains paragraph mode', async () => {
  mockSegmentLines(5);
  const custom = { ...chapter, contentHtml: '<h2>A</h2><p>甲乙丙丁戊己庚辛壬癸</p><h2>B</h2><p>一二三四五</p><p>六七八九十</p>' };
  const rangedBook = { ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 5 } } };
  const api = readerApi(rangedBook, custom);
  api.library.saveReadingRange = vi.fn(async input => ({ ...rangedBook, chapterRanges: { [chapter.chapterId]: input.range } }));
  window.readerExample = api;
  render(<App />);
  await screen.findByText('甲乙丙丁戊己庚辛壬癸');
  const next = screen.getByRole('button', { name: /Next segment/ });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(next);
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: 6, end: 11 } }));
  await act(async () => {});
  fireEvent.click(next);
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: 11, end: 17 } }));
});

test('B72 TC4: a manual partial paragraph replaces the inferred short-section preference', async () => {
  mockSegmentLines(5);
  const custom = { ...chapter, contentHtml: '<h2>A</h2><p>甲乙丙丁戊</p><h2>B</h2><p>一二三四五</p><p>六七八九十</p><p>天地玄黃宇</p><h2>C</h2><p>末節</p>' };
  let rangedBook = { ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 5 } } };
  const api = readerApi(rangedBook, custom);
  api.library.saveReadingRange = vi.fn(async input => {
    rangedBook = { ...rangedBook, chapterRanges: { [chapter.chapterId]: input.range } };
    return rangedBook;
  });
  window.readerExample = api;
  render(<App />);
  const article = await screen.findByLabelText('Read This First chapter content');
  const next = screen.getByRole('button', { name: /Next segment/ });
  await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(next);
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: 6, end: 22 } }));
  await act(async () => {});
  const paragraph = article.querySelectorAll('p')[1];
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true, value: () => ({ offsetNode: paragraph.firstChild!, offset: 4 })
  });
  try {
    fireEvent.contextMenu(paragraph, { clientX: 120, clientY: 180 });
    fireEvent.click(screen.getByRole('menuitem', { name: /Move end here/ }));
    await act(async () => {});
    fireEvent.click(next);
    expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: 12, end: 17 } }));
  } finally {
    Reflect.deleteProperty(document, 'caretPositionFromPoint');
  }
});

test('B70: adaptive Next starts below the previous END line across inline text nodes', async () => {
  const custom = { ...chapter, contentHtml: '<p>AAAAA<em>BBBBB</em></p><p>CCCCC DDDDD</p>' };
  const rangedBook = { ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 8 } } };
  const api = readerApi(rangedBook, custom);
  api.library.saveReadingRange = vi.fn(async input => ({ ...rangedBook, chapterRanges: { [chapter.chapterId]: input.range } }));
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockImplementation(function (this: Range) {
    const paragraph = this.startContainer.parentElement?.closest('p');
    if (!paragraph) return new DOMRect();
    const prefix = document.createRange();
    prefix.selectNodeContents(paragraph);
    prefix.setEnd(this.startContainer, this.startOffset);
    const top = (paragraph.previousElementSibling ? 80 : 0) + Math.floor(prefix.toString().length / 5) * 20;
    return new DOMRect(0, top, 10, 18);
  });
  window.readerExample = api;
  render(<App />);
  await screen.findByText('CCCCC DDDDD');
  await waitFor(() => expect((screen.getByRole('button', { name: /Next segment/ }) as HTMLButtonElement).disabled).toBe(false));
  const oldEnd = parseFloat((document.querySelector('[data-range-boundary="end"]') as HTMLElement).style.top);
  fireEvent.click(screen.getByRole('button', { name: /Next segment/ }));
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith({ bookId: book.id, chapterId: chapter.chapterId, range: { start: 10, end: 21 } });
  await waitFor(() => expect(parseFloat((document.querySelector('[data-range-boundary="start"]') as HTMLElement).style.top)).toBeGreaterThanOrEqual(oldEnd));
});

test('F64 TC10: Next segment selects the whole next subsection even when much longer', async () => {
  // This test exercises structure without layout; B70 covers real visual-line advancement.
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect());
  const first = 'FirstShort passage.';
  const second = 'SecondA much longer passage with many words that must all remain in this subsection.';
  const custom = { ...chapter, contentHtml: `<h2>First</h2><p>Short passage.</p><h2>Second</h2><p>${second.slice(6)}</p><h2>Third</h2><p>Last.</p>` };
  const rangedBook = { ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: first.length } } };
  const api = readerApi(rangedBook);
  api.library.getChapterContent = vi.fn(async () => custom);
  api.library.saveReadingRange = vi.fn(async input => ({ ...rangedBook, chapterRanges: { [chapter.chapterId]: input.range } }));
  window.readerExample = api;
  render(<App />);
  await screen.findByText('Short passage.');
  await waitFor(() => expect((screen.getByRole('button', { name: /Next segment/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /Next segment/ }));
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith({
    bookId: book.id, chapterId: chapter.chapterId,
    range: { start: first.length, end: first.length + second.length }
  });
  await waitFor(() => expect((screen.getByRole('button', { name: /Next segment/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /Next segment/ }));
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith({
    bookId: book.id, chapterId: chapter.chapterId,
    range: { start: first.length + second.length, end: first.length + second.length + 'ThirdLast.'.length }
  });
});

test('F64 TC5/10: automatic ranges retain the manual target and context-menu edits replace it', async () => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect());
  const parts = ['甲'.repeat(10), '乙'.repeat(6), '丙'.repeat(7), '丁'.repeat(8), '戊'.repeat(8), '己'.repeat(6)];
  const custom = { ...chapter, contentHtml: parts.map(part => `<p>${part}</p>`).join('') };
  let rangedBook = { ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 10 } } };
  const api = readerApi(rangedBook, custom);
  api.library.saveReadingRange = vi.fn(async input => {
    rangedBook = { ...rangedBook, chapterRanges: { [chapter.chapterId]: input.range } };
    return rangedBook;
  });
  window.readerExample = api;
  render(<App />);
  const article = await screen.findByLabelText('Read This First chapter content');
  const nextButton = screen.getByRole('button', { name: /Next segment/ }) as HTMLButtonElement;
  await waitFor(() => expect(nextButton.disabled).toBe(false));
  fireEvent.click(nextButton);
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: 10, end: 23 } }));
  await act(async () => {});
  fireEvent.click(nextButton);
  // Keeping ten units selects eight. Learning from the previous 13 would select 16.
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: 23, end: 31 } }));
  await act(async () => {});

  const paragraph = article.querySelectorAll('p')[3];
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true, value: () => ({ offsetNode: paragraph.firstChild!, offset: 3 })
  });
  try {
    fireEvent.contextMenu(paragraph, { clientX: 120, clientY: 180 });
    fireEvent.click(screen.getByRole('menuitem', { name: /Move end here/ }));
    expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: 23, end: 26 } }));
    await act(async () => {});
    fireEvent.click(nextButton);
    expect(api.library.saveReadingRange).toHaveBeenLastCalledWith(expect.objectContaining({ range: { start: 26, end: 31 } }));
  } finally {
    Reflect.deleteProperty(document, 'caretPositionFromPoint');
  }
});

test('F64 TC5/10: changing chapters infers a new preference from the saved range', async () => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect());
  const nextChapter = { ...chapter, chapterId: 'chapter-2', title: 'Next chapter', contentHtml: '<p>甲乙丙丁</p><p>一二三</p><p>四五六七</p><p>八九十</p>' };
  const firstChapter = { ...chapter, contentHtml: '<h2>A</h2><p>正文</p><h2>B</h2><p>較長的下一小節正文</p>' };
  let rangedBook: LibraryBook = {
    ...book,
    chapters: [...book.chapters, { id: nextChapter.chapterId, title: nextChapter.title, href: 'next.xhtml', order: 1 }],
    chapterRanges: { [chapter.chapterId]: { start: 0, end: 3 }, [nextChapter.chapterId]: { start: 0, end: 4 } }
  };
  const api = readerApi(rangedBook, firstChapter);
  api.library.getChapterContent = vi.fn(async (_book, chapterId) => chapterId === nextChapter.chapterId ? nextChapter : firstChapter);
  api.library.saveReadingState = vi.fn(async input => {
    rangedBook = { ...rangedBook, readingState: { view: input.view, chapterId: input.chapterId, scrollProgress: input.scrollProgress } };
    return rangedBook;
  });
  api.library.saveReadingRange = vi.fn(async input => {
    rangedBook = { ...rangedBook, chapterRanges: { ...rangedBook.chapterRanges, [input.chapterId]: input.range } };
    return rangedBook;
  });
  window.readerExample = api;
  render(<App />);
  await screen.findByText('正文');
  await waitFor(() => expect((screen.getByRole('button', { name: /Next segment/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /Next segment/ }));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /Next chapter/ }));
  await screen.findByLabelText('Next chapter chapter content');
  await waitFor(() => expect((screen.getByRole('button', { name: /Next segment/ }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: /Next segment/ }));
  expect(api.library.saveReadingRange).toHaveBeenLastCalledWith({ bookId: book.id, chapterId: nextChapter.chapterId, range: { start: 4, end: 7 } });
});

test('video entry opens a fresh discussion without a selector, preserving the reading question and the active draft across library navigation', async () => {
  const source = { bookId: book.id, chapterId: chapter.chapterId, bookTitle: book.title, chapterTitle: chapter.title, range: { start: 0, end: 28 }, readingSegment: 'Welcome to the chapter text.', images: [] };
  const create = vi.fn();
  window.readerExample.conceptVideos = {
    capability: vi.fn(async () => ({ aiAllowed: false as const, generationAllowed: false as const, reason: '只用內含額度' })),
    list: vi.fn(async () => []), get: vi.fn(), create, save: vi.fn(), append: vi.fn(), compare: vi.fn(), generate: vi.fn(async () => { throw Error("尚未生成"); }), cancel: vi.fn(async () => { throw Error("尚未生成"); }), adopt: vi.fn(async () => { throw Error("尚未生成"); }), media: vi.fn(async () => new Uint8Array()), poster: vi.fn(async () => new Uint8Array()), remove: vi.fn(), requestAi: vi.fn()
  };
  render(<App />); await screen.findByText('Welcome to the chapter text.');
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask about the current reading range' }), { target: { value: '原本未送出的問題' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create Video' }));
  expect(create).not.toHaveBeenCalled();
  expect(screen.getByText('Welcome to the chapter text.')).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe your video idea' }), { target: { value: '影片未送出的需求' } });
  fireEvent.click(screen.getByRole('button', { name: 'Back to reading chat' }));
  expect((screen.getByRole('textbox', { name: 'Ask about the current reading range' }) as HTMLTextAreaElement).value).toBe('原本未送出的問題');
  fireEvent.click(screen.getByRole('button', { name: 'Create Video' }));
  expect((screen.getByRole('textbox', { name: 'Describe your video idea' }) as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('combobox', { name: 'Switch video workspace' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'New video from this passage' })).toBeNull();
  expect(create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe your video idea' }), { target: { value: '新的影片需求' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open Video Library' }));
  await screen.findByRole('heading', { name: 'Videos' });
  expect((screen.getByRole('textbox', { name: 'Describe your video idea' }) as HTMLTextAreaElement).value).toBe('新的影片需求');
  expect(window.readerExample.chat.sendMessage).not.toHaveBeenCalled();
});

test('saved video source keeps its snapshot without a chapter-jump button or changes to START/END', async () => {
  const source = { bookId: book.id, chapterId: chapter.chapterId, bookTitle: book.title, chapterTitle: chapter.title, range: { start: 2, end: 20 }, readingSegment: '來源快照內容', images: [] };
  const video: import('../src/shared/concept-video').ConceptVideo = { id: 'saved-video', revision: 1, createdAt: 1, updatedAt: 1, status: 'draft', versions: [], source, context: [], plan: { title: '來源測試', goal: '保留閱讀範圍', scenes: [{ id: 's1', heading: '', visual: '', narration: '' }], pace: 'normal', narration: false }, discussion: [], conflicts: [] };
  window.readerExample.conceptVideos = {
    capability: vi.fn(async () => ({ aiAllowed: false as const, generationAllowed: false as const, reason: '只用內含額度' })),
    list: vi.fn(async () => [video]), get: vi.fn(async () => video), create: vi.fn(), save: vi.fn(), append: vi.fn(), compare: vi.fn(), generate: vi.fn(async () => { throw Error("尚未生成"); }), cancel: vi.fn(async () => { throw Error("尚未生成"); }), adopt: vi.fn(async () => { throw Error("尚未生成"); }), media: vi.fn(async () => new Uint8Array()), poster: vi.fn(async () => new Uint8Array()), remove: vi.fn(), requestAi: vi.fn()
  };
  render(<App />); await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(screen.getByRole('button', { name: 'Videos' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue: 來源測試' }));
  fireEvent.click(screen.getByText(`Source: ${book.title} / ${chapter.title}`));
  expect(screen.queryByRole('button', { name: 'Back to source chapter' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Bookshelf' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Continue reading American Accent Training' }));
  await screen.findByText('Welcome to the chapter text.');
  expect(window.readerExample.library.getChapterContent).toHaveBeenLastCalledWith(book.id, chapter.chapterId);
  expect(window.readerExample.library.saveReadingRange).not.toHaveBeenCalled();
  expect(screen.getByText('來源快照內容')).toBeTruthy();
});

function installWhiteboards() {
  let board: Whiteboard = { id: 'board-1', title: 'Systems', revision: 1, createdAt: 1, updatedAt: 1, notes: [], texts: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const api = {
    list: vi.fn(async () => [board]), get: vi.fn(async () => board),
    create: vi.fn(async (title: string) => { board = { ...board, id: 'new-board', title }; return board; }),
    save: vi.fn(async (input: Whiteboard & { baseRevision: number }) => { board = { ...input, revision: input.baseRevision + 1 }; return board; }),
    remove: vi.fn(async () => {})
  };
  window.readerExample.whiteboards = api;
  return api;
}

test('F47 TC1: restarting restores the last main page', async () => {
  const first = render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-current')).toBe('page');
  first.unmount();

  const second = render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Notes' }).getAttribute('aria-current')).toBe('page'));
  fireEvent.click(screen.getByRole('button', { name: 'Pinned Notes' }));
  second.unmount();

  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Pinned Notes' }).getAttribute('aria-current')).toBe('page'));
});

test('F47 TC1: restarting restores spaced review', async () => {
  window.readerExample.readingNotes.review = {
    summary: vi.fn(async () => ({
      daily: { dailyNewLimit: 10, dailyDueLimit: 50, startedNew: 0, completedDue: 0 },
      learning: 0, backlog: 0, refreshAt: Date.now() + 60_000,
      progress: { solid: 0, building: 0, delta30Days: 0, recallRate: 0, recallReviews: 0, historyIncomplete: false, daily: [] },
      activity: { completedReviews: 0, activeDays: 0, daily: [] },
      available: 0, newCards: 0, due: 0, enrolled: 0, paused: 0, unavailable: 0, nextDueAt: null
    })),
    onChanged: vi.fn(() => () => undefined)
  } as unknown as NonNullable<ReaderDesktopApi['readingNotes']['review']>;
  const first = render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(screen.getByRole('button', { name: /^Review/ }));
  expect(screen.getByRole('button', { name: /^Review/ }).getAttribute('aria-current')).toBe('page');
  first.unmount();

  render(<App />);
  await waitFor(() => expect(screen.getByRole('button', { name: /^Review/ }).getAttribute('aria-current')).toBe('page'));
  expect(screen.getByRole('heading', { name: 'Review' })).toBeTruthy();
});

test('F47 TC2,4: restarting restores the selected book and falls back after deletion or bad storage', async () => {
  const anotherBook: LibraryBook = { ...book, pinned: true, id: 'book-2', title: 'Another Book', readingState: { view: 'overview', chapterId: chapter.chapterId, scrollProgress: 0.5 } };
  window.readerExample.library.listBooks = vi.fn(async () => [{ ...book, pinned: true }, anotherBook]);
  const first = render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(document.querySelector('[data-book-id="book-2"] .book-item-select')!);
  expect(document.querySelector('[data-book-id="book-2"] .book-item-select')?.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(await screen.findByRole('button', { name: 'Back to overview' }));
  first.unmount();

  const second = render(<App />);
  await waitFor(() => expect(document.querySelector('[data-book-id="book-2"] .book-item-select')?.getAttribute('aria-pressed')).toBe('true'));
  expect(screen.getByRole('heading', { name: 'Another Book' })).toBeTruthy();
  second.unmount();

  window.readerExample.library.listBooks = vi.fn(async () => [{ ...book, pinned: true }]);
  const third = render(<App />);
  await waitFor(() => expect(document.querySelector('[data-book-id="book-1"] .book-item-select')?.getAttribute('aria-pressed')).toBe('true'));
  third.unmount();

  window.localStorage.setItem('deep-reader-last-location', '{broken');
  render(<App />);
  await waitFor(() => expect(document.querySelector('[data-book-id="book-1"] .book-item-select')?.getAttribute('aria-pressed')).toBe('true'));
});

test('F47 TC2: restarting a reader opens the selected book chapter', async () => {
  const anotherBook: LibraryBook = { ...book, pinned: true, id: 'book-2', title: 'Another Book', readingState: { view: 'reader', chapterId: chapter.chapterId, scrollProgress: 0.5 } };
  window.readerExample.library.listBooks = vi.fn(async () => [{ ...book, pinned: true }, anotherBook]);
  const first = render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(document.querySelector('[data-book-id="book-2"] .book-item-select')!);
  await waitFor(() => expect(window.readerExample.library.getChapterContent).toHaveBeenLastCalledWith('book-2', 'chapter-1'));
  first.unmount();

  render(<App />);
  await waitFor(() => expect(document.querySelector('[data-book-id="book-2"] .book-item-select')?.getAttribute('aria-pressed')).toBe('true'));
  await screen.findByLabelText('Read This First chapter content');
  expect(window.readerExample.library.getChapterContent).toHaveBeenLastCalledWith('book-2', 'chapter-1');
});

test('F47 TC3,5: restarting restores the open whiteboard or its list when the board is gone', async () => {
  const api = installWhiteboards();
  const first = render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Systems' }));
  await screen.findByRole('region', { name: 'Whiteboard canvas' });
  first.unmount();

  const second = render(<App />);
  await screen.findByRole('region', { name: 'Whiteboard canvas' });
  expect(api.get).toHaveBeenLastCalledWith('board-1');
  fireEvent.click(screen.getByRole('button', { name: 'All whiteboards' }));
  await screen.findByRole('button', { name: 'Open Systems' });
  second.unmount();

  const third = render(<App />);
  await screen.findByRole('button', { name: 'Open Systems' });
  expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull();
  third.unmount();

  window.localStorage.setItem('deep-reader-last-location', JSON.stringify({ mode: 'whiteboards', whiteboardId: 'missing' }));
  api.get.mockRejectedValueOnce(new Error('Whiteboard not found'));
  render(<App />);
  await screen.findByRole('button', { name: 'Open Systems' });
  expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull();
  await waitFor(() => expect(JSON.parse(window.localStorage.getItem('deep-reader-last-location')!).whiteboardId).toBeUndefined());
});

test('F47 TC6: cancelling a guarded whiteboard exit keeps its restart destination', async () => {
  const api = installWhiteboards();
  render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Systems' }));
  await screen.findByRole('region', { name: 'Whiteboard canvas' });
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  api.save.mockRejectedValueOnce(new Error('Disk full'));
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Unsaved whiteboard' })).getByRole('button', { name: 'Keep editing' }));
  expect(JSON.parse(window.localStorage.getItem('deep-reader-last-location')!)).toMatchObject({ mode: 'whiteboards', whiteboardId: 'board-1' });
});

test('B50 TC1,3: main navigation resumes the same whiteboard and viewport until explicitly returning to all boards', async () => {
  const api = installWhiteboards(); render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Systems' }));
  const canvas = await screen.findByRole('region', { name: 'Whiteboard canvas' });
  fireEvent(canvas, new WheelEvent('wheel', { deltaX: 90, deltaY: 160, bubbles: true, cancelable: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  const transform = canvas.querySelector('.wb-world')?.getAttribute('style');
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull());
  expect(api.save).toHaveBeenCalled();
  for (const destination of ['Bookshelf', 'Notes']) {
    fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
    const restored = await screen.findByRole('region', { name: 'Whiteboard canvas' });
    expect(screen.getByRole('textbox', { name: 'Whiteboard name' }).getAttribute('value')).toBe('Systems');
    expect(screen.getByLabelText('Zoom level').textContent).toBe('120%');
    expect(restored.querySelector('.wb-world')?.getAttribute('style')).toBe(transform);
    fireEvent.click(screen.getByRole('button', { name: destination }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull());
  }
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  fireEvent.click(await screen.findByRole('button', { name: 'All whiteboards' }));
  await screen.findByRole('button', { name: 'Open Systems' });
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  await screen.findByRole('button', { name: 'Open Systems' });
  expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull();
});

test('B50 TC2,5: newly created boards resume, and an unavailable board falls back to the list', async () => {
  const api = installWhiteboards(); render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  await screen.findByRole('button', { name: 'Open Systems' });
  fireEvent.change(screen.getByRole('textbox', { name: 'New whiteboard name' }), { target: { value: 'New ideas' } });
  fireEvent.click(screen.getByRole('button', { name: 'New whiteboard' }));
  await screen.findByRole('region', { name: 'Whiteboard canvas' });
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  await screen.findByRole('region', { name: 'Whiteboard canvas' });
  expect(api.get).toHaveBeenLastCalledWith('new-board');
  expect(screen.getByRole('textbox', { name: 'Whiteboard name' }).getAttribute('value')).toBe('New ideas');
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull());
  api.get.mockRejectedValueOnce(new Error('Whiteboard not found'));
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Whiteboard not found');
  await screen.findByRole('button', { name: 'Open New ideas' });
  const calls = api.get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open New ideas' }));
  await screen.findByRole('region', { name: 'Whiteboard canvas' });
  expect(api.get.mock.calls.length).toBe(calls + 1);
});

test('B50 TC4: failed navigation save keeps editing, retries before leaving, and clears resume on discard', async () => {
  const api = installWhiteboards(); render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Systems' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Zoom in' }));
  api.save.mockRejectedValueOnce(new Error('Disk full'));
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Unsaved whiteboard' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByLabelText('Zoom level').textContent).toBe('120%');
  api.save.mockRejectedValueOnce(new Error('Disk full'));
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  const retryDialog = await screen.findByRole('alertdialog', { name: 'Unsaved whiteboard' });
  fireEvent.click(within(retryDialog).getByRole('button', { name: 'Retry save' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  await screen.findByRole('region', { name: 'Whiteboard canvas' });
  expect(screen.getByLabelText('Zoom level').textContent).toBe('120%');
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  api.save.mockRejectedValueOnce(new Error('Disk full'));
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  fireEvent.click(within(await screen.findByRole('alertdialog', { name: 'Unsaved whiteboard' })).getByRole('button', { name: 'Discard and leave' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  await screen.findByRole('button', { name: 'Open Systems' });
  expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull();
});

test('B50 TC6: leaving during restoration ignores the old request and preserves the board to resume', async () => {
  const api = installWhiteboards(); render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Open Systems' }));
  await screen.findByRole('region', { name: 'Whiteboard canvas' });
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Whiteboard canvas' })).toBeNull());
  let reject!: (reason: Error) => void;
  api.get.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  await screen.findByText('Loading whiteboard…');
  expect(screen.queryByRole('button', { name: 'Open Systems' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
  await act(async () => { reject(new Error('Late failure')); });
  fireEvent.click(screen.getByRole('button', { name: 'Whiteboards' }));
  await screen.findByRole('region', { name: 'Whiteboard canvas' });
  expect(api.get).toHaveBeenLastCalledWith('board-1');
  expect(screen.queryByRole('alert')).toBeNull();
});

test("F35 opens a chapter scratchpad without replacing the article or AI panel", async () => {
  Object.assign(window.readerExample, { chapterScratchpad: {
    get: vi.fn(async (key) => ({ ...key, revision: 0, updatedAt: 0, content: markdownToReadingNoteDocument("") })),
    save: vi.fn(),
    attachments: window.readerExample.readingNotes.attachments
  } });
  render(<App />);
  await screen.findByText("Welcome to the chapter text.");
  const article = document.querySelector("article");
  const conversation = screen.getByRole("tab", { name: "AI Tutor" });
  fireEvent.click(screen.getByRole("button", { name: "Open chapter scratchpad" }));
  await screen.findByRole("region", { name: "Chapter scratchpad" });
  expect(document.querySelector("article")).toBe(article);
  expect(conversation.getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Minimize scratchpad" }));
  expect(screen.queryByRole("region", { name: "Chapter scratchpad" })).toBeNull();
  fireEvent.keyDown(window, { key: "J", ctrlKey: true, shiftKey: true });
  expect(screen.getByRole("region", { name: "Chapter scratchpad" })).toBeTruthy();
});

const chapter: ChapterContent = {
  bookId: "book-1",
  chapterId: "chapter-1",
  title: "Read This First",
  contentHtml: "<h1>Read This First</h1><p>Welcome to the chapter text.</p>"
};

const book: LibraryBook = {
  id: "book-1",
  title: "American Accent Training",
  author: "Ann Cook",
  chapters: [{ id: chapter.chapterId, title: chapter.title, href: "chapter.xhtml", order: 0 }],
  lastChapterId: chapter.chapterId,
  readingState: { view: "reader", chapterId: chapter.chapterId, scrollProgress: 0 },
  chapterRanges: {},
  chapterAnnotations: {}
};

const chat: ChatSnapshot = {
  connection: "ready",
  connectionDetail: "Connected",
  account: null,
  allowance: {
    phase: "unavailable",
    fiveHour: null,
    weekly: null,
    detail: "Unavailable"
  },
  threadId: null,
  activeTurnId: null,
  messages: [],
  conversations: [],
  activeConversationId: null,
  managementBusy: false,
  conversationError: null
};

const savedNote: ReadingNote = {
  id: "note-1",
  sourceDraftId: "draft-1",
  title: "A saved reading note",
  content: markdownToReadingNoteDocument("Manual content"),
  bookTitle: book.title,
  chapterTitle: chapter.title,
  createdAt: 1,
  updatedAt: 1,
  revision: 1
};

function readerApi(
  libraryBook: LibraryBook = book,
  chapterContent: ChapterContent = chapter
): ReaderDesktopApi {
  return {
    library: {
      listBooks: vi.fn(async () => [libraryBook]),
      importBook: vi.fn(),
      getChapterContent: vi.fn(async () => chapterContent),
      saveReadingState: vi.fn(async () => libraryBook),
      setShelfStatus: vi.fn(async () => libraryBook),
      setPinned: vi.fn(async () => libraryBook),
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(async () => libraryBook),
      saveAnnotations: vi.fn(async () => libraryBook)
    },
    readingNotes: {
      list: vi.fn(async () => []),
      listPage: vi.fn(async () => ({ items: [] })),
      activeBookTitles: vi.fn(async () => []),
      get: vi.fn(),
      counts: vi.fn(async () => ({ active: 0, trashed: 0 })),
      beginDraft: vi.fn(async () => ({ draftId: "draft-1" })),
      create: vi.fn(async () => savedNote),
      discardDraft: vi.fn(async () => undefined),
      update: vi.fn(async () => savedNote),
      trash: vi.fn(async () => ({ ...savedNote, trashedAt: 2 })),
      restore: vi.fn(async () => savedNote),
      emptyTrash: vi.fn(async () => 0),
      attachments: {
        upload: vi.fn(),
        readDataUrl: vi.fn(),
        copyForNote: vi.fn(),
        discardStaged: vi.fn(async () => 0)
      },
      memoryImage: {
        revise: vi.fn(), confirm: vi.fn(), discard: vi.fn(async (noteId: string) => ({
          noteId, phase: "ready" as const, available: true, status: ""
        })),
        templates: {
          get: vi.fn(async () => ({ purposes: BUILT_IN_MEMORY_IMAGE_PURPOSES, styles: BUILT_IN_MEMORY_IMAGE_STYLES,
            defaultPurposeId: "purpose-concept-structure", defaultStyleId: "style-minimal-vector" })),
          create: vi.fn(), update: vi.fn(), remove: vi.fn(), setDefault: vi.fn()
        },
        listActive: vi.fn(async () => []),
        getState: vi.fn(),
        generate: vi.fn(),
        adjust: vi.fn(),
        stop: vi.fn(),
        remove: vi.fn(),
        onStateChanged: vi.fn(() => () => undefined)
      },
      ai: {
        startCreate: vi.fn(),
        complete: vi.fn(),
        startEdit: vi.fn(),
        startTransform: vi.fn(),
        send: vi.fn(),
        accept: vi.fn(),
        reject: vi.fn(),
        stop: vi.fn(),
        save: vi.fn(),
        discard: vi.fn(async () => undefined),
        onStateChanged: vi.fn(() => () => undefined)
      }
    },
    chat: {
      prepareReadingNoteDraft: vi.fn(),
      saveReadingNoteDraft: vi.fn(),
      getState: vi.fn(async () => chat),
      connect: vi.fn(async () => chat),
      sendMessage: vi.fn(async () => chat),
      submitReadingNote: vi.fn(async () => chat),
      startNewConversation: vi.fn(async () => chat),
      selectConversation: vi.fn(async () => chat),
      removeConversation: vi.fn(async () => chat),
      stopResponse: vi.fn(async () => chat),
      onStateChanged: vi.fn(() => () => undefined)
    }
  };
}

beforeAll(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      get length() { return storage.size; }
    }
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }))
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  Range.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    top: 0,
    right: 10,
    bottom: 10,
    left: 0,
    width: 10,
    height: 10,
    toJSON: () => ({})
  }));
});

beforeEach(() => {
  window.localStorage.clear();
  window.readerExample = readerApi();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("F58 image checkbox controls book images for questions, guides and new note drafts", async () => {
  const image = "data:image/png;base64,aGVsbG8=";
  window.readerExample = readerApi(book, { ...chapter, contentHtml: `<p>Welcome to the chapter text.</p><img src="${image}">` });
  const rendered = render(<App />);
  await screen.findByText("Welcome to the chapter text.");
  const checkbox = await screen.findByRole("checkbox", { name: "讀取圖片" }) as HTMLInputElement;
  expect(checkbox.checked).toBe(true);
  const copy = screen.getByRole("button", { name: "Copy conversation" });
  expect(checkbox.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(checkbox);
  const textbox = screen.getByRole("textbox", { name: "Ask about the current reading range" });
  fireEvent.change(textbox, { target: { value: "說明" } });
  fireEvent.submit(textbox.closest("form")!);
  await waitFor(() => expect(window.readerExample.chat.sendMessage).toHaveBeenCalledTimes(1));
  let input = vi.mocked(window.readerExample.chat.sendMessage).mock.calls[0]![0];
  expect(input.context?.images).toBeUndefined();
  expect(input.context?.readingSegment).toContain("Welcome to the chapter text.");
  expect(input.context?.readingSegment).not.toContain("[Book image");
  fireEvent.click(screen.getByRole("button", { name: "Reading Guide" }));
  await waitFor(() => expect(window.readerExample.chat.sendMessage).toHaveBeenCalledTimes(2));
  input = vi.mocked(window.readerExample.chat.sendMessage).mock.calls[1]![0];
  expect(input.context?.images).toBeUndefined();
  fireEvent.click(checkbox);
  fireEvent.change(textbox, { target: { value: "再說明" } });
  fireEvent.submit(textbox.closest("form")!);
  await waitFor(() => expect(window.readerExample.chat.sendMessage).toHaveBeenCalledTimes(3));
  input = vi.mocked(window.readerExample.chat.sendMessage).mock.calls[2]![0];
  expect(input.context?.images).toEqual([{ dataUrl: image }]);
  fireEvent.click(checkbox);
  rendered.unmount();
  render(<App />);
  await screen.findByText("Welcome to the chapter text.");
  expect((screen.getByRole("checkbox", { name: "讀取圖片" }) as HTMLInputElement).checked).toBe(false);
});

test("restarting restores the last selected reading chat model after the model catalog loads", async () => {
  const models = [
    { id: "gpt-5.6-sol", label: "GPT-5.6-Sol", isDefault: true },
    { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" }
  ];
  vi.mocked(window.readerExample.chat.getState).mockResolvedValue({ ...chat, models });
  vi.mocked(window.readerExample.chat.connect).mockResolvedValue({ ...chat, models });

  const first = render(<App />);
  const model = await screen.findByRole("combobox", { name: "Choose AI model" }) as HTMLSelectElement;
  await waitFor(() => expect(model.querySelector('option[value="gpt-6.1-sol"]')).not.toBeNull());
  fireEvent.change(model, { target: { value: "gpt-6.1-sol" } });
  expect(model.value).toBe("gpt-6.1-sol");
  expect(window.localStorage.getItem("deep-reader-last-chat-model")).toBe("gpt-6.1-sol");
  first.unmount();

  let revealCatalog!: (snapshot: ChatSnapshot) => void;
  const pendingCatalog = new Promise<ChatSnapshot>((resolve) => { revealCatalog = resolve; });
  vi.mocked(window.readerExample.chat.getState).mockReturnValue(pendingCatalog);
  vi.mocked(window.readerExample.chat.connect).mockReturnValue(pendingCatalog);
  render(<App />);
  expect((screen.getByRole("combobox", { name: "Choose AI model" }) as HTMLSelectElement).value).toBe("gpt-5.6-sol");
  expect(window.localStorage.getItem("deep-reader-last-chat-model")).toBe("gpt-6.1-sol");
  await act(async () => { revealCatalog({ ...chat, models }); });
  await waitFor(() => expect((screen.getByRole("combobox", { name: "Choose AI model" }) as HTMLSelectElement).value).toBe("gpt-6.1-sol"));
});

test("F50 copies the selected reading conversation and reports clipboard failure", async () => {
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const saved: ChatSnapshot = {
    ...chat,
    activeConversationId: "conversation-1",
    conversations: [{ id: "conversation-1", title: "Question", createdAt: 1, updatedAt: 2,
      source: { bookTitle: book.title, chapterTitle: chapter.title } }],
    messages: [{ id: "user-1", turnId: "turn-1", role: "user", text: "Explain", status: "completed",
      readingSource: { bookTitle: book.title, chapterTitle: chapter.title, readingSegment: "Complete passage" } }]
  };
  vi.mocked(window.readerExample.chat.getState).mockResolvedValue(saved);
  vi.mocked(window.readerExample.chat.connect).mockResolvedValue(saved);
  render(<App />);
  const button = await screen.findByRole("button", { name: "Copy conversation" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0]![0]).toContain("Complete passage");
  await screen.findByText("Copied");

  const history = screen.getByRole("button", { name: "Conversation history" });
  const shortcutNames = ['Reading Guide', 'Guided Learning', 'Take a Quiz', 'Retell', 'Create Video', 'Create Note'];
  for (const name of shortcutNames) expect(screen.getByRole('button', { name })).toBeTruthy();
  fireEvent.click(history);
  for (const name of shortcutNames) expect(screen.queryByRole('button', { name })).toBeNull();
  expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(button);
  expect(writeText).toHaveBeenCalledTimes(1);
  fireEvent.click(history);
  for (const name of shortcutNames) expect(screen.getByRole('button', { name })).toBeTruthy();
  expect((button as HTMLButtonElement).disabled).toBe(false);

  writeText.mockRejectedValueOnce(new Error("denied"));
  fireEvent.click(button);
  await screen.findByText(/Unable to copy conversation: denied/);
});

test("F33 reader notes preserve the article, range, conversation draft and selected note across tabs", async () => {
  vi.mocked(window.readerExample.readingNotes.list).mockResolvedValue([savedNote]);
  render(<App />);
  const article = await screen.findByLabelText("Read This First chapter content");
  // Let initial reading-position restoration finish before simulating a reader scroll.
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
  const scroll = article.closest(".reader-scroll")!;
  scroll.scrollTop = 120;
  const rangeBefore = article.parentElement!.textContent;
  const composer = screen.getByRole("textbox", { name: "Ask about the current reading range" });
  fireEvent.change(composer, { target: { value: "Keep my question" } });
  fireEvent.click(await screen.findByRole("button", { name: "Notes 1" }));
  const panel = screen.getByRole("tabpanel", { name: "Notes" });
  fireEvent.click(await within(panel).findByRole("button", { name: /A saved reading note/ }));
  expect(await within(panel).findByRole("heading", { name: savedNote.title })).toBeTruthy();
  expect(panel.querySelector(".reader-notes-preview")!.textContent).toContain("Manual content");
  expect(panel.querySelector('[contenteditable="true"]')).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "AI Tutor" }));
  expect(screen.getByRole("textbox", { name: "Ask about the current reading range" })).toBe(composer);
  expect((composer as HTMLTextAreaElement).value).toBe("Keep my question");
  fireEvent.click(screen.getByRole("button", { name: "Collapse side panel" }));
  fireEvent.click(screen.getByRole("button", { name: "Notes 1" }));
  expect(within(screen.getByRole("tabpanel", { name: "Notes" })).getByRole("heading", { name: savedNote.title })).toBeTruthy();
  expect(screen.getByLabelText("Read This First chapter content")).toBe(article);
  expect(scroll.scrollTop).toBe(120);
  expect(article.parentElement!.textContent).toBe(rangeBefore);
});

test("F33 saving a reader draft updates the count without a saved notice", async () => {
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  await waitFor(() => expect((screen.getByRole("button", { name: "Create Note" }) as HTMLButtonElement).disabled).toBe(false));
  await act(async () => { await new Promise<void>((resolve) => requestAnimationFrame(() => resolve())); });
  fireEvent.click(screen.getByRole("button", { name: "Create Note" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Reading note title" }), {
    target: { value: savedNote.title }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  const notesButton = await screen.findByRole("button", { name: "Notes 1" });
  expect(screen.queryByRole("status", { name: "Note saved" })).toBeNull();
  fireEvent.click(notesButton);
  fireEvent.click(await within(screen.getByRole("tabpanel", { name: "Notes" })).findByRole("button", { name: /A saved reading note/ }));
  expect(await screen.findByRole("heading", { name: savedNote.title })).toBeTruthy();
  expect(screen.getByLabelText("Read This First chapter content")).toBeTruthy();
});

test("F33 library navigation opens the full notes library", async () => {
  vi.mocked(window.readerExample.readingNotes.list).mockResolvedValue([savedNote]);
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  fireEvent.click(await screen.findByRole("button", { name: "Notes 1" }));
  fireEvent.click(screen.getByRole("button", { name: /^Notes$/ }));
  await screen.findByRole("region", { name: "Reading Notes Library" });
});

test("F33 Edit opens the saved note front and flushes changes back to the sidebar", async () => {
  vi.mocked(window.readerExample.readingNotes.list).mockResolvedValue([savedNote]);
  vi.mocked(window.readerExample.readingNotes.update).mockImplementation(async (input) => ({
    ...savedNote, ...input, id: savedNote.id, revision: 2
  }));
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  fireEvent.click(await screen.findByRole("button", { name: "Notes 1" }));
  fireEvent.click(screen.getByRole("button", { name: /A saved reading note/ }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit reading note" });
  const title = within(dialog).getByRole("textbox", { name: "Reading note title" }) as HTMLTextAreaElement;
  expect(title.readOnly).toBe(false);
  fireEvent.change(title, { target: { value: "Updated from reader" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close reading note" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByRole("heading", { name: "Updated from reader" })).toBeTruthy();
  expect(window.readerExample.readingNotes.update).toHaveBeenCalledOnce();
});

test("F33 changing chapters resets note selection, search and scope", async () => {
  const next = { ...chapter, chapterId: "chapter-2", title: "Next chapter" };
  const nextBook = { ...book, chapters: [...book.chapters,
    { id: next.chapterId, title: next.title, href: "next.xhtml", order: 1 }] };
  window.readerExample = readerApi(nextBook);
  vi.mocked(window.readerExample.library.getChapterContent).mockImplementation(async (_bookId, chapterId) =>
    chapterId === next.chapterId ? next : chapter);
  vi.mocked(window.readerExample.readingNotes.list).mockResolvedValue([savedNote]);
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  fireEvent.click(await screen.findByRole("button", { name: "Notes 1" }));
  fireEvent.click(screen.getByRole("button", { name: "This book" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "saved" } });
  fireEvent.click(screen.getByRole("button", { name: /A saved reading note/ }));
  fireEvent.click(screen.getByRole("button", { name: /Next chapter/ }));
  await screen.findByLabelText("Next chapter chapter content");
  await screen.findByText("No notes in this chapter yet.");
  expect(screen.getByRole("button", { name: "This chapter" }).getAttribute("aria-pressed")).toBe("true");
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("heading", { name: savedNote.title })).toBeNull();
});

test("F33 saving a note from the reading conversation refreshes the sidebar", async () => {
  const draftChat: ChatSnapshot = { ...chat, activeConversationId: "conversation-1",
    conversations: [{ id: "conversation-1", title: "Reading", createdAt: 1, updatedAt: 1,
      source: { bookTitle: book.title, chapterTitle: chapter.title } }], messages: [{
    id: "draft-message", turnId: "turn", role: "assistant", status: "completed",
    text: "```reading-note-draft\n" + JSON.stringify({
      version: 2, draftId: "draft-1", title: savedNote.title, content: "Manual content"
    }) + "\n```"
  }] };
  vi.mocked(window.readerExample.chat.getState).mockResolvedValue(draftChat);
  vi.mocked(window.readerExample.chat.connect).mockResolvedValue(draftChat);
  vi.mocked(window.readerExample.chat.prepareReadingNoteDraft).mockResolvedValue({ draftId: "draft-1", title: savedNote.title,
    content: savedNote.content, markdown: "Manual content", stagedAttachmentIds: [],
    source: { bookTitle: book.title, chapterTitle: chapter.title, readingSegment: "Welcome" } });
  vi.mocked(window.readerExample.chat.saveReadingNoteDraft).mockImplementation(async () => {
    vi.mocked(window.readerExample.readingNotes.list).mockResolvedValue([savedNote]);
    return savedNote;
  });
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  fireEvent.click(await screen.findByRole("button", { name: /Review and save/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Save note" }));
  await screen.findByRole("button", { name: "Notes 1" });
  expect(window.readerExample.chat.saveReadingNoteDraft).toHaveBeenCalledWith(expect.objectContaining({ draftId: "draft-1", title: savedNote.title }));
});

test("returning from Reading Notes after saving keeps the chapter context menu available", async () => {
  render(<App />);

  const chapterArticle = await screen.findByLabelText("Read This First chapter content");
  await waitFor(() => expect(
    (screen.getByRole("button", { name: "Create Note" }) as HTMLButtonElement).disabled
  ).toBe(false));

  fireEvent.click(screen.getByRole("button", { name: "Create Note" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "Reading note title" }), {
    target: { value: "A saved reading note" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create a reading note" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Notes" }));
  await screen.findByRole("region", { name: "Reading Notes Library" });
  fireEvent.click(await screen.findByRole("button", { name: "Back to books" }));

  const restoredArticle = await screen.findByLabelText("Read This First chapter content");
  expect(restoredArticle).not.toBe(chapterArticle);
  const paragraph = restoredArticle.querySelector("p")!;
  const paragraphText = paragraph.firstChild!;
  const selectionRange = document.createRange();
  selectionRange.setStart(paragraphText, 0);
  selectionRange.setEnd(paragraphText, "Welcome".length);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(selectionRange);
  fireEvent.contextMenu(paragraph, { clientX: 120, clientY: 180 });

  expect(await screen.findByRole("menu", { name: "Set reading range" })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Move start here/ })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: /Move end here/ })).toBeTruthy();
  expect(screen.getByRole("menuitem", { name: "白話說明" })).toBeTruthy();
});

test("closing an empty reading-note draft keeps the chapter context menu available", async () => {
  render(<App />);

  const chapterArticle = await screen.findByLabelText("Read This First chapter content");
  await waitFor(() => expect(
    (screen.getByRole("button", { name: "Create Note" }) as HTMLButtonElement).disabled
  ).toBe(false));

  fireEvent.click(screen.getByRole("button", { name: "Create Note" }));
  fireEvent.click(await screen.findByRole("button", { name: "Close reading note draft" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Create a reading note" })).toBeNull());
  fireEvent.contextMenu(chapterArticle.querySelector("p")!, { clientX: 120, clientY: 180 });

  expect(await screen.findByRole("menu", { name: "Set reading range" })).toBeTruthy();
});

test("a persisted annotation remains rendered after a delayed chat state commit", async () => {
  const annotatedBook: LibraryBook = {
    ...book,
    chapterAnnotations: {
      [chapter.chapterId]: [
        {
          id: "annotation-welcome",
          start: "Read This First".length,
          end: "Read This FirstWelcome".length,
          text: "Welcome"
        },
        {
          id: "annotation-stale",
          start: 0,
          end: "Read".length,
          text: "Outdated"
        }
      ]
    }
  };
  const api = readerApi(annotatedBook);
  let notifyChatState: ((snapshot: ChatSnapshot) => void) | undefined;
  api.chat.onStateChanged = vi.fn((listener) => {
    notifyChatState = listener;
    return () => undefined;
  });
  window.readerExample = api;

  render(<App />);

  const article = await screen.findByLabelText("Read This First chapter content");
  await waitFor(() => expect(
    article.querySelector('[data-annotation-id="annotation-welcome"]')?.textContent
  ).toBe("Welcome"));

  act(() => notifyChatState?.({
    ...chat,
    connectionDetail: "Connection state updated after chapter render"
  }));

  expect(
    article.querySelector('[data-annotation-id="annotation-welcome"]')?.textContent
  ).toBe("Welcome");
  expect(article.querySelector('[data-annotation-id="annotation-stale"]')).toBeNull();
});

test("an existing annotation changes color from its context menu and persists the update", async () => {
  const annotatedBook: LibraryBook = {
    ...book,
    chapterAnnotations: {
      [chapter.chapterId]: [{
        id: "annotation-welcome",
        start: "Read This First".length,
        end: "Read This FirstWelcome".length,
        text: "Welcome",
        color: "yellow"
      }]
    }
  };
  const api = readerApi(annotatedBook);
  api.library.saveAnnotations = vi.fn(async (input: SaveAnnotationsInput) => ({
    ...annotatedBook,
    chapterAnnotations: {
      [chapter.chapterId]: input.annotations.map((annotation) => ({ ...annotation }))
    }
  }));
  window.readerExample = api;

  render(<App />);

  const article = await screen.findByLabelText("Read This First chapter content");
  await waitFor(() => expect(article.querySelector(
    '[data-annotation-id="annotation-welcome"]'
  )).not.toBeNull());
  const mark = article.querySelector<HTMLElement>('[data-annotation-id="annotation-welcome"]');
  expect(mark?.dataset.annotationColor).toBe("yellow");

  fireEvent.contextMenu(mark!, { clientX: 120, clientY: 180 });
  fireEvent.click(await screen.findByRole("menuitemradio", {
    name: "Change annotation color to pink"
  }));

  await waitFor(() => expect(api.library.saveAnnotations).toHaveBeenCalledWith({
    bookId: book.id,
    chapterId: chapter.chapterId,
    annotations: [{
      id: "annotation-welcome",
      start: "Read This First".length,
      end: "Read This FirstWelcome".length,
      text: "Welcome",
      color: "pink"
    }]
  }));
  await waitFor(() => expect(
    article.querySelector<HTMLElement>('[data-annotation-id="annotation-welcome"]')
      ?.dataset.annotationColor
  ).toBe("pink"));
});

test("a newly created annotation survives save and delayed chat state commits", async () => {
  const api = readerApi();
  let notifyChatState: ((snapshot: ChatSnapshot) => void) | undefined;
  api.chat.onStateChanged = vi.fn((listener) => {
    notifyChatState = listener;
    return () => undefined;
  });
  api.library.saveAnnotations = vi.fn(async (input: SaveAnnotationsInput) => ({
    ...book,
    chapterAnnotations: {
      [chapter.chapterId]: input.annotations.map((annotation) => ({ ...annotation }))
    }
  }));
  window.readerExample = api;

  render(<App />);

  const article = await screen.findByLabelText("Read This First chapter content");
  fireEvent.click(screen.getByRole("button", { name: "Use yellow annotation" }));
  expect(screen.getByRole("button", { name: "Turn off yellow annotation mode" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use green annotation" }));
  expect(screen.getByRole("button", { name: "Use yellow annotation" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Turn off green annotation mode" })).toBeTruthy();
  const paragraphText = article.querySelector("p")!.firstChild!;
  const selectionRange = document.createRange();
  selectionRange.setStart(paragraphText, 0);
  selectionRange.setEnd(paragraphText, "Welcome".length);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(selectionRange);
  fireEvent.mouseUp(article.querySelector("p")!);

  await waitFor(() => expect(
    article.querySelector("mark[data-annotation-id]")?.textContent
  ).toBe("Welcome"));
  await waitFor(() => expect(api.library.saveAnnotations).toHaveBeenCalledTimes(1));
  expect(api.library.saveAnnotations).toHaveBeenCalledWith(expect.objectContaining({
    annotations: [expect.objectContaining({ color: "green", text: "Welcome" })]
  }));
  expect(article.querySelector<HTMLElement>("mark[data-annotation-id]")?.dataset.annotationColor)
    .toBe("green");

  fireEvent.click(screen.getByRole("button", { name: "Turn off green annotation mode" }));
  expect(screen.getByRole("button", { name: "Use green annotation" })).toBeTruthy();

  act(() => notifyChatState?.({
    ...chat,
    connectionDetail: "Connection state updated after annotation save"
  }));

  expect(article.querySelector("mark[data-annotation-id]")?.textContent).toBe("Welcome");
});

test("annotation tool color selection is temporary across app mounts", async () => {
  const firstMount = render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  fireEvent.click(screen.getByRole("button", { name: "Use purple annotation" }));
  expect(screen.getByRole("button", { name: "Turn off purple annotation mode" })).toBeTruthy();

  firstMount.unmount();
  window.readerExample = readerApi();
  render(<App />);

  await screen.findByLabelText("Read This First chapter content");
  expect(screen.getByRole("button", { name: "Use purple annotation" })).toBeTruthy();
});

// B34: geometry represents three visual lines in one paragraph.
test.each([
  { name: "START line with invisible chapter-ending whitespace", start: 7, end: 18, from: 5, to: 10, enabled: true, trailing: true },
  { name: "START line", start: 7, end: 10, from: 5, to: 10, enabled: true },
  { name: "END line", start: 5, end: 8, from: 5, to: 10, enabled: true },
  { name: "both boundary markers on one line", start: 7, end: 8, from: 5, to: 10, enabled: true },
  { name: "before START line", start: 7, end: 8, from: 4, to: 10, enabled: false },
  { name: "after END line", start: 7, end: 8, from: 5, to: 11, enabled: false },
  { name: "empty reading range", start: 7, end: 7, from: 5, to: 10, enabled: false },
  { name: "layout changes before sending", start: 7, end: 8, from: 5, to: 10, enabled: true, reflow: true }
].flatMap((scenario) => [
  { ...scenario, action: "白話說明", elaborate: false },
  { ...scenario, action: "詳細闡明", elaborate: true }
]))("$action validates the visual reading segment: $name", async ({ start, end, from, to, enabled, reflow, trailing, action, elaborate }) => {
  let lineWidth = 5;
  vi.spyOn(Range.prototype, "getBoundingClientRect").mockImplementation(function (this: Range) {
    if (this.startContainer.parentElement?.tagName !== "P") return new DOMRect(0, 0, 0, 0);
    return new DOMRect(0, Math.floor(this.startOffset / lineWidth) * 20, 10, 20);
  });
  const api = readerApi({
    ...book,
    chapterRanges: { [chapter.chapterId]: { start, end } }
  }, { ...chapter, contentHtml: "<p>AAAAABBBBBCCCCC</p>" + (trailing ? "\n  " : "") });
  window.readerExample = api;
  render(<App />);
  const article = await screen.findByLabelText("Read This First chapter content");
  await waitFor(() => expect(
    (screen.getByRole("button", { name: "Create Note" }) as HTMLButtonElement).disabled
  ).toBe(start === end));
  const paragraph = article.querySelector("p")!;
  const node = paragraph.firstChild!;
  const selected = document.createRange();
  selected.setStart(node, from);
  selected.setEnd(node, to);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(selected);
  const caret = document.createRange();
  caret.setStart(node, from);
  caret.collapse(true);
  Object.defineProperty(document, "caretRangeFromPoint", {
    configurable: true, value: () => caret
  });
  try {
    fireEvent.contextMenu(paragraph, { clientX: 120, clientY: 180 });
    const explain = await screen.findByRole("menuitem", { name: action }) as HTMLButtonElement;
    expect(explain.disabled).toBe(!enabled);
    if (reflow) lineWidth = 1;
    fireEvent.click(explain);
    if (enabled && !reflow) {
      await waitFor(() => expect(api.chat.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        text: elaborate ? "請詳細闡明這段原文，補足簡略帶過的背景、推理與例子" : "請用白話說明這段內容",
        ...(elaborate ? { intent: "explainReadingSegment" } : {}),
        quote: { text: "BBBBB" },
        context: expect.objectContaining({ readingSegment: trailing ? "BBBBBCCCCC" : "BBBBB" })
      })));
      expect(document.getSelection()!.rangeCount).toBe(0);
    } else {
      expect(api.chat.sendMessage).not.toHaveBeenCalled();
    }
    expect(api.library.saveReadingRange).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(document, "caretRangeFromPoint");
    document.getSelection()!.removeAllRanges();
  }
});


test("F71 guided learning uses the entire reading segment without a selection quote", async () => {
  const api = readerApi({ ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 5 } } },
    { ...chapter, contentHtml: "<p>ABCDE</p>" });
  window.readerExample = api;
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  const button = screen.getByRole("button", { name: "Guided Learning" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(api.chat.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    intent: "readingCoach",
    context: expect.objectContaining({ readingSegment: "ABCDE" })
  })));
  expect(vi.mocked(api.chat.sendMessage).mock.calls[0][0].quote).toBeUndefined();
});

test("F48: pasted image previews, can be removed, and sends with a question", async () => {
  const api = readerApi();
  window.readerExample = api;
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  const composer = screen.getByRole("textbox", { name: "Ask about the current reading range" });
  const image = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], "clip.png", { type: "image/png" });
  const item = { kind: "file", type: "image/png", getAsFile: () => image };
  fireEvent.paste(composer, { clipboardData: { items: [item] } });
  await screen.findByRole("img", { name: "待送出的圖片 1" });
  const card = composer.closest(".chat-composer-card")!;
  expect(Array.from(card.children, child => child.className)).toEqual([
    "conversation-note-picker", "chat-composer-input", "chat-composer-actions"
  ]);
  expect(card.querySelector(".chat-composer-input .chat-draft-images")).toBeTruthy();
  expect(card.querySelector(".chat-composer-input")?.firstElementChild?.className).toBe("chat-draft-images");
  expect((screen.getByRole("button", { name: "Send question" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "移除圖片 1" }));
  expect(screen.queryByRole("img", { name: "待送出的圖片 1" })).toBeNull();
  fireEvent.paste(composer, { clipboardData: { items: [item] } });
  await screen.findByRole("img", { name: "待送出的圖片 1" });
  fireEvent.change(composer, { target: { value: "What does this show?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(api.chat.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    text: "What does this show?",
    images: [expect.objectContaining({ dataUrl: expect.stringMatching(/^data:image\/png;base64,/) })]
  })));
  await waitFor(() => expect(screen.queryByRole("img", { name: "待送出的圖片 1" })).toBeNull());
});

test("F48: image-only question keeps the pasted image after send failure", async () => {
  const api = readerApi();
  vi.mocked(api.chat.sendMessage).mockRejectedValueOnce(new Error("Offline"));
  window.readerExample = api;
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  const composer = screen.getByRole("textbox", { name: "Ask about the current reading range" });
  const image = new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], "clip.png", { type: "image/png" });
  fireEvent.paste(composer, { clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => image }] } });
  await screen.findByRole("img", { name: "待送出的圖片 1" });
  fireEvent.click(screen.getByRole("button", { name: "Send question" }));
  await waitFor(() => expect(api.chat.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    text: "請幫我解讀這張圖片。",
    images: expect.any(Array)
  })));
  await screen.findByRole("alert");
  expect(screen.getByRole("img", { name: "待送出的圖片 1" })).toBeTruthy();
});

test("F48: a saved user message displays its pasted image", () => {
  const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  render(<ChatMessageList activeTurnId={null} messages={[{
    id: "user-image", turnId: "turn-1", role: "user", text: "Explain this",
    images: [{ dataUrl: image }], status: "completed"
  }]} />);
  expect((screen.getByRole("img", { name: "貼上的圖片 1" }) as HTMLImageElement).src).toBe(image);
});

test("F46: reading sidebar sends an in-range formula image with its surrounding text", async () => {
  const dataUrl = "data:image/png;base64,aGVsbG8=";
  const api = readerApi({ ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 11 } } },
    { ...chapter, contentHtml: `<p>Before<img src="${dataUrl}">after</p>` });
  window.readerExample = api;
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  const button = screen.getByRole("button", { name: "Guided Learning" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(api.chat.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    context: expect.objectContaining({
      readingSegment: "Before[Book image 1]after",
      images: [{ dataUrl }]
    })
  })));
});

test("AI Complete Note receives the original image from the marked reading range", async () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const api = readerApi({ ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 11 } } },
    { ...chapter, contentHtml: `<p>Before<img src="${dataUrl}">after</p>` });
  vi.mocked(api.readingNotes.ai.startCreate).mockResolvedValue({
    sessionId: "session-note", mode: "create", phase: "ready", messages: [],
    hasChanges: false, status: "Ready"
  });
  vi.mocked(api.readingNotes.ai.send).mockResolvedValue({
    sessionId: "session-note", mode: "create", phase: "ready", messages: [],
    hasChanges: false, status: "No proposal"
  });
  window.readerExample = api;
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  const create = screen.getByRole("button", { name: "Create Note" }) as HTMLButtonElement;
  await waitFor(() => expect(create.disabled).toBe(false));
  fireEvent.click(create);
  fireEvent.change(await screen.findByRole("textbox", { name: "Reading note title" }), {
    target: { value: "說明此圖" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "請說明原文圖片" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(api.readingNotes.ai.startCreate).toHaveBeenCalledWith({
    bookId: book.id, chapterId: chapter.chapterId, bookTitle: book.title, chapterTitle: chapter.title,
    readingSegment: "Before[Book image 1]after", images: [{ dataUrl }],
    userDraft: "Title: 說明此圖"
  }));
});

test("F58 AI Complete Note receives text only when image reading is disabled", async () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const api = readerApi({ ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 11 } } },
    { ...chapter, contentHtml: `<p>Before<img src="${dataUrl}">after</p>` });
  vi.mocked(api.readingNotes.ai.startCreate).mockResolvedValue({
    sessionId: "session-note", mode: "create", phase: "ready", messages: [],
    hasChanges: false, status: "Ready"
  });
  vi.mocked(api.readingNotes.ai.send).mockResolvedValue({
    sessionId: "session-note", mode: "create", phase: "ready", messages: [],
    hasChanges: false, status: "No proposal"
  });
  window.readerExample = api;
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  const create = screen.getByRole("button", { name: "Create Note" }) as HTMLButtonElement;
  await waitFor(() => expect(create.disabled).toBe(false));
  fireEvent.click(screen.getByRole("checkbox", { name: "讀取圖片" }));
  fireEvent.click(create);
  fireEvent.change(await screen.findByRole("textbox", { name: "Reading note title" }), {
    target: { value: "說明此圖" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "請說明原文圖片" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(api.readingNotes.ai.startCreate).toHaveBeenCalledWith({
    bookId: book.id, chapterId: chapter.chapterId, bookTitle: book.title, chapterTitle: chapter.title,
    readingSegment: "Beforeafter\n\n[Images omitted: image reading is disabled. Use only the supplied text.]",
    userDraft: "Title: 說明此圖"
  }));
});

test("F46: an image-only chapter can start a reading conversation", async () => {
  const dataUrl = "data:image/png;base64,aGVsbG8=";
  const api = readerApi({ ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 0 } } },
    { ...chapter, contentHtml: `<img src="${dataUrl}">` });
  window.readerExample = api;
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  const button = screen.getByRole("button", { name: "Guided Learning" }) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(api.chat.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
    context: expect.objectContaining({ readingSegment: "[Book image 1]", images: [{ dataUrl }] })
  })));
});

test('F39 completion opens another book note in the right sidebar without replacing the reader', async () => {
  const listeners = new Set<(snapshot: import('../src/shared/contracts').ReadingNoteMemoryImageSnapshot) => void>();
  const completed = { ...savedNote, id: 'completed-elsewhere', title: 'A finished visual', bookTitle: 'Another book', chapterTitle: 'Another chapter',
    memoryImages: { recall: { attachmentId: 'recall-ready', basedOnRevision: 1 }, understand: { attachmentId: 'front-ready', basedOnRevision: 1 } } };
  vi.mocked(window.readerExample.readingNotes.get).mockResolvedValue(completed);
  vi.mocked(window.readerExample.readingNotes.attachments.readDataUrl).mockResolvedValue("data:image/png;base64,AA==");
  window.readerExample.readingNotes.memoryImage!.onStateChanged = listener => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  render(<App />); await screen.findByText('Welcome to the chapter text.');
  const article = document.querySelector('article');
  fireEvent.click(screen.getByRole('button', { name: 'Collapse side panel' }));
  act(() => { for (const listener of listeners) listener({ noteId: completed.id, phase: 'ready', available: true, status: 'Saved', note: completed, completion: { sides: ['recall'] } }); });
  fireEvent.click(screen.getByRole('button', { name: 'Expand image activity' }));
  fireEvent.click(screen.getByRole('button', { name: 'View images for A finished visual' }));
  const preview = await screen.findByRole('region', { name: 'Note preview' });
  expect(await within(preview).findByAltText('Recall image for A finished visual')).toBeTruthy();
  expect(within(preview).getByText('Another book')).toBeTruthy();
  expect(document.querySelector('article')).toBe(article);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('tab', { name: /Notes/ }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('button', { name: 'Collapse side panel' })).toBeTruthy();
  fireEvent.click(within(preview).getByRole('button', { name: 'Flip to understanding image' }));
  expect(await within(preview).findByAltText('Understanding image')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Expand image activity' }));
  fireEvent.click(screen.getByRole('button', { name: 'View images for A finished visual' }));
  expect(await screen.findByAltText('Recall image for A finished visual')).toBeTruthy();
});

test("F40 voice mode uses the marked passage, preserves draft and stops when the panel is hidden", async () => {
  const stopTrack = vi.fn();
  const track = { enabled: true, stop: stopTrack, onended: null };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const previousMedia = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
  class Peer {
    connectionState = "new";
    onconnectionstatechange: (() => void) | null = null;
    ontrack = null;
    addTrack = vi.fn();
    createDataChannel = vi.fn(() => ({ onerror: null, close: vi.fn() }));
    createOffer = vi.fn(async () => ({ type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n" }));
    setLocalDescription = vi.fn(async () => {});
    setRemoteDescription = vi.fn(async () => { this.connectionState = "connected"; this.onconnectionstatechange?.(); });
    close = vi.fn();
  }
  vi.stubGlobal("RTCPeerConnection", Peer);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const voice = { start: vi.fn(async (input) => ({ sessionId: input.sessionId, sdp: "answer" })), stop: vi.fn(async () => {}) };
  window.readerExample.chat.voice = voice;
  try {
    render(<App />);
    await screen.findByText("Welcome to the chapter text.");
    const start = screen.getByRole("button", { name: "開始語音聊天" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByRole("textbox", { name: "Ask about the current reading range" }), { target: { value: "Keep this draft" } });
    fireEvent.click(start);
    await screen.findByText("可以開始說話");
    expect(voice.start).toHaveBeenCalledTimes(1);
    expect(voice.start.mock.calls[0][0].context).toMatchObject({ bookTitle: book.title, chapterTitle: chapter.title });
    expect(voice.start.mock.calls[0][0].context.readingSegment).toContain("Welcome to the chapter text.");
    expect(window.readerExample.chat.sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "麥克風靜音" }));
    expect(track.enabled).toBe(false);
    expect(stopTrack).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "結束語音聊天" }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "Ask about the current reading range" }) as HTMLTextAreaElement).value).toBe("Keep this draft"));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    expect(voice.stop).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "開始語音聊天" }));
    await screen.findByText("可以開始說話");
    fireEvent.click(screen.getByRole("button", { name: "Collapse side panel" }));
    await waitFor(() => expect(voice.stop).toHaveBeenCalledTimes(2));
    expect(stopTrack).toHaveBeenCalledTimes(2);
  } finally {
    cleanup(); vi.unstubAllGlobals();
    if (previousMedia) Object.defineProperty(navigator, "mediaDevices", previousMedia);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

test("F40 voice entry is disabled before Codex is connected", async () => {
  window.readerExample.chat.voice = { start: vi.fn(), stop: vi.fn() };
  vi.mocked(window.readerExample.chat.getState).mockResolvedValue({ ...chat, connection: "disconnected" });
  vi.mocked(window.readerExample.chat.connect).mockResolvedValue({ ...chat, connection: "disconnected" });
  render(<App />);
  await screen.findByText("Welcome to the chapter text.");
  const start = screen.getByRole("button", { name: "開始語音聊天" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  fireEvent.click(start);
  expect(window.readerExample.chat.voice.start).not.toHaveBeenCalled();
});

test("B47 dismisses voice failures and clears stale notices when leaving the conversation panel", async () => {
  const previousMedia = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: vi.fn(async () => { throw new DOMException("Denied", "NotAllowedError"); })
  } });
  window.readerExample.chat.voice = { start: vi.fn(), stop: vi.fn() };
  try {
    render(<App />);
    await screen.findByText("Welcome to the chapter text.");
    const start = screen.getByRole("button", { name: "開始語音聊天" });
    await waitFor(() => expect((start as HTMLButtonElement).disabled).toBe(false));
    const draft = screen.getByRole("textbox", { name: "Ask about the current reading range" });
    fireEvent.change(draft, { target: { value: "Keep my draft after an error" } });
    fireEvent.click(start);
    await screen.findByText("語音暫時無法使用");
    fireEvent.click(screen.getByRole("button", { name: "關閉語音提示" }));
    expect(screen.queryByText("語音暫時無法使用")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "開始語音聊天" }));
    await screen.findByText("語音暫時無法使用");
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    fireEvent.click(screen.getByRole("tab", { name: "AI Tutor" }));
    expect(screen.queryByText("語音暫時無法使用")).toBeNull();
    expect((screen.getByRole("textbox", { name: "Ask about the current reading range" }) as HTMLTextAreaElement).value).toBe("Keep my draft after an error");
  } finally {
    cleanup();
    if (previousMedia) Object.defineProperty(navigator, "mediaDevices", previousMedia);
    else Reflect.deleteProperty(navigator, "mediaDevices");
  }
});

test("F41 changing chapters resets all-notes selection, search and scope", async () => {
  const next = { ...chapter, chapterId: "chapter-2", title: "Next chapter" };
  const nextBook = { ...book, chapters: [...book.chapters,
    { id: next.chapterId, title: next.title, href: "next.xhtml", order: 1 }] };
  window.readerExample = readerApi(nextBook);
  vi.mocked(window.readerExample.library.getChapterContent).mockImplementation(async (_bookId, chapterId) =>
    chapterId === next.chapterId ? next : chapter);
  vi.mocked(window.readerExample.readingNotes.list).mockResolvedValue([savedNote]);
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  fireEvent.click(await screen.findByRole("button", { name: "Notes 1" }));
  fireEvent.click(screen.getByRole("button", { name: "All notes" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "saved" } });
  fireEvent.click(screen.getByRole("button", { name: /A saved reading note/ }));
  fireEvent.click(screen.getByRole("button", { name: /Next chapter/ }));
  await screen.findByLabelText("Next chapter chapter content");
  await screen.findByText("No notes in this chapter yet.");
  expect(screen.getByRole("button", { name: "This chapter" }).getAttribute("aria-pressed")).toBe("true");
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  expect(screen.queryByRole("heading", { name: savedNote.title })).toBeNull();
});


test("F41 cross-book editing preserves reading and the current chapter count", async () => {
  const crossBook = { ...savedNote, id: "cross-book", bookTitle: "Another book", title: "Cross-book idea" };
  vi.mocked(window.readerExample.readingNotes.list).mockResolvedValue([savedNote, crossBook]);
  vi.mocked(window.readerExample.readingNotes.update).mockImplementation(async (input) => ({
    ...crossBook, ...input, id: crossBook.id, revision: 2
  }));
  render(<App />);
  const article = await screen.findByLabelText("Read This First chapter content");
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
  const scroll = article.closest(".reader-scroll")!;
  scroll.scrollTop = 120;
  const rangeBefore = article.parentElement!.textContent;
  fireEvent.click(await screen.findByRole("button", { name: "Notes 1" }));
  expect(screen.queryByRole("button", { name: /Cross-book idea/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All notes" }));
  fireEvent.click(screen.getByRole("button", { name: /Cross-book idea/ }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const dialog = await screen.findByRole("dialog", { name: "Edit reading note" });
  const title = within(dialog).getByRole("textbox", { name: "Reading note title" }) as HTMLTextAreaElement;
  expect(title.readOnly).toBe(false);
  fireEvent.change(title, { target: { value: "Updated from reader" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Close reading note" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(await screen.findByRole("heading", { name: "Updated from reader" })).toBeTruthy();
  expect(window.readerExample.readingNotes.update).toHaveBeenCalledOnce();
  expect(window.readerExample.readingNotes.update).toHaveBeenCalledWith(expect.objectContaining({ id: crossBook.id }));
  expect(screen.getByLabelText("Read This First chapter content")).toBe(article);
  expect(scroll.scrollTop).toBe(120);
  expect(article.parentElement!.textContent).toBe(rangeBefore);
  expect(screen.getByRole("button", { name: "Notes 1" })).toBeTruthy();
  fireEvent.click(within(screen.getByRole("tabpanel", { name: "Notes" })).getByRole("button", { name: "Notes" }));
  expect(screen.getByRole("button", { name: /Updated from reader.*Another book/ })).toBeTruthy();
});

test('F45 T8: practice navigation keeps the reading chapter and adds the focus workspace', async () => {
  window.readerExample.practice = {
    list: vi.fn(async () => ({ version: 1 as const, revision: 0, pins: [] })),
    setPinned: vi.fn(async () => ({ version: 1 as const, revision: 0, pins: [] }))
  };
  render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  expect(screen.queryByRole('button', { name: /Import EPUB/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Pinned Notes' }));
  await screen.findByRole('button', { name: 'Pin your first note' });
  expect(screen.queryByRole('button', { name: /Import EPUB/ })).toBeNull();
  expect(document.querySelector('.workspace-shell.practice-active')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Bookshelf/ }));
  expect(screen.getByRole('button', { name: /Import EPUB/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Continue reading American Accent Training' }));
  await screen.findByText('Welcome to the chapter text.');
  expect(screen.queryByRole('button', { name: /Import EPUB/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Pin your first note' })).toBeNull();
});

test('F59 Videos tab uses the reader scope and keyboard navigation preserves the reading composer', async () => {
  window.readerExample.conceptVideos = {
    capability: vi.fn(async () => ({ aiAllowed: false, generationAllowed: false, reason: 'Unavailable' })),
    list: vi.fn(async () => []), get: vi.fn(), create: vi.fn(), save: vi.fn(), append: vi.fn(), compare: vi.fn(), generate: vi.fn(), cancel: vi.fn(), adopt: vi.fn(), media: vi.fn(), poster: vi.fn(), remove: vi.fn(), requestAi: vi.fn()
  };
  render(<App />);
  const article = await screen.findByLabelText('Read This First chapter content');
  const composer = screen.getByRole('textbox', { name: 'Ask about the current reading range' });
  fireEvent.change(composer, { target: { value: 'Keep this reading question' } });
  const tutor = screen.getByRole('tab', { name: 'AI Tutor' });
  fireEvent.keyDown(tutor, { key: 'ArrowRight' });
  const notes = screen.getByRole('tab', { name: 'Notes' });
  expect(notes.getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(notes);
  fireEvent.keyDown(notes, { key: 'ArrowRight' });
  const videos = screen.getByRole('tab', { name: 'Videos' });
  expect(videos.getAttribute('aria-selected')).toBe('true'); expect(document.activeElement).toBe(videos);
  const panel = screen.getByRole('tabpanel', { name: 'Videos' });
  await within(panel).findByText('No videos in this chapter yet.');
  expect(screen.queryByRole('textbox', { name: 'Ask about the current reading range' })).toBeNull();
  fireEvent.keyDown(videos, { key: 'Home' });
  expect(document.activeElement).toBe(tutor); expect(tutor.getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('textbox', { name: 'Ask about the current reading range' })).toBe(composer);
  expect((composer as HTMLTextAreaElement).value).toBe('Keep this reading question');
  fireEvent.keyDown(tutor, { key: 'End' });
  expect(document.activeElement).toBe(videos);
  fireEvent.click(within(screen.getByRole('tabpanel', { name: 'Videos' })).getByRole('button', { name: 'Create video' }));
  expect(screen.getByRole('textbox', { name: 'Describe your video idea' })).toBeTruthy();
  fireEvent.keyDown(tutor, { key: 'End' });
  expect(screen.getByRole('tabpanel', { name: 'Videos' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Describe your video idea' })).toBeNull();
  expect(screen.getByLabelText('Read This First chapter content')).toBe(article);
});


test.each([false, true])('B63 new video source follows reading image preference: %s', async readImages => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  window.readerExample = readerApi(book, { ...chapter, contentHtml: `<p>Welcome to the chapter text.</p><img src="${image}">` });
  const create = vi.fn(async () => { throw new Error('Stop after source capture'); });
  window.readerExample.conceptVideos = {
    capability: vi.fn(async () => ({ aiAllowed: true, generationAllowed: false as const, reason: 'Fixture' })),
    list: vi.fn(async () => []), get: vi.fn(), create, save: vi.fn(), append: vi.fn(), compare: vi.fn(), generate: vi.fn(), cancel: vi.fn(), adopt: vi.fn(), media: vi.fn(), poster: vi.fn(), remove: vi.fn(), requestAi: vi.fn()
  };
  render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  await waitFor(() => expect(document.querySelector('[data-range-boundary="start"]')).not.toBeNull());
  if (!readImages) fireEvent.click(screen.getByRole('checkbox', { name: '讀取圖片' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create Video' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe your video idea' }), { target: { value: 'Compare methods' } });
  const send = await screen.findByRole('button', { name: 'Send' }) as HTMLButtonElement;
  await waitFor(() => expect(send.disabled).toBe(false));
  fireEvent.click(send);
  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const { source } = (create.mock.calls as unknown as [{ source: { images: { dataUrl: string }[]; readingSegment: string } }][])[0][0];
  expect(source.images).toEqual(readImages ? [{ dataUrl: image }] : []);
  expect(source.readingSegment).toContain('Welcome to the chapter text.');
  if (readImages) expect(source.readingSegment).toContain('[Book image 1]');
  else {
    expect(source.readingSegment).not.toContain('[Book image');
    expect(source.readingSegment).toContain('Images omitted: image reading is disabled');
  }
  await screen.findByText('Stop after source capture');
});

test('F63: failed sends preserve the question and cross-book references; successful retry submits only IDs', async () => {
  const note = { ...savedNote, id: 'cross-book-note', bookTitle: 'Another book' };
  vi.mocked(window.readerExample.readingNotes.listPage).mockResolvedValue({ items: [note] });
  vi.mocked(window.readerExample.chat.sendMessage).mockRejectedValueOnce(new Error('引用讀取失敗'));
  render(<App />); await screen.findByText('Welcome to the chapter text.');
  const composer = screen.getByRole('textbox', { name: 'Ask about the current reading range' });
  fireEvent.change(composer, { target: { value: '請參考這張筆記討論' } });
  fireEvent.click(screen.getByRole('button', { name: '引用筆記' }));
  fireEvent.click(await screen.findByRole('button', { name: /引用 A saved reading note Another book/ }));
  fireEvent.click(screen.getByRole('button', { name: '關閉筆記搜尋' }));
  fireEvent.submit(composer.closest('form')!);
  await screen.findByText('引用讀取失敗');
  expect((composer as HTMLTextAreaElement).value).toBe('請參考這張筆記討論');
  expect(screen.getByRole('button', { name: /移除引用 A saved reading note/ })).toBeTruthy();
  fireEvent.submit(composer.closest('form')!);
  await waitFor(() => expect(vi.mocked(window.readerExample.chat.sendMessage)).toHaveBeenCalledTimes(2));
  await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(''));
  const input = vi.mocked(window.readerExample.chat.sendMessage).mock.calls[1]![0];
  expect(input.noteReferenceIds).toEqual([note.id]); expect(input).not.toHaveProperty('noteReferences');
  expect(screen.queryByRole('button', { name: /移除引用 A saved reading note/ })).toBeNull();
});

test('F63 reference card opens the existing central editor and its AI editing panel with the latest note', async () => {
  const reference = { id: savedNote.id, revision: 1, title: savedNote.title, content: savedNote.content, bookTitle: savedNote.bookTitle, chapterTitle: savedNote.chapterTitle };
  const state: ChatSnapshot = { ...chat, messages: [{ id: 'quote', role: 'user', text: '討論這張筆記', status: 'completed', turnId: null, noteReferences: [reference] }] };
  vi.mocked(window.readerExample.chat.getState).mockResolvedValue(state);
  vi.mocked(window.readerExample.chat.connect).mockResolvedValue(state);
  vi.mocked(window.readerExample.readingNotes.get).mockResolvedValue({ ...savedNote, revision: 4, title: '最新標題' });
  render(<App />);
  await screen.findByText('Welcome to the chapter text.');
  fireEvent.change(screen.getByRole('textbox', { name: 'Ask about the current reading range' }), { target: { value: '尚未送出的問題' } });
  fireEvent.click(await screen.findByRole('button', { name: /開啟筆記 A saved reading note/ }));
  expect(await screen.findByRole('textbox', { name: 'Reading note title' })).toHaveProperty('value', '最新標題');
  expect(document.querySelector('.conversation-note-history details')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open AI editor' }));
  expect(screen.getByRole('complementary', { name: 'AI editing conversation' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close reading note' }));
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Reading note title' })).toBeNull());
  expect(screen.getByRole('textbox', { name: 'Ask about the current reading range' })).toHaveProperty('value', '尚未送出的問題');
  expect(window.readerExample.readingNotes.update).not.toHaveBeenCalled();
});

test('B69 update preview reuses the note canvas; comparing and closing never saves', async () => {
  vi.mocked(window.readerExample.readingNotes.get).mockResolvedValue(savedNote);
  const content = markdownToReadingNoteDocument('整合後的理解');
  const proposal = { id: 'edit', noteId: savedNote.id, baseRevision: savedNote.revision,
    originalTitle: savedNote.title, title: '編修後標題', summary: '調整第一段', status: 'pending' as const,
    originalContent: savedNote.content, content,
    changes: { replacements: [{ blockId: savedNote.content.blocks[0]!.id, content }], insertions: [] } };
  const state: ChatSnapshot = { ...chat, messages: [{ id: 'candidate', role: 'assistant', text: '已準備編修', status: 'completed', turnId: null, noteUpdates: [proposal] }] };
  vi.mocked(window.readerExample.chat.getState).mockResolvedValue(state);
  vi.mocked(window.readerExample.chat.connect).mockResolvedValue(state);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: '預覽編修' }));
  await screen.findByRole('dialog');
  expect(document.querySelector('.reading-note-editor-dialog .reading-note-revision')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Reading note title' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '修改前' }));
  expect(screen.getByRole('textbox', { name: 'Reading note title' })).toHaveProperty('value', savedNote.title);
  fireEvent.click(screen.getByRole('button', { name: '修改後' }));
  expect(screen.getByRole('textbox', { name: 'Reading note title' })).toHaveProperty('value', '編修後標題');
  fireEvent.click(screen.getByRole('button', { name: 'Close reading note' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '預覽編修' }));
  expect(window.readerExample.readingNotes.update).not.toHaveBeenCalled();
});

test('F65 TC1-5: follow-up, Next operation, Tab acceptance, draft and navigation safeguards', async () => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect());
  const custom = { ...chapter, contentHtml: '<p>First passage.</p><p>Second passage.</p><p>Third passage.</p>' };
  const rangedBook = { ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 14 } } };
  const api = readerApi(rangedBook, custom);
  const metadata = '\n```reading-input-suggestion\n{"repeat":"請用生活例子解釋這一段。","followUp":"這個差異可以再舉例嗎？"}\n```';
  const snapshot: ChatSnapshot = { ...chat, activeConversationId: 'f65', messages: [
    { id: 'u65', turnId: 't65', role: 'user', status: 'completed', text: '請用生活例子解釋', readingSource: { bookTitle: book.title, chapterTitle: chapter.title, readingSegment: 'First passage.' } },
    { id: 'a65', turnId: 't65', role: 'assistant', status: 'completed', text: '這是回答。' + metadata }
  ] };
  api.chat.getState = vi.fn(async () => snapshot);
  api.chat.connect = vi.fn(async () => snapshot);
  let notify: ((s: ChatSnapshot) => void) | undefined;
  api.chat.onStateChanged = fn => { notify = fn; return () => {}; };
  api.library.saveReadingRange = vi.fn(async input => ({ ...rangedBook, chapterRanges: { [chapter.chapterId]: input.range } }));
  window.readerExample = api;
  render(<App />);
  const input = await screen.findByRole('textbox', { name: 'Ask about the current reading range' }) as HTMLTextAreaElement;
  await screen.findByText('First passage.');
  await waitFor(() => expect(input.placeholder).toBe('這個差異可以再舉例嗎？'));
  expect(document.body.textContent).not.toContain('reading-input-suggestion');
  expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(true);
  expect(fireEvent.keyDown(input, { key: 'Tab', isComposing: true })).toBe(true);
  expect(input.value).toBe('');
  fireEvent.change(input, { target: { value: '自己的問題' } });
  expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
  expect(input.value).toBe('自己的問題');
  fireEvent.click(screen.getByRole('button', { name: /Next segment/ }));
  expect(input.value).toBe('自己的問題');
  fireEvent.change(input, { target: { value: '' } });
  await waitFor(() => expect(input.placeholder).toBe('請用生活例子解釋這一段。'));
  expect(api.chat.sendMessage).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(false);
  expect(input.value).toBe('請用生活例子解釋這一段。');
  expect(api.chat.sendMessage).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '請用兩個生活例子解釋這一段。' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(api.chat.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: '請用兩個生活例子解釋這一段。', readingSource: expect.objectContaining({ readingSegment: 'Second passage.' }) })));
  act(() => notify?.({ ...snapshot, activeConversationId: 'different', messages: [] }));
  await waitFor(() => expect(input.placeholder).toBe('Ask about the marked passage…'));
});

test('F65 TC4/5: Escape dismisses follow-up and failed or active turns never suggest', async () => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect());
  const api = readerApi({ ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 5 } } }, { ...chapter, contentHtml: '<p>First</p>' });
  const snapshot: ChatSnapshot = { ...chat, activeConversationId: 'f65-escape', messages: [
    { id: 'u', turnId: 't', role: 'user', status: 'completed', text: '解釋', readingSource: { bookTitle: book.title, chapterTitle: chapter.title, readingSegment: 'First' } },
    { id: 'a', turnId: 't', role: 'assistant', status: 'completed', text: '回答\n```reading-input-suggestion\n{"repeat":null,"followUp":"為什麼？"}\n```' }
  ] };
  api.chat.getState = vi.fn(async () => ({ ...snapshot, activeTurnId: 't' }));
  api.chat.connect = vi.fn(async () => ({ ...snapshot, activeTurnId: 't' }));
  let notify: ((s: ChatSnapshot) => void) | undefined;
  api.chat.onStateChanged = fn => { notify = fn; return () => {}; };
  window.readerExample = api;
  render(<App />);
  const input = await screen.findByRole('textbox', { name: 'Ask about the current reading range' }) as HTMLTextAreaElement;
  expect(input.placeholder).toBe('Ask about the marked passage…');
  act(() => notify?.({ ...snapshot, messages: snapshot.messages.map(m => m.role === 'assistant' ? { ...m, status: 'failed' } : m) }));
  expect(input.placeholder).toBe('Ask about the marked passage…');
  act(() => notify?.(snapshot));
  await waitFor(() => expect(input.placeholder).toBe('為什麼？'));
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input.placeholder).toBe('Ask about the marked passage…');
  expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
});

test.each(['Enter', 'button'] as const)('F65 TC3: directly send the visible default with %s and retry after failure', async method => {
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect());
  const custom = { ...chapter, contentHtml: '<p>First</p><p>Second</p>' };
  const rangedBook = { ...book, chapterRanges: { [chapter.chapterId]: { start: 0, end: 5 } } };
  const api = readerApi(rangedBook, custom);
  const snapshot: ChatSnapshot = { ...chat, activeConversationId: 'direct', messages: [
    { id: 'u', turnId: 't', role: 'user', status: 'completed', text: '用例子解釋', readingSource: { bookTitle: book.title, chapterTitle: chapter.title, readingSegment: 'First' } },
    { id: 'a', turnId: 't', role: 'assistant', status: 'completed', text: '回答\n```reading-input-suggestion\n{"repeat":"請用例子解釋這一段。","followUp":"可以再舉例嗎？"}\n```' }
  ] };
  api.chat.getState = vi.fn(async () => snapshot);
  api.chat.connect = vi.fn(async () => snapshot);
  api.chat.sendMessage = vi.fn().mockRejectedValueOnce(new Error('Try again')).mockRejectedValueOnce(new Error('Retry failed')).mockResolvedValue({ ...snapshot, activeTurnId: 'next-turn' });
  api.library.saveReadingRange = vi.fn(async input => ({ ...rangedBook, chapterRanges: { [chapter.chapterId]: input.range } }));
  window.readerExample = api;
  render(<App />);
  const input = await screen.findByRole('textbox', { name: 'Ask about the current reading range' }) as HTMLTextAreaElement;
  await waitFor(() => expect(input.placeholder).toBe('可以再舉例嗎？'));
  if (method === 'button') fireEvent.click(screen.getByRole('button', { name: /Next segment/ }));
  const suggestion = method === 'Enter' ? '可以再舉例嗎？' : '請用例子解釋這一段。';
  await waitFor(() => expect(input.placeholder).toBe(suggestion));
  const send = screen.getByRole('button', { name: 'Send question' }) as HTMLButtonElement;
  expect(input.value).toBe('');
  expect(send.disabled).toBe(false);
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
  expect(api.chat.sendMessage).not.toHaveBeenCalled();
  const submit = () => method === 'Enter' ? fireEvent.keyDown(input, { key: 'Enter' }) : fireEvent.click(send);
  submit();
  await screen.findByText('Try again');
  expect(input.value).toBe('');
  expect(input.placeholder).toBe(suggestion);
  expect(api.chat.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ text: suggestion, readingSource: expect.objectContaining({ readingSegment: method === 'Enter' ? 'First' : 'Second' }) }));
  submit();
  await screen.findByText('Retry failed');
  expect(api.chat.sendMessage).toHaveBeenCalledTimes(2);
  expect(api.chat.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ text: suggestion }));
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(send.disabled).toBe(true);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(api.chat.sendMessage).toHaveBeenCalledTimes(2);
  fireEvent.change(input, { target: { value: '我自己的問題' } });
  submit();
  await waitFor(() => expect(api.chat.sendMessage).toHaveBeenCalledTimes(3));
  expect(api.chat.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ text: '我自己的問題' }));
});


test('F71 TC1/9: 引導學習 sends the coach prompt and range while preserving the composer draft', async () => {
  render(<App />);
  await screen.findByLabelText('Read This First chapter content');
  const button = screen.getByRole('button', { name: 'Guided Learning' });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  const composer = screen.getByRole('textbox', { name: 'Ask about the current reading range' });
  fireEvent.change(composer, { target: { value: '保留我的草稿' } });
  fireEvent.click(button);
  await waitFor(() => expect(window.readerExample.chat.sendMessage).toHaveBeenCalled());
  const input = vi.mocked(window.readerExample.chat.sendMessage).mock.calls.at(-1)![0];
  expect(input.intent).toBe('readingCoach');
  expect(input.text).toContain('# AI 深度閱讀與理解教練');
  expect(input.text).toContain('### 7. 本次理解評估');
  expect(input.context?.readingSegment).toBeTruthy();
  expect((composer as HTMLTextAreaElement).value).toBe('保留我的草稿');
});


test("B75 reader note trash supports cancel, failure, pending and success", async () => {
  const api = window.readerExample.readingNotes;
  vi.mocked(api.list).mockResolvedValue([savedNote]);
  render(<App />);
  await screen.findByLabelText("Read This First chapter content");
  fireEvent.click(await screen.findByRole("button", { name: "Notes 1" }));
  fireEvent.click(screen.getByRole("button", { name: /A saved reading note/ }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const editor = await screen.findByRole("dialog", { name: "Edit reading note" });
  fireEvent.click(within(editor).getByRole("button", { name: "Move to Trash" }));
  let confirm = screen.getByRole("alertdialog");
  fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
  expect(api.trash).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Edit reading note" })).toBeTruthy();
  fireEvent.click(within(editor).getByRole("button", { name: "Move to Trash" }));
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.getByRole("dialog", { name: "Edit reading note" })).toBeTruthy();
  fireEvent.click(within(editor).getByRole("button", { name: "Move to Trash" }));
  vi.mocked(api.trash).mockRejectedValueOnce(new Error("Disk unavailable"));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Move to Trash" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Disk unavailable");
  expect(screen.getByRole("dialog", { name: "Edit reading note" })).toBeTruthy();
  let finish!: (note: ReadingNote) => void;
  vi.mocked(api.trash).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  confirm = screen.getByRole("alertdialog");
  fireEvent.click(within(confirm).getByRole("button", { name: "Move to Trash" }));
  expect((within(confirm).getByRole("button", { name: "Moving…" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  await act(async () => finish({ ...savedNote, revision: 2, trashedAt: 3 }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(screen.queryByRole("heading", { name: savedNote.title })).toBeNull();
  expect(await screen.findByRole("button", { name: "Notes 0" })).toBeTruthy();
  expect(api.trash).toHaveBeenLastCalledWith(savedNote.id);
});

test("F75 resumes a shelf book at the saved position even while animation frames are paused", async () => {
  const savedBook = { ...book, readingState: { ...book.readingState, scrollProgress: 0.46 } };
  window.readerExample = readerApi(savedBook);
  window.localStorage.setItem("deep-reader-last-location", JSON.stringify({ mode: "bookshelf", bookId: book.id }));
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  const { container } = render(<App />);
  const resume = await screen.findByRole("button", { name: "Continue reading American Accent Training" });
  const scroller = container.querySelector(".reader-scroll")!;
  Object.defineProperties(scroller, { scrollHeight: { value: 2500 }, clientHeight: { value: 500 } });
  fireEvent.click(resume);
  await screen.findByText("Welcome to the chapter text.");
  expect(scroller.scrollTop).toBe(920);
});
