import { parseReadingNoteDocument, type ReadingNoteDocument } from "./reading-note-document";
import type { ReadingNoteAttachmentSnapshot, UploadReadingNoteAttachmentInput } from "./contracts";

export interface ChapterScratchpadKey { bookId: string; chapterId: string }
export interface ChapterScratchpad extends ChapterScratchpadKey {
  content: ReadingNoteDocument;
  revision: number;
  updatedAt: number;
}
export interface SaveChapterScratchpad extends ChapterScratchpadKey {
  content: ReadingNoteDocument;
  baseRevision: number;
}
export interface ChapterScratchpadApi {
  get(key: ChapterScratchpadKey): Promise<ChapterScratchpad>;
  save(input: SaveChapterScratchpad): Promise<ChapterScratchpad>;
  attachments: {
    upload(input: UploadReadingNoteAttachmentInput): Promise<ReadingNoteAttachmentSnapshot>;
    readDataUrl(id: string): Promise<string>;
  };
}
export function emptyScratchpadContent(): ReadingNoteDocument {
  return { version: 1, blocks: [{ id: "scratchpad-start", type: "paragraph", props: {}, content: [], children: [] }] };
}
export function parseScratchpadKey(value: unknown): ChapterScratchpadKey {
  if (!value || typeof value !== "object") throw new Error("Invalid chapter scratchpad source.");
  const { bookId, chapterId } = value as ChapterScratchpadKey;
  if (typeof bookId !== "string" || !bookId.trim() || bookId.length > 512 ||
      typeof chapterId !== "string" || !chapterId.trim() || chapterId.length > 2048) {
    throw new Error("Invalid chapter scratchpad source.");
  }
  return { bookId, chapterId };
}
export function parseScratchpadSave(value: unknown): SaveChapterScratchpad {
  const key = parseScratchpadKey(value);
  const input = value as SaveChapterScratchpad;
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0) throw new Error("Invalid scratchpad revision.");
  return { ...key, baseRevision: input.baseRevision, content: parseReadingNoteDocument(input.content) };
}
