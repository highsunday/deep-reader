// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { ChapterScratchpad, scratchpadEditorContent, scratchpadPosition } from "../src/renderer/ChapterScratchpad";
import type { ChapterScratchpadApi, ChapterScratchpad as SavedScratchpad } from "../src/shared/chapter-scratchpad";
import { emptyScratchpadContent } from "../src/shared/chapter-scratchpad";
import { markdownToReadingNoteDocument, readingNoteDocumentToMarkdown } from "../src/shared/reading-note-document";

beforeAll(() => {
  const storage = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    clear: () => storage.clear(), getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key)
  } });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) });
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView = vi.fn();
  window.scrollBy = vi.fn();
  Element.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 100, 20);
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
});
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function fixture() {
  const saved = new Map<string, SavedScratchpad>();
  const api: ChapterScratchpadApi = {
    get: vi.fn(async key => saved.get(key.chapterId) ?? { ...key, revision: 0, updatedAt: 0, content: emptyScratchpadContent() }),
    save: vi.fn(async input => { const value = { bookId: input.bookId, chapterId: input.chapterId, revision: input.baseRevision + 1, updatedAt: Date.now(), content: input.content }; saved.set(input.chapterId, value); return value; }),
    attachments: { upload: vi.fn(), readDataUrl: vi.fn() }
  };
  return { api, saved };
}
const props = { bookId: "book", chapterId: "one", chapterTitle: "First chapter" };
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "Open chapter scratchpad" }));
  await waitFor(() => expect(document.querySelector('.chapter-scratchpad .bn-editor[contenteditable="true"]')).not.toBeNull());
  return document.querySelector<HTMLElement>('.chapter-scratchpad .bn-editor[contenteditable="true"]')!;
}

test("TC1/2: the real BlockNote editor saves bold text, retains undo/editor on minimize and reloads after remount", async () => {
  const { api, saved } = fixture();
  const user = userEvent.setup();
  const view = render(<ChapterScratchpad api={api} {...props} />);
  const editor = await open();
  expect(api.save).not.toHaveBeenCalled();
  editor.focus();
  await user.type(editor, "A thought ", { skipClick: true });
  await user.keyboard("{Control>}b{/Control}");
  await user.type(editor, "bold", { skipClick: true });
  await waitFor(() => expect(saved.has("one")).toBe(true), { timeout: 2000 });
  expect(JSON.stringify(saved.get("one")!.content)).toContain('"bold":true');
  expect(readingNoteDocumentToMarkdown(saved.get("one")!.content)).toContain("bold");
  fireEvent.click(screen.getByRole("button", { name: "Minimize scratchpad" }));
  expect(screen.getByLabelText("This chapter has notes")).toBeTruthy();
  fireEvent.keyDown(window, { key: "j", ctrlKey: true, shiftKey: true });
  expect(document.querySelector('.chapter-scratchpad .bn-editor')).toBe(editor);
  view.unmount();
  render(<ChapterScratchpad api={{ ...api }} {...props} />);
  const reloaded = await open();
  expect(reloaded.textContent).toContain("A thought bold");
});

test("TC3: pending chapter loads cannot replace the current chapter and quick switching saves the original source", async () => {
  const { api, saved } = fixture();
  const user = userEvent.setup();
  const view = render(<ChapterScratchpad api={api} {...props} />);
  const editor = await open();
  editor.focus(); await user.type(editor, "Only in chapter one", { skipClick: true });
  view.rerender(<ChapterScratchpad api={api} {...props} chapterId="two" chapterTitle="Second chapter" />);
  await waitFor(() => expect(saved.has("one")).toBe(true));
  await waitFor(() => expect(document.querySelector('.chapter-scratchpad .bn-editor')?.textContent).not.toContain("Only in chapter one"));
  expect(saved.has("two")).toBe(false);
  view.rerender(<ChapterScratchpad api={api} {...props} />);
  await waitFor(() => expect(document.querySelector('.chapter-scratchpad .bn-editor')?.textContent).toContain("Only in chapter one"));
});

test("TC5: errors retain editable content and expose retry without a false Saved state", async () => {
  const { api } = fixture();
  vi.mocked(api.save).mockRejectedValueOnce(new Error("Disk unavailable"));
  const user = userEvent.setup();
  render(<ChapterScratchpad api={api} {...props} />);
  const editor = await open();
  editor.focus(); await user.type(editor, "Keep this draft", { skipClick: true });
  await screen.findByText("Disk unavailable", {}, { timeout: 2000 });
  expect(screen.getByRole("status").textContent).toBe("Not saved");
  expect(editor.textContent).toContain("Keep this draft");
  fireEvent.click(screen.getByRole("button", { name: "Save my draft" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Saved"));
});

test("TC3: a late previous-chapter response cannot populate the current editor", async () => {
  const { api } = fixture();
  let resolve!: (pad: SavedScratchpad) => void;
  vi.mocked(api.get).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = render(<ChapterScratchpad api={api} {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "Open chapter scratchpad" }));
  expect(document.querySelector(".bn-editor")).toBeNull();
  view.rerender(<ChapterScratchpad api={api} {...props} chapterId="two" chapterTitle="Second chapter" />);
  await waitFor(() => expect(document.querySelector(".bn-editor")).not.toBeNull());
  await act(async () => { resolve({ bookId: "book", chapterId: "one", revision: 1, updatedAt: 1, content: markdownToReadingNoteDocument("Late first chapter") }); });
  expect(document.querySelector(".bn-editor")?.textContent).not.toContain("Late first chapter");
  expect(api.save).not.toHaveBeenCalled();
});

test("TC6: keyboard positioning is bounded and retained; IME and suspended shortcuts do not open the panel", async () => {
  const { api } = fixture();
  const view = render(<ChapterScratchpad api={api} {...props} />);
  await open();
  const move = screen.getByRole("button", { name: "Move scratchpad" });
  fireEvent.keyDown(move, { key: "ArrowRight" });
  fireEvent.keyDown(move, { key: "ArrowUp" });
  const panel = screen.getByRole("region", { name: "Chapter scratchpad" });
  expect(panel.style.left).toBe("10%");
  expect(panel.style.top).toBe("90%");
  for (let i = 0; i < 15; i++) fireEvent.keyDown(move, { key: "ArrowLeft" });
  expect(panel.style.left).toBe("0%");
  fireEvent.click(screen.getByRole("button", { name: "Minimize scratchpad" }));
  fireEvent.keyDown(window, { key: "j", metaKey: true, shiftKey: true, isComposing: true });
  expect(screen.queryByRole("region", { name: "Chapter scratchpad" })).toBeNull();
  view.rerender(<ChapterScratchpad api={api} {...props} suspended />);
  fireEvent.keyDown(window, { key: "j", metaKey: true, shiftKey: true });
  expect(screen.queryByRole("region", { name: "Chapter scratchpad" })).toBeNull();
  view.unmount();
  render(<ChapterScratchpad api={api} {...props} />);
  await open();
  expect(screen.getByRole("region", { name: "Chapter scratchpad" }).style.left).toBe("0%");
  expect(scratchpadPosition({ x: -8, y: 12 })).toEqual({ x: 0, y: 1 });
});

test("TC6: Escape closes the slash menu before minimizing the scratchpad", async () => {
  const { api } = fixture();
  const user = userEvent.setup();
  render(<ChapterScratchpad api={api} {...props} />);
  const editor = await open();
  editor.focus();
  await user.type(editor, "/", { skipClick: true });
  await waitFor(() => expect(document.querySelector(".bn-suggestion-menu")).not.toBeNull());
  fireEvent.keyDown(editor, { key: "Escape" });
  await waitFor(() => expect(document.querySelector(".bn-suggestion-menu")).toBeNull());
  expect(screen.getByRole("region", { name: "Chapter scratchpad" })).toBeTruthy();
  fireEvent.keyDown(editor, { key: "Escape" });
  expect(screen.queryByRole("region", { name: "Chapter scratchpad" })).toBeNull();
});

test("TC2: unfinished image pickers never prevent surrounding text from being saved", () => {
  const parsed = scratchpadEditorContent([
    { id: "p", type: "paragraph", props: {}, content: [{ type: "text", text: "Remember this", styles: { italic: true } }], children: [{ id: "empty-nested-image", type: "image", props: { url: "" }, children: [] }] },
    { id: "empty-image", type: "image", props: { url: "" }, children: [] }
  ]);
  expect(readingNoteDocumentToMarkdown(parsed)).toContain("Remember this");
  expect(parsed.blocks).toHaveLength(1);
  expect(parsed.blocks[0]!.children).toEqual([]);
});


test("B46 TC2: old positions reset to the lower left; invalid positions use the same default", async () => {
  localStorage.setItem("deep-reader:scratchpad-position", JSON.stringify({ x: 1, y: .5 }));
  const { api } = fixture();
  render(<ChapterScratchpad api={api} {...props} />);
  await open();
  const panel = screen.getByRole("region", { name: "Chapter scratchpad" });
  expect(panel.style.left).toBe("0%");
  expect(panel.style.top).toBe("100%");
  expect(scratchpadPosition(null)).toEqual({ x: 0, y: 1 });
  expect(scratchpadPosition({ x: NaN, y: 0 })).toEqual({ x: 0, y: 1 });
});

test("B46 TC3: pointer dragging reaches the lower left boundary and retains it after remount", async () => {
  const { api } = fixture();
  const view = render(<ChapterScratchpad api={api} {...props} />);
  await open();
  const panel = screen.getByRole("region", { name: "Chapter scratchpad" });
  const layer = panel.parentElement!;
  vi.spyOn(layer, "getBoundingClientRect").mockReturnValue(new DOMRect(12, 60, 800, 600));
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(new DOMRect(172, 230, 480, 260));
  const handle = screen.getByRole("button", { name: "Move scratchpad" });
  handle.setPointerCapture = vi.fn();
  function pointer(type: string, x: number, y: number) {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(handle, event);
  }
  pointer("pointerdown", 190, 250);
  pointer("pointermove", 30, 420);
  pointer("pointerup", 30, 420);
  expect(panel.style.left).toBe("0%");
  expect(panel.style.top).toBe("100%");
  view.unmount();
  render(<ChapterScratchpad api={api} {...props} />);
  await open();
  expect(screen.getByRole("region", { name: "Chapter scratchpad" }).style.top).toBe("100%");
  expect(screen.getByRole("region", { name: "Chapter scratchpad" }).style.left).toBe("0%");
});
