// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { ReadingNoteSourceContext } from "../src/renderer/reading-note-source-context";
import { ReaderNotesPanel } from "../src/renderer/ReaderNotesPanel";
import { useReaderNotes } from "../src/renderer/use-reader-notes";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import type { ReaderDesktopApi, ReadingNote } from "../src/shared/contracts";

const first: ReadingNote = {
  id: "one", sourceDraftId: "draft-one", title: "Feedback loops",
  content: markdownToReadingNoteDocument("Feedback changes future behavior."),
  bookTitle: "Thinking in Systems", chapterTitle: "Chapter 1", createdAt: 1, updatedAt: 1, revision: 1
};
const second = { ...first, id: "two", title: "Resilience", chapterTitle: "Chapter 2", createdAt: 2 };
const otherBook = { ...first, id: "other", bookTitle: "Another book" };
const trashed = { ...first, id: "trashed", trashedAt: 3 };
const api = { list: vi.fn(async () => [first, second, otherBook, trashed]) } as unknown as ReaderDesktopApi["readingNotes"];
afterEach(() => { cleanup(); vi.clearAllMocks(); });

test("F33 list thumbnails use the saved memory image and remain part of the note action", async () => {
  const readDataUrl = vi.fn(async () => "data:image/png;base64,dGVzdA==");
  const onSelect = vi.fn();
  const localApi = { ...api, attachments: { readDataUrl } } as unknown as ReaderDesktopApi["readingNotes"];
  const note = { ...first, memoryImages: { recall: { attachmentId: "image-one", basedOnRevision: 1 } } };
  const props = { api: localApi, notes: [note, second], chapterTitle: first.chapterTitle,
    loading: false, error: "", onSelect, onEdit: vi.fn(), onCreate: vi.fn(), canCreate: true,
    onRefresh: vi.fn() };
  const { container, rerender } = render(<ReaderNotesPanel {...props} />);
  await waitFor(() => expect(container.querySelector(".reader-notes-thumbnail")).not.toBeNull());
  const image = container.querySelector<HTMLImageElement>(".reader-notes-thumbnail")!;
  expect(readDataUrl).toHaveBeenCalledWith("image-one");
  expect(image.src).toBe("data:image/png;base64,dGVzdA==");
  fireEvent.click(image);
  expect(onSelect).toHaveBeenCalledWith(first.id);
  fireEvent.error(image);
  expect(container.querySelector(".reader-notes-thumbnail")).toBeNull();
  expect(screen.getByRole("button", { name: /Feedback loops/ })).toBeTruthy();

  readDataUrl.mockRejectedValueOnce(new Error("Missing attachment"));
  rerender(<ReaderNotesPanel {...props} notes={[{ ...note, memoryImages: { recall: { attachmentId: "image-two", basedOnRevision: 1 } } }]} />);
  await waitFor(() => expect(readDataUrl).toHaveBeenCalledWith("image-two"));
  expect(container.querySelector(".reader-notes-thumbnail")).toBeNull();
  rerender(<ReaderNotesPanel {...props} notes={[first]} />);
  expect(container.querySelector(".reader-notes-thumbnail")).toBeNull();
});

test("F33 scopes notes to the chapter or book and searches titles without searching content", () => {
  render(<ReaderNotesPanel api={api} notes={[second, first]} chapterTitle={first.chapterTitle}
    loading={false} error="" onSelect={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()} canCreate
    onRefresh={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Feedback loops/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Resilience/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "This book" }));
  expect(screen.getByRole("button", { name: /Resilience.*Chapter 2/ })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  FEEDBACK " } });
  expect(screen.queryByRole("button", { name: /Resilience/ })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "future behavior" } });
  expect(screen.getByText("No matching notes.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByRole("button", { name: /Resilience/ })).toBeTruthy();
});

test("F33 distinguishes empty, loading, and failed states and supports retry", () => {
  const refresh = vi.fn();
  const create = vi.fn();
  const props = { api, notes: [], chapterTitle: first.chapterTitle, loading: false, error: "",
    onSelect: vi.fn(), onEdit: vi.fn(), onCreate: create, canCreate: false, onRefresh: refresh };
  const { rerender } = render(<ReaderNotesPanel {...props} />);
  expect(screen.getByText("No notes in this chapter yet.")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Create note" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "View book notes" }));
  expect(screen.getByText("No notes in this book yet.")).toBeTruthy();
  rerender(<ReaderNotesPanel {...props} canCreate />);
  fireEvent.click(screen.getByRole("button", { name: "Create note" }));
  expect(create).toHaveBeenCalledOnce();
  rerender(<ReaderNotesPanel {...props} loading />);
  expect(screen.getByRole("status").textContent).toContain("Loading notes");
  expect(screen.queryByText("No notes in this book yet.")).toBeNull();
  rerender(<ReaderNotesPanel {...props} error="Unable to read notes" />);
  expect(screen.getByRole("alert").textContent).toContain("Unable to read notes");
  expect(screen.queryByText("No notes in this book yet.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refresh).toHaveBeenCalledOnce();
});

test("F33 loads only active notes for the selected book and orders by creation time", async () => {
  const { result } = renderHook(() => useReaderNotes(api, first.bookTitle, "context"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.notes.map((note) => note.id)).toEqual([second.id, first.id]);
  expect(api.list).toHaveBeenCalledWith({ status: "active", sort: "recent" });
  expect(result.current.allNotes.map((note) => note.id)).toEqual([second.id, first.id, otherBook.id]);
});

test("F33 ignores late responses from the previous book", async () => {
  let resolveOld!: (notes: ReadingNote[]) => void;
  const list = vi.fn().mockImplementationOnce(() => new Promise<ReadingNote[]>((resolve) => { resolveOld = resolve; }))
    .mockResolvedValueOnce([otherBook]);
  const localApi = { list } as unknown as ReaderDesktopApi["readingNotes"];
  const { result, rerender } = renderHook(({ bookTitle }) => useReaderNotes(localApi, bookTitle, "context"), {
    initialProps: { bookTitle: first.bookTitle }
  });
  rerender({ bookTitle: otherBook.bookTitle });
  await waitFor(() => expect(result.current.notes[0]?.id).toBe(otherBook.id));
  await act(async () => resolveOld([first]));
  expect(result.current.notes.map((note) => note.id)).toEqual([otherBook.id]);
});

test("F33 retries failed loading and refreshes after returning to the library context", async () => {
  const list = vi.fn().mockRejectedValueOnce(new Error("Storage unavailable")).mockResolvedValue([first]);
  const localApi = { list } as unknown as ReaderDesktopApi["readingNotes"];
  const { result, rerender } = renderHook(({ context }) => useReaderNotes(localApi, first.bookTitle, context), {
    initialProps: { context: "books" }
  });
  await waitFor(() => expect(result.current.error).toBe("Storage unavailable"));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.notes).toEqual([first]));
  expect(result.current.error).toBe("");
  rerender({ context: "reading-notes" });
  await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
});

test("F33 a stale list response cannot replace a newly saved revision", async () => {
  let resolveOld!: (notes: ReadingNote[]) => void;
  const list = vi.fn(() => new Promise<ReadingNote[]>((resolve) => { resolveOld = resolve; }));
  const localApi = { list } as unknown as ReaderDesktopApi["readingNotes"];
  const { result } = renderHook(() => useReaderNotes(localApi, first.bookTitle, "context"));
  const updated = { ...first, title: "Updated feedback", revision: 2 };
  act(() => result.current.saved(updated));
  await act(async () => resolveOld([first, second]));
  expect(result.current.notes.find((note) => note.id === first.id)?.title).toBe(updated.title);
  // Other notes from the in-flight snapshot must still be available.
  expect(result.current.notes.some((note) => note.id === second.id)).toBe(true);
  act(() => result.current.saved(first));
  expect(result.current.notes.find((note) => note.id === first.id)?.revision).toBe(2);
});


beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn(() => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn()
  })) });
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

function previewProps(note: ReadingNote) {
  const localApi = { ...api, attachments: { readDataUrl: vi.fn(async id => `data:image/png;base64,${id}`) }, update: vi.fn() } as unknown as ReaderDesktopApi["readingNotes"];
  return { api: localApi, notes: [note], selectedId: note.id, chapterTitle: note.chapterTitle,
    loading: false, error: "", onSelect: vi.fn(), onEdit: vi.fn(), onCreate: vi.fn(), canCreate: true, onRefresh: vi.fn() };
}

test("the reader sidebar opens images large, flips there or from the compact caption, and has no Visual page", async () => {
  const note = { ...first, memoryImages: {
    understand: { attachmentId: "front", basedOnRevision: 1 }, recall: { attachmentId: "back", basedOnRevision: 1 }
  } };
  const props = previewProps(note);
  render(<ReaderNotesPanel {...props} />);
  const preview = within(screen.getByRole("region", { name: "Note preview" }));
  expect(preview.getByRole("heading", { name: first.title })).toBeTruthy();
  expect(preview.getByText("Feedback changes future behavior.")).toBeTruthy();
  expect(preview.queryByRole("button", { name: /View note content|View memory image/ })).toBeNull();
  expect(preview.queryByText("Visual")).toBeNull();
  fireEvent.click(await preview.findByRole("img", { name: `Understanding image for ${first.title}` }));
  const viewer = preview.getByRole("dialog", { name: `Enlarged image: Understanding image for ${first.title}` });
  fireEvent.click(within(viewer).getByRole("button", { name: "Flip to back image" }));
  expect((await preview.findByRole("img", { name: "Recall image" })).getAttribute("src")).toBe("data:image/png;base64,back");
  fireEvent.mouseDown(viewer);
  expect(preview.queryByRole("dialog")).toBeNull();
  expect(preview.getByText("Feedback changes future behavior.")).toBeTruthy();
  fireEvent.click(preview.getByRole("button", { name: "Flip to understanding image" }));
  expect((await preview.findByRole("img", { name: `Understanding image for ${first.title}` })).getAttribute("src")).toBe("data:image/png;base64,front");
  expect(props.api.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(props.onEdit).toHaveBeenCalledWith(note);
});

test("sidebar embedded illustrations enlarge and flip without duplicating the same front image", async () => {
  const content = markdownToReadingNoteDocument("Feedback changes future behavior.");
  content.blocks.push({ id: "illustration", type: "image", props: { assetId: "front", alt: "Feedback diagram" }, children: [] });
  const note = { ...first, content, memoryImages: {
    understand: { attachmentId: "front", basedOnRevision: 1 }, recall: { attachmentId: "back", basedOnRevision: 1 }
  } };
  render(<ReaderNotesPanel {...previewProps(note)} />);
  const preview = within(screen.getByRole("region", { name: "Note preview" }));
  fireEvent.click(await preview.findByRole("img", { name: "Feedback diagram" }));
  const viewer = preview.getByRole("dialog", { name: "Enlarged image: Feedback diagram" });
  fireEvent.click(within(viewer).getByRole("button", { name: "Flip to back image" }));
  expect((await preview.findByRole("img", { name: "Recall image" })).getAttribute("src")).toBe("data:image/png;base64,back");
  fireEvent.mouseDown(viewer);
  expect(preview.getAllByRole("button", { name: /Flip to/ })).toHaveLength(1);
  expect(preview.getByText("Feedback changes future behavior.")).toBeTruthy();
});

test("sidebar shows recall-only images alongside readable text and can flip back from a missing front", async () => {
  const note = { ...first, memoryImages: { recall: { attachmentId: "back", basedOnRevision: 1 } } };
  const props = previewProps(note);
  const { rerender } = render(<ReaderNotesPanel {...props} />);
  const preview = within(screen.getByRole("region", { name: "Note preview" }));
  fireEvent.click(await preview.findByRole("img", { name: `Recall image for ${first.title}` }));
  const viewer = preview.getByRole("dialog", { name: `Enlarged image: Recall image for ${first.title}` });
  fireEvent.click(within(viewer).getByRole("button", { name: "Flip to front image" }));
  expect(preview.getByText("No understanding image yet")).toBeTruthy();
  expect(preview.getByText("Feedback changes future behavior.")).toBeTruthy();
  fireEvent.click(preview.getByRole("button", { name: "Flip to recall image" }));
  fireEvent.mouseDown(viewer);
  expect(await preview.findByRole("img", { name: `Recall image for ${first.title}` })).toBeTruthy();
  rerender(<ReaderNotesPanel {...props} notes={[first]} />);
  expect(preview.getByText("Feedback changes future behavior.")).toBeTruthy();
  expect(preview.queryByRole("button", { name: /Flip to/ })).toBeNull();
});

// Sidebar shortcuts exercise the existing Main-owned batch workflow.
import { ReaderNoteVisualActions } from "../src/renderer/ReaderNoteVisualActions";
import type { MemoryImageTemplateSettings, ReadingNoteMemoryImageSnapshot } from "../src/shared/contracts";
import { BUILT_IN_MEMORY_IMAGE_PURPOSES, BUILT_IN_MEMORY_IMAGE_STYLES } from "../src/shared/memory-image-templates";

function visualFixture(initial?: ReadingNoteMemoryImageSnapshot) {
  const ready: ReadingNoteMemoryImageSnapshot = { noteId: first.id, phase: "ready", available: true, status: "Ready" };
  let listener = (_state: ReadingNoteMemoryImageSnapshot) => {};
  const settings: MemoryImageTemplateSettings = {
    purposes: BUILT_IN_MEMORY_IMAGE_PURPOSES, styles: BUILT_IN_MEMORY_IMAGE_STYLES,
    defaultPurposeId: "purpose-concept-structure", defaultStyleId: "style-minimal-vector",
    defaultsBySide: { recall: { purposeId: "purpose-surreal-association", styleId: "style-hand-drawn" },
      understand: { purposeId: "purpose-concept-contrast", styleId: "style-clay-miniature" } }
  };
  const memory = {
    getState: vi.fn(async () => initial ?? ready),
    onStateChanged: vi.fn(callback => { listener = callback; return vi.fn(); }),
    generateMissing: vi.fn(async (_id: string, _options: unknown) => ready),
    stop: vi.fn(async () => ({ ...ready, phase: "error" as const, status: "Generation stopped. Saved images are kept." })),
    templates: { get: vi.fn(async () => settings) }
  };
  return { memory, ready, emit: (state: ReadingNoteMemoryImageSnapshot) => act(() => listener(state)),
    props: { api: { memoryImage: memory } as unknown as ReaderDesktopApi["readingNotes"], note: first, onSaved: vi.fn(), onAdjust: vi.fn() } };
}

test("sidebar generates both visuals in one click using each side's saved defaults without opening the editor", async () => {
  const f = visualFixture();
  const props = { ...previewProps(first), api: { ...previewProps(first).api, memoryImage: f.props.api.memoryImage } };
  render(<ReaderNotesPanel {...props} />);
  const button = await screen.findByRole("button", { name: "Generate both visuals" });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(f.memory.generateMissing).toHaveBeenCalledOnce());
  expect(f.memory.generateMissing).toHaveBeenCalledWith(first.id, {
    understand: { purpose: expect.objectContaining({ id: "purpose-concept-contrast" }), style: expect.objectContaining({ id: "style-clay-miniature" }) },
    recall: { purpose: expect.objectContaining({ id: "purpose-surreal-association" }), style: expect.objectContaining({ id: "style-hand-drawn" }) }
  });
  expect(props.onEdit).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("sidebar offers only the missing face and keeps a completed note compact with direct adjustment", async () => {
  const f = visualFixture();
  const one = { ...first, memoryImages: { understand: { attachmentId: "front", basedOnRevision: 1 } } };
  const { rerender } = render(<ReaderNoteVisualActions {...f.props} note={one} />);
  fireEvent.click(await screen.findByRole("button", { name: "Generate back visual" }));
  await waitFor(() => expect(f.memory.generateMissing).toHaveBeenCalledOnce());
  expect(Object.keys(f.memory.generateMissing.mock.calls[0][1] as object)).toEqual(["recall"]);
  rerender(<ReaderNoteVisualActions {...f.props} note={{ ...one, memoryImages: { ...one.memoryImages, recall: { attachmentId: "back", basedOnRevision: 1 } } }} />);
  expect(screen.getByText("Both visuals ready")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Generate/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Adjust visuals" }));
  expect(f.props.onAdjust).toHaveBeenCalledOnce();
});

test("sidebar restores running progress, prevents duplicate generation, and stops through Main", async () => {
  const f = visualFixture({ noteId: first.id, phase: "generating", available: true, status: "Working",
    batch: { sides: ["understand", "recall"], completed: ["understand"], phase: "running" } });
  render(<ReaderNoteVisualActions {...f.props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Stop generation" }));
  expect(f.memory.stop).toHaveBeenCalledWith(first.id);
  expect(f.memory.generateMissing).not.toHaveBeenCalled();
  await screen.findByRole("button", { name: "Retry missing visuals" });
});

test("sidebar ignores a late initial snapshot after observing live progress and publishes saved images", async () => {
  const f = visualFixture();
  let resolve!: (state: ReadingNoteMemoryImageSnapshot) => void;
  f.memory.getState.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<ReaderNoteVisualActions {...f.props} />);
  const note = { ...first, revision: 2, memoryImages: { understand: { attachmentId: "front", basedOnRevision: 1 } } };
  f.emit({ ...f.ready, phase: "generating", note, batch: { sides: ["understand", "recall"], completed: ["understand"], phase: "running" } });
  await act(async () => resolve(f.ready));
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("1");
  expect(screen.getByRole("button", { name: "Stop generation" })).toBeTruthy();
  expect(f.props.onSaved).toHaveBeenCalledWith(note);
});

test("sidebar generation errors remain actionable and retry only the still-missing face", async () => {
  const f = visualFixture();
  f.memory.generateMissing.mockRejectedValueOnce(new Error("Connection lost"));
  const { rerender } = render(<ReaderNoteVisualActions {...f.props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Generate both visuals" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Connection lost");
  rerender(<ReaderNoteVisualActions {...f.props} note={{ ...first, memoryImages: { understand: { attachmentId: "front", basedOnRevision: 1 } } }} />);
  fireEvent.click(screen.getByRole("button", { name: "Retry missing visuals" }));
  await waitFor(() => expect(f.memory.generateMissing).toHaveBeenCalledTimes(2));
  // Main ignores options for an already saved face and preserves its image.
  expect(f.memory.generateMissing.mock.calls[1][1]).toEqual(f.memory.generateMissing.mock.calls[0][1]);
});

test("sidebar image settings are optional, cancel safely, and submit through the same batch action", async () => {
  const f = visualFixture();
  render(<ReaderNoteVisualActions {...f.props} />);
  await screen.findByRole("button", { name: "Generate both visuals" });
  fireEvent.click(screen.getByRole("button", { name: "Image settings" }));
  const dialog = await screen.findByRole("dialog", { name: "Generate visuals" });
  await waitFor(() => expect((within(dialog).getByRole("button", { name: "Generate 2 images" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(f.memory.generateMissing).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Image settings" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Generate 2 images" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Generate 2 images" }));
  await waitFor(() => expect(f.memory.generateMissing).toHaveBeenCalledOnce());
});

test("sidebar availability failure can be retried and leaving before defaults load does not start generation", async () => {
  const f = visualFixture();
  f.memory.getState.mockRejectedValueOnce(new Error("Offline"));
  const { unmount } = render(<ReaderNoteVisualActions {...f.props} />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry connection" }));
  let resolve!: (settings: MemoryImageTemplateSettings) => void;
  const settings = await f.memory.templates.get();
  f.memory.templates.get.mockImplementation(() => new Promise(done => { resolve = done; }));
  fireEvent.click(await screen.findByRole("button", { name: "Generate both visuals" }));
  unmount();
  await act(async () => resolve(settings));
  expect(f.memory.generateMissing).not.toHaveBeenCalled();
});


test("F41 all notes searches across books and keeps chapter and book scopes isolated", async () => {
  const chinese = { ...otherBook, title: "理解與回想", createdAt: 5 };
  const listAll = vi.fn(async () => [first, second, chinese, trashed]);
  // Keep the API identity stable across state updates.
  const localApi = { ...api, list: listAll };
  function StablePanel() {
    const data = useReaderNotes(localApi, first.bookTitle, "context");
    return <ReaderNotesPanel {...previewProps(first)} selectedId={undefined}
      notes={data.notes} allNotes={data.allNotes} loading={data.loading} />;
  }
  render(<StablePanel />);
  await screen.findByRole("button", { name: /Feedback loops/ });
  expect(screen.queryByRole("button", { name: /理解與回想/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "This book" }));
  expect(screen.getByText("2 notes")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All notes" }));
  expect(screen.getByText("All saved notes")).toBeTruthy();
  expect(screen.getByText("3 notes")).toBeTruthy();
  expect(screen.getByRole("button", { name: /理解與回想.*Another book.*Chapter 1/ })).toBeTruthy();
  expect(document.querySelector("[data-note-id]")?.getAttribute("data-note-id")).toBe(otherBook.id);
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  理解  " } });
  expect(screen.getByText("1 note found")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "This chapter" }));
  expect(screen.getByText("No matching notes.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All notes" }));
  expect(screen.getByText("1 note found")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "  FEEDback " } });
  expect(screen.getByText("1 note found")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "future behavior" } });
  expect(screen.getByText("No matching notes.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByText("3 notes")).toBeTruthy();
});

test("F41 all notes exposes empty, loading and retry states", () => {
  const props = { ...previewProps(first), selectedId: undefined, notes: [], allNotes: [] };
  const { rerender } = render(<ReaderNotesPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "All notes" }));
  expect(screen.getByText("No saved notes yet.")).toBeTruthy();
  rerender(<ReaderNotesPanel {...props} loading />);
  expect(screen.getByRole("status").textContent).toContain("Loading notes");
  rerender(<ReaderNotesPanel {...props} error="Storage unavailable" />);
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(props.onRefresh).toHaveBeenCalledOnce();
});

test("F41 cross-book saves and trash survive stale list responses", async () => {
  let resolve!: (notes: ReadingNote[]) => void;
  const localApi = { list: vi.fn(() => new Promise<ReadingNote[]>(done => { resolve = done; })) } as unknown as ReaderDesktopApi["readingNotes"];
  const { result } = renderHook(() => useReaderNotes(localApi, first.bookTitle, "context"));
  const updated = { ...otherBook, title: "Updated other book", revision: 2 };
  act(() => result.current.saved(updated));
  act(() => result.current.saved({ ...first, revision: 2, trashedAt: 5 }));
  await act(async () => resolve([first, otherBook]));
  expect(result.current.allNotes).toEqual([updated]);
  expect(result.current.notes).toEqual([]);
  act(() => result.current.saved(otherBook));
  expect(result.current.allNotes).toEqual([updated]);
});


test("F41 book filter combines with title search and only applies to all notes", () => {
  const crossBook = { ...otherBook, title: "Other feedback" };
  const props = { ...previewProps(first), selectedId: undefined, notes: [second, first], allNotes: [second, first, crossBook] };
  const { rerender } = render(<ReaderNotesPanel {...props} />);
  expect(screen.queryByRole("combobox", { name: "Book" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All notes" }));
  const book = screen.getByRole("combobox", { name: "Book" });
  fireEvent.focus(book);
  expect(screen.getAllByRole("option")).toHaveLength(3);
  fireEvent.change(book, { target: { value: "another" } });
  fireEvent.click(screen.getByRole("option", { name: "Another book" }));
  expect(screen.getByText("1 note found")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Resilience/ })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Resilience" } });
  expect(screen.getByText("No matching notes.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "This book" }));
  expect(screen.queryByRole("combobox", { name: "Book" })).toBeNull();
  expect(screen.getByRole("button", { name: /Resilience/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "All notes" }));
  expect((screen.getByRole("combobox", { name: "Book" }) as HTMLInputElement).value).toBe("Another book");
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByRole("button", { name: /Other feedback/ })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "feedback" } });
  fireEvent.focus(screen.getByRole("combobox", { name: "Book" }));
  expect(screen.getAllByRole("option")).toHaveLength(3);
  fireEvent.click(screen.getByRole("option", { name: "All books" }));
  expect(screen.getByText("2 notes found")).toBeTruthy();
  expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("feedback");
  fireEvent.focus(screen.getByRole("combobox", { name: "Book" }));
  fireEvent.click(screen.getByRole("option", { name: "Another book" }));
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
  rerender(<ReaderNotesPanel {...props} allNotes={[first, second]} />);
  expect(screen.getByText("No matching notes.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear book filter" }));
  expect(screen.getByText("2 notes")).toBeTruthy();
});

test('F60 sidebar tag filter combines OR tags with scope, book and title and can clear no results', async () => {
  const one = { ...first, tagIds: ['a'] }, two = { ...second, tagIds: ['b'] };
  const cross = { ...otherBook, title: 'Other feedback', tagIds: ['a'] };
  const tags = { list: vi.fn(async () => [{ id: 'a', name: 'Communication' }, { id: 'b', name: 'Learning' }]) };
  const props = { ...previewProps(first), selectedId: undefined, notes: [one, two], allNotes: [one, two, cross], api: { ...api, tags } as unknown as ReaderDesktopApi['readingNotes'] };
  render(<ReaderNotesPanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'All notes' }));
  fireEvent.click(await screen.findByText('Tags · All'));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Communication' }));
  expect(screen.getByText('2 notes found')).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Learning' }));
  expect(screen.getByText('3 notes found')).toBeTruthy();
  const book = screen.getByRole('combobox', { name: 'Book' });
  fireEvent.focus(book); fireEvent.click(screen.getByRole('option', { name: 'Another book' }));
  expect(screen.getByText('1 note found')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Resilience' } });
  expect(screen.getByText('No matching notes.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'This book' }));
  expect(screen.getByRole('button', { name: /Resilience/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'This chapter' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByText('1 note')).toBeTruthy();
});

test('F60 sidebar tag loading can retry and unmatched tags can be cleared', async () => {
  const list = vi.fn().mockRejectedValueOnce(new Error('Tags unavailable')).mockResolvedValue([{ id: 'unused', name: 'Unused' }]);
  render(<ReaderNotesPanel {...previewProps(first)} selectedId={undefined} notes={[first]} api={{ ...api, tags: { list } } as unknown as ReaderDesktopApi['readingNotes']} />);
  fireEvent.click(screen.getByRole('button', { name: 'All notes' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Tags unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry tags' }));
  fireEvent.click(await screen.findByText('Tags · All'));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Unused' }));
  expect(screen.getByText('No matching notes.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear tag filter' }));
  expect(screen.getByRole('button', { name: /Feedback loops/ })).toBeTruthy();
});


test('F60 tags only appear and filter in All notes, preserving selection across scopes', async () => {
  const list = vi.fn(async () => [{ id: 'b', name: 'Learning' }]);
  render(<ReaderNotesPanel {...previewProps(first)} selectedId={undefined} notes={[first, { ...second, tagIds: ['b'] }]}
    api={{ ...api, tags: { list } } as unknown as ReaderDesktopApi['readingNotes']} />);
  expect(screen.queryByText('Tags · All')).toBeNull();
  expect(list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'All notes' }));
  fireEvent.click(await screen.findByText('Tags · All'));
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Learning' }));
  expect(screen.queryByRole('button', { name: /Feedback loops/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'This chapter' }));
  expect(screen.queryByText('Tags · 1 selected')).toBeNull();
  expect(screen.getByRole('button', { name: /Feedback loops/ })).toBeTruthy();
  expect(screen.getByText('1 note')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'This book' }));
  expect(screen.queryByText('Tags · 1 selected')).toBeNull();
  expect(screen.getByText('2 notes')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All notes' }));
  expect(screen.getByText('Tags · 1 selected')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Feedback loops/ })).toBeNull();
  expect(screen.getByRole('button', { name: /Resilience/ })).toBeTruthy();
});

function selectPreviewText(start = 0, end = 8) {
  const preview = screen.getByRole('region', { name: 'Note preview' });
  const text = preview.querySelector('.bn-editor .bn-inline-content')!.firstChild!;
  const range = document.createRange();
  range.setStart(text, start); range.setEnd(text, end);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
}

test('F67 highlights selected sidebar text without enabling editing and saves the same note', async () => {
  const props = previewProps(first);
  const onSaved = vi.fn();
  vi.mocked(props.api.update).mockImplementation(async input => ({ ...first, ...input, revision: 2 }));
  const { container, rerender } = render(<ReaderNotesPanel {...props} onSaved={onSaved} />);
  expect(container.querySelector('.bn-editor')?.getAttribute('contenteditable')).toBe('false');
  expect(screen.queryByRole('toolbar', { name: 'Highlight text' })).toBeNull();
  selectPreviewText();
  fireEvent.click(screen.getByRole('button', { name: 'Yellow highlight' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const input = vi.mocked(props.api.update).mock.calls[0][0];
  expect(input).toMatchObject({ id: first.id, baseRevision: 1, title: first.title });
  expect(input.content.blocks[0].content).toEqual([
    { type: 'text', text: 'Feedback', styles: { backgroundColor: 'yellow' } },
    { type: 'text', text: ' changes future behavior.', styles: {} }
  ]);
  expect(props.onEdit).not.toHaveBeenCalled();
  expect(container.querySelector('.bn-editor')?.getAttribute('contenteditable')).toBe('false');
  const saved = onSaved.mock.calls[0][0];
  rerender(<ReaderNotesPanel {...props} notes={[saved]} onSaved={onSaved} />);
  expect(container.querySelector('[data-style-type="backgroundColor"][data-value="yellow"]')?.textContent).toBe('Feedback');
});

test.each(['Green', 'Blue', 'Pink', 'Purple'])('F67 applies %s to a selected range', async color => {
  const props = previewProps(first);
  vi.mocked(props.api.update).mockImplementation(async input => ({ ...first, ...input, revision: 2 }));
  render(<ReaderNotesPanel {...props} />);
  selectPreviewText();
  fireEvent.click(screen.getByRole('button', { name: `${color} highlight` }));
  await waitFor(() => expect(props.api.update).toHaveBeenCalledOnce());
  expect(vi.mocked(props.api.update).mock.calls[0][0].content.blocks[0].content)
    .toContainEqual({ type: 'text', text: 'Feedback', styles: { backgroundColor: color.toLowerCase() } });
});

test('F67 recolors and clears only background styles, preserving bold and links', async () => {
  const note = { ...first, content: markdownToReadingNoteDocument('**Feedback** changes [future](https://example.com) behavior.') };
  const content = note.content.blocks[0].content as Array<{ styles?: Record<string, string | boolean> }>;
  content[0].styles!.backgroundColor = 'yellow';
  const props = previewProps(note);
  const onSaved = vi.fn();
  vi.mocked(props.api.update).mockImplementation(async input => ({ ...note, ...input, revision: input.baseRevision + 1 }));
  const { rerender } = render(<ReaderNotesPanel {...props} onSaved={onSaved} />);
  // Bold wraps the text in a child span/strong.
  const text = screen.getByRole('region', { name: 'Note preview' }).querySelector('.bn-inline-content strong')!.firstChild!;
  const range = document.createRange(); range.selectNodeContents(text);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  fireEvent.click(screen.getByRole('button', { name: 'Clear highlight' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const saved = onSaved.mock.calls[0][0] as ReadingNote;
  expect(saved.content.blocks[0].content).toEqual([
    { type: 'text', text: 'Feedback', styles: { bold: true } },
    ...(note.content.blocks[0].content as unknown[]).slice(1)
  ]);
  rerender(<ReaderNotesPanel {...props} notes={[saved]} onSaved={onSaved} />);
  expect(screen.getByRole('link', { name: 'future' }).getAttribute('href')).toBe('https://example.com');
});

test('F67 ignores empty, outside and cross-boundary selections', () => {
  render(<ReaderNotesPanel {...previewProps(first)} />);
  selectPreviewText(0, 0);
  expect(screen.queryByRole('toolbar', { name: 'Highlight text' })).toBeNull();
  const preview = screen.getByRole('region', { name: 'Note preview' });
  const range = document.createRange(); range.selectNodeContents(preview.querySelector('h2')!);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  expect(screen.queryByRole('toolbar', { name: 'Highlight text' })).toBeNull();
  range.setEnd(preview.querySelector('.bn-inline-content')!.firstChild!, 8);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  expect(screen.queryByRole('toolbar', { name: 'Highlight text' })).toBeNull();
});

test('F67 saves one operation at a time and retries a failed snapshot with its original revision', async () => {
  const props = previewProps(first);
  let reject!: (error: Error) => void;
  vi.mocked(props.api.update).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }))
    .mockImplementationOnce(async input => ({ ...first, ...input, revision: 2 }));
  render(<ReaderNotesPanel {...props} />);
  selectPreviewText();
  fireEvent.click(screen.getByRole('button', { name: 'Yellow highlight' }));
  fireEvent.click(screen.getByRole('button', { name: 'Blue highlight' }));
  expect(props.api.update).toHaveBeenCalledOnce();
  await act(async () => reject(new Error('Storage unavailable')));
  expect((await screen.findByRole('alert')).textContent).toContain('Storage unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Retry highlight save' }));
  await waitFor(() => expect(props.api.update).toHaveBeenCalledTimes(2));
  expect(vi.mocked(props.api.update).mock.calls[1][0]).toEqual(vi.mocked(props.api.update).mock.calls[0][0]);
});

test('F67 conflict never adopts another revision or changes a different note after navigation', async () => {
  const props = previewProps(first);
  let reject!: (error: Error) => void;
  vi.mocked(props.api.update).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const { rerender } = render(<ReaderNotesPanel {...props} />);
  selectPreviewText();
  fireEvent.click(screen.getByRole('button', { name: 'Yellow highlight' }));
  rerender(<ReaderNotesPanel {...props} notes={[second]} selectedId={second.id} />);
  await act(async () => reject(new Error('This reading note changed. Reopen it and try again.')));
  expect(screen.getByRole('region', { name: 'Note preview' }).textContent).toContain(second.title);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(props.api.update).toHaveBeenCalledOnce();
});

test('F67 marks a subrange while preserving tables, math, images and other blocks', async () => {
  const content = markdownToReadingNoteDocument('Feedback changes future behavior.\n\n- Keep this item\n\nInline $x^2$ formula.');
  content.blocks.push(
    { id: 'math', type: 'mathBlock', props: { latex: 'E=mc^2' }, children: [] },
    { id: 'image', type: 'image', props: { assetId: 'front', alt: 'A diagram' }, children: [] },
    { id: 'table', type: 'table', props: {}, children: [], content: { type: 'tableContent', columnWidths: [null], rows: [{ cells: [[{ type: 'text', text: 'Table cell', styles: {} }]] }] } }
  );
  const note = { ...first, content };
  const props = previewProps(note);
  vi.mocked(props.api.update).mockImplementation(async input => ({ ...note, ...input, revision: 2 }));
  const { container } = render(<ReaderNotesPanel {...props} />);
  await waitFor(() => expect(container.querySelectorAll('.katex')).toHaveLength(2));
  const before = container.querySelector('.bn-editor')!.textContent;
  selectPreviewText(2, 6);
  const button = screen.getByRole('button', { name: 'Blue highlight' });
  button.focus();
  window.getSelection()!.removeAllRanges();
  fireEvent(document, new Event('selectionchange'));
  fireEvent.click(button);
  await waitFor(() => expect(props.api.update).toHaveBeenCalledOnce());
  const saved = vi.mocked(props.api.update).mock.calls[0][0].content;
  expect(saved.blocks.map(block => [block.id, block.type])).toEqual(content.blocks.map(block => [block.id, block.type]));
  expect(saved.blocks[0].content).toContainEqual({ type: 'text', text: 'edba', styles: { backgroundColor: 'blue' } });
  expect(saved.blocks.find(block => block.id === 'image')?.props.assetId).toBe('front');
  expect(saved.blocks.find(block => block.id === 'math')?.props.latex).toBe('E=mc^2');
  expect(saved.blocks.find(block => block.id === 'table')?.content).toMatchObject(content.blocks.at(-1)!.content!);
  expect(container.querySelector('.bn-editor')!.textContent).toBe(before);
});

test('F67 recolors an existing background and Escape dismisses accessible controls', async () => {
  const note = { ...first, content: markdownToReadingNoteDocument('Feedback changes future behavior.') };
  (note.content.blocks[0].content as Array<{ styles: Record<string, string> }>)[0].styles.backgroundColor = 'yellow';
  const props = previewProps(note);
  vi.mocked(props.api.update).mockImplementation(async input => ({ ...note, ...input, revision: 2 }));
  const { container } = render(<ReaderNotesPanel {...props} />);
  const text = container.querySelector('.bn-inline-content [data-style-type="backgroundColor"]')!.firstChild!;
  const choose = () => {
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 8);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    fireEvent(document, new Event('selectionchange'));
  };
  choose();
  const toolbar = screen.getByRole('toolbar', { name: 'Highlight text' });
  expect(within(toolbar).getAllByRole('button')).toHaveLength(6);
  fireEvent.keyDown(toolbar, { key: 'Escape' });
  expect(screen.queryByRole('toolbar', { name: 'Highlight text' })).toBeNull();
  expect(props.api.update).not.toHaveBeenCalled();
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Purple highlight' }));
  await waitFor(() => expect(props.api.update).toHaveBeenCalledOnce());
  expect(vi.mocked(props.api.update).mock.calls[0][0].content.blocks[0].content)
    .toContainEqual({ type: 'text', text: 'Feedback', styles: { backgroundColor: 'purple' } });
});

test('F67 a visible version conflict can only retry the original base revision', async () => {
  const props = previewProps(first);
  vi.mocked(props.api.update).mockRejectedValue(new Error('This reading note changed. Reopen it and try again.'));
  render(<ReaderNotesPanel {...props} />);
  selectPreviewText();
  fireEvent.click(screen.getByRole('button', { name: 'Yellow highlight' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Reopen it');
  fireEvent.click(screen.getByRole('button', { name: 'Retry highlight save' }));
  await waitFor(() => expect(props.api.update).toHaveBeenCalledTimes(2));
  expect(vi.mocked(props.api.update).mock.calls.every(([input]) => input.baseRevision === first.revision)).toBe(true);
  expect(screen.queryByText('Highlights saved')).toBeNull();
});

test('F67 a save completing after navigation updates only its original note cache', async () => {
  const props = previewProps(first);
  const onSaved = vi.fn();
  let resolve!: (note: ReadingNote) => void;
  vi.mocked(props.api.update).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { rerender, container } = render(<ReaderNotesPanel {...props} onSaved={onSaved} />);
  selectPreviewText();
  fireEvent.click(screen.getByRole('button', { name: 'Yellow highlight' }));
  rerender(<ReaderNotesPanel {...props} notes={[second]} selectedId={second.id} onSaved={onSaved} />);
  const content = vi.mocked(props.api.update).mock.calls[0][0].content;
  const saved = { ...first, content, revision: 2 };
  await act(async () => resolve(saved));
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(saved);
  expect(screen.getByRole('region', { name: 'Note preview' }).textContent).toContain(second.title);
  expect(container.querySelector('[data-style-type="backgroundColor"]')).toBeNull();
});

test('F67 UIUX exposes the current color and disables clearing an unmarked selection', async () => {
  const props = previewProps(first);
  vi.mocked(props.api.update).mockImplementation(async input => ({ ...first, ...input, revision: 2 }));
  const { rerender } = render(<ReaderNotesPanel {...props} />);
  selectPreviewText();
  expect((screen.getByRole('button', { name: 'Clear highlight' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Yellow highlight' }).getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Blue highlight' }));
  await waitFor(() => expect(props.api.update).toHaveBeenCalledOnce());
  const saved = { ...first, ...vi.mocked(props.api.update).mock.calls[0][0], revision: 2 };
  rerender(<ReaderNotesPanel {...props} notes={[saved]} />);
  const text = document.querySelector('.bn-inline-content [data-style-type="backgroundColor"]')!.firstChild!;
  const range = document.createRange(); range.selectNodeContents(text);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  fireEvent(document, new Event('selectionchange'));
  expect(screen.getByRole('button', { name: 'Blue highlight' }).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByRole('button', { name: 'Clear highlight' }) as HTMLButtonElement).disabled).toBe(false);
});

test('F67 UIUX Escape dismisses the toolbar directly from a text selection', () => {
  render(<ReaderNotesPanel {...previewProps(first)} />);
  selectPreviewText();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('toolbar', { name: 'Highlight text' })).toBeNull();
});

test('F67 UIUX saving feedback stays outside the document and survives a saved revision refresh', async () => {
  const props = previewProps(first);
  let resolve!: (note: ReadingNote) => void;
  vi.mocked(props.api.update).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const onSaved = vi.fn();
  const { container, rerender } = render(<ReaderNotesPanel {...props} onSaved={onSaved} />);
  selectPreviewText();
  fireEvent.click(screen.getByRole('button', { name: 'Yellow highlight' }));
  expect(container.querySelector('.reader-note-highlight-content > p')).toBeNull();
  const saved = { ...first, content: vi.mocked(props.api.update).mock.calls[0][0].content, revision: 2 };
  await act(async () => resolve(saved));
  rerender(<ReaderNotesPanel {...props} notes={[saved]} onSaved={onSaved} />);
  expect(screen.getByText('Highlight saved')).toBeTruthy();
});

test('F67 UIUX waits until a pointer selection is finished and supports toolbar arrow keys', () => {
  const { container } = render(<ReaderNotesPanel {...previewProps(first)} />);
  fireEvent.pointerDown(container.querySelector('.bn-editor')!);
  selectPreviewText();
  expect(screen.queryByRole('toolbar', { name: 'Highlight text' })).toBeNull();
  fireEvent.pointerUp(document);
  const yellow = screen.getByRole('button', { name: 'Yellow highlight' });
  yellow.focus();
  fireEvent.keyDown(yellow, { key: 'ArrowRight' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Green highlight' }));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Purple highlight' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(yellow);
});

test('F67 UIUX keeps the editor mounted after its own save and receives external content updates', async () => {
  const props = previewProps(first);
  const onSaved = vi.fn();
  vi.mocked(props.api.update).mockImplementation(async input => ({ ...first, ...input, revision: 2 }));
  const { container, rerender } = render(<ReaderNotesPanel {...props} onSaved={onSaved} />);
  const editorDom = container.querySelector('.bn-editor');
  selectPreviewText();
  fireEvent.click(screen.getByRole('button', { name: 'Yellow highlight' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const saved = onSaved.mock.calls[0][0] as ReadingNote;
  rerender(<ReaderNotesPanel {...props} notes={[saved]} onSaved={onSaved} />);
  expect(container.querySelector('.bn-editor')).toBe(editorDom);
  const external = { ...saved, revision: 3, content: markdownToReadingNoteDocument('An updated understanding.') };
  rerender(<ReaderNotesPanel {...props} notes={[external]} onSaved={onSaved} />);
  await waitFor(() => expect(within(screen.getByRole('region', { name: 'Note preview' })).getByText('An updated understanding.')).toBeTruthy());
  expect(props.api.update).toHaveBeenCalledOnce();
});


test.each([false, true])("F78 right-side preview opens its source without entering Edit (identity=%s)", identity => {
  const open = vi.fn(), edit = vi.fn();
  const note = { ...first, ...(identity ? { bookId: "source-book", chapterId: "source-chapter" } : {}) };
  render(<ReadingNoteSourceContext.Provider value={{ books: [{ id: "source-book", title: first.bookTitle, chapters: [{ id: "source-chapter", title: first.chapterTitle }] }], open }}>
    <ReaderNotesPanel api={api} notes={[note]} selectedId={note.id} chapterTitle={first.chapterTitle}
      loading={false} error="" onSelect={vi.fn()} onEdit={edit} onCreate={vi.fn()} canCreate onRefresh={vi.fn()} />
  </ReadingNoteSourceContext.Provider>);
  const link = screen.getByRole("button", { name: "開啟原文章節" });
  expect(within(link).getByText(note.bookTitle)).toBeTruthy();
  expect(within(link).getByText(note.chapterTitle)).toBeTruthy();
  fireEvent.click(link);
  expect(open).toHaveBeenCalledWith({ bookId: "source-book", chapterId: "source-chapter" });
  expect(edit).not.toHaveBeenCalled();
});

test("F78 right-side preview explains unavailable source instead of opening a replacement", () => {
  const open = vi.fn();
  const note = { ...first, bookId: "deleted", chapterId: "deleted" };
  render(<ReadingNoteSourceContext.Provider value={{ books: [{ id: "replacement", title: first.bookTitle, chapters: [{ id: "replacement", title: first.chapterTitle }] }], open }}>
    <ReaderNotesPanel api={api} notes={[note]} selectedId={note.id} chapterTitle={first.chapterTitle}
      loading={false} error="" onSelect={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()} canCreate onRefresh={vi.fn()} />
  </ReadingNoteSourceContext.Provider>);
  const link = screen.getByRole("button", { name: "開啟原文章節" });
  expect(link.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/來源書籍或章節已不存在/)).toBeTruthy();
  fireEvent.click(link); expect(open).not.toHaveBeenCalled();
});
