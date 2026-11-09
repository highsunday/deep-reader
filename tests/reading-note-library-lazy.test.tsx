// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import type { ReaderDesktopApi, ReadingNote, ReadingNotePageInput, ReadingNoteSummary } from "../src/shared/contracts";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import { ReadingNoteLibrary } from "../src/renderer/ReadingNoteLibrary";

vi.mock("../src/renderer/ReadingNoteEditorDialog", () => ({
  ReadingNoteEditorDialog: ({ note, onClose }: { note?: ReadingNote; onClose(): void }) =>
    <div role="dialog">{note?.title}<button onClick={onClose}>Close note</button></div>
}));

const summaries: ReadingNoteSummary[] = Array.from({ length: 75 }, (_, index) => ({
  id: `note-${index}`, title: `Note ${index}`, bookTitle: "Book", chapterTitle: "Chapter",
  createdAt: 1000 - index, updatedAt: 1000 - index, revision: 1
}));

class Observer {
  static current?: Observer;
  constructor(private callback: IntersectionObserverCallback) { Observer.current = this; }
  observe() {}
  disconnect() {}
  trigger() { this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
}

function fixture() {
  const listPage = vi.fn(async ({ cursor }: ReadingNotePageInput) => cursor
    ? { items: summaries.slice(50), nextCursor: undefined }
    : { items: summaries.slice(0, 50), nextCursor: "next" });
  const get = vi.fn(async (id: string) => ({
    ...summaries.find(note => note.id === id)!, sourceDraftId: id,
    content: markdownToReadingNoteDocument("Full note content")
  }));
  const api = {
    list: vi.fn(), listPage, activeBookTitles: vi.fn(async () => ["Book"]), get,
    counts: vi.fn(async () => ({ active: 75, trashed: 0 })),
    attachments: { readDataUrl: vi.fn() }
  } as unknown as ReaderDesktopApi["readingNotes"];
  return { api, listPage, get };
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", Observer);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 1000; } });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 700; } });
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); Observer.current = undefined; });

test("library fetches summary pages on intersection and keeps mounted cards bounded", async () => {
  const f = fixture();
  const { container } = render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  await waitFor(() => expect(f.listPage).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(Observer.current).toBeDefined());
  expect(f.api.list).not.toHaveBeenCalled();
  expect(container.querySelectorAll(".reading-note-card-container").length).toBeLessThan(50);
  await act(async () => { Observer.current!.trigger(); Observer.current!.trigger(); });
  await waitFor(() => expect(f.listPage).toHaveBeenCalledTimes(2));
  expect(container.querySelectorAll(".reading-note-card-container").length).toBeLessThan(50);
  expect(f.get).not.toHaveBeenCalled();
  const root = container.querySelector<HTMLElement>(".reading-note-library-results")!;
  screen.getByText("Note 0").closest("button")!.focus();
  root.scrollTop = 9480;
  fireEvent.scroll(root);
  await waitFor(() => expect(screen.getByText("Note 60")).toBeDefined());
  expect(document.activeElement?.textContent).toContain("Note 0");
  expect(container.querySelectorAll(".reading-note-card-container").length).toBeLessThan(50);
  root.scrollTop = 0;
  fireEvent.scroll(root);
  await waitFor(() => expect(screen.getByText("Note 0")).toBeDefined());
  expect(document.activeElement?.textContent).toContain("Note 0");
  fireEvent.click(screen.getByText("Note 0").closest("button")!);
  await waitFor(() => expect(f.get).toHaveBeenCalledWith("note-0"));
  expect(screen.getByRole("dialog").textContent).toContain("Note 0");
});

test("library ignores a stale response after changing sort", async () => {
  const f = fixture();
  let resolveFirst!: (value: { items: ReadingNoteSummary[]; nextCursor: undefined }) => void;
  f.listPage.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
  f.listPage.mockImplementationOnce(async () => ({ items: [summaries[1]], nextCursor: undefined }));
  render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  await waitFor(() => expect(f.listPage).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "alphabetical" } });
  await waitFor(() => expect(screen.getByText("Note 1")).toBeDefined());
  await act(async () => resolveFirst({ items: [summaries[0]], nextCursor: undefined }));
  expect(screen.queryByText("Note 0")).toBeNull();
});

test("library retains the first page and retries a failed continuation", async () => {
  const f = fixture();
  let attempts = 0;
  f.listPage.mockImplementation(async ({ cursor }: ReadingNotePageInput) => {
    if (!cursor) return { items: summaries.slice(0, 50), nextCursor: "next" };
    if (++attempts === 1) throw new Error("temporary failure");
    return { items: summaries.slice(50), nextCursor: undefined };
  });
  render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  await waitFor(() => expect(Observer.current).toBeDefined());
  await act(async () => Observer.current!.trigger());
  await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeDefined());
  expect(screen.getByText("Note 0")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(attempts).toBe(2));
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("closing a note refreshes the loaded depth without resetting the list position", async () => {
  const f = fixture();
  const { container } = render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  await waitFor(() => expect(Observer.current).toBeDefined());
  await act(async () => Observer.current!.trigger());
  await waitFor(() => expect(f.listPage).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByText("Note 0").closest("button")!);
  await screen.findByRole("dialog");
  const root = container.querySelector<HTMLElement>(".reading-note-library-results")!;
  root.scrollTop = 3000;
  fireEvent.click(screen.getByRole("button", { name: "Close note" }));
  await waitFor(() => expect(f.listPage).toHaveBeenCalledTimes(4));
  expect(root.scrollTop).toBe(3000);
  expect(container.querySelectorAll(".reading-note-card-container").length).toBeLessThan(50);
});

test("Trash also loads summary pages on demand", async () => {
  const f = fixture();
  f.listPage.mockImplementation(async ({ status, cursor }: ReadingNotePageInput) => {
    if (status === "active") return { items: [], nextCursor: undefined };
    return cursor
      ? { items: summaries.slice(50).map(note => ({ ...note, trashedAt: 10 })), nextCursor: undefined }
      : { items: summaries.slice(0, 50).map(note => ({ ...note, trashedAt: 10 })), nextCursor: "trash-next" };
  });
  f.api.counts = vi.fn(async () => ({ active: 0, trashed: 75 }));
  const { container } = render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  await screen.findByText("Your Reading Notes Library is empty");
  fireEvent.click(screen.getByRole("button", { name: /^Trash/ }));
  await waitFor(() => expect(Observer.current).toBeDefined());
  await act(async () => Observer.current!.trigger());
  await waitFor(() => expect(f.listPage).toHaveBeenCalledTimes(3));
  expect(f.listPage.mock.calls[2]?.[0]).toMatchObject({ status: "trashed", cursor: "trash-next" });
  expect(container.querySelectorAll(".reading-note-trash-item").length).toBeLessThan(50);
});

test('F60: select all captures every matching ID, preserves selection on failure, and cancels on filter change', async () => {
  const f = fixture();
  const allIds = summaries.map(note => note.id);
  const change = vi.fn().mockRejectedValueOnce(new Error('Try again')).mockResolvedValue(75);
  f.api.tags = { list: vi.fn(async () => [{ id: 'tag', name: 'Communication' }]), create: vi.fn(), rename: vi.fn(), matchingIds: vi.fn(async () => allIds), change };
  render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  await screen.findByText('Note 0');
  fireEvent.click(screen.getByRole('button', { name: 'Select notes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Select all 75 matching notes' }));
  expect(screen.getByText('75 selected')).toBeDefined();
  expect(f.listPage).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
  fireEvent.click(await screen.findByRole('button', { name: '#Communication' }));
  await screen.findByText('Try again', { exact: false });
  expect(screen.getByText('75 selected')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: '#Communication' }));
  await waitFor(() => expect(change).toHaveBeenCalledTimes(2));
  expect(change).toHaveBeenLastCalledWith({ noteIds: allIds, tagId: 'tag', action: 'add' });
  await screen.findByText('Added “Communication” on 75 notes.');
  expect(screen.queryByLabelText('Selected notes actions')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Select notes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Select Note 0' }));
  expect(screen.getByText('1 selected')).toBeDefined();
  fireEvent.change(screen.getByLabelText('Search reading note titles'), { target: { value: 'different' } });
  expect(screen.queryByLabelText('Selected notes actions')).toBeNull();
});

test('F60: tags filter goes to paginated query and Clear filters resets it', async () => {
  const f = fixture();
  f.api.tags = { list: vi.fn(async () => [{ id: 'tag', name: 'Communication' }]), create: vi.fn(), rename: vi.fn(), matchingIds: vi.fn(), change: vi.fn() };
  render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  await screen.findByText('Note 0');
  fireEvent.click(screen.getByText('Tags · All'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Communication' }));
  await waitFor(() => expect(f.listPage).toHaveBeenLastCalledWith({ status: 'active', sort: 'recent', tagIds: ['tag'] }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => expect(f.listPage).toHaveBeenLastCalledWith({ status: 'active', sort: 'recent' }));
});


test("F61 uploads all selected matching notes including unloaded pages", async () => {
  const f = fixture(); const allIds = summaries.map(note => note.id);
  f.api.tags = { list: vi.fn(async () => []), create: vi.fn(), rename: vi.fn(), matchingIds: vi.fn(async () => allIds), change: vi.fn() };
  f.api.cardPool = { get: vi.fn(async () => undefined), start: vi.fn(async () => ({ id: "batch", baseUrl: "http://127.0.0.1:8787", running: true, items: [] })), retry: vi.fn() };
  render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  await screen.findByText("Note 0");
  fireEvent.click(screen.getByRole("button", { name: "Select notes" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select all 75 matching notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Upload 75 notes to card pool" }));
  await waitFor(() => expect(f.api.cardPool!.start).toHaveBeenCalledExactlyOnceWith(allIds));
  expect(f.listPage).toHaveBeenCalledTimes(1);
});

test("F79 imports the full selection, prevents resubmission, retains selection and handles failure", async () => {
  const f = fixture(); const allIds = summaries.map(note => note.id);
  f.api.tags = { list: vi.fn(async () => []), create: vi.fn(), rename: vi.fn(), matchingIds: vi.fn(async () => allIds), change: vi.fn() };
  let finish!: (value: import('../src/shared/heptabase-import').HeptabaseImportBatch) => void;
  f.api.heptabase = { get: vi.fn(async () => undefined), retry: vi.fn(), start: vi.fn(() => new Promise<import("../src/shared/heptabase-import").HeptabaseImportBatch>(resolve => { finish = resolve; })) };
  render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  await screen.findByText('Note 0'); fireEvent.click(screen.getByRole('button', { name: 'Select notes' }));
  expect((screen.getByRole('button', { name: 'Import to Heptabase' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(await screen.findByRole('button', { name: 'Select all 75 matching notes' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Import to Heptabase' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Import to Heptabase' }));
  fireEvent.click(screen.getByRole('button', { name: 'Import to Heptabase' }));
  await waitFor(() => expect(f.api.heptabase!.start).toHaveBeenCalledExactlyOnceWith(allIds));
  const result: import('../src/shared/heptabase-import').HeptabaseImportBatch = { id:'batch', running:false, items:allIds.map(noteId=>({noteId,title:noteId,status:'created'})) };
  vi.mocked(f.api.heptabase!.get).mockResolvedValue(result);
  await act(async () => finish(result));
  expect(await screen.findByText(/^75 imported ·/)).toBeDefined(); expect(screen.getByText('75 selected')).toBeDefined();
  vi.mocked(f.api.heptabase!.start).mockRejectedValueOnce(new Error('CLI unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Import to Heptabase' }));
  expect(await screen.findByText('CLI unavailable')).toBeDefined(); expect(screen.getByText('75 selected')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: /^Trash/ }));
  expect(screen.queryByRole('button', { name: 'Import to Heptabase' })).toBeNull();
});

test("F74 batch Trash confirms all selected IDs and retains only unfinished notes on failure", async () => {
  const f = fixture();
  f.api.tags = { list: vi.fn(async () => []), matchingIds: vi.fn(async () => summaries.map(n => n.id)) } as unknown as NonNullable<typeof f.api.tags>;
  f.api.trash = vi.fn(async () => { return undefined as never; });
  vi.mocked(f.api.trash).mockRejectedValueOnce(new Error("Disk unavailable"));
  render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: "Select notes" }));
  expect((screen.getByRole("button", { name: "Move to Trash" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(await screen.findByRole("button", { name: "Select all 75 matching notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  expect(screen.getByRole("alertdialog").textContent).toContain("75 notes");
  fireEvent.click(screen.getByRole("button", { name: "Keep notes" }));
  expect(f.api.trash).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Move to Trash" }).at(-1)!);
  await screen.findByText(/Disk unavailable/);
  expect(screen.getByText("75 selected")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Move to Trash" }).at(-1)!);
  await waitFor(() => expect(f.api.trash).toHaveBeenCalledTimes(76));
  expect(vi.mocked(f.api.trash).mock.calls.slice(1).map(call => call[0])).toEqual(summaries.map(n => n.id));
  await waitFor(() => expect(screen.queryByRole("region", { name: "Selected notes actions" })).toBeNull());
});

test("F74 partial Trash failure retries only remaining IDs and blocks duplicate confirmation", async () => {
  const f = fixture();
  f.api.tags = { list: vi.fn(async () => []), matchingIds: vi.fn(async () => ["note-0", "note-1", "note-2"]) } as unknown as NonNullable<typeof f.api.tags>;
  let reject!: (error: Error) => void;
  f.api.trash = vi.fn(async () => undefined as never);
  vi.mocked(f.api.trash).mockResolvedValueOnce(undefined as never).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  render(<ReadingNoteLibrary api={f.api} onReturnToBooks={() => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: "Select notes" }));
  fireEvent.click(await screen.findByRole("button", { name: "Select all 3 matching notes" }));
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Move to Trash" }).at(-1)!);
  await waitFor(() => expect(f.api.trash).toHaveBeenCalledTimes(2));
  const moving = screen.getByRole("button", { name: "Moving…" });
  fireEvent.click(moving);
  expect(f.api.trash).toHaveBeenCalledTimes(2);
  await act(async () => reject(new Error("Try again")));
  await screen.findByText("Try again");
  expect(screen.getByText("2 selected")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Move to Trash" }).at(-1)!);
  await waitFor(() => expect(f.api.trash).toHaveBeenCalledTimes(4));
  expect(vi.mocked(f.api.trash).mock.calls.map(call => call[0])).toEqual(["note-0", "note-1", "note-1", "note-2"]);
});
