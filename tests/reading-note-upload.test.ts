import { test, expect, vi, afterEach } from "vitest";
import { buildCardNotePayload, CardNoteUploadController, cardPoolOrigin } from "../src/main/reading-note-upload";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import type { ReadingNote } from "../src/shared/contracts";
const note: ReadingNote = { id: "n", sourceDraftId: "d", title: "Title", content: markdownToReadingNoteDocument("Body `reading-note-asset:body`"), bookTitle: "Book", chapterTitle: "Chapter", tagIds: ["t"], createdAt: 1, updatedAt: 1, revision: 1 };
const image = "data:image/png;base64,aGVsbG8=";
test("TC1 preserves both faces, body images, tags and code literals", () => {
  const illustrated = { ...note, content: { ...note.content, blocks: [...note.content.blocks, { id: "i", type: "image" as const, props: { assetId: "body", alt: "diagram" }, children: [] }] }, memoryImages: { recall: { attachmentId: "back", basedOnRevision: 1 }, understand: { attachmentId: "front", basedOnRevision: 1 } } };
  const payload = buildCardNotePayload(illustrated, [{ id: "t", name: "Tag" }], () => image, "submission");
  expect(payload.title).toBe("Title");
  expect(payload.tags).toEqual(["Tag"]);
  expect(payload.source).toBe("Book");
  const otherChapter = buildCardNotePayload({ ...note, chapterTitle: "Another chapter" }, [], vi.fn(), "another-submission");
  expect(otherChapter.source).toBe(payload.source);
  expect(payload.markdown).toContain("`reading-note-asset:body`");
  expect(payload.markdown).toContain("![diagram](card-note-asset:asset-1)");
  expect(payload.images).toEqual({ recall: "asset-2", understanding: "asset-3" });
  expect(payload.attachments).toHaveLength(3);
});
test("TC4 missing images and unassigned legacy images are refused", () => {
  const withImage = { ...note, memoryImages: { recall: { attachmentId: "missing", basedOnRevision: 1 } } };
  expect(() => buildCardNotePayload(withImage, [], () => { throw new Error("Missing image"); }, "s")).toThrow("Missing image");
  expect(() => buildCardNotePayload({ ...note, memoryImage: { attachmentId: "old", basedOnRevision: 1 } }, [], vi.fn(), "s")).toThrow(/assign/i);
});

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
function directory() { const dir = mkdtempSync(join(tmpdir(), "card-upload-")); dirs.push(dir); return dir; }
async function finished(controller: CardNoteUploadController) { await vi.waitFor(() => expect(controller.get()?.running).toBe(false)); return controller.get()!; }
function response(status: string, code: number) { return new Response(JSON.stringify({ status, noteId: "saved", title: note.title, url: "http://127.0.0.1:8787/notes/saved" }), { status: code }); }
test("TC2 isolates HTTP service and sends selected snapshots to correct endpoints", async () => {
  const requests: Array<{ path: string; payload: any }> = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString()); requests.push({ path: req.url!, payload });
    const status = requests.length === 1 ? "created" : "duplicate_title";
    res.writeHead(status === "created" ? 201 : 409, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status, noteId: "saved", title: payload.title, url: `http://127.0.0.1:${(server.address() as any).port}/notes/saved` }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const controller = new CardNoteUploadController(directory(), { baseUrl: `http://127.0.0.1:${(server.address() as any).port}`, get: id => id === "a" ? note : { ...note, memoryImages: { recall: { attachmentId: "b", basedOnRevision: 1 } } }, tags: () => [{ id: "t", name: "Tag" }], readImage: () => image });
    controller.start(["a", "a", "b"]);
    expect(() => controller.start(["a"])).toThrow(/current upload/);
    const batch = await finished(controller);
    expect(batch.items.map(i => i.status)).toEqual(["created", "duplicate_title"]);
    expect(requests.map(r => r.path)).toEqual(["/api/notes", "/api/notes/import"]);
    expect(requests[0]!.payload.tags).toEqual(["Tag"]);
    expect(requests[1]!.payload.images).toEqual({ recall: "asset-1" });
    controller.retry(); await finished(controller);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(controller.get())).not.toContain("dataBase64");
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("TC3 restart and retry use original ID, text and image bytes despite changed note", async () => {
  const dir = directory();
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("bad", { status: 503 })).mockResolvedValueOnce(response("created", 201));
  const original = { ...note, memoryImages: { recall: { attachmentId: "back", basedOnRevision: 1 } } };
  const deps = { get: () => original, tags: () => [], readImage: () => image, fetch: send };
  const controller = new CardNoteUploadController(dir, deps);
  controller.start(["n"]); expect((await finished(controller)).items[0]!.status).toBe("uncertain");
  const saved = readFileSync(join(dir, "card-pool-upload.json"), "utf8");
  expect(saved).not.toContain("dataBase64");
  const restored = new CardNoteUploadController(dir, { ...deps, get: () => ({ ...note, title: "Changed" }), readImage: () => { throw new Error("Deleted image"); } });
  expect(() => restored.start(["n"])).toThrow(/current upload/);
  restored.retry(); expect((await finished(restored)).items[0]!.status).toBe("created");
  expect(send.mock.calls[1]![1]!.body).toBe(send.mock.calls[0]![1]!.body);
});

test("B68 TC1 keeps 134 illustrated snapshots out of the batch manifest", async () => {
  const dir = directory();
  const send = vi.fn<typeof fetch>().mockResolvedValue(response("created", 201));
  const controller = new CardNoteUploadController(dir, { get: id => ({ ...note, id, memoryImages: { recall: { attachmentId: "back", basedOnRevision: 1 } } }), tags: () => [], readImage: () => image, fetch: send });
  controller.start(Array.from({ length: 134 }, (_, i) => `note-${i}`));
  const manifest = readFileSync(join(dir, "card-pool-upload.json"), "utf8");
  expect(manifest).not.toContain("dataBase64");
  expect(manifest.length).toBeLessThan(50000);
  expect(readdirSync(join(dir, "card-pool-upload-payloads"))).toHaveLength(134);
  await finished(controller);
  expect(send).toHaveBeenCalledTimes(134);
  for (const [, request] of send.mock.calls) expect(JSON.parse(request!.body as string).attachments[0].dataBase64).toBe("aGVsbG8=");
});

test("B68 TC2 schedules one request at a time and freezes waiting notes", async () => {
  let release!: (value: Response) => void;
  const first = new Promise<Response>(resolve => { release = resolve; });
  const send = vi.fn<typeof fetch>().mockReturnValueOnce(first).mockResolvedValue(response("created", 201));
  let current = { ...note, title: "Original", memoryImages: { recall: { attachmentId: "back", basedOnRevision: 1 } } };
  const readImage = vi.fn(() => image);
  const controller = new CardNoteUploadController(directory(), { get: () => current, tags: () => [], readImage, fetch: send });
  controller.start(["a", "b"]);
  expect(send).not.toHaveBeenCalled();
  current = { ...current, title: "Changed" };
  readImage.mockImplementation(() => { throw new Error("Deleted image"); });
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(send).toHaveBeenCalledTimes(1);
  release(response("created", 201));
  await finished(controller);
  expect(send).toHaveBeenCalledTimes(2);
  expect(JSON.parse(send.mock.calls[1]![1]!.body as string).title).toBe("Original");
  expect(readImage).toHaveBeenCalledTimes(2);
});

test("B68 TC3 migrates legacy inline snapshots without changing the submission", async () => {
  const dir = directory();
  const payload = buildCardNotePayload({ ...note, memoryImages: { recall: { attachmentId: "back", basedOnRevision: 1 } } }, [], () => image, "legacy-submission");
  writeFileSync(join(dir, "card-pool-upload.json"), JSON.stringify({ id: "legacy-batch", baseUrl: "http://127.0.0.1:8787", items: [{ noteId: "n", title: note.title, submissionId: payload.submissionId, status: "uploading", payload }] }));
  const send = vi.fn<typeof fetch>().mockResolvedValue(response("created", 200));
  const controller = new CardNoteUploadController(dir, { get: () => { throw new Error("Do not read note"); }, tags: () => [], readImage: () => { throw new Error("Do not read image"); }, fetch: send });
  expect(readFileSync(join(dir, "card-pool-upload.json"), "utf8")).not.toContain("dataBase64");
  expect(controller.get()!.items[0]!.status).toBe("uncertain");
  controller.retry(); await finished(controller);
  expect(send.mock.calls[0]![1]!.body).toBe(JSON.stringify(payload));
});

test("B68 TC4 missing snapshots never reload notes or resend uncertain submissions", async () => {
  const dir = directory();
  const offline = vi.fn<typeof fetch>().mockRejectedValue(Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } }));
  const controller = new CardNoteUploadController(dir, { get: () => note, tags: () => [], readImage: () => image, fetch: offline });
  controller.start(["a", "b"]); await finished(controller);
  const path = join(dir, "card-pool-upload.json");
  const stored = JSON.parse(readFileSync(path, "utf8"));
  stored.items[0].status = "uncertain";
  writeFileSync(path, JSON.stringify(stored));
  rmSync(join(dir, "card-pool-upload-payloads"), { recursive: true });
  const get = vi.fn(), readImage = vi.fn(), send = vi.fn<typeof fetch>();
  const restarted = new CardNoteUploadController(dir, { get, tags: () => [], readImage, fetch: send });
  restarted.retry();
  const batch = await finished(restarted);
  expect(batch.items.map(item => item.status)).toEqual(["uncertain", "validation_error"]);
  expect(batch.items.every(item => item.message?.includes("saved upload snapshot"))).toBe(true);
  expect(send).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
  expect(readImage).not.toHaveBeenCalled();
});

test("B68 TC5 failed batch replacement preserves previous snapshots and cleans new ones", async () => {
  const dir = directory();
  const send = vi.fn<typeof fetch>().mockResolvedValue(response("created", 201));
  const controller = new CardNoteUploadController(dir, { get: () => note, tags: () => [], readImage: () => image, fetch: send });
  controller.start(["a"]); await finished(controller);
  const path = join(dir, "card-pool-upload.json");
  const saved = readFileSync(path, "utf8");
  const payloadDir = join(dir, "card-pool-upload-payloads");
  const previousFiles = readdirSync(payloadDir);
  mkdirSync(`${path}.tmp`);
  expect(() => controller.start(["b", "c"])).toThrow();
  expect(readFileSync(path, "utf8")).toBe(saved);
  expect(readdirSync(payloadDir)).toEqual(previousFiles);
  expect(controller.get()!.items[0]!.noteId).toBe("a");
  expect(send).toHaveBeenCalledTimes(1);
  rmSync(`${path}.tmp`, { recursive: true });
  controller.start(["b"]); await finished(controller);
  const newFiles = readdirSync(payloadDir);
  expect(newFiles).toHaveLength(1);
  expect(newFiles[0]).not.toBe(previousFiles[0]);
});

test("B68 TC5 snapshot storage failure does not publish or send a new batch", async () => {
  const dir = directory();
  const send = vi.fn<typeof fetch>();
  const controller = new CardNoteUploadController(dir, { get: () => note, tags: () => [], readImage: () => image, fetch: send });
  writeFileSync(join(dir, "card-pool-upload-payloads"), "blocked");
  expect(() => controller.start(["a"])).toThrow();
  expect(controller.get()).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});
test("TC2 unavailable service preserves pending notes, retries them and refuses invalid results", async () => {
  const send = vi.fn<typeof fetch>().mockRejectedValueOnce(Object.assign(new Error("offline"), { cause: { code: "ECONNREFUSED" } })).mockResolvedValueOnce(response("created", 201)).mockResolvedValueOnce(new Response(JSON.stringify({ status: "validation_error", message: "Too long" }), { status: 400 }));
  const controller = new CardNoteUploadController(directory(), { get: () => note, tags: () => [], readImage: () => image, fetch: send });
  controller.start(["a", "b"]);
  expect((await finished(controller)).items.map(i => i.status)).toEqual(["unreachable", "pending"]);
  controller.retry(); expect((await finished(controller)).items.map(i => i.status)).toEqual(["created", "validation_error"]);
  expect(send.mock.calls[1]![1]!.body).toBe(send.mock.calls[0]![1]!.body);
});
test("TC2 uncertainty is not cleared by a later refusal, and external returned links are rejected", async () => {
  const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ status: "created", noteId: "saved", url: "https://example.com/notes/saved" }), { status: 201 })).mockResolvedValueOnce(new Response(JSON.stringify({ status: "submission_conflict" }), { status: 409 }));
  const controller = new CardNoteUploadController(directory(), { get: () => note, tags: () => [], readImage: () => image, fetch: send });
  controller.start(["n"]); expect((await finished(controller)).items[0]!.status).toBe("uncertain");
  controller.retry(); expect((await finished(controller)).items[0]!.status).toBe("uncertain");
});
test("TC4 preparation failures never send a text fallback and local destination validation is strict", async () => {
  const send = vi.fn<typeof fetch>();
  const controller = new CardNoteUploadController(directory(), { get: () => ({ ...note, trashedAt: 2 }), tags: () => [], readImage: () => image, fetch: send });
  controller.start(["n"]); expect((await finished(controller)).items[0]!.status).toBe("validation_error");
  expect(send).not.toHaveBeenCalled();
  expect(cardPoolOrigin("http://localhost:8787")).toBe("http://127.0.0.1:8787");
  for (const origin of ["https://127.0.0.1:8787", "http://example.com", "http://localhost/path", "http://user@localhost"]) expect(() => cardPoolOrigin(origin)).toThrow();
});

test("TC3 interrupted uploads become uncertain after restart and recover saved submissions", async () => {
  const dir = directory();
  const controller = new CardNoteUploadController(dir, { get: () => note, tags: () => [], readImage: () => image, fetch: vi.fn<typeof fetch>().mockResolvedValue(response("created", 201)) });
  controller.start(["n"]); await finished(controller);
  const path = join(dir, "card-pool-upload.json");
  const stored = JSON.parse(readFileSync(path, "utf8")); stored.items[0].status = "uploading"; writeFileSync(path, JSON.stringify(stored));
  const send = vi.fn<typeof fetch>().mockResolvedValue(response("created", 200));
  const restarted = new CardNoteUploadController(dir, { get: vi.fn(), tags: vi.fn(), readImage: vi.fn(), fetch: send });
  expect(restarted.get()!.items[0]!.status).toBe("uncertain");
  restarted.retry(); expect((await finished(restarted)).items[0]!.status).toBe("created");
  expect(JSON.parse(send.mock.calls[0]![1]!.body as string).submissionId).toBe(stored.items[0].submissionId);
});

test("F62 restart does not replay successful upload history, but fresh uploads still report progress", async () => {
  const dir = directory();
  const deps = { get: () => note, tags: () => [], readImage: () => image, fetch: vi.fn<typeof fetch>().mockImplementation(async () => response("created", 201)) };
  const first = new CardNoteUploadController(dir, deps);
  first.start(["n"]);
  expect((await finished(first)).items[0]!.status).toBe("created");
  const saved = readFileSync(join(dir, "card-pool-upload.json"), "utf8");
  const restarted = new CardNoteUploadController(dir, deps);
  expect(restarted.get()).toBeUndefined();
  expect(readFileSync(join(dir, "card-pool-upload.json"), "utf8")).toBe(saved);
  expect(deps.fetch).toHaveBeenCalledTimes(1);
  expect(restarted.start(["n"]).running).toBe(true);
  expect((await finished(restarted)).items[0]!.status).toBe("created");
});

test.each(["duplicate_title", "validation_error", "refused", "unreachable", "uncertain", "pending"] as const)("F62 restart restores only actionable history: %s", status => {
  const dir = directory();
  writeFileSync(join(dir, "card-pool-upload.json"), JSON.stringify({ id: "old", baseUrl: "http://127.0.0.1:8787", items: [{ noteId: "n", title: note.title, submissionId: "s", status }] }));
  const fetch = vi.fn<typeof globalThis.fetch>();
  const restored = new CardNoteUploadController(dir, { get: vi.fn(), tags: () => [], readImage: vi.fn(), fetch });
  if (status === "duplicate_title") expect(restored.get()).toBeUndefined();
  else expect(restored.get()!.items[0]!.status).toBe(status);
  expect(fetch).not.toHaveBeenCalled();
});
