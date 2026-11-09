// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { ReaderDesktopApi, ReadingNote } from "../src/shared/contracts";
import { bookMemoryImageDefaults, rememberBookMemoryImageChoices, rememberMemoryImageGenerationMode, readMemoryImageGenerationMode } from "../src/renderer/memory-image-preferences";
import { MissingVisualSettings } from "../src/renderer/MissingVisualSettings";
import { ReaderNoteVisualActions } from "../src/renderer/ReaderNoteVisualActions";
import { BookOverview } from "../src/renderer/App";
import { ReadingNoteEditorDialog } from "../src/renderer/ReadingNoteEditorDialog";
import { ReadingNoteLibrary, ReadingNoteList } from "../src/renderer/ReadingNoteLibrary";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import { BUILT_IN_MEMORY_IMAGE_PURPOSES, BUILT_IN_MEMORY_IMAGE_STYLES } from "../src/main/memory-image-template-store";

beforeAll(() => {
  const preferences = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => preferences.get(key) ?? null,
    setItem: (key: string, value: string) => { preferences.set(key, value); },
    removeItem: (key: string) => { preferences.delete(key); }
  } });
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }))
  });
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver = class {
    readonly root = null; readonly rootMargin = "0px"; readonly thresholds = [];
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = vi.fn(() => ({ x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0, toJSON: () => ({}) }));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.removeItem("reader-memory-image-generation-mode");
  for (const title of [note.bookTitle, "Other book"]) window.localStorage.removeItem(`reader-memory-image-book:${encodeURIComponent(title)}`);
});

const note: ReadingNote = {
  id: "note-1", sourceDraftId: "draft-1", title: "Why feedback overshoots",
  content: markdownToReadingNoteDocument("The correction arrives too late."),
  bookTitle: "Thinking in Systems", chapterTitle: "Feedback", createdAt: 1, updatedAt: 1, revision: 2
};

function heptabaseFixture(readingNotes: ReturnType<typeof api>) {
  const result = { id: "batch", running: false, items: [{ noteId: note.id, title: note.title, status: "created" as const }] };
  let current: typeof result | undefined;
  readingNotes.heptabase = { start: vi.fn(async () => { current=result;return result; }), get: vi.fn(async () => current), retry: vi.fn() };
  return readingNotes.heptabase;
}
test("a saved note offers direct Heptabase import with persistent results", async () => {
  const readingNotes = api(); const heptabase = heptabaseFixture(readingNotes);
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} initialView="note" onClose={vi.fn()} onSaved={vi.fn()} />);
  const button = await screen.findByRole("button", { name: "Import to Heptabase" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button);
  await waitFor(() => expect(heptabase.start).toHaveBeenCalledWith([note.id]));
  expect(await screen.findByText(/^1 imported ·/)).toBeDefined();
  expect(screen.queryByText(/Import → Obsidian/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss Heptabase import notifications" }));
  fireEvent.click(screen.getByRole("button", { name: "View Heptabase import results" }));
  expect(screen.getByText(/^1 imported ·/)).toBeDefined();
});
test("a trashed note has no direct Heptabase action", async () => {
  const readingNotes = api(); heptabaseFixture(readingNotes);
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={{ ...note, trashedAt: 10 }} readOnly initialView="note" onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Import to Heptabase" })).toBeNull();
});
test("the note front shows CLI connection failures while browsing", async () => {
  const readingNotes = api(); const heptabase = heptabaseFixture(readingNotes);
  vi.mocked(heptabase.start).mockRejectedValueOnce(new Error("Heptabase CLI unavailable"));
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} initialView="note" onClose={vi.fn()} onSaved={vi.fn()} />);
  const button = await screen.findByRole("button", { name: "Import to Heptabase" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(button);
  expect((await screen.findByRole("alert")).textContent).toContain("Heptabase CLI unavailable");
});

const purpose = {
  id: "purpose-surreal-association", kind: "purpose" as const, name: "超現實聯想",
  prompt: "Turn the concept into an exaggerated metaphor.", builtIn: true
};
const style = {
  id: "style-minimal-vector", kind: "style" as const, name: "極簡向量",
  prompt: "Use crisp vector shapes.", builtIn: true
};
const templateSettings = {
  purposes: [purpose], styles: [style],
  defaultPurposeId: purpose.id, defaultStyleId: style.id
};

function api() {
  return {
    update: vi.fn(async (input) => ({ ...note, ...input, revision: input.baseRevision + 1 })),
    attachments: { upload: vi.fn(), readDataUrl: vi.fn(async () => "data:image/png;base64,AA=="), copyForNote: vi.fn(), discardStaged: vi.fn() },
    ai: { onStateChanged: vi.fn(() => () => undefined), discard: vi.fn() },
    memoryImage: {
      revise: vi.fn(), confirm: vi.fn(), discard: vi.fn(async () => ({ noteId: note.id, phase: "ready", available: true, status: "Discarded." })),
      templates: {
        get: vi.fn(async () => templateSettings), create: vi.fn(), update: vi.fn(),
        remove: vi.fn(), setDefault: vi.fn()
      },
      getState: vi.fn(async () => ({ noteId: note.id, phase: "ready", available: true, status: "Ready." })),
      generate: vi.fn(async () => ({ noteId: note.id, phase: "ready", available: true, status: "Generated." })),
      adjust: vi.fn(async () => ({ noteId: note.id, phase: "ready", available: true, status: "Adjusted." })),
      stop: vi.fn(),
      remove: vi.fn(async () => ({ noteId: note.id, phase: "ready", available: true, status: "Removed.", note })),
      onStateChanged: vi.fn(() => () => undefined)
    }
  } as unknown as ReaderDesktopApi["readingNotes"];
}

function openImageControls() {
  const button = screen.queryByRole("button", { name: /^(Generate|Adjust) recall image$/ });
  if (button) fireEvent.click(button);
}

test.each(["active", "trashed", "failed"] as const)("B41: closing a %s note preserves the library while refreshing", async (scenario) => {
  const readingNotes = guidedApi();
  const listed = { ...note, ...(scenario === "trashed" ? { trashedAt: 10 } : {}) };
  readingNotes.listPage = vi.fn(async () => ({ items: [listed] }));
  readingNotes.activeBookTitles = vi.fn(async () => [note.bookTitle]);
  readingNotes.get = vi.fn(async () => listed);
  readingNotes.counts = vi.fn(async () => ({ active: 1, trashed: 1 }));
  readingNotes.memoryImage!.listActive = vi.fn(async () => []);
  render(<ReadingNoteLibrary api={readingNotes} onReturnToBooks={vi.fn()} />);
  await screen.findByLabelText("Saved reading notes");
  if (scenario === "trashed") {
    fireEvent.click(screen.getByRole("button", { name: /Trash/ }));
    await screen.findByLabelText("Reading notes in Trash");
  } else {
    fireEvent.change(screen.getByRole("combobox", { name: "Book" }), { target: { value: note.bookTitle } });
    fireEvent.click(await screen.findByRole("option", { name: note.bookTitle }));
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "alphabetical" } });
    await screen.findByLabelText("Saved reading notes");
  }
  const label = scenario === "trashed" ? "Reading notes in Trash" : "Saved reading notes";
  const list = screen.getByLabelText(label);
  const results = list.closest<HTMLElement>(".reading-note-library-results")!;
  results.scrollTop = 720;
  const card = within(list).getByRole("button", { name: scenario === "trashed" ? `Open ${note.title}` : new RegExp(note.title) });
  fireEvent.click(card);
  const close = await screen.findByRole("button", { name: "Close reading note" });
  let resolveRefresh!: (page: { items: ReadingNote[] }) => void;
  let rejectRefresh!: (cause: Error) => void;
  const refresh = new Promise<{ items: ReadingNote[] }>((resolve, reject) => {
    resolveRefresh = resolve;
    rejectRefresh = reject;
  });
  readingNotes.listPage = vi.fn(() => refresh);
  fireEvent.click(close);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Close reading note" })).toBeNull());
  expect(readingNotes.listPage).toHaveBeenCalledWith(scenario === "trashed"
    ? { status: "trashed", sort: "recent" }
    : { status: "active", sort: "alphabetical", bookTitle: note.bookTitle });
  expect(screen.getByLabelText(label)).toBe(list);
  expect(card.isConnected).toBe(true);
  expect(screen.queryByText("Loading Reading Notes…")).toBeNull();
  expect(results.scrollTop).toBe(720);

  await act(async () => {
    if (scenario === "failed") rejectRefresh(new Error("Refresh unavailable"));
    else resolveRefresh({ items: [{ ...listed, title: "Updated feedback note", revision: 3 }] });
  });
  expect(screen.getByLabelText(label)).toBe(list);
  expect(card.isConnected).toBe(true);
  expect(results.scrollTop).toBe(720);
  if (scenario === "failed") expect(screen.getByRole("alert").textContent).toBe("Refresh unavailable");
  else expect(card.textContent).toContain("Updated feedback note");
  fireEvent.click(card);
  expect(await screen.findByRole("button", { name: "Close reading note" })).toBeTruthy();
});

function memoryImageRequest() {
  openImageControls();
  const add = screen.queryByRole("button", { name: "Add optional details" });
  if (add && !(add as HTMLButtonElement).disabled) fireEvent.click(add);
  return screen.getByLabelText("Memory image request");
}

function guidedApi() {
  const readingNotes = api();
  readingNotes.memoryImage!.templates.get = vi.fn(async () => ({
    purposes: BUILT_IN_MEMORY_IMAGE_PURPOSES,
    styles: BUILT_IN_MEMORY_IMAGE_STYLES,
    defaultPurposeId: "purpose-concept-structure",
    defaultStyleId: "style-minimal-vector"
  }));
  return readingNotes;
}

test("F34 TC3/6: back-first browse keeps visual controls visible and front uses only understanding", async () => {
  const readingNotes = guidedApi();
  const dual = { ...note, memoryImages: {
    recall: { attachmentId: "recall", basedOnRevision: 1 },
    understand: { attachmentId: "understand", basedOnRevision: 1 }
  } };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={dual} onClose={vi.fn()} onSaved={vi.fn()} />);
  await waitFor(() => expect(readingNotes.attachments.readDataUrl).toHaveBeenCalledWith("recall"));
  expect(screen.getByRole("complementary", { name: "Memory Image AI" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  await waitFor(() => expect(readingNotes.attachments.readDataUrl).toHaveBeenCalledWith("understand"));
  expect(screen.getByText("The correction arrives too late.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View memory image" }));
  fireEvent.click(screen.getByRole("button", { name: "Select front visual" }));
  expect(await screen.findByRole("complementary", { name: "Memory Image AI" })).toBeTruthy();
});

test("Library cards flip between recall and understanding without opening the note", async () => {
  const read = vi.fn(async id => `data:image/png;base64,${id}`);
  const open = vi.fn();
  const dual = { ...note, memoryImages: { recall: { attachmentId: "recall", basedOnRevision: 1 }, understand: { attachmentId: "understand", basedOnRevision: 1 } } };
  const understandingOnly = { ...note, id: "second", title: "Second card", memoryImages: { understand: dual.memoryImages.understand } };
  render(<ReadingNoteList view="active" notes={[dual, understandingOnly]} mutating={false} onOpen={open} onRestore={vi.fn()} readAttachmentDataUrl={read} />);
  await waitFor(() => expect(read).toHaveBeenCalledWith("recall"));
  expect(read).not.toHaveBeenCalledWith("understand");
  expect(screen.getByLabelText("No memory image")).toBeTruthy();

  const firstCard = screen.getByRole("group", { name: note.title });
  expect(within(firstCard).getByLabelText("Current face: Back. Front image: generated. Back image: generated.")).toBeTruthy();
  expect(within(screen.getByRole("group", { name: "Second card" })).getByLabelText("Current face: Back. Front image: generated. Back image: not generated.")).toBeTruthy();
  fireEvent.click(within(firstCard).getByRole("button", { name: "Show front image" }));
  await waitFor(() => expect(read).toHaveBeenCalledWith("understand"));
  expect(await screen.findByRole("img", { name: `Understanding image for ${note.title}` })).toBeTruthy();
  expect(within(firstCard).getByLabelText("Current face: Front. Front image: generated. Back image: generated.")).toBeTruthy();
  expect(open).not.toHaveBeenCalled();

  fireEvent.click(within(firstCard).getByRole("button", { name: "Show back image" }));
  expect(await screen.findByRole("img", { name: `Recall image for ${note.title}` })).toBeTruthy();
  expect(open).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("group", { name: "Second card" })).getByRole("button", { name: /Second card/ }));
  expect(open).toHaveBeenCalledWith(understandingOnly, "note");
});

test("Library Open note opens the editor on note content instead of Visual", async () => {
  const open = vi.fn();
  render(<ReadingNoteList view="active" notes={[note]} mutating={false} onOpen={open} onRestore={vi.fn()} />);

  fireEvent.click(screen.getByRole("button", { name: /Open note/ }));

  expect(open).toHaveBeenCalledWith(note, "note");
});

test("the editor can open directly on note content", () => {
  render(
    <ReadingNoteEditorDialog
      api={guidedApi()}
      mode="manual-edit"
      note={note}
      initialView="note"
      onClose={vi.fn()}
      onSaved={vi.fn()}
    />
  );

  expect(screen.getByRole("article", { name: "Reading note front" })).toBeTruthy();
  expect(screen.getByText("The correction arrives too late.")).toBeTruthy();
  expect(screen.getByText("Note").closest("span.active")).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Reading note back" })).toBeNull();
});

test("the note image edit button opens Visual on the currently displayed side", async () => {
  const dual = { ...note, memoryImages: {
    recall: { attachmentId: "recall", basedOnRevision: 1 },
    understand: { attachmentId: "understand", basedOnRevision: 1 }
  } };
  render(
    <ReadingNoteEditorDialog api={guidedApi()} mode="manual-edit" note={dual} initialView="note"
      onClose={vi.fn()} onSaved={vi.fn()} />
  );

  fireEvent.click(await screen.findByRole("button", { name: "Edit visual" }));

  expect(await screen.findByRole("region", { name: "Understanding image editor" })).toBeTruthy();
  expect(screen.getByText("Understanding · Front")).toBeTruthy();
  expect(screen.getByText("Visual").closest("span.active")).toBeTruthy();
});

test("Library magnifier opens a two-sided viewer that flips on content and closes from the backdrop", async () => {
  const read = vi.fn(async id => `data:image/png;base64,${id}`);
  const dual = { ...note, memoryImages: { recall: { attachmentId: "recall", basedOnRevision: 1 }, understand: { attachmentId: "understand", basedOnRevision: 1 } } };
  render(<ReadingNoteList view="active" notes={[dual]} mutating={false} onOpen={vi.fn()} onRestore={vi.fn()} readAttachmentDataUrl={read} />);
  const card = screen.getByRole("group", { name: note.title });

  fireEvent.click(within(card).getByRole("button", { name: "Enlarge image" }));
  const viewer = screen.getByRole("dialog", { name: `Enlarged image: ${note.title}` });
  expect(await within(viewer).findByRole("img", { name: `Recall image: ${note.title}` })).toBeTruthy();
  expect(within(viewer).getByRole("button", { name: "Close image" }).querySelector("svg")).toBeTruthy();

  fireEvent.click(within(viewer).getByRole("button", { name: "Flip to front image" }));
  expect(await within(viewer).findByRole("img", { name: `Understanding image: ${note.title}` })).toBeTruthy();
  fireEvent.keyDown(viewer, { key: "ArrowLeft" });
  expect(await within(viewer).findByRole("img", { name: `Recall image: ${note.title}` })).toBeTruthy();

  fireEvent.mouseDown(viewer);
  expect(screen.queryByRole("dialog", { name: `Enlarged image: ${note.title}` })).toBeNull();
});

test("empty Library card faces use visibly different default artwork", () => {
  render(<ReadingNoteList view="active" notes={[note]} mutating={false} onOpen={vi.fn()} onRestore={vi.fn()} />);
  const card = screen.getByRole("group", { name: note.title });
  expect(card.querySelector(".reading-note-default-recall")).toBeTruthy();
  expect(card.querySelector(".reading-note-default-understand")).toBeNull();

  fireEvent.click(within(card).getByRole("button", { name: "Flip to understanding image" }));
  expect(card.querySelector(".reading-note-default-understand")).toBeTruthy();
  expect(card.querySelector(".reading-note-default-recall")).toBeNull();

  fireEvent.click(within(card).getByRole("button", { name: "Enlarge image" }));
  const viewer = screen.getByRole("dialog", { name: `Enlarged image: ${note.title}` });
  const emptyContent = within(viewer).getByRole("button", { name: "Flip to back image" });
  expect(emptyContent.classList.contains("is-empty")).toBe(true);
  expect(emptyContent.querySelector(".reading-note-two-sided-lightbox-empty")).toBeTruthy();
});

test("F30 guides by learning intent, recommends a style and preserves explicit choices across a flip", async () => {
  const readingNotes = guidedApi();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  await screen.findByText("Give the concept a memorable scene");
  expect(screen.queryByRole("group", { name: "Memory image goal" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Choose 概念對照" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Choose 清爽手繪" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Memory image request" })).toBeNull();
  expect(screen.getByRole("button", { name: "Add optional details" })).toBeTruthy();

  expect(screen.getByText("溫暖插畫")).toBeTruthy();
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Change style" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose 清爽手繪" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Choose 清爽手繪" }).getAttribute("aria-pressed")).toBe("true"));

  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  fireEvent.click(await screen.findByRole("button", { name: "View memory image" }));
  await screen.findByText("清爽手繪");
  fireEvent.click(screen.getByRole("button", { name: "Prepare text draft" }));
  await waitFor(() => expect(readingNotes.memoryImage!.generate).toHaveBeenCalledWith(expect.objectContaining({
    purpose: expect.objectContaining({ id: "purpose-surreal-association" }),
    style: expect.objectContaining({ id: "style-hand-drawn" })
  })));
});

test("F30 custom defaults stay selectable and are submitted without replacing their prompt", async () => {
  const readingNotes = guidedApi();
  const custom = { id: "my-map", kind: "purpose" as const, name: "My map", prompt: "Keep my exact map instructions.", builtIn: false };
  const customStyle = { id: "my-style", kind: "style" as const, name: "My style", prompt: "Keep my color palette.", builtIn: false };
  readingNotes.memoryImage!.templates.get = vi.fn(async () => ({
    purposes: [...BUILT_IN_MEMORY_IMAGE_PURPOSES, custom], styles: [...BUILT_IN_MEMORY_IMAGE_STYLES, customStyle],
    defaultPurposeId: custom.id, defaultStyleId: customStyle.id
  }));
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  await screen.findByText("My map");
  expect(screen.queryByText("Suggested starting point")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Prepare text draft" }));
  await waitFor(() => expect(readingNotes.memoryImage!.generate).toHaveBeenCalledWith(expect.objectContaining({
    purpose: { id: custom.id, name: custom.name, prompt: custom.prompt },
    style: { id: customStyle.id, name: customStyle.name, prompt: customStyle.prompt }
  })));
});

test("F30 selecting the same style keeps a draft and changing style waits for discard", async () => {
  const readingNotes = guidedApi();
  const memory = readingNotes.memoryImage!;
  const draft = { id: "guided-draft", mode: "generate" as const, text: "My exact draft", baseRevision: note.revision };
  memory.getState = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Review", draft }));
  let finishDiscard!: (state: Awaited<ReturnType<typeof memory.discard>>) => void;
  memory.discard = vi.fn(() => new Promise<Awaited<ReturnType<typeof memory.discard>>>((resolve) => { finishDiscard = resolve; }));
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  await screen.findByRole("textbox", { name: "Memory image text draft" });
  fireEvent.click(await screen.findByRole("button", { name: "Change selection" }));
  fireEvent.click(screen.getByRole("button", { name: "Change style" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose 溫暖插畫" }));
  expect(memory.discard).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox", { name: "Memory image text draft" }) as HTMLTextAreaElement).value).toBe(draft.text);
  fireEvent.click(screen.getByRole("button", { name: "Choose 清爽手繪" }));
  expect(memory.discard).toHaveBeenCalledWith(note.id, "recall");
  expect((screen.getByRole("button", { name: "Choose 溫暖插畫" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "Confirm and apply" }) as HTMLButtonElement).disabled).toBe(true);
  finishDiscard({ noteId: note.id, phase: "ready", available: true, status: "Discarded" });
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Memory image text draft" })).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Prepare text draft" }));
  await waitFor(() => expect(memory.generate).toHaveBeenCalledWith(expect.objectContaining({ style: expect.objectContaining({ id: "style-hand-drawn" }) })));
});

test("F30 a failed discard keeps the original draft and selection available for retry", async () => {
  const readingNotes = guidedApi();
  const memory = readingNotes.memoryImage!;
  const draft = { id: "guided-draft", mode: "generate" as const, text: "Keep this draft", baseRevision: note.revision };
  memory.getState = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Review", draft }));
  memory.discard = vi.fn(async () => { throw new Error("Could not discard"); });
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  fireEvent.click(await screen.findByRole("button", { name: "Change selection" }));
  fireEvent.click(screen.getByRole("button", { name: "Change style" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose 清爽手繪" }));
  await screen.findByText("Could not discard");
  expect(window.localStorage.getItem(bookPreferenceKey())).toBeNull();
  expect((screen.getByRole("textbox", { name: "Memory image text draft" }) as HTMLTextAreaElement).value).toBe(draft.text);
  expect(screen.getByRole("button", { name: "Choose 溫暖插畫" }).getAttribute("aria-pressed")).toBe("true");
  expect(memory.generate).not.toHaveBeenCalled();
});

test("a saved note opens with the visual editor always visible and no second toolbar", async () => {
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  const back = await screen.findByRole("region", { name: "Reading note back" });
  expect(back.classList.contains("is-empty")).toBe(true);
  expect(back.classList.contains("has-memory-image")).toBe(false);
  expect(screen.queryByRole("button", { name: "Back to Reading Notes" })).toBeNull();
  expect(screen.getByRole("group", { name: "Reading note sides" }).parentElement?.firstElementChild)
    .toBe(screen.getByRole("group", { name: "Reading note sides" }));
  const panel = screen.getByRole("complementary", { name: "Memory Image AI" });
  expect(screen.queryByLabelText("Visual workspace")).toBeNull();
  expect(panel.textContent).toContain(note.title);
  expect(panel.textContent).not.toContain(note.bookTitle);
  expect(panel.textContent).not.toContain(note.chapterTitle);
  expect(panel.querySelectorAll("time")).toHaveLength(0);
  expect(screen.queryByText("Created")).toBeNull();
  expect(screen.queryByRole("button", { name: "Memory image context details" })).toBeNull();
  expect(screen.getByRole("region", { name: "Memory image" })).toBeTruthy();
  expect(screen.getByText(/No recall image yet/i)).toBeTruthy();
  expect(screen.getByRole("region", { name: "Memory image" }).querySelector(".reading-note-default-recall")).toBeTruthy();
  fireEvent.click(screen.getByRole("region", { name: "Reading note back" }));
  expect(screen.getByRole("region", { name: "Reading note back" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  const front = await screen.findByLabelText("Reading note front");
  expect(screen.queryByLabelText("Editable reading note")).toBeNull();
  const details = screen.getByRole("button", { name: "Reading note details" });
  expect(details.getAttribute("aria-expanded")).toBe("false");
  expect(front.querySelectorAll("time")).toHaveLength(1);
  expect(screen.queryByText("Created")).toBeNull();
  fireEvent.click(details);
  expect(details.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Created")).toBeTruthy();
  expect(within(document.querySelector(".reading-note-metadata-details") as HTMLElement).getByText(note.bookTitle)).toBeTruthy();
  expect(within(document.querySelector(".reading-note-metadata-details") as HTMLElement).getByText(note.chapterTitle)).toBeTruthy();
  expect(front.querySelectorAll("time")).toHaveLength(3);
  fireEvent.click(details);
  expect(details.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Created")).toBeNull();
  fireEvent.click(screen.getByLabelText("Reading note front"));
  expect(screen.getByLabelText("Reading note front")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View memory image" }));
  expect(await screen.findByRole("region", { name: "Reading note back" })).toBeTruthy();
});

test("clicking either visible half of the side control always flips to the opposite side", async () => {
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);

  expect(await screen.findByRole("region", { name: "Reading note back" })).toBeTruthy();
  fireEvent.click(screen.getByText("Visual"));
  expect(await screen.findByLabelText("Reading note front")).toBeTruthy();

  fireEvent.click(screen.getByText("Note"));
  expect(await screen.findByRole("region", { name: "Reading note back" })).toBeTruthy();
});

test("a note front shows metadata and its memory image between the title and note content in browse and edit modes", async () => {
  const withImage: ReadingNote = {
    ...note,
    memoryImages: { understand: { attachmentId: "asset-1", basedOnRevision: note.revision } }
  };
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={withImage} onClose={() => undefined} onSaved={() => undefined} />);

  fireEvent.click(await screen.findByRole("button", { name: "View note content" }));
  const front = await screen.findByLabelText("Reading note front");
  const title = screen.getByRole("textbox", { name: "Reading note title" });
  const metadata = screen.getByLabelText("Reading note metadata");
  const image = await screen.findByRole("img", { name: `Memory image for ${note.title}` });
  const content = screen.getByText("The correction arrives too late.");

  expect(front.contains(image)).toBe(true);
  expect(title.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(title.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(metadata.compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(image.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Enter edit mode" }));
  expect(await screen.findByLabelText("Editable reading note")).toBeTruthy();
  expect(screen.getByRole("img", { name: `Memory image for ${note.title}` })).toBeTruthy();
});

test("a note front without a memory image keeps metadata between the title and note content", async () => {
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);

  fireEvent.click(await screen.findByRole("button", { name: "View note content" }));
  await screen.findByLabelText("Reading note front");

  expect(screen.queryByRole("img", { name: /Memory image for/i })).toBeNull();
  const title = screen.getByRole("textbox", { name: "Reading note title" });
  const metadata = screen.getByLabelText("Reading note metadata");
  const content = screen.getByText("The correction arrives too late.");
  expect(title.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(metadata.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("a note front stays readable when its memory-image attachment cannot be loaded", async () => {
  const withImage: ReadingNote = {
    ...note,
    memoryImages: { understand: { attachmentId: "missing-asset", basedOnRevision: note.revision } }
  };
  const readingNotes = api();
  readingNotes.attachments.readDataUrl = vi.fn(async () => { throw new Error("Missing attachment"); });
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={withImage} onClose={() => undefined} onSaved={() => undefined} />);

  fireEvent.click(await screen.findByRole("button", { name: "View note content" }));
  await waitFor(() => expect(readingNotes.attachments.readDataUrl).toHaveBeenCalledWith("missing-asset"));

  expect(screen.getByRole("textbox", { name: "Reading note title" })).toBeTruthy();
  expect(screen.getByText("The correction arrives too late.")).toBeTruthy();
  expect(screen.queryByRole("img", { name: /Memory image for/i })).toBeNull();
});

test("the reading-note card keeps the same outer width and gives the image most of the back", () => {
  const styles = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");
  const sharedDialogRule = styles.match(/\.reading-note-editor-dialog\s*\{([^}]*)\}/)?.[1] ?? "";
  const backBodyRule = styles.match(/^\.reading-note-memory-back-body\s*\{([^}]*)\}/m)?.[1] ?? "";
  const sideSpecificWidth = /\.reading-note-editor-dialog:has\(\.reading-note-memory-back\)\s*\{[^}]*\bwidth\s*:/;

  expect(sharedDialogRule).toMatch(/\bwidth:\s*min\(1080px,\s*100%\)/);
  expect(backBodyRule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(300px,\s*38%\)/);
  expect(styles).toMatch(/\.reading-note-memory-empty strong \{[^}]*white-space: nowrap;/s);
  expect(styles).not.toMatch(sideSpecificWidth);
});

test("the memory-image composer forwards wheel scrolling to the conversation content", async () => {
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();

  const composer = memoryImageRequest() as HTMLTextAreaElement;
  const content = document.querySelector<HTMLElement>(".reading-note-memory-ai-content")!;
  Object.defineProperties(content, {
    clientHeight: { configurable: true, value: 200 },
    scrollHeight: { configurable: true, value: 600 }
  });
  Object.defineProperties(composer, {
    clientHeight: { configurable: true, value: 80 },
    scrollHeight: { configurable: true, value: 80 }
  });
  content.scrollTop = 40;

  fireEvent.wheel(composer, { deltaY: 120, deltaMode: 0 });

  expect(content.scrollTop).toBe(160);
});

test("wheel scrolling inside bounded conversation content continues through the outer dialog", async () => {
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();

  memoryImageRequest();
  const body = document.querySelector<HTMLElement>(".reading-note-memory-back-body")!;
  const content = document.querySelector<HTMLElement>(".reading-note-memory-ai-content")!;
  Object.defineProperties(body, {
    clientHeight: { configurable: true, value: 500 },
    scrollHeight: { configurable: true, value: 1_000 }
  });
  Object.defineProperties(content, {
    clientHeight: { configurable: true, value: 300 },
    scrollHeight: { configurable: true, value: 300 }
  });
  body.scrollTop = 100;

  fireEvent.wheel(await screen.findByRole("region", { name: "Memory image choices" }), { deltaY: 120, deltaMode: 0 });

  expect(body.scrollTop).toBe(220);
});

test("a multiline memory-image request keeps its own available wheel scrolling", async () => {
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();

  const composer = memoryImageRequest() as HTMLTextAreaElement;
  const content = document.querySelector<HTMLElement>(".reading-note-memory-ai-content")!;
  Object.defineProperties(composer, {
    clientHeight: { configurable: true, value: 80 },
    scrollHeight: { configurable: true, value: 180 }
  });
  composer.scrollTop = 20;
  content.scrollTop = 40;

  fireEvent.wheel(composer, { deltaY: 120, deltaMode: 0 });

  expect(content.scrollTop).toBe(40);
});

test("Edit is a toggle state that enters and exits editing", async () => {
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  fireEvent.click(await screen.findByRole("button", { name: "View note content" }));
  fireEvent.click(await screen.findByRole("button", { name: "Enter edit mode" }));
  expect(await screen.findByLabelText("Editable reading note")).toBeTruthy();
  expect(screen.getByLabelText("Reading note metadata")).toBeTruthy();
  expect(within(screen.getByRole("button", { name: "開啟原文章節" })).getByText(note.bookTitle)).toBeTruthy();
  expect(within(screen.getByRole("button", { name: "開啟原文章節" })).getByText(note.chapterTitle)).toBeTruthy();
  const editToggle = screen.getByRole("button", { name: "Exit edit mode" });
  expect(editToggle.getAttribute("aria-pressed")).toBe("true");
  expect(editToggle.textContent).toBe("Edit");
  fireEvent.click(editToggle);
  await waitFor(() => expect(screen.getByLabelText("Reading note front")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Enter edit mode" }).getAttribute("aria-pressed")).toBe("false");
});

test("destructive and close actions stay consistently placed across note sides and edit state", async () => {
  const onDelete = vi.fn();
  const onClose = vi.fn();
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={note} onClose={onClose} onSaved={() => undefined} onDelete={onDelete} />);

  expect(await screen.findByRole("region", { name: "Reading note back" })).toBeTruthy();
  let trash = screen.getByRole("button", { name: "Move to Trash" });
  let close = screen.getByRole("button", { name: "Close reading note" });
  expect(close.previousElementSibling).toBe(trash);
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  trash = await screen.findByRole("button", { name: "Move to Trash" });
  close = screen.getByRole("button", { name: "Close reading note" });
  expect(close.previousElementSibling).toBe(trash);
  fireEvent.click(screen.getByRole("button", { name: "Enter edit mode" }));
  expect(await screen.findByLabelText("Editable reading note")).toBeTruthy();
  trash = screen.getByRole("button", { name: "Move to Trash" });
  close = screen.getByRole("button", { name: "Close reading note" });
  expect(close.previousElementSibling).toBe(trash);
  fireEvent.click(trash);
  expect(onDelete).toHaveBeenCalledTimes(1);
  fireEvent.click(close);
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});

test("memory image generation only starts after the explicit back-face action", async () => {
  const readingNotes = api();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  const generate = await screen.findByRole("button", { name: "Prepare text draft" });
  expect(generate.closest(".reading-note-memory-composer")).not.toBeNull();
  expect(generate.closest(".reading-note-canvas-toolbar")).toBeNull();
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Use Adjust current mode" })).toBeNull();
  expect(screen.queryByRole("combobox", { name: "Choose AI model" })).toBeNull();
  expect(await screen.findByRole("region", { name: "Memory image choices" })).toBeTruthy();
  expect(screen.getByText(purpose.name)).toBeTruthy();
  expect(screen.getByText(style.name)).toBeTruthy();
  const composer = memoryImageRequest();
  fireEvent.change(composer, {
    target: { value: "Put the cause at the bottom." }
  });
  fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
  fireEvent.keyDown(composer, { key: "Enter", isComposing: true });
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
  fireEvent.keyDown(composer, { key: "Enter" });
  await waitFor(() => expect(readingNotes.memoryImage!.generate).toHaveBeenCalledWith({
    noteId: note.id, side: "recall",
    purpose: { id: purpose.id, name: purpose.name, prompt: purpose.prompt },
    style: { id: style.id, name: style.name, prompt: style.prompt },
    extraInstruction: "Put the cause at the bottom."
  }));
});

test("an existing image separates adjustment from full regeneration", async () => {
  const readingNotes = api();
  const withImage: ReadingNote = {
    ...note,
    memoryImage: {
      attachmentId: "asset-1",
      basedOnRevision: note.revision,
      recipe: {
        purpose: { id: purpose.id, name: purpose.name, prompt: purpose.prompt },
        style: { id: style.id, name: style.name, prompt: style.prompt },
        extraInstruction: "Initial request",
        adjustments: []
      }
    }
  };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={withImage} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();

  const back = await screen.findByRole("region", { name: "Reading note back" });
  expect(back.classList.contains("has-memory-image")).toBe(true);
  expect(back.classList.contains("is-empty")).toBe(false);
  const adjustMode = await screen.findByRole("button", { name: "Use Adjust current mode" });
  const generateMode = screen.getByRole("button", { name: "Use Generate new mode" });
  expect(adjustMode.getAttribute("aria-pressed")).toBe("true");
  expect(screen.queryByRole("combobox", { name: "Memory image purpose" })).toBeNull();
  expect(screen.getByText(`${purpose.name} · ${style.name}`)).toBeTruthy();
  const adjustment = memoryImageRequest() as HTMLTextAreaElement;
  fireEvent.change(adjustment, { target: { value: "Make the final step glow." } });
  fireEvent.click(generateMode);
  expect((memoryImageRequest() as HTMLTextAreaElement).value).toBe("Initial request");
  expect(screen.getByRole("region", { name: "Memory image choices" })).toBeTruthy();
  fireEvent.change(memoryImageRequest(), { target: { value: "Use a fresh composition." } });
  fireEvent.click(adjustMode);
  expect((memoryImageRequest() as HTMLTextAreaElement).value).toBe("Make the final step glow.");
  fireEvent.click(screen.getByRole("button", { name: "Prepare text draft" }));
  await waitFor(() => expect(readingNotes.memoryImage!.adjust).toHaveBeenCalledWith({
    noteId: note.id, side: "recall",
    instruction: "Make the final step glow."
  }));

  fireEvent.click(generateMode);
  fireEvent.click(screen.getByRole("button", { name: "Prepare text draft" }));
  await waitFor(() => expect(readingNotes.memoryImage!.generate).toHaveBeenCalledWith({
    noteId: note.id, side: "recall",
    purpose: withImage.memoryImage!.recipe!.purpose,
    style: withImage.memoryImage!.recipe!.style,
    extraInstruction: "Use a fresh composition."
  }));
});

test("a generating memory-image composer becomes a stop control in place", async () => {
  const readingNotes = api();
  readingNotes.memoryImage!.getState = vi.fn(async () => ({
    noteId: note.id, phase: "generating" as const, available: true, status: "Generating memory image…"
  }));
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();

  const stop = await screen.findByRole("button", { name: "Stop generation" });
  expect(stop.classList.contains("stop-response")).toBe(true);
  expect((memoryImageRequest() as HTMLTextAreaElement).disabled).toBe(true);
  fireEvent.click(stop);
  expect(readingNotes.memoryImage!.stop).toHaveBeenCalledWith(note.id);
});

test("an unavailable capability keeps Generate visible and offers a separate retry", async () => {
  const readingNotes = api();
  readingNotes.memoryImage!.getState = vi.fn(async () => ({
    noteId: note.id,
    phase: "unavailable" as const,
    available: false,
    status: "Memory image generation is unavailable."
  }));
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  expect(await screen.findByRole("button", { name: "Prepare text draft" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Retry memory image availability" })).toBeTruthy();
});

test("an active note can remove its memory image after confirmation", async () => {
  const readingNotes = api();
  const withImage = {
    ...note,
    memoryImages: { recall: { attachmentId: "asset-1", basedOnRevision: note.revision } }
  };
  readingNotes.memoryImage!.remove = vi.fn(async () => ({
    noteId: note.id,
    phase: "ready" as const,
    available: true,
    status: "Memory image removed.",
    note: { ...note, revision: note.revision + 1 }
  }));
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={withImage} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();

  await screen.findByRole("complementary", { name: "Memory Image AI" });
  const remove = screen.getByRole("button", { name: "Remove memory image" });
  expect(remove.closest(".reading-note-memory-context-actions")).not.toBeNull();
  fireEvent.click(remove);
  expect(screen.getByRole("alertdialog", { name: "Remove memory image?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove image" }));

  await waitFor(() => expect(readingNotes.memoryImage!.remove).toHaveBeenCalledWith(note.id, "recall"));
});

test("a trashed note keeps memory-image context readable without AI controls", async () => {
  const readingNotes = api();
  const onRestore = vi.fn();
  const trashed: ReadingNote = {
    ...note,
    trashedAt: 20,
    memoryImage: {
      attachmentId: "asset-1",
      basedOnRevision: note.revision,
      recipe: {
        purpose: { id: purpose.id, name: purpose.name, prompt: purpose.prompt },
        style: { id: style.id, name: style.name, prompt: style.prompt },
        adjustments: []
      }
    }
  };
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="manual-edit"
      note={trashed}
      readOnly
      onClose={() => undefined}
      onSaved={() => undefined}
      onRestore={onRestore}
    />
  );

  expect(screen.queryByRole("complementary", { name: "Memory Image AI" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Memory image request" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry memory image availability" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Memory image context details" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Remove memory image" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  const details = await screen.findByRole("button", { name: "Reading note details" });
  fireEvent.click(details);
  expect(screen.getByText("Created")).toBeTruthy();
  expect(within(document.querySelector(".reading-note-metadata-details") as HTMLElement).getByText(trashed.bookTitle)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  expect(onRestore).toHaveBeenCalledTimes(1);
});

test("Library cards reserve the same visual area with or without a memory image", async () => {
  const withImage: ReadingNote = {
    ...note,
    id: "note-with-image",
    memoryImages: { recall: { attachmentId: "asset-1", basedOnRevision: 2 } }
  };
  render(
    <ReadingNoteList
      view="active"
      notes={[withImage, { ...note, id: "note-without-image", title: "A note without an image" }]}
      mutating={false}
      onOpen={() => undefined}
      onRestore={() => undefined}
      readAttachmentDataUrl={vi.fn(async () => "data:image/png;base64,AA==")}
    />
  );
  expect(document.querySelectorAll(".reading-note-card-visual")).toHaveLength(2);
  await waitFor(() => expect(document.querySelector(".reading-note-card-visual img")).not.toBeNull());
  expect(screen.getByLabelText("No memory image")).toBeTruthy();
  expect(screen.getByText("Why feedback overshoots")).toBeTruthy();
  expect(screen.getByText("A note without an image")).toBeTruthy();
});

test("a Library card shows generation only on the active side and marks that face as in progress", async () => {
  const withImage: ReadingNote = {
    ...note,
    memoryImages: { understand: { attachmentId: "asset-1", basedOnRevision: 2 } }
  };
  render(
    <ReadingNoteList
      view="active"
      notes={[withImage, { ...note, id: "note-idle", title: "Idle note" }]}
      generatingNoteSides={new Map([[withImage.id, new Set(["recall" as const])]])}
      mutating={false}
      onOpen={() => undefined}
      onRestore={() => undefined}
      readAttachmentDataUrl={vi.fn(async () => "data:image/png;base64,AA==")}
    />
  );

  const generatingCard = screen.getByRole("button", { name: new RegExp(withImage.title) });
  expect(generatingCard.classList.contains("generating")).toBe(true);
  expect(screen.getByText("產圖中")).toBeTruthy();
  const status = screen.getByLabelText("Current face: Back. Front image: generated. Back image: generating.");
  expect(status.querySelector('[data-generating="true"]')?.textContent).toContain("Back");
  fireEvent.click(within(screen.getByRole("group", { name: withImage.title })).getByRole("button", { name: "Flip to understanding image" }));
  expect(screen.queryByText("產圖中")).toBeNull();
  expect(generatingCard.getAttribute("aria-busy")).toBe("false");
  await waitFor(() => expect(generatingCard.querySelector(".reading-note-card-visual img")).not.toBeNull());
  expect(screen.getByRole("button", { name: /Idle note/ }).classList.contains("generating")).toBe(false);
});


test("memory-image refinement prioritizes the preview and puts explicit actions before typing", async () => {
  const withImage: ReadingNote = { ...note, memoryImage: {
    attachmentId: "asset-1", basedOnRevision: note.revision,
    recipe: { purpose, style, adjustments: ["Make the five categories distinct."] }
  } };
  render(<ReadingNoteEditorDialog api={api()} mode="manual-edit" note={withImage} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  await screen.findByRole("img", { name: `Memory image for ${note.title}` });
  const mode = screen.getByRole("group", { name: "Memory image operation" });
  const input = memoryImageRequest();
  expect(mode.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText("Refine the current image")).toBeNull();
  expect(screen.queryByText("Ready.")).toBeNull();
  const history = screen.getByText("Last adjustment").closest("details");
  expect(history).not.toBeNull();
  expect(history!.open).toBe(false);
  expect(history!.textContent).toContain("Make the five categories distinct.");
  expect(screen.getByRole("button", { name: "Prepare text draft" }).textContent).toBe("Prepare text draft");
  fireEvent.click(screen.getByRole("button", { name: "Use Generate new mode" }));
  expect(screen.getByRole("button", { name: "Prepare text draft" }).textContent).toBe("Prepare text draft");
});

test("F28 readers revise editable text and explicitly confirm before an image changes", async () => {
  const readingNotes = api();
  const memory = readingNotes.memoryImage!;
  const draft = { id: "draft-1", mode: "generate" as const, baseRevision: note.revision, text: "A boat and a delayed rudder." };
  memory.generate = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Review", draft }));
  memory.revise = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Review", draft: { ...draft, id: "draft-2", text: "A blue bicycle with delayed steering." } }));
  memory.confirm = vi.fn(async () => ({ noteId: note.id, phase: "error" as const, available: true, status: "Try again", draft: { ...draft, id: "draft-2", text: "Final description" } }));
  const onSaved = vi.fn();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={onSaved} />);
  openImageControls();
  const prepare = await screen.findByRole("button", { name: "Prepare text draft" });
  await waitFor(() => expect((prepare as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(prepare);
  const text = await screen.findByRole("textbox", { name: "Memory image text draft" });
  expect(memory.confirm).not.toHaveBeenCalled();
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.change(text, { target: { value: "A bicycle" } });
  fireEvent.keyDown(text, { key: "Enter" });
  expect(memory.confirm).not.toHaveBeenCalled();
  const request = memoryImageRequest();
  fireEvent.change(request, { target: { value: "Make it blue" } });
  fireEvent.click(screen.getByRole("button", { name: "Revise text draft" }));
  await waitFor(() => expect(memory.revise).toHaveBeenCalledWith({ noteId: note.id, side: "recall", draftId: "draft-1", text: "A bicycle", instruction: "Make it blue" }));
  await waitFor(() => expect((text as HTMLTextAreaElement).value).toBe("A blue bicycle with delayed steering."));
  fireEvent.change(text, { target: { value: " " } });
  expect((screen.getByRole("button", { name: "Confirm and apply" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(text, { target: { value: "Final description" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm and apply" }));
  await waitFor(() => expect(memory.confirm).toHaveBeenCalledExactlyOnceWith({ noteId: note.id, side: "recall", draftId: "draft-2", text: "Final description" }));
  expect(await screen.findByText("Try again")).toBeTruthy();
  expect((text as HTMLTextAreaElement).value).toBe("Final description");
  expect(onSaved).not.toHaveBeenCalled();
});

test("F28 adjustment drafts preserve the visible image and are discarded on mode or template changes and closing", async () => {
  const readingNotes = api();
  const memory = readingNotes.memoryImage!;
  const withImage = { ...note, memoryImages: { recall: { attachmentId: "original", basedOnRevision: note.revision } } };
  const draft = { id: "draft-1", mode: "adjust" as const, baseRevision: note.revision, text: "Keep the layout; use blue." };
  memory.adjust = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Review", draft }));
  memory.generate = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Review", draft: { ...draft, mode: "generate" as const } }));
  memory.templates.get = vi.fn(async () => ({ ...templateSettings, styles: [style, { ...style, id: "style-two", name: "Second style" }] }));
  const onSaved = vi.fn();
  const view = render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={withImage} onClose={() => undefined} onSaved={onSaved} />);
  openImageControls();
  const request = memoryImageRequest();
  fireEvent.change(request, { target: { value: "Blue" } });
  fireEvent.click(screen.getByRole("button", { name: "Prepare text draft" }));
  await screen.findByRole("textbox", { name: "Memory image text draft" });
  expect(document.querySelector(".reading-note-memory-image-frame img")).not.toBeNull();
  expect(onSaved).not.toHaveBeenCalled();
  expect(memory.confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use Generate new mode" }));
  expect(screen.queryByRole("textbox", { name: "Memory image text draft" })).toBeNull();
  expect(memory.discard).toHaveBeenCalledWith(note.id, "recall");
  fireEvent.click(screen.getByRole("button", { name: "Prepare text draft" }));
  await screen.findByRole("textbox", { name: "Memory image text draft" });
  fireEvent.click(screen.getByRole("button", { name: "Change selection" }));
  fireEvent.click(screen.getByRole("button", { name: "Change style" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose Second style" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Memory image text draft" })).toBeNull());
  const calls = vi.mocked(memory.discard).mock.calls.length;
  view.unmount();
  expect(vi.mocked(memory.discard).mock.calls.length).toBe(calls + 1);
});

test("F28 preparation stops without confirming, and stale drafts and Trash cannot be applied", async () => {
  const readingNotes = api();
  const memory = readingNotes.memoryImage!;
  memory.getState = vi.fn(async () => ({ noteId: note.id, phase: "preparing" as const, available: true, status: "Preparing text draft…" }));
  const view = render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  fireEvent.click(await screen.findByRole("button", { name: "Stop generation" }));
  expect(memory.stop).toHaveBeenCalledWith(note.id);
  expect(memory.confirm).not.toHaveBeenCalled();
  view.unmount();
  memory.getState = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Review", draft: { id: "old", mode: "generate" as const, text: "An old draft", baseRevision: note.revision - 1 } }));
  const staleView = render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  expect((await screen.findByRole("button", { name: "Confirm and apply" }) as HTMLButtonElement).disabled).toBe(true);
  staleView.unmount();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} readOnly onClose={() => undefined} onSaved={() => undefined} />);
  await screen.findByRole("region", { name: "Reading note back" });
  expect(screen.queryByRole("button", { name: "Confirm and apply" })).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Memory image text draft" })).toBeNull();
});

test("F28 turning the note over preserves manual draft edits until the note closes", async () => {
  const readingNotes = api();
  const memory = readingNotes.memoryImage!;
  memory.getState = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Review", draft: { id: "draft-turn", mode: "generate" as const, text: "Original AI description", baseRevision: note.revision } }));
  const view = render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  fireEvent.change(await screen.findByRole("textbox", { name: "Memory image text draft" }), { target: { value: "My manually edited description" } });
  fireEvent.change(memoryImageRequest(), { target: { value: "Another idea" } });
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  fireEvent.click(await screen.findByRole("button", { name: "View memory image" }));
  expect((await screen.findByRole("textbox", { name: "Memory image text draft" }) as HTMLTextAreaElement).value).toBe("My manually edited description");
  expect((memoryImageRequest() as HTMLTextAreaElement).value).toBe("Another idea");
  expect(memory.discard).not.toHaveBeenCalled();
  view.unmount();
  expect(memory.discard).toHaveBeenCalledExactlyOnceWith(note.id);
});

test("B32 a parent redraw cannot erase a failed draft request", async () => {
  const readingNotes = api();
  readingNotes.memoryImage!.generate = vi.fn(async () => ({ noteId: note.id, phase: "error" as const, available: true, status: "This model requires a newer version of Codex." }));
  const view = render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  const prepare = await screen.findByRole("button", { name: "Prepare text draft" });
  await waitFor(() => expect((prepare as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(prepare);
  await screen.findByText("This model requires a newer version of Codex.");
  view.rerender(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  await waitFor(() => expect(readingNotes.memoryImage!.getState).toHaveBeenCalledTimes(1));
  expect(screen.getByText("This model requires a newer version of Codex.")).toBeTruthy();
});

test("F32 selects direct generation and retains the choice across a flip", async () => {
  const readingNotes = api();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  const direct = await screen.findByRole("radio", { name: "Generate directly" });
  expect((screen.getByRole("radio", { name: "Review draft first" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(direct);
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  fireEvent.click(screen.getByRole("button", { name: "View memory image" }));
  expect((await screen.findByRole("radio", { name: "Generate directly" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(await screen.findByRole("button", { name: "Generate image" }));
  await waitFor(() => expect(readingNotes.memoryImage!.generate).toHaveBeenCalledWith(expect.objectContaining({ generationMode: "direct" })));
  expect(readingNotes.memoryImage!.confirm).not.toHaveBeenCalled();
});

test("F32 changing workflow preserves a draft on discard failure and clears it only on success", async () => {
  const readingNotes = api();
  readingNotes.memoryImage!.getState = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Draft ready", draft: { id: "draft-1", mode: "generate" as const, text: "A boat", baseRevision: note.revision } }));
  readingNotes.memoryImage!.discard = vi.fn().mockRejectedValueOnce(new Error("Could not discard")).mockResolvedValue({ noteId: note.id, phase: "ready", available: true, status: "Discarded" });
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  await screen.findByRole("textbox", { name: "Memory image text draft" });
  fireEvent.click(screen.getByRole("radio", { name: "Generate directly" }));
  await screen.findByText("Could not discard");
  expect((screen.getByRole("radio", { name: "Review draft first" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("textbox", { name: "Memory image text draft" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Generate directly" }));
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "Memory image text draft" })).toBeNull());
  expect((screen.getByRole("radio", { name: "Generate directly" }) as HTMLInputElement).checked).toBe(true);
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
});

test("F32 direct adjustment sends the requested mode and locks it during generation", async () => {
  const readingNotes = api();
  const withImage = { ...note, memoryImages: { recall: { attachmentId: "original", basedOnRevision: note.revision } } };
  readingNotes.memoryImage!.adjust = vi.fn(async () => ({ noteId: note.id, phase: "generating" as const, available: true, status: "Adjusting" }));
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={withImage} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  const direct = await screen.findByRole("radio", { name: "Generate directly" });
  fireEvent.click(direct);
  await waitFor(() => expect(direct.matches(":disabled")).toBe(false));
  fireEvent.change(memoryImageRequest(), { target: { value: "Use blue" } });
  fireEvent.keyDown(memoryImageRequest(), { key: "Enter" });
  await waitFor(() => expect(readingNotes.memoryImage!.adjust).toHaveBeenCalledWith({ noteId: note.id, side: "recall", instruction: "Use blue", generationMode: "direct" }));
  expect(direct.matches(":disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Stop generation" })).toBeTruthy();
});


test("F32 workflow cards support keyboard selection without starting image work", async () => {
  const user = userEvent.setup();
  const readingNotes = api();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  const review = await screen.findByRole("radio", { name: "Review draft first" });
  const direct = screen.getByRole("radio", { name: "Generate directly" });
  expect(screen.getByText("Edit the description before generating.")).toBeTruthy();
  expect(screen.getByText("Let AI design and save your image.")).toBeTruthy();
  review.focus();
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect((direct as HTMLInputElement).checked).toBe(true));
  expect((review as HTMLInputElement).checked).toBe(false);
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
  expect(readingNotes.memoryImage!.discard).not.toHaveBeenCalled();
});


test("F32 remembers workflow across closed notes and restores review when selected again", async () => {
  const readingNotes = api();
  const first = render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  fireEvent.click(await screen.findByRole("radio", { name: "Generate directly" }));
  expect(JSON.parse(window.localStorage.getItem(`reader-memory-image-book:${encodeURIComponent(note.bookTitle)}`) ?? "{}").generationMode).toBe("direct");
  first.unmount();
  const second = render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={{ ...note, id: "another-note" }} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  expect((await screen.findByRole("radio", { name: "Generate directly" }) as HTMLInputElement).checked).toBe(true);
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: "Review draft first" }));
  expect(JSON.parse(window.localStorage.getItem(`reader-memory-image-book:${encodeURIComponent(note.bookTitle)}`) ?? "{}").generationMode).toBe("review");
  second.unmount();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  expect((await screen.findByRole("radio", { name: "Review draft first" }) as HTMLInputElement).checked).toBe(true);
});

test("F32 invalid or unavailable preference storage preserves a usable workflow", async () => {
  window.localStorage.setItem("reader-memory-image-generation-mode", "invalid");
  const readingNotes = api();
  const rendered = render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  expect((await screen.findByRole("radio", { name: "Review draft first" }) as HTMLInputElement).checked).toBe(true);
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  fireEvent.click(screen.getByRole("radio", { name: "Generate directly" }));
  expect((screen.getByRole("radio", { name: "Generate directly" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("This choice applies now, but could not be remembered for next time.")).toBeTruthy();
  rendered.unmount();
  vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={() => undefined} onSaved={() => undefined} />);
  openImageControls();
  expect((await screen.findByRole("radio", { name: "Review draft first" }) as HTMLInputElement).checked).toBe(true);
});


test("F34 TC3/6: understanding-only notes never reveal that image on recall; image editing reuses the two-sided lightbox", async () => {
  const readingNotes = guidedApi();
  const close = vi.fn();
  const withImage = { ...note, memoryImages: { understand: { attachmentId: "answer", basedOnRevision: 1 } } };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={withImage} onClose={close} onSaved={vi.fn()} />);
  expect(await screen.findByText("No recall image yet")).toBeTruthy();
  expect(readingNotes.attachments.readDataUrl).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  fireEvent.click(screen.getByRole("button", { name: "View memory image" }));
  fireEvent.click(screen.getByRole("button", { name: "Select front visual" }));
  fireEvent.click(await screen.findByRole("button", { name: /Enlarge/ }));
  const lightbox = screen.getByRole("dialog", { name: /Enlarged image/ });
  expect(within(lightbox).getByRole("button", { name: "Flip to back image" })).toBeTruthy();
  fireEvent.click(within(lightbox).getByRole("button", { name: "Flip to back image" }));
  expect(within(lightbox).getByText("No back image yet")).toBeTruthy();
  expect(screen.getByText("Understanding · Front")).toBeTruthy();
  fireEvent.keyDown(lightbox, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Enlarged image" })).toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText("Understanding · Front")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  expect(screen.getByText("The correction arrives too late.")).toBeTruthy();
});

test("Visual opens on recall and flips only between the two images, with a face label", async () => {
  const readingNotes = guidedApi();
  const dual = { ...note, memoryImages: {
    recall: { attachmentId: "recall", basedOnRevision: 1 },
    understand: { attachmentId: "understand", basedOnRevision: 1 }
  } };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={dual} onClose={vi.fn()} onSaved={vi.fn()} />);
  await waitFor(() => expect(readingNotes.attachments.readDataUrl).toHaveBeenCalledWith("recall"));
  expect(screen.getByText("Recall · Back")).toBeTruthy();
  fireEvent.click(await screen.findByRole("button", { name: "Select front visual" }));
  await waitFor(() => expect(readingNotes.attachments.readDataUrl).toHaveBeenCalledWith("understand"));
  expect(screen.getByText("Understanding · Front")).toBeTruthy();
  expect(screen.getByText("Visual").closest("span.active")).toBeTruthy();
  expect(screen.queryByText("The correction arrives too late.")).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "Select back visual" }));
  expect(await screen.findByRole("button", { name: "Select front visual" })).toBeTruthy();
  expect(screen.getByText("Recall · Back")).toBeTruthy();
  expect(screen.queryByRole("dialog", { name: "Enlarged image" })).toBeNull();
  expect(await screen.findByRole("complementary", { name: "Memory Image AI" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Reading note back" })).toBeTruthy();
});

test("Note content clicks do not switch to Visual; only the header changes the view", async () => {
  const readingNotes = guidedApi();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  fireEvent.click(screen.getByRole("button", { name: "Reading note details" }));
  expect(screen.getByRole("button", { name: "Reading note details" }).getAttribute("aria-expanded")).toBe("true");
  const content = screen.getByText("The correction arrives too late.");
  const selection = window.getSelection()!;
  const range = document.createRange();
  selection.removeAllRanges(); range.selectNodeContents(content); selection.addRange(range);
  expect(selection.isCollapsed).toBe(false);
  fireEvent.click(content);
  expect(screen.getByRole("article", { name: "Reading note front" })).toBeTruthy();
  selection.removeAllRanges();
  fireEvent.click(content);
  expect(screen.getByRole("article", { name: "Reading note front" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View memory image" }));
  expect(screen.getByRole("region", { name: "Reading note back" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View note content" }));
  fireEvent.click(screen.getByRole("button", { name: "Enter edit mode" }));
  fireEvent.click(screen.getByText("The correction arrives too late."));
  expect(screen.getByRole("button", { name: "Exit edit mode" })).toBeTruthy();
});

test("A missing visual face remains flippable without showing note content or the other image", async () => {
  const readingNotes = guidedApi();
  const oneSide = { ...note, memoryImages: { recall: { attachmentId: "recall", basedOnRevision: 1 } } };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={oneSide} onClose={vi.fn()} onSaved={vi.fn()} />);
  await screen.findByRole("img", { name: `Memory image for ${note.title}` });
  fireEvent.click(screen.getByRole("button", { name: "Select front visual" }));
  expect(screen.getByText("No understanding image yet")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Memory image" }).querySelector(".reading-note-default-understand")).toBeTruthy();
  expect(screen.getByText("Understanding · Front")).toBeTruthy();
  expect(screen.queryByText("The correction arrives too late.")).toBeNull();
  expect(screen.queryByRole("img", { name: `Memory image for ${note.title}` })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Select back visual" }));
  expect(await screen.findByRole("img", { name: `Memory image for ${note.title}` })).toBeTruthy();
  expect(screen.getByText("Recall · Back")).toBeTruthy();
});

test("Compact visual switch keeps editing open and retains each side's request", async () => {
  const readingNotes = guidedApi();
  const dual = { ...note, memoryImages: {
    recall: { attachmentId: "recall", basedOnRevision: 1 },
    understand: { attachmentId: "understand", basedOnRevision: 1 }
  } };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={dual} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Memory image request" }), { target: { value: "Make the back more memorable" } });
  fireEvent.click(screen.getByRole("button", { name: "Select front visual" }));
  expect(screen.getByRole("complementary", { name: "Memory Image AI" })).toBeTruthy();
  expect(screen.getByText("Understanding · Front")).toBeTruthy();
  fireEvent.change(await screen.findByRole("textbox", { name: "Memory image request" }), { target: { value: "Clarify the arrows on the front" } });
  fireEvent.click(screen.getByRole("button", { name: "Select back visual" }));
  expect((await screen.findByRole("textbox", { name: "Memory image request" }) as HTMLTextAreaElement).value).toBe("Make the back more memorable");
  fireEvent.click(screen.getByRole("button", { name: "Select front visual" }));
  expect((await screen.findByRole("textbox", { name: "Memory image request" }) as HTMLTextAreaElement).value).toBe("Clarify the arrows on the front");
});

test("One-click generation updates both previews and cannot be dispatched twice", async () => {
  const readingNotes = guidedApi();
  let finish!: (value: any) => void;
  const generateMissing = vi.fn(() => new Promise<any>(resolve => { finish = resolve; }));
  Object.assign(readingNotes.memoryImage!, { generateMissing });
  const saved = { ...note, revision: 4, memoryImages: {
    recall: { attachmentId: "back-created", basedOnRevision: 3 },
    understand: { attachmentId: "front-created", basedOnRevision: 2 }
  } };
  const onSaved = vi.fn();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={vi.fn()} onSaved={onSaved} />);
  const quick = screen.getByRole("button", { name: "Generate both visuals" });
  fireEvent.click(quick);
  expect(generateMissing).not.toHaveBeenCalled();
  const generate = await screen.findByRole("button", { name: "Generate 2 images" });
  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
  const settings = within(screen.getByRole("dialog", { name: "Generate visuals" }));
  fireEvent.click(settings.getByRole("button", { name: "Explore other purposes" }));
  fireEvent.click(settings.getByRole("button", { name: "Choose 概念對照" }));
  fireEvent.click(settings.getByRole("button", { name: "Change style" }));
  fireEvent.click(settings.getByRole("button", { name: "Choose 淡彩水彩" }));
  fireEvent.click(settings.getByRole("button", { name: "Add optional details" }));
  fireEvent.change(settings.getByRole("textbox", { name: "Front image details" }), { target: { value: "Emphasize the arrows" } });
  fireEvent.click(settings.getByRole("button", { name: "Back · Recall" }));
  fireEvent.click(settings.getByRole("button", { name: "Change style" }));
  fireEvent.click(settings.getByRole("button", { name: "Choose 柔和立體" }));
  fireEvent.click(settings.getByRole("button", { name: "Front · Understanding" }));
  expect(settings.getByRole("button", { name: "Choose 淡彩水彩" }).getAttribute("aria-pressed")).toBe("true");
  expect((settings.getByRole("textbox", { name: "Front image details" }) as HTMLTextAreaElement).value).toBe("Emphasize the arrows");
  fireEvent.click(generate); fireEvent.click(generate);
  expect(generateMissing).toHaveBeenCalledExactlyOnceWith(note.id, expect.objectContaining({
    understand: expect.objectContaining({ purpose: expect.objectContaining({ id: "purpose-concept-contrast" }), style: expect.objectContaining({ id: "style-storybook-watercolor" }) }),
    recall: expect.objectContaining({ style: expect.objectContaining({ id: "style-clay-miniature" }) })
  }));
  expect(screen.getByRole("button", { name: "Stop generation" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select front visual" }));
  finish({ noteId: note.id, phase: "ready", available: true, status: "Both visuals are ready.", note: saved,
    batch: { sides: ["understand", "recall"], completed: ["understand", "recall"], phase: "completed" } });
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  expect(screen.queryByRole("button", { name: "Generate both visuals" })).toBeNull();
  expect(screen.getByRole("complementary", { name: "Memory Image AI" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Choose visual side" })).toBeNull();
  expect(await screen.findByRole("img", { name: `Memory image for ${note.title}` })).toBeTruthy();
});

test("Partial failure offers a missing-side retry; read-only notes expose no generation", async () => {
  const readingNotes = guidedApi();
  const generateMissing = vi.fn(async () => ({ noteId: note.id, phase: "error", available: true, status: "Try again later.",
    batch: { sides: ["recall"], completed: [], phase: "error" } }));
  Object.assign(readingNotes.memoryImage!, { generateMissing });
  const partial = { ...note, memoryImages: { understand: { attachmentId: "front", basedOnRevision: 1 } } };
  const view = render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={partial} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate missing visual" }));
  const generate = await screen.findByRole("button", { name: "Generate 1 image" });
  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("group", { name: "Visual settings side" })).toBeNull();
  fireEvent.click(generate);
  expect(await screen.findByRole("button", { name: "Retry missing visuals" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("Try again later");
  view.rerender(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={partial} readOnly onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "Retry missing visuals" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Generate recall image" })).toBeNull();
});


test("Note hides generation controls and flips its visual in place without saving or navigating", async () => {
  const readingNotes = guidedApi();
  readingNotes.attachments.readDataUrl = vi.fn(async id => `data:image/png;base64,${id}`);
  const dual = { ...note, memoryImages: {
    recall: { attachmentId: "recall", basedOnRevision: 1 },
    understand: { attachmentId: "understand", basedOnRevision: 1 }
  } };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={dual} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "View note content" }));
  const image = await screen.findByRole("img", { name: `Memory image for ${note.title}` });
  expect(screen.queryByRole("button", { name: /^(Generate|Adjust).*image$/ })).toBeNull();
  fireEvent.click(image);
  const viewer = screen.getByRole("dialog", { name: `Enlarged image: Memory image for ${note.title}` });
  fireEvent.click(within(viewer).getByRole("button", { name: "Flip to back image" }));
  fireEvent.mouseDown(viewer);
  expect((await screen.findByRole("img", { name: "Recall image" })).getAttribute("src")).toBe("data:image/png;base64,recall");
  expect(screen.getByText("Recall · Back")).toBeTruthy();
  expect(screen.getByText("The correction arrives too late.")).toBeTruthy();
  expect(screen.getByText("Note").closest("span.active")).toBeTruthy();
  const user = userEvent.setup();
  screen.getByRole("button", { name: "Flip to understanding image" }).focus();
  await user.keyboard("{Enter}");
  expect((await screen.findByRole("img", { name: `Memory image for ${note.title}` })).getAttribute("src")).toBe("data:image/png;base64,understand");
  expect(readingNotes.update).not.toHaveBeenCalled();
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
});

test("an ordinary embedded note image enlarges without being mislabeled as a front visual", async () => {
  const readingNotes = guidedApi();
  readingNotes.attachments.readDataUrl = vi.fn(async id => `data:image/png;base64,${id}`);
  const content = markdownToReadingNoteDocument("Before the image.\n\nAfter the image.");
  content.blocks.splice(1, 0, { id: "embedded-image", type: "image", props: { assetId: "embedded", alt: "Original illustration" }, children: [] });
  const embedded = { ...note, content, memoryImages: { recall: { attachmentId: "recall", basedOnRevision: 1 } } };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={embedded} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "View note content" }));
  const image = await screen.findByRole("img", { name: "Original illustration" });
  expect(screen.queryByRole("button", { name: /^(Generate|Adjust).*image$/ })).toBeNull();
  expect(screen.getByText("Before the image.").compareDocumentPosition(image) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(image.compareDocumentPosition(screen.getByText("After the image.")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(image);
  const viewer = screen.getByRole("dialog", { name: "Enlarged image: Original illustration" });
  expect(within(viewer).queryByRole("button", { name: /Flip to/ })).toBeNull();
  expect(within(viewer).queryByText("Front")).toBeNull();
  expect(screen.queryByText("Understanding · Front")).toBeNull();
  fireEvent.mouseDown(viewer);
  expect(screen.queryByRole("dialog", { name: "Enlarged image: Original illustration" })).toBeNull();
  expect(screen.getByText("After the image.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Enter edit mode" }));
  expect((await screen.findByRole("img", { name: "Original illustration" })).getAttribute("src")).toBe("data:image/png;base64,embedded");
  expect(screen.queryByRole("button", { name: "Flip to understanding image" })).toBeNull();
  expect(readingNotes.update).not.toHaveBeenCalled();
  expect(embedded.content).toEqual(content);
});

test("an ordinary embedded image without memory visuals stays a single image", async () => {
  const readingNotes = guidedApi();
  const content = markdownToReadingNoteDocument("");
  content.blocks = [{ id: "embedded-image", type: "image", props: { assetId: "embedded", alt: "Original illustration" }, children: [] }];
  const embedded = { ...note, content };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={embedded} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "View note content" }));
  fireEvent.click(await screen.findByRole("img", { name: "Original illustration" }));
  const viewer = screen.getByRole("dialog", { name: "Enlarged image: Original illustration" });
  expect(within(viewer).queryByRole("button", { name: /Flip to/ })).toBeNull();
  expect(within(viewer).queryByText(/Front|Back|Understanding|Recall/)).toBeNull();
  expect(screen.queryByRole("button", { name: /Generate/ })).toBeNull();
  fireEvent.mouseDown(viewer);
  expect(await screen.findByRole("img", { name: "Original illustration" })).toBeTruthy();
  expect(readingNotes.update).not.toHaveBeenCalled();
});


test("legacy recall images appear normally without a manual side attribution panel", async () => {
  const readingNotes = guidedApi();
  Object.assign(readingNotes.memoryImage!, { generateMissing: vi.fn() });
  const legacy = { ...note, memoryImage: { attachmentId: "old-recall", basedOnRevision: 1 } };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={legacy} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(await screen.findByRole("img", { name: `Memory image for ${note.title}` })).toBeTruthy();
  expect(readingNotes.attachments.readDataUrl).toHaveBeenCalledWith("old-recall");
  expect(screen.queryByText("Existing image · choose its side")).toBeNull();
  expect(screen.queryByRole("button", { name: "Generate both visuals" })).toBeNull();
  expect(screen.getByRole("button", { name: "Generate missing visual" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select front visual" }));
  expect(screen.getByText("No understanding image yet")).toBeTruthy();
  expect(screen.queryByText("Existing image · choose its side")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Select back visual" }));
  expect(await screen.findByRole("img", { name: `Memory image for ${note.title}` })).toBeTruthy();
});


test("Note shows a recall-only image alongside the text and flips back from the missing front", async () => {
  const readingNotes = guidedApi();
  readingNotes.attachments.readDataUrl = vi.fn(async id => `data:image/png;base64,${id}`);
  const recallOnly = { ...note, title: "母音、半母音與子音", memoryImages: { recall: { attachmentId: "pronunciation-recall", basedOnRevision: 1 } } };
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={recallOnly} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "View note content" }));
  const image = await screen.findByRole("img", { name: `Memory image for ${recallOnly.title}` });
  expect(image.getAttribute("src")).toBe("data:image/png;base64,pronunciation-recall");
  expect(screen.getByText("Recall · Back")).toBeTruthy();
  expect(screen.getByText("The correction arrives too late.")).toBeTruthy();
  fireEvent.click(image);
  const viewer = screen.getByRole("dialog", { name: `Enlarged image: Memory image for ${recallOnly.title}` });
  fireEvent.click(within(viewer).getByRole("button", { name: "Flip to front image" }));
  expect(within(viewer).getByText("No front image yet")).toBeTruthy();
  expect(screen.getByText("The correction arrives too late.")).toBeTruthy();
  fireEvent.click(within(viewer).getByRole("button", { name: "Flip to back image" }));
  fireEvent.mouseDown(viewer);
  expect(await screen.findByRole("img", { name: `Memory image for ${recallOnly.title}` })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Enter edit mode" }));
  expect(await screen.findByRole("img", { name: `Memory image for ${recallOnly.title}` })).toBeTruthy();
  expect(readingNotes.update).not.toHaveBeenCalled();
});


test("canceling visual settings does not generate images or close the note", async () => {
  const readingNotes = guidedApi();
  const generateMissing = vi.fn();
  const close = vi.fn();
  Object.assign(readingNotes.memoryImage!, { generateMissing });
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={close} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate both visuals" }));
  const settings = await screen.findByRole("dialog", { name: "Generate visuals" });
  await within(settings).findByText("See the key ideas and relationships");
  fireEvent.keyDown(settings, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Generate visuals" })).toBeNull();
  expect(generateMissing).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
});


test("batch generation starts from the independent front and back Settings defaults", async () => {
  const readingNotes = guidedApi();
  const defaults = { understand: { purposeId: "purpose-concept-contrast", styleId: "style-storybook-watercolor" },
    recall: { purposeId: "purpose-memory-palace", styleId: "style-clay-miniature" } };
  readingNotes.memoryImage!.templates.get = vi.fn(async () => ({ purposes: BUILT_IN_MEMORY_IMAGE_PURPOSES, styles: BUILT_IN_MEMORY_IMAGE_STYLES,
    defaultPurposeId: "purpose-concept-structure", defaultStyleId: "style-minimal-vector", defaultsBySide: defaults }));
  const generateMissing = vi.fn(async () => ({ noteId: note.id, phase: "ready", available: true, status: "Saved." }));
  Object.assign(readingNotes.memoryImage!, { generateMissing });
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Generate both visuals" }));
  const generate = await screen.findByRole("button", { name: "Generate 2 images" });
  await waitFor(() => expect((generate as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(generate);
  expect(generateMissing).toHaveBeenCalledWith(note.id, {
    understand: expect.objectContaining({ purpose: expect.objectContaining({ id: defaults.understand.purposeId }), style: expect.objectContaining({ id: defaults.understand.styleId }) }),
    recall: expect.objectContaining({ purpose: expect.objectContaining({ id: defaults.recall.purposeId }), style: expect.objectContaining({ id: defaults.recall.styleId }) })
  });
});


test("single-side creation uses that side's saved purpose and style", async () => {
  const readingNotes = guidedApi();
  readingNotes.memoryImage!.templates.get = vi.fn(async () => ({ purposes: BUILT_IN_MEMORY_IMAGE_PURPOSES, styles: BUILT_IN_MEMORY_IMAGE_STYLES,
    defaultPurposeId: "purpose-concept-structure", defaultStyleId: "style-minimal-vector",
    defaultsBySide: { recall: { purposeId: "purpose-memory-palace", styleId: "style-storybook-watercolor" } } }));
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={vi.fn()} onSaved={vi.fn()} />);
  openImageControls();
  await screen.findByText("空間記憶");
  fireEvent.click(screen.getByRole("button", { name: "Prepare text draft" }));
  await waitFor(() => expect(readingNotes.memoryImage!.generate).toHaveBeenCalledWith(expect.objectContaining({ side: "recall",
    purpose: expect.objectContaining({ id: "purpose-memory-palace" }), style: expect.objectContaining({ id: "style-storybook-watercolor" }) })));
});


test("F68 TC1/2: book choices survive reopening, stay separate by side and do not affect another book", async () => {
  const readingNotes = guidedApi();
  function open(bookTitle = note.bookTitle, id = "new-note") {
    return render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={{ ...note, bookTitle, id }} onClose={vi.fn()} onSaved={vi.fn()} />);
  }
  const first = open(); openImageControls();
  await screen.findByText("Give the concept a memorable scene");
  fireEvent.click(screen.getByRole("button", { name: "Change style" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose 清爽手繪" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Choose 清爽手繪" }).getAttribute("aria-pressed")).toBe("true"));
  fireEvent.click(screen.getByRole("button", { name: "Explore other purposes" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose 空間記憶" }));
  await waitFor(() => expect(screen.getByRole("radio", { name: "Generate directly" }).matches(":disabled")).toBe(false));
  fireEvent.click(screen.getByRole("radio", { name: "Generate directly" }));
  first.unmount();
  const second = open(note.bookTitle, "second-note"); openImageControls();
  await screen.findByText("清爽手繪");
  expect(screen.getByText("空間記憶")).toBeTruthy();
  expect((screen.getByRole("radio", { name: "Generate directly" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Select front visual" }));
  await screen.findByText("極簡向量");
  expect((screen.getByRole("radio", { name: "Generate directly" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: "Review draft first" }));
  fireEvent.click(screen.getByRole("button", { name: "Select back visual" }));
  openImageControls();
  expect((await screen.findByRole("radio", { name: "Review draft first" }) as HTMLInputElement).checked).toBe(true);
  second.unmount();
  open("Other book"); openImageControls();
  await screen.findByText("溫暖插畫");
  expect((screen.getByRole("radio", { name: "Review draft first" }) as HTMLInputElement).checked).toBe(true);
  expect(window.localStorage.getItem("reader-memory-image-generation-mode")).toBeNull();
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
});


const bookPreferenceKey = () => `reader-memory-image-book:${encodeURIComponent(note.bookTitle)}`;

test("F68 TC3: deleted templates, changed sides and malformed storage fall back without rewriting preferences", async () => {
  const settings = await guidedApi().memoryImage!.templates.get();
  rememberBookMemoryImageChoices(note.bookTitle, "recall", { purposeId: "purpose-concept-structure", styleId: "deleted-style" });
  expect(bookMemoryImageDefaults(settings, "recall", note.bookTitle)).toMatchObject({ purposeId: "purpose-surreal-association", styleId: "style-warm-illustration" });
  for (const invalid of ["{", "[]", '{"sides":{"recall":false},"generationMode":"invalid"}']) {
    window.localStorage.setItem(bookPreferenceKey(), invalid);
    expect(bookMemoryImageDefaults(settings, "recall", note.bookTitle)).toMatchObject({ purposeId: "purpose-surreal-association", styleId: "style-warm-illustration" });
    expect(readMemoryImageGenerationMode(note.bookTitle)).toBe("review");
    expect(window.localStorage.getItem(bookPreferenceKey())).toBe(invalid);
  }
  window.localStorage.setItem("reader-memory-image-generation-mode", "direct");
  expect(readMemoryImageGenerationMode(note.bookTitle)).toBe("direct");
  rememberMemoryImageGenerationMode("review", note.bookTitle);
  expect(readMemoryImageGenerationMode(note.bookTitle)).toBe("review");
  expect(readMemoryImageGenerationMode("Other book")).toBe("direct");
});

test("F68 TC4: template storage failure keeps this selection usable and shows a warning", async () => {
  const readingNotes = guidedApi();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={vi.fn()} onSaved={vi.fn()} />);
  openImageControls(); await screen.findByText("溫暖插畫");
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Full"); });
  fireEvent.click(screen.getByRole("button", { name: "Change style" }));
  fireEvent.click(screen.getByRole("button", { name: "Choose 清爽手繪" }));
  await screen.findByText("This choice applies now, but could not be remembered for next time.");
  expect(screen.getByRole("button", { name: "Choose 清爽手繪" }).getAttribute("aria-pressed")).toBe("true");
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
});

test("F68 TC5: missing visual settings cancel safely, save on submit and feed the sidebar default action", async () => {
  const readingNotes = guidedApi();
  const onGenerate = vi.fn();
  const onCancel = vi.fn();
  const first = render(<MissingVisualSettings api={readingNotes} note={note} onCancel={onCancel} onGenerate={onGenerate} />);
  await screen.findByText("極簡向量");
  const front = screen.getByRole("region", { name: "Front visual settings" });
  fireEvent.click(within(front).getByRole("button", { name: "Change style" }));
  fireEvent.click(within(front).getByRole("button", { name: "Choose 清爽手繪" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(window.localStorage.getItem(bookPreferenceKey())).toBeNull();
  first.unmount();
  const second = render(<MissingVisualSettings api={readingNotes} note={note} onCancel={vi.fn()} onGenerate={onGenerate} />);
  await screen.findByText("極簡向量");
  const frontAgain = screen.getByRole("region", { name: "Front visual settings" });
  fireEvent.click(within(frontAgain).getByRole("button", { name: "Change style" }));
  fireEvent.click(within(frontAgain).getByRole("button", { name: "Choose 清爽手繪" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate 2 images" }));
  expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ understand: expect.objectContaining({ style: expect.objectContaining({ id: "style-hand-drawn" }) }) }), false);
  second.unmount();
  readingNotes.memoryImage!.generateMissing = vi.fn(async () => ({ noteId: note.id, phase: "ready" as const, available: true, status: "Done" }));
  render(<ReaderNoteVisualActions api={readingNotes} note={note} onSaved={vi.fn()} />);
  const button = await screen.findByRole("button", { name: "Generate both visuals" });
  fireEvent.click(button);
  await waitFor(() => expect(readingNotes.memoryImage!.generateMissing).toHaveBeenCalledWith(note.id, expect.objectContaining({ understand: expect.objectContaining({ style: expect.objectContaining({ id: "style-hand-drawn" }) }) })));
});

test("F68 TC6: viewing an old recipe preserves the snapshot and does not change the book defaults", async () => {
  const readingNotes = guidedApi();
  rememberBookMemoryImageChoices(note.bookTitle, "recall", { purposeId: "purpose-memory-palace", styleId: "style-hand-drawn" });
  const before = window.localStorage.getItem(bookPreferenceKey());
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={{ ...note, memoryImages: { recall: { attachmentId: "old", basedOnRevision: 1,
    recipe: { purpose: { name: "Old purpose", prompt: "Old purpose text" }, style: { name: "Old style", prompt: "Old style text" }, adjustments: [] } } } }} onClose={vi.fn()} onSaved={vi.fn()} />);
  openImageControls();
  await screen.findByText("Old purpose · Old style");
  expect(window.localStorage.getItem(bookPreferenceKey())).toBe(before);
});


test("F68 TC2/4: a workflow that cannot be saved stays shared for the current note session across flips", async () => {
  const readingNotes = guidedApi();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={note} onClose={vi.fn()} onSaved={vi.fn()} />);
  openImageControls(); await screen.findByText("溫暖插畫");
  vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Full"); });
  fireEvent.click(screen.getByRole("radio", { name: "Generate directly" }));
  expect((screen.getByRole("radio", { name: "Generate directly" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Select front visual" }));
  expect((await screen.findByRole("radio", { name: "Generate directly" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText("This choice applies now, but could not be remembered for next time.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Select back visual" }));
  expect((await screen.findByRole("radio", { name: "Generate directly" }) as HTMLInputElement).checked).toBe(true);
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
});


const overviewBook = { id: "book-a", title: note.bookTitle, author: "Author", chapters: [], chapterRanges: {}, chapterAnnotations: {}, readingState: { view: "overview" as const, chapterId: null, scrollProgress: 0 } };
function openOverview(readingNotes = guidedApi(), bookTitle = note.bookTitle) {
  return render(<BookOverview book={{ ...overviewBook, title: bookTitle }} onContinue={vi.fn()} onDelete={vi.fn()} onOpenChapter={vi.fn()}
    {...{ memoryImageTemplates: readingNotes.memoryImage!.templates }} />);
}

test("F68 TC7: book overview configures both image sides and workflow before any notes exist", async () => {
  const readingNotes = guidedApi();
  const first = openOverview(readingNotes);
  fireEvent.click(await screen.findByRole("button", { name: "Edit image settings" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Recall purpose" }), { target: { value: "purpose-memory-palace" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Recall style" }), { target: { value: "style-storybook-watercolor" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Understanding purpose" }), { target: { value: "purpose-cause-effect" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Understanding style" }), { target: { value: "style-hand-drawn" } });
  fireEvent.click(screen.getByRole("radio", { name: "Generate directly" }));
  expect(window.localStorage.getItem(bookPreferenceKey())).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Image settings saved for this book.");
  expect(readMemoryImageGenerationMode(note.bookTitle)).toBe("direct");
  const settings = await readingNotes.memoryImage!.templates.get();
  expect(bookMemoryImageDefaults(settings, "recall", note.bookTitle)).toMatchObject({ purposeId: "purpose-memory-palace", styleId: "style-storybook-watercolor" });
  expect(bookMemoryImageDefaults(settings, "understand", note.bookTitle)).toMatchObject({ purposeId: "purpose-cause-effect", styleId: "style-hand-drawn" });
  expect(readingNotes.memoryImage!.generate).not.toHaveBeenCalled();
  first.unmount();
  const second = openOverview(readingNotes);
  fireEvent.click(await screen.findByRole("button", { name: "Edit image settings" }));
  expect(screen.getByRole("combobox", { name: "Recall style" })).toHaveProperty("value", "style-storybook-watercolor");
  second.unmount();
  const third = openOverview(readingNotes, "Other book");
  fireEvent.click(await screen.findByRole("button", { name: "Edit image settings" }));
  expect(screen.getByRole("combobox", { name: "Recall style" })).toHaveProperty("value", "style-warm-illustration");
  expect((screen.getByRole("radio", { name: "Review draft first" }) as HTMLInputElement).checked).toBe(true);
  third.unmount();
  render(<ReadingNoteEditorDialog api={readingNotes} mode="manual-edit" note={{ ...note, id: "new-note-after-settings" }} onClose={vi.fn()} onSaved={vi.fn()} />);
  openImageControls();
  await screen.findByText("淡彩水彩");
  fireEvent.click(screen.getByRole("button", { name: "Generate image" }));
  await waitFor(() => expect(readingNotes.memoryImage!.generate).toHaveBeenCalledWith(expect.objectContaining({
    generationMode: "direct", purpose: expect.objectContaining({ id: "purpose-memory-palace" }), style: expect.objectContaining({ id: "style-storybook-watercolor" })
  })));
});

test("F68 TC8: overview cancel preserves preferences and failed save can retry the same edits", async () => {
  openOverview();
  fireEvent.click(await screen.findByRole("button", { name: "Edit image settings" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Recall style" }), { target: { value: "style-hand-drawn" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(window.localStorage.getItem(bookPreferenceKey())).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit image settings" }));
  expect(screen.getByRole("combobox", { name: "Recall style" })).toHaveProperty("value", "style-warm-illustration");
  fireEvent.change(screen.getByRole("combobox", { name: "Recall style" }), { target: { value: "style-storybook-watercolor" } });
  const storage = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Full"); });
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Unable to save image settings");
  expect(screen.getByRole("combobox", { name: "Recall style" })).toHaveProperty("value", "style-storybook-watercolor");
  expect(window.localStorage.getItem(bookPreferenceKey())).toBeNull();
  storage.mockRestore();
  fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  await screen.findByText("Image settings saved for this book.");
});

test("F68 TC8: overview retries template loading failures", async () => {
  const readingNotes = guidedApi();
  const settings = await readingNotes.memoryImage!.templates.get();
  readingNotes.memoryImage!.templates.get = vi.fn().mockRejectedValueOnce(new Error("Templates unavailable")).mockResolvedValue(settings);
  openOverview(readingNotes);
  expect((await screen.findByRole("alert")).textContent).toContain("Templates unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Retry image settings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit image settings" }));
  expect(screen.getByRole("combobox", { name: "Recall purpose" })).toBeTruthy();
});


test("F68 TC10/11: the simplified main-page form has one exit and accessible feedback at Save", async () => {
  const user = userEvent.setup();
  openOverview();
  const edit = await screen.findByRole("button", { name: "Edit image settings" });
  await user.click(edit);
  expect(screen.queryByRole("button", { name: "Close image settings" })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Recall purpose" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Recall style" }), { target: { value: "style-hand-drawn" } });
  const storage = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("Full"); });
  const save = screen.getByRole("button", { name: "Save settings" });
  await user.click(save);
  const error = await screen.findByRole("alert");
  expect(save.getAttribute("aria-describedby")).toBe(error.id);
  expect(document.activeElement).toBe(save);
  expect(screen.getByRole("combobox", { name: "Recall style" })).toHaveProperty("value", "style-hand-drawn");
  storage.mockRestore();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit image settings" }));
  expect(window.localStorage.getItem(bookPreferenceKey())).toBeNull();
});
