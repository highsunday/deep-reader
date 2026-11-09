// @vitest-environment jsdom

import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, test, vi } from "vitest";
import { MyBookshelf } from "../src/renderer/MyBookshelf";
import { BookShelf } from "../src/renderer/App";
import type { LibraryBook } from "../src/shared/contracts";

afterEach(cleanup);

const book: LibraryBook = {
  id: "book-1",
  title: "First imported",
  author: "Example Author",
  chapters: [{ id: "chapter-1", title: "Chapter", href: "chapter.xhtml", order: 0 }],
  readingState: { view: "overview", chapterId: null, scrollProgress: 0 },
  chapterRanges: {},
  chapterAnnotations: {}
};

test("sidebar shows all pinned shortcuts under an unnumbered heading", () => {
  const pinned = Array.from({ length: 6 }, (_, i) => ({ ...book, id: String(i), title: `Title ${i}`, pinned: true }));
  const onSelect = vi.fn();
  const view = render(<BookShelf books={[book, ...pinned]} onSelect={onSelect} />);
  const list = within(screen.getByRole("navigation", { name: "Pinned books" }));
  assert.ok(screen.getByRole("button", { name: "Bookshelf" }));
  assert.equal(screen.getByRole("heading", { name: "Pinned books" }).textContent, "Pinned books");
  assert.equal(list.getAllByRole("button").length, 6);
  fireEvent.click(list.getByRole("button", { name: "Title 5" }));
  assert.equal(onSelect.mock.calls[0][0], pinned[5]);
  view.rerender(<BookShelf books={[book]} onSelect={onSelect} />);
  assert.equal(screen.queryByRole("navigation", { name: "Pinned books" }), null);
});

test("F75 shelf filters, searches and reads completed books alongside legacy in-progress titles", () => {
  const reading = { ...book, lastChapterId: book.chapters[0].id };
  const finished = { ...book, id: "finished", title: "Finished title", pinned: true, shelfStatus: "finished" as const };
  const unread = { ...book, id: "unread", title: "Unread title" };
  const onRead = vi.fn();
  render(<MyBookshelf importing={false} onImport={vi.fn()} books={[reading, finished, unread]} onRead={onRead} onPin={vi.fn()} onStatus={vi.fn()} />);
  assert.equal(screen.getAllByRole("article")[0].getAttribute("aria-label"), finished.title);
  fireEvent.click(screen.getByRole("button", { name: "Finished 1" }));
  fireEvent.click(screen.getByRole("button", { name: "Revisit Finished title" }));
  assert.equal(onRead.mock.calls[0][0], finished);
  fireEvent.click(screen.getByRole("button", { name: "Reading 1" }));
  const card = within(screen.getByRole("article", { name: reading.title }));
  assert.ok(card.getByText("Reading"));
  assert.equal(card.queryByText("Chapter"), null);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
  assert.ok(screen.getByText("No matching books"));
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  assert.equal(document.activeElement, screen.getByRole("searchbox"));
  assert.ok(screen.getByRole("article", { name: reading.title }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "FIRST" } });
  assert.equal(screen.getAllByRole("article").length, 1);
  fireEvent.click(screen.getByRole("button", { name: "To read 1" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  assert.ok(screen.getByRole("button", { name: "Start reading Unread title" }));
});

test("empty bookshelf header invokes import and disables repeat imports while pending", () => {
  const props = { books: [], onRead: vi.fn(), onPin: vi.fn(), onStatus: vi.fn(), onImport: vi.fn() };
  const view = render(<MyBookshelf {...props} importing={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Import EPUB" }));
  assert.equal(props.onImport.mock.calls.length, 1);
  view.rerender(<MyBookshelf {...props} importing />);
  assert.ok((screen.getByRole("button", { name: "Importing…" }) as HTMLButtonElement).disabled);
});

test("F76 book tag filter uses only book assignments and combines with title search", async () => {
  const tagsApi = {
    list: async () => [{ id: "topic", name: "Decisions" }, { id: "note-only", name: "Examples" }],
    create: vi.fn(), rename: vi.fn(), matchingIds: vi.fn(), change: vi.fn()
  };
  const bookTagsApi = { list: async () => ({ [book.id]: ["topic"] }), change: vi.fn() };
  const other = { ...book, id: "other", title: "Second book" };
  render(<MyBookshelf books={[book, other]} importing={false} tagsApi={tagsApi} bookTagsApi={bookTagsApi}
    onRead={vi.fn()} onPin={vi.fn()} onImport={vi.fn()} onStatus={vi.fn()} />);
  await screen.findByRole("option", { name: "Decisions" });
  const filter = screen.getByRole("combobox", { name: "Filter by book tag" });
  fireEvent.change(filter, { target: { value: "note-only" } });
  assert.ok(screen.getByText("No matching books"));
  fireEvent.change(filter, { target: { value: "topic" } });
  assert.deepEqual(screen.getAllByRole("article").map(card => card.getAttribute("aria-label")), [book.title]);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: other.title } });
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  assert.equal(screen.getAllByRole("article").length, 2);
});


test.each(["reading", "finished"] as const)("F77 TC1/5: %s can move to To read, retry on error and disable duplicate saves", async status => {
  const current = { ...book, shelfStatus: status, lastChapterId: book.chapters[0].id };
  let rejectSave!: (error: Error) => void;
  const onStatus = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { rejectSave = reject; }))
    .mockResolvedValue(undefined);
  const props = { importing: false, onImport: vi.fn(), onRead: vi.fn(), onPin: vi.fn(), onStatus };
  const view = render(<MyBookshelf {...props} books={[current]} />);
  const move = screen.getByRole("button", { name: "Move to To read", hidden: true });
  fireEvent.click(move);
  assert.deepEqual(onStatus.mock.calls[0][0], { bookId: book.id, status: "unread" });
  assert.equal((move as HTMLButtonElement).disabled, true);
  rejectSave(new Error("offline"));
  await screen.findByRole("alert", { hidden: true });
  assert.equal((move as HTMLButtonElement).disabled, false);
  assert.ok(screen.getByRole("button", { name: "To read 0" }));
  // jsdom does not implement the native popover API.
  const menu = move.closest('[popover]') as HTMLElement & { hidePopover(): void };
  menu.hidePopover = vi.fn();
  fireEvent.click(move);
  await waitFor(() => assert.equal(onStatus.mock.calls.length, 2));
  view.rerender(<MyBookshelf {...props} books={[{ ...current, shelfStatus: "unread" }]} />);
  fireEvent.click(screen.getByRole("button", { name: "To read 1" }));
  assert.ok(screen.getByRole("button", { name: `Start reading ${book.title}` }));
  assert.equal(screen.queryByRole("button", { name: "Move to To read", hidden: true }), null);
});
