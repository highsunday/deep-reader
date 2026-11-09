import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, join } from "node:path";
import type { ReadingNoteBlock, ReadingNoteDocument } from "../shared/reading-note-document";
import { parseReadingNoteDocument } from "../shared/reading-note-document";

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

interface StoredAttachment {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  extension: "png" | "jpg" | "webp" | "gif";
  size: number;
  createdAt: number;
  ownerNoteId?: string;
  orphanedAt?: number;
}

interface AttachmentState {
  version: 1;
  attachments: StoredAttachment[];
}

export interface StageReadingNoteAttachmentInput {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface ReadingNoteAttachment {
  id: string;
  name: string;
  mimeType: StoredAttachment["mimeType"];
  size: number;
  url: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function detectedType(bytes: Uint8Array): Pick<StoredAttachment, "mimeType" | "extension"> | undefined {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  const prefix = new TextDecoder("ascii").decode(bytes.slice(0, 12));
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) {
    return { mimeType: "image/gif", extension: "gif" };
  }
  if (prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return undefined;
}

function publicAttachment(value: StoredAttachment): ReadingNoteAttachment {
  return {
    id: value.id,
    name: value.name,
    mimeType: value.mimeType,
    size: value.size,
    url: `reading-note-asset:${value.id}`
  };
}

export class LocalReadingNoteAttachmentStore {
  readonly #directory: string;
  readonly #assetDirectory: string;
  readonly #metadataPath: string;
  readonly #createId: () => string;
  readonly #now: () => number;
  #attachments: StoredAttachment[];

  constructor(directory: string, options: { createId?(): string; now?(): number } = {}) {
    this.#directory = directory;
    this.#assetDirectory = join(directory, "reading-note-assets");
    this.#metadataPath = join(directory, "reading-note-assets.json");
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? Date.now;
    this.#attachments = this.#load();
  }

  stage(input: StageReadingNoteAttachmentInput): ReadingNoteAttachment {
    if (!(input.bytes instanceof Uint8Array)) throw new Error("A valid image is required.");
    if (input.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("Images must be 20 MB or smaller.");
    const type = detectedType(input.bytes);
    if (!type) throw new Error("This is not a valid image. Use PNG, JPEG, WebP, or GIF bytes that match the format.");
    const claimed = input.mimeType === "image/jpg" ? "image/jpeg" : input.mimeType;
    if (claimed && claimed !== type.mimeType) throw new Error("The image content does not match its declared format.");
    const id = this.#createId();
    if (!id.trim() || this.#attachments.some((item) => item.id === id)) {
      throw new Error("Unable to allocate a reading-note attachment identifier.");
    }
    const attachment: StoredAttachment = {
      id,
      name: basename(input.name).trim() || `image.${type.extension}`,
      ...type,
      size: input.bytes.byteLength,
      createdAt: this.#now()
    };
    mkdirSync(this.#assetDirectory, { recursive: true });
    const path = this.#path(attachment);
    writeFileSync(path, input.bytes, { mode: 0o600 });
    const previous = this.#attachments;
    this.#attachments = [...previous, attachment];
    try { this.#save(); }
    catch (error) {
      this.#attachments = previous;
      try { unlinkSync(path); } catch { /* best-effort rollback */ }
      throw error;
    }
    return publicAttachment(attachment);
  }

  readDataUrl(attachmentId: string): string {
    const attachment = this.#require(attachmentId);
    const data = readFileSync(this.#path(attachment));
    return `data:${attachment.mimeType};base64,${data.toString("base64")}`;
  }

  localPath(attachmentId: string): string {
    return this.#path(this.#require(attachmentId));
  }

  reconcile(noteId: string, attachmentIds: string[]): void {
    if (!noteId.trim()) throw new Error("A reading note is required for attachment reconciliation.");
    const referenced = new Set(attachmentIds);
    for (const id of referenced) {
      const attachment = this.#require(id);
      if (attachment.ownerNoteId && attachment.ownerNoteId !== noteId) {
        throw new Error("Copy this attachment before using it in another reading note.");
      }
    }
    const now = this.#now();
    this.#mutate((items) => items.map((attachment) => {
      if (referenced.has(attachment.id)) {
        const { orphanedAt: _orphanedAt, ...live } = attachment;
        return { ...live, ownerNoteId: noteId };
      }
      if (attachment.ownerNoteId === noteId && attachment.orphanedAt === undefined) {
        return { ...attachment, orphanedAt: now };
      }
      return attachment;
    }));
  }

  copyForNote(attachmentId: string, noteId: string): ReadingNoteAttachment {
    const source = this.#require(attachmentId);
    if (!noteId.trim()) throw new Error("A target reading note is required.");
    if (!source.ownerNoteId || source.ownerNoteId === noteId) return publicAttachment(source);
    const id = this.#createId();
    if (!id.trim() || this.#attachments.some((item) => item.id === id)) {
      throw new Error("Unable to allocate a reading-note attachment identifier.");
    }
    const now = this.#now();
    const copied: StoredAttachment = {
      ...source,
      id,
      ownerNoteId: noteId,
      createdAt: now,
      orphanedAt: now
    };
    mkdirSync(this.#assetDirectory, { recursive: true });
    copyFileSync(this.#path(source), this.#path(copied));
    const previous = this.#attachments;
    this.#attachments = [...previous, copied];
    try { this.#save(); }
    catch (error) {
      this.#attachments = previous;
      try { unlinkSync(this.#path(copied)); } catch { /* best-effort rollback */ }
      throw error;
    }
    return publicAttachment(copied);
  }

  prepareDocument(noteId: string, document: ReadingNoteDocument): ReadingNoteDocument {
    const parsed = parseReadingNoteDocument(document);
    const replacements = new Map<string, string>();
    const prepareBlock = (block: ReadingNoteBlock): ReadingNoteBlock => {
      if (block.type === "image") {
        const sourceId = String(block.props.assetId ?? "");
        let targetId = replacements.get(sourceId);
        if (!targetId) {
          targetId = this.copyForNote(sourceId, noteId).id;
          replacements.set(sourceId, targetId);
        }
        return { ...block, props: { ...block.props, assetId: targetId } };
      }
      return { ...block, children: block.children.map(prepareBlock) };
    };
    return { version: parsed.version, blocks: parsed.blocks.map(prepareBlock) };
  }

  discardStaged(attachmentIds: string[]): number {
    const requested = new Set(attachmentIds);
    const removed = this.#attachments.filter(({ id, ownerNoteId }) => requested.has(id) && !ownerNoteId);
    if (!removed.length) return 0;
    const removedIds = new Set(removed.map(({ id }) => id));
    this.#mutate((items) => items.filter(({ id }) => !removedIds.has(id)));
    for (const attachment of removed) {
      try { unlinkSync(this.#path(attachment)); } catch { /* metadata remains authoritative */ }
    }
    return removed.length;
  }

  deleteForNotes(noteIds: string[]): number {
    const ids = new Set(noteIds);
    const removed = this.#attachments.filter(({ ownerNoteId }) => ownerNoteId && ids.has(ownerNoteId));
    if (!removed.length) return 0;
    this.#mutate((items) => items.filter((item) => !removed.some(({ id }) => id === item.id)));
    for (const attachment of removed) {
      try { unlinkSync(this.#path(attachment)); } catch { /* metadata remains authoritative */ }
    }
    return removed.length;
  }

  collectGarbage(): number {
    const cutoff = this.#now() - ORPHAN_GRACE_MS;
    const garbage = this.#attachments.filter((item) =>
      item.orphanedAt !== undefined && item.orphanedAt < cutoff ||
      !item.ownerNoteId && item.createdAt < cutoff);
    if (!garbage.length) return 0;
    const garbageIds = new Set(garbage.map(({ id }) => id));
    this.#mutate((items) => items.filter(({ id }) => !garbageIds.has(id)));
    for (const attachment of garbage) {
      try { unlinkSync(this.#path(attachment)); } catch { /* metadata remains authoritative */ }
    }
    return garbage.length;
  }

  #require(attachmentId: string): StoredAttachment {
    const attachment = this.#attachments.find(({ id }) => id === attachmentId);
    if (!attachment) throw new Error("Reading-note attachment not found.");
    return attachment;
  }

  #path(attachment: StoredAttachment): string {
    return join(this.#assetDirectory, `${attachment.id}.${attachment.extension}`);
  }

  #mutate(update: (items: StoredAttachment[]) => StoredAttachment[]): void {
    const previous = this.#attachments;
    this.#attachments = update(previous);
    try { this.#save(); } catch (error) { this.#attachments = previous; throw error; }
  }

  #load(): StoredAttachment[] {
    let value: unknown;
    try { value = JSON.parse(readFileSync(this.#metadataPath, "utf8")); }
    catch (error) {
      if (object(error) && error.code === "ENOENT") return [];
      throw new Error("Unable to load reading-note attachments.", { cause: error });
    }
    if (!object(value) || value.version !== 1 || !Array.isArray(value.attachments)) {
      throw new Error("Invalid reading-note attachment metadata.");
    }
    return value.attachments.map((item) => {
      if (!object(item) || typeof item.id !== "string" || typeof item.name !== "string" ||
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(String(item.mimeType)) ||
        !["png", "jpg", "webp", "gif"].includes(String(item.extension)) ||
        typeof item.size !== "number" || typeof item.createdAt !== "number") {
        throw new Error("Invalid reading-note attachment metadata.");
      }
      return item as unknown as StoredAttachment;
    });
  }

  #save(): void {
    mkdirSync(this.#directory, { recursive: true });
    const state: AttachmentState = { version: 1, attachments: this.#attachments };
    const temporary = `${this.#metadataPath}.next`;
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.#metadataPath);
  }
}
