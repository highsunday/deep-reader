import type { MemoryImageSide, ReadingNote, ReadingNoteMemoryImage } from "./contracts";
import { memoryImagePurposeGuide } from "./memory-image-templates";
import { readingNoteDocumentAttachmentIds } from "./reading-note-document";

export function isMemoryImageSide(value: unknown): value is MemoryImageSide {
  return value === "recall" || value === "understand";
}

export function legacyImageSide(image: ReadingNoteMemoryImage): MemoryImageSide | undefined {
  const id = image.recipe?.purpose.id;
  const goal = id ? memoryImagePurposeGuide(id)?.goal : undefined;
  return goal === "remember" ? "recall" : goal === "understand" || id === "purpose-process-contrast" ? "understand" : undefined;
}

export function readingNoteImage(note: Pick<ReadingNote, "memoryImage" | "memoryImages"> | undefined, side?: MemoryImageSide): ReadingNoteMemoryImage | undefined {
  if (!note) return undefined;
  if (!side) return note.memoryImage;
  // Single-image notes predate purpose metadata and were recall illustrations.
  return note.memoryImages?.[side] ?? (note.memoryImage && (legacyImageSide(note.memoryImage) ?? "recall") === side ? note.memoryImage : undefined);
}

export function readingNoteAttachmentIds(note: ReadingNote): string[] {
  return [...new Set([...readingNoteDocumentAttachmentIds(note.content),
    ...[note.memoryImage, note.memoryImages?.recall, note.memoryImages?.understand]
      .flatMap(image => image ? [image.attachmentId] : [])])];
}
