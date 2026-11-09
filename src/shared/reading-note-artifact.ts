import type { ChatMessage, ReadingNote } from "./contracts";
import { readingNoteDocumentToMarkdown } from "./reading-note-document";

export interface ReadingNoteDraft {
  version: 1 | 2 | 3;
  draftId: string;
  title: string;
  content: string;
}

export interface ReadingNoteSavedArtifact {
  version: 1;
  draftId: string;
  note: {
    id: string;
    prompt: string;
    content: string;
    bookTitle: string;
    chapterTitle: string;
    createdAt: number;
  };
}

type MessageLike = Pick<ChatMessage, "role" | "text"> &
  Partial<Omit<ChatMessage, "role" | "text">>;

const artifactPattern = /^```(reading-note-draft|reading-note-saved)[ \t]*\r?\n([\s\S]*?)^```[ \t]*(?=\r?$)/gm;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function text(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function finiteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseDraft(value: unknown): ReadingNoteDraft | undefined {
  if (!object(value) || !text(value.draftId) || !text(value.content)) {
    return undefined;
  }
  const legacy = value.version === 1 && exactKeys(value, ["version", "draftId", "prompt", "content"]) && text(value.prompt);
  const current = value.version === 2 && exactKeys(value, ["version", "draftId", "title", "content"]) && text(value.title);
  const withBookImages = value.version === 3 && exactKeys(value, ["version", "draftId", "title", "content"]) && text(value.title) &&
    validBookImageMarkdown(value.content);
  if (!legacy && !current && !withBookImages) return undefined;
  return {
    version: withBookImages ? 3 : current ? 2 : 1,
    draftId: value.draftId.trim(),
    title: (current || withBookImages ? value.title as string : value.prompt as string).trim(),
    content: value.content.trim()
  };
}

/** The model can select only a numbered App-supplied image, placed on its own line. */
export const bookImagePattern = /^!\[([^\]\n]{1,160})\]\(book-image:([1-9]\d*)\)$/;

export const readerImagePattern = /^!\[([^\]\n]{1,160})\]\(reader-image:([1-9]\d*)\)$/;

function validBookImageMarkdown(content: string): boolean {
  const chunks = content.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  return chunks.every(chunk => !chunk.includes("![") || bookImagePattern.test(chunk.trim()) || readerImagePattern.test(chunk.trim()));
}

export function bookImageReferences(content: string): Array<{ index: number; alt: string }> {
  return content.split(/\r?\n/).flatMap(line => {
    const match = line.trim().match(bookImagePattern);
    return match ? [{ index: Number(match[2]), alt: match[1]! }] : [];
  });
}

export function bookImagesForDraft(messages: MessageLike[], draftMessageIndex: number): ChatMessage["bookImages"] {
  const draftTurnId = messages[draftMessageIndex]?.turnId;
  for (let index = draftMessageIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.turnId === draftTurnId && message.bookImages) {
      return message.bookImages;
    }
  }
  const origin = messages.slice(0, draftMessageIndex).findLast(m => m.role === "user" && m.turnId === draftTurnId);
  const source = origin?.readingSource;
  if (source?.bookImageCount) {
    const supplied = messages.slice(0, draftMessageIndex).findLast(m => m.role === "user" && m.bookImages?.length &&
      m.readingSource?.bookTitle === source.bookTitle && m.readingSource?.chapterTitle === source.chapterTitle &&
      m.readingSource?.readingSegment === source.readingSegment && m.bookImages.length === source.bookImageCount);
    if (supplied) return supplied.bookImages;
  }
  if (!readingNoteWorkflowPending(messages.slice(0, draftMessageIndex))) return [];
  for (let index = draftMessageIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.intent === "createReadingNote") return message.bookImages ?? [];
  }
  return [];
}

function parseSaved(value: unknown): ReadingNoteSavedArtifact | undefined {
  if (!object(value) || !exactKeys(value, ["version", "draftId", "note"]) ||
    value.version !== 1 || !text(value.draftId) || !object(value.note) ||
    !exactKeys(value.note, ["id", "prompt", "content", "bookTitle", "chapterTitle", "createdAt"]) ||
    !text(value.note.id) || !text(value.note.prompt) || !text(value.note.content) ||
    !text(value.note.bookTitle) || !text(value.note.chapterTitle) ||
    !finiteTimestamp(value.note.createdAt)) {
    return undefined;
  }
  return {
    version: 1,
    draftId: value.draftId.trim(),
    note: {
      id: value.note.id.trim(),
      prompt: value.note.prompt.trim(),
      content: value.note.content.trim(),
      bookTitle: value.note.bookTitle.trim(),
      chapterTitle: value.note.chapterTitle.trim(),
      createdAt: value.note.createdAt
    }
  };
}

export function readingNoteArtifacts(messages: MessageLike[]): {
  drafts: ReadingNoteDraft[];
  saved: ReadingNoteSavedArtifact[];
} {
  const drafts: ReadingNoteDraft[] = [];
  const saved: ReadingNoteSavedArtifact[] = [];
  const draftIds = new Set<string>();
  const savedIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const matches = [...message.text.matchAll(artifactPattern)];
    if (matches.length > 1) continue;
    for (const match of matches) {
      let value: unknown;
      try {
        value = JSON.parse(match[2] ?? "");
      } catch {
        continue;
      }
      if (match[1] === "reading-note-draft") {
        const draft = parseDraft(value);
        if (draft && !draftIds.has(draft.draftId)) {
          draftIds.add(draft.draftId);
          drafts.push(draft);
        }
      } else {
        const result = parseSaved(value);
        if (result && !savedIds.has(result.draftId)) {
          savedIds.add(result.draftId);
          saved.push(result);
        }
      }
    }
  }
  return { drafts, saved };
}

export function stripReadingNoteArtifacts(value: string): string {
  return value.replace(artifactPattern, "").trim();
}

export function readingNoteWorkflowPending(messages: MessageLike[]): boolean {
  let startedAt = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user" && message.intent) {
      if (message.intent !== "createReadingNote") return false;
      startedAt = index;
      break;
    }
  }
  if (startedAt < 0) return false;
  return readingNoteArtifacts(messages.slice(startedAt + 1)).drafts.length === 0;
}

export function readingNoteSavedArtifact(
  draftId: string,
  note: Omit<ReadingNote, "sourceDraftId">
): string {
  const snapshot = {
    id: note.id,
    prompt: note.title,
    content: readingNoteDocumentToMarkdown(note.content),
    bookTitle: note.bookTitle,
    chapterTitle: note.chapterTitle,
    createdAt: note.createdAt
  };
  return `\`\`\`reading-note-saved\n${JSON.stringify({
    version: 1,
    draftId,
    note: snapshot
  })}\n\`\`\``;
}

/** Resolve reader markers only against attachments on the draft's own question. */
export function conversationDraftImages(messages: MessageLike[], draftMessageIndex: number, content: string): {
  content: string; images: NonNullable<ChatMessage["bookImages"]>;
} {
  const books = bookImagesForDraft(messages, draftMessageIndex) ?? [];
  const turnId = messages[draftMessageIndex]?.turnId;
  const readers = messages.slice(0, draftMessageIndex).findLast(m => m.role === "user" && m.turnId === turnId)?.images ?? [];
  const normalized = content.replace(/^[ \t]*!\[([^\]\n]{1,160})\]\(reader-image:([1-9]\d*)\)[ \t]*$/gm,
    (_match, alt: string, number: string) => {
      const index = Number(number);
      if (!Number.isSafeInteger(index) || !readers[index - 1]) throw new Error(`Reader image ${number} is unavailable for this draft.`);
      return `![${alt}](book-image:${books.length + index})`;
    });
  // Validate book references before combining namespaces, so a missing book
  // marker cannot accidentally select a reader attachment at the same offset.
  for (const { index } of bookImageReferences(content)) {
    if (!books[index - 1]) throw new Error(`Book image ${index} is unavailable for this draft.`);
  }
  return { content: normalized, images: [...books, ...readers] };
}
