import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { LocalChapterScratchpadStore } from "../src/main/chapter-scratchpad-store";
import { LocalReadingNoteAttachmentStore } from "../src/main/reading-note-attachment-store";
import { registerChapterScratchpadIpc } from "../src/main/chapter-scratchpad-ipc";
import { ChapterScratchpadSession } from "../src/renderer/chapter-scratchpad-session";
import { emptyScratchpadContent, type ChapterScratchpadApi, type ChapterScratchpad, type ChapterScratchpadKey } from "../src/shared/chapter-scratchpad";
import { markdownToReadingNoteDocument, readingNoteDocumentToMarkdown, type ReadingNoteDocument } from "../src/shared/reading-note-document";

const directories: string[] = [];
function directory() { const path = mkdtempSync(join(tmpdir(), "chapter-scratchpad-")); directories.push(path); return path; }
afterEach(() => { vi.useRealTimers(); directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
const key = { bookId: "book-a", chapterId: "chapter-1" };
const content = (text: string) => markdownToReadingNoteDocument(text);
function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
function apiFor(store: LocalChapterScratchpadStore): ChapterScratchpadApi {
  return { get: vi.fn(async key => store.get(key)), save: vi.fn(async input => store.save(input)), attachments: { upload: vi.fn(), readDataUrl: vi.fn() } };
}
async function ready(session: ChapterScratchpadSession) { await session.load(); expect(session.getSnapshot().phase).toBe("ready"); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("TC2/3: rich documents persist across store restarts and stable chapter IDs isolate notes", () => {
  const path = directory(), store = new LocalChapterScratchpadStore(path);
  expect(store.get(key).revision).toBe(0);
  const rich = content("## Heading\n\n**Bold** and [link](https://example.com)\n\n- List\n\n> Quote\n\n| A | B |\n| --- | --- |\n| one | two |");
  rich.blocks.push({ id: "table", type: "table", props: {}, content: { type: "tableContent", columnWidths: [120, 120], headerRows: 1, rows: [{ cells: [[{ type: "text", text: "A", styles: { bold: true } }], [{ type: "text", text: "B", styles: {} }]] }] }, children: [] });
  const saved = store.save({ ...key, baseRevision: 0, content: rich });
  expect(new LocalChapterScratchpadStore(path).get(key)).toEqual(saved);
  expect(saved.content).toEqual(rich);
  expect(store.get({ ...key, chapterId: "chapter-2" }).revision).toBe(0);
  expect(store.get({ ...key, bookId: "book-b" }).revision).toBe(0);
  const empty = store.save({ ...key, baseRevision: 1, content: emptyScratchpadContent() });
  expect(empty.revision).toBe(2);
  expect(new LocalChapterScratchpadStore(path).get(key).content).toEqual(empty.content);
});

test("TC5/7: stale revisions, malformed source and corrupt disk content never overwrite a note", () => {
  const path = directory(), store = new LocalChapterScratchpadStore(path);
  store.save({ ...key, baseRevision: 0, content: content("original") });
  expect(() => store.save({ ...key, baseRevision: 0, content: content("stale") })).toThrow(/changed elsewhere/);
  expect(() => store.save({ ...key, baseRevision: 1, content: {} as ReadingNoteDocument })).toThrow();
  expect(() => store.get({ ...key, bookId: "" })).toThrow();
  expect(readingNoteDocumentToMarkdown(store.get(key).content)).toContain("original");
  const filename = readdirSync(path).find(name => name.endsWith(".json"))!;
  writeFileSync(join(path, filename), "{corrupt");
  expect(() => store.get(key)).toThrow(/Unable to load/);
  expect(() => store.save({ ...key, baseRevision: 0, content: content("new") })).toThrow(/Unable to load/);
});

test("TC7: pasted images receive independent ownership and survive restart / garbage collection", () => {
  const path = directory();
  const attachments = new LocalReadingNoteAttachmentStore(path);
  const upload = attachments.stage({ name: "test.png", mimeType: "image/png", bytes: new Uint8Array([137,80,78,71,13,10,26,10,0]) });
  attachments.reconcile("existing-card", [upload.id]);
  const rich: ReadingNoteDocument = { version: 1, blocks: [{ id: "image-1", type: "image", props: { assetId: upload.id, alt: "Example" }, children: [] }] };
  const store = new LocalChapterScratchpadStore(join(path, "pads"), attachments);
  const saved = store.save({ ...key, baseRevision: 0, content: rich });
  const owned = String(saved.content.blocks[0]!.props.assetId);
  expect(owned).not.toBe(upload.id);
  expect(attachments.readDataUrl(owned)).toBe(attachments.readDataUrl(upload.id));
  const reloaded = new LocalReadingNoteAttachmentStore(path, { now: () => Date.now() + 172800000 });
  new LocalChapterScratchpadStore(join(path, "pads"), reloaded).reconcileAttachments();
  reloaded.collectGarbage();
  expect(reloaded.readDataUrl(owned)).toContain("data:image/png;base64,");
});

test("TC5/7: a corrupt scratchpad does not prevent startup and suspends attachment garbage collection", () => {
  const path = directory(), store = new LocalChapterScratchpadStore(path);
  store.save({ ...key, baseRevision: 0, content: content("Stored") });
  writeFileSync(join(path, readdirSync(path).find(name => name.endsWith(".json"))!), "{corrupt");
  expect(store.reconcileAttachments()).toBe(false);
  expect(() => store.get(key)).toThrow(/Unable to load/);
});

test("TC7: IPC validates actual library membership and content before saving", async () => {
  const handlers = new Map<string, (event: unknown, input: unknown) => unknown>();
  const store = new LocalChapterScratchpadStore(directory());
  registerChapterScratchpadIpc({ handle: (channel, handler) => { handlers.set(channel, handler); } }, store,
    async input => input.bookId === key.bookId && input.chapterId === key.chapterId);
  const get = handlers.get("chapter-scratchpad:get")!, save = handlers.get("chapter-scratchpad:save")!;
  await expect(get(null, { ...key, bookId: "other" })).rejects.toThrow(/Chapter not found/);
  await expect(save(null, { ...key, baseRevision: 0, content: null })).rejects.toThrow();
  await expect(save(null, { ...key, baseRevision: 0, content: content("Saved") })).resolves.toMatchObject({ revision: 1 });
  await expect(get(null, key)).resolves.toMatchObject({ revision: 1 });
});

test("TC4: slow save acknowledgements never replace new typing, writes remain serialized", async () => {
  const store = new LocalChapterScratchpadStore(directory()), api = apiFor(store), storage = memoryStorage();
  const first = deferred<ChapterScratchpad>();
  vi.mocked(api.save).mockImplementationOnce(async input => { const saved = store.save(input); await first.promise; return saved; });
  const session = new ChapterScratchpadSession(api, key, storage);
  await ready(session);
  session.update(content("First"));
  const flushing = session.flush();
  session.update(content("Newest"));
  expect(api.save).toHaveBeenCalledTimes(1);
  first.resolve(store.get(key));
  await flushing;
  expect(api.save).toHaveBeenCalledTimes(2);
  expect(readingNoteDocumentToMarkdown(session.getSnapshot().content)).toContain("Newest");
  expect(session.getSnapshot()).toMatchObject({ revision: 2, dirty: false, error: "" });
  expect(storage.getItem(session.recoveryKey)).toBeNull();
});

test("TC3/4: switching chapters flushes to the original key and drafts recover before debounce", async () => {
  vi.useFakeTimers();
  const store = new LocalChapterScratchpadStore(directory()), api = apiFor(store), storage = memoryStorage();
  const first = new ChapterScratchpadSession(api, key, storage);
  await ready(first);
  first.update(content("Chapter one"));
  const otherKey = { ...key, chapterId: "chapter-2" };
  const second = new ChapterScratchpadSession(api, otherKey, storage);
  await ready(second);
  second.update(content("Chapter two"));
  expect(storage.getItem(first.recoveryKey)).toContain("Chapter one");
  await first.flush();
  // A new renderer process can recover the second chapter before its timer fired.
  const restored = new ChapterScratchpadSession(api, otherKey, storage);
  await ready(restored); await restored.flush();
  expect(readingNoteDocumentToMarkdown(store.get(key).content)).toContain("Chapter one");
  expect(readingNoteDocumentToMarkdown(store.get(otherKey).content)).toContain("Chapter two");
});

test("TC4: debounce autosaves after the final edit", async () => {
  vi.useFakeTimers();
  const api = apiFor(new LocalChapterScratchpadStore(directory()));
  const session = new ChapterScratchpadSession(api, key, memoryStorage());
  await ready(session);
  session.update(content("A"));
  await vi.advanceTimersByTimeAsync(300);
  session.update(content("B"));
  await vi.advanceTimersByTimeAsync(399);
  expect(api.save).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(session.getSnapshot().dirty).toBe(false);
});

test("TC5: load failures cannot overwrite disk and save failures retain a retryable draft", async () => {
  const api = apiFor(new LocalChapterScratchpadStore(directory()));
  vi.mocked(api.get).mockRejectedValueOnce(new Error("Read failed"));
  const session = new ChapterScratchpadSession(api, key, memoryStorage());
  await session.load();
  expect(session.getSnapshot()).toMatchObject({ phase: "loading", error: "Read failed" });
  session.update(content("Must not write"));
  await session.flush(); expect(api.save).not.toHaveBeenCalled();
  await session.retry();
  vi.mocked(api.save).mockRejectedValueOnce(new Error("Disk full"));
  session.update(content("Keep me")); await session.flush();
  expect(session.getSnapshot()).toMatchObject({ dirty: true, error: "Disk full" });
  await session.retry();
  expect(session.getSnapshot()).toMatchObject({ dirty: false, error: "" });
  expect(readingNoteDocumentToMarkdown(session.getSnapshot().content)).toContain("Keep me");
});

test("TC5: recovery conflicts keep the draft visible without automatically overwriting saved content", async () => {
  const store = new LocalChapterScratchpadStore(directory()), api = apiFor(store), storage = memoryStorage();
  store.save({ ...key, baseRevision: 0, content: content("Saved elsewhere") });
  const recoveryKey = `deep-reader:scratchpad-draft:${JSON.stringify([key.bookId, key.chapterId])}`;
  storage.setItem(recoveryKey, JSON.stringify({ ...key, baseRevision: 0, content: content("Recovered draft") }));
  const session = new ChapterScratchpadSession(api, key, storage);
  await ready(session); await session.flush();
  expect(api.save).not.toHaveBeenCalled();
  expect(session.getSnapshot().error).toMatch(/recovered draft/);
  expect(readingNoteDocumentToMarkdown(session.getSnapshot().content)).toContain("Recovered draft");
  await session.retry();
  expect(readingNoteDocumentToMarkdown(store.get(key).content)).toContain("Recovered draft");
});

test("TC5: unavailable recovery storage is visible while Main autosave can still succeed", async () => {
  const api = apiFor(new LocalChapterScratchpadStore(directory()));
  const session = new ChapterScratchpadSession(api, key, { ...memoryStorage(), setItem() { throw new Error("Quota"); } });
  await ready(session);
  session.update(content("Persist through Main"));
  expect(session.getSnapshot().recoveryWarning).toMatch(/Keep the app open/);
  await session.flush();
  expect(session.getSnapshot().dirty).toBe(false);
});
