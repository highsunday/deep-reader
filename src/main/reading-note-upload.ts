import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { ReadingNote, ReadingNoteTag } from "../shared/contracts";
import type { CardNoteUploadBatch, CardNoteUploadItem } from "../shared/card-note-upload";
import { readingNoteDocumentToMarkdown, type ReadingNoteBlock } from "../shared/reading-note-document";

interface Payload {
  title: string; markdown: string; source: string; tags: string[]; submissionId: string;
  images?: { recall?: string; understanding?: string };
  attachments?: Array<{ id: string; mimeType: string; dataBase64: string }>;
}
export function buildCardNotePayload(note: ReadingNote, tags: ReadingNoteTag[], readImage: (id: string) => string, submissionId: string): Payload {
  if (note.trashedAt !== undefined) throw new Error("This reading note is in Trash.");
  if (note.memoryImage) throw new Error("Assign the legacy memory image to Recall or Understanding before uploading.");
  const attachments: NonNullable<Payload["attachments"]> = [];
  const ids = new Map<string, string>();
  let total = 0;
  const include = (id: string) => {
    if (ids.has(id)) return ids.get(id)!;
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(readImage(id));
    if (!match) throw new Error("An image has an unsupported or invalid format.");
    const size = Buffer.from(match[2]!, "base64").length;
    total += size;
    if (!size || size > 10 * 1048576 || total > 20 * 1048576 || attachments.length >= 32) throw new Error("Images exceed card pool limits (10 MiB each, 20 MiB total, 32 images).");
    const target = `asset-${attachments.length + 1}`;
    attachments.push({ id: target, mimeType: match[1]!, dataBase64: match[2]! }); ids.set(id, target);
    return target;
  };
  // Change only structured image blocks, preserving code and ordinary text verbatim.
  const prefix = `upload-${randomUUID()}-`;
  const replacements = new Map<string, string>();
  const convert = (block: ReadingNoteBlock): ReadingNoteBlock => {
    let props = block.props;
    if (block.type === "image") {
      if (typeof props.assetId !== "string" || !props.assetId) throw new Error("A body image is not a local attachment. Save it locally before uploading.");
      const placeholder = `${prefix}${replacements.size}`;
      replacements.set(`reading-note-asset:${placeholder}`, `card-note-asset:${include(props.assetId)}`);
      props = { ...props, assetId: placeholder };
    }
    return { ...block, props, children: block.children.map(convert) };
  };
  let markdown = readingNoteDocumentToMarkdown({ ...note.content, blocks: note.content.blocks.map(convert) });
  for (const [from, to] of replacements) markdown = markdown.replaceAll(from, to);
  const images: NonNullable<Payload["images"]> = {};
  if (note.memoryImages?.recall) images.recall = include(note.memoryImages.recall.attachmentId);
  if (note.memoryImages?.understand) images.understanding = include(note.memoryImages.understand.attachmentId);
  if (!markdown.trim() || Buffer.byteLength(markdown) > 1048576) throw new Error("Note content must contain text and be at most 1 MiB.");
  return { title: note.title, markdown, source: note.bookTitle, tags: tags.filter(t => note.tagIds?.includes(t.id)).map(t => t.name), submissionId, ...(attachments.length ? { images, attachments } : {}) };
}
interface StoredItem extends CardNoteUploadItem { payload?: Payload; payloadFile?: string; }
interface StoredBatch { id: string; baseUrl: string; items: StoredItem[]; }
export function cardPoolOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Card pool URL must be a local HTTP origin.");
  url.hostname = "127.0.0.1";
  return url.origin;
}
export class CardNoteUploadController {
  private batch?: StoredBatch;
  private running = false;
  private restoredSuccess = false;
  private readonly path: string;
  private readonly payloadDirectory: string;
  constructor(directory: string, private dependencies: { get(id: string): ReadingNote | undefined; tags(): ReadingNoteTag[]; readImage(id: string): string; baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, "card-pool-upload.json");
    this.payloadDirectory = join(directory, "card-pool-upload-payloads");
    if (existsSync(this.path)) {
      this.batch = JSON.parse(readFileSync(this.path, "utf8"));
      // Successful history is durable, but is not a new activity on app startup.
      this.restoredSuccess = this.batch!.items.every(item => ["created", "duplicate_title"].includes(item.status));
      // Migrate old inline snapshots before saving the lightweight manifest.
      const migrated: StoredItem[] = [];
      try {
        for (const item of this.batch!.items) if (item.payload) {
          item.payloadFile = this.savePayload(item.payload);
          migrated.push(item);
          delete item.payload;
        }
        for (const item of this.batch!.items) if (item.status === "uploading") { item.status = "uncertain"; item.message = "Upload was interrupted. Retry the saved submission to confirm the result."; }
        this.persist();
      } catch (error) {
        this.removePayloads(migrated);
        throw error;
      }
    }
  }
  private payloadPath(file: string): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/.test(file)) throw new Error("Invalid saved upload snapshot reference.");
    return join(this.payloadDirectory, file);
  }
  private savePayload(payload: Payload): string {
    mkdirSync(this.payloadDirectory, { recursive: true });
    const file = `${randomUUID()}.json`;
    const path = this.payloadPath(file);
    try {
      writeFileSync(`${path}.tmp`, JSON.stringify(payload), { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    } catch (error) {
      rmSync(`${path}.tmp`, { force: true });
      throw error;
    }
    return file;
  }
  private removePayloads(items: StoredItem[]) {
    for (const item of items) if (item.payloadFile) {
      try { rmSync(this.payloadPath(item.payloadFile), { force: true }); }
      catch { /* A failed cleanup must not discard the saved batch. */ }
    }
  }
  private persist() {
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.batch), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
  get(): CardNoteUploadBatch | undefined {
    if (!this.batch || this.restoredSuccess) return;
    return { id: this.batch.id, baseUrl: this.batch.baseUrl, running: this.running, items: this.batch.items.map(({ payload: _payload, payloadFile: _file, ...item }) => ({ ...item })) };
  }
  start(noteIds: unknown): CardNoteUploadBatch {
    if (this.running || this.batch?.items.some(i => ["pending", "uploading", "uncertain", "unreachable"].includes(i.status))) throw new Error("Finish or retry the current upload before starting another batch.");
    if (!Array.isArray(noteIds) || !noteIds.length || noteIds.some(id => typeof id !== "string" || !id.trim())) throw new Error("Select reading notes to upload.");
    const baseUrl = cardPoolOrigin(this.dependencies.baseUrl ?? "http://127.0.0.1:8787");
    const tags = this.dependencies.tags();
    const items: StoredItem[] = [];
    try {
      for (const noteId of new Set(noteIds as string[])) {
        const note = this.dependencies.get(noteId);
        const item: StoredItem = { noteId, title: note?.title ?? noteId, submissionId: randomUUID(), status: "pending" };
        let payload: Payload | undefined;
        try { if (!note) throw new Error("This reading note is unavailable."); payload = buildCardNotePayload(note, tags, this.dependencies.readImage, item.submissionId); }
        catch (error) { item.status = "validation_error"; item.message = error instanceof Error ? error.message : "Unable to prepare note."; }
        // Freeze every selected note, but never accumulate image payloads in the batch.
        if (payload) item.payloadFile = this.savePayload(payload);
        items.push(item);
      }
    } catch (error) { this.removePayloads(items); throw error; }
    const previous = this.batch;
    this.batch = { id: randomUUID(), baseUrl, items };
    try { this.persist(); } catch (error) { this.batch = previous; this.removePayloads(items); throw error; }
    if (previous) this.removePayloads(previous.items);
    this.launch();
    return this.get()!;
  }
  retry(): CardNoteUploadBatch {
    if (this.running || !this.batch) throw new Error("No stopped batch is available to retry.");
    this.launch();
    return this.get()!;
  }
  private launch() {
    this.restoredSuccess = false;
    this.running = true;
    void new Promise<void>(resolve => setImmediate(resolve)).then(() => this.run()).catch(error => {
      for (const item of this.batch!.items) if (item.status === "uploading") { item.status = "uncertain"; item.message = `Unable to save upload result: ${error instanceof Error ? error.message : "Storage error"}. Retry the original submission.`; }
    }).finally(() => { this.running = false; });
  }
  private async run() {
    for (const item of this.batch!.items) {
      if (!["pending", "uncertain", "unreachable"].includes(item.status)) continue;
      const priorUncertain = item.status === "uncertain";
      let body: string;
      let hasImages: boolean;
      try {
        if (!item.payloadFile) throw new Error("Saved upload snapshot is missing.");
        body = readFileSync(this.payloadPath(item.payloadFile), "utf8");
        hasImages = !!JSON.parse(body).attachments;
      } catch (error) {
        item.status = priorUncertain ? "uncertain" : "validation_error";
        item.message = `Unable to read saved upload snapshot: ${error instanceof Error ? error.message : "Storage error"}. Original note was not reloaded.`;
        this.persist();
        continue;
      }
      item.status = "uploading"; item.message = undefined;
      this.persist(); // Durable ID and bytes exist before the network can receive a request.
      try {
        const response = await (this.dependencies.fetch ?? fetch)(`${this.batch!.baseUrl}${hasImages ? "/api/notes/import" : "/api/notes"}`, { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(this.dependencies.timeoutMs ?? 120000) });
        const result = await response.json();
        let validUrl = false;
        try { const u = new URL(result.url); validUrl = u.origin === this.batch!.baseUrl && u.pathname === `/notes/${result.noteId}` && !u.search && !u.hash && !u.username && !u.password && typeof result.noteId === "string" && !!result.noteId; } catch { /* Untrusted response. */ }
        if ((([200, 201].includes(response.status) && result.status === "created") || (response.status === 409 && result.status === "duplicate_title")) && validUrl) {
          item.status = result.status; item.url = result.url;
        } else if (!priorUncertain && response.status >= 400 && response.status < 500 && ["validation_error", "payload_too_large", "unsupported_media_type", "forbidden", "not_found", "method_not_allowed", "submission_conflict"].includes(result.status)) {
          item.status = result.status === "validation_error" ? "validation_error" : "refused";
          item.message = typeof result.message === "string" ? result.message : result.status;
        } else { item.status = "uncertain"; item.message = "The result is not confirmed; this note may already be saved. Retry the original submission."; }
      } catch (error) {
        const refused = (error as { cause?: { code?: string } })?.cause?.code === "ECONNREFUSED";
        item.status = refused && !priorUncertain ? "unreachable" : "uncertain";
        item.message = item.status === "unreachable" ? "Card pool service is unavailable. Start it, then retry." : "The result is not confirmed; this note may already be saved. Retry the original submission.";
      }
      this.persist();
      // Stop trying an unavailable service; keep the remaining snapshots ready for retry.
      if (item.status === "unreachable") break;
      await new Promise<void>(resolve => setImmediate(resolve));
    }
  }
}
