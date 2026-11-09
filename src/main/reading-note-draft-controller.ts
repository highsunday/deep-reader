import { randomUUID } from "node:crypto";
import type {
  BeginReadingNoteDraftInput,
  CreateReadingNoteFromDraftInput,
  ReadingNote
} from "../shared/contracts";
import type { ReadingNoteStore } from "./reading-note-store";
import { readingNoteDocumentAttachmentIds } from "../shared/reading-note-document";

interface DraftSource {
  noteId: string;
  bookId?: string;
  chapterId?: string;
  bookTitle: string;
  chapterTitle: string;
  readingSegment: string;
}

function required(value: string, message: string): string {
  if (!value.trim()) throw new Error(message);
  return value.trim();
}

export class ReadingNoteDraftController {
  readonly #drafts = new Map<string, DraftSource>();

  constructor(
    private readonly store: Pick<ReadingNoteStore, "create">,
    private readonly createId: () => string = randomUUID,
    private readonly attachments?: {
      prepareDocument(noteId: string, document: CreateReadingNoteFromDraftInput["content"]): CreateReadingNoteFromDraftInput["content"];
      reconcile(noteId: string, attachmentIds: string[]): void;
    }
  ) {}

  begin(input: BeginReadingNoteDraftInput): { draftId: string } {
    const draftId = this.createId();
    this.#drafts.set(draftId, {
      noteId: this.createId(),
      bookId: input.bookId,
      chapterId: input.chapterId,
      bookTitle: required(input.bookTitle, "A book is required to create a reading note."),
      chapterTitle: required(input.chapterTitle, "A chapter is required to create a reading note."),
      readingSegment: required(input.readingSegment, "A reading segment is required to create a reading note.")
    });
    return { draftId };
  }

  create(input: CreateReadingNoteFromDraftInput): ReadingNote {
    const source = this.#drafts.get(input.draftId);
    if (!source) throw new Error("Reading-note draft not found.");
    const content = this.attachments?.prepareDocument(source.noteId, input.content) ?? input.content;
    const note = this.store.create({
      id: source.noteId,
      sourceDraftId: input.draftId,
      title: input.title,
      content,
      ...(source.bookId ? { bookId: source.bookId } : {}),
      ...(source.chapterId ? { chapterId: source.chapterId } : {}),
      bookTitle: source.bookTitle,
      chapterTitle: source.chapterTitle
    });
    this.attachments?.reconcile(note.id, readingNoteDocumentAttachmentIds(note.content));
    this.#drafts.delete(input.draftId);
    return note;
  }

  discard(draftId: string): void {
    this.#drafts.delete(draftId);
  }

  readingSegment(draftId: string): string | undefined {
    return this.#drafts.get(draftId)?.readingSegment;
  }
}
