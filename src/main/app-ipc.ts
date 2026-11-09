import { BOOK_IMAGE_MAX_BYTES, parseChatImages } from "../shared/chat-images";
import type { MemoryImageSide, MissingVisualOptions } from "../shared/contracts";
import { isMemoryImageSide } from "../shared/reading-note-images";
import type {
  ChapterContent,
  MemoryImageDraftInput,
  ChatSnapshot,
  CodexChatModel,
  CreateMemoryImageTemplateInput,
  AdjustReadingNoteMemoryImageInput,
  GenerateReadingNoteMemoryImageInput,
  ImportBookResult,
  LibraryBook,
  ReadingNote,
  ReadingNoteAiDraft,
  ReadingNoteAiSnapshot,
  ReadingNoteCounts,
  ReadingNoteListInput,
  ReadingNotePageInput,
  ReadingNotePage,
  ReadingNoteMemoryImageSnapshot,
  MemoryImagePromptSnapshot,
  MemoryImageTemplateIdentityInput,
  MemoryImageTemplateKind,
  MemoryImageTemplateSettings,
  UpdateMemoryImageTemplateInput,
  BeginReadingNoteDraftInput,
  CreateReadingNoteFromDraftInput,
  PreparedConversationReadingNote,
  ReadingNoteAttachmentSnapshot,
  UploadReadingNoteAttachmentInput,
  StartReadingNoteDraftInput,
  UpdateReadingNoteInput,
  SaveAnnotationsInput,
  SaveReadingRangeInput,
  SaveReadingStateInput,
  SetShelfStatusInput,
  SetBookPinnedInput,
  SendChatMessageInput
} from "../shared/contracts";
import { isChatIntent, isCodexChatModel } from "../shared/contracts";
import { parseReadingNoteDocument } from "../shared/reading-note-document";
import { SpacedReviewService, validateRating } from "./spaced-review-service";

export function registerSpacedReviewIpc(ipc: IpcRegistrar, review: SpacedReviewService): void {
  ipc.handle("spaced-review:settings", () => review.settings());
  ipc.handle("spaced-review:save-settings", (_event, value) => review.saveSettings(value));
  ipc.handle("spaced-review:summary", () => review.summary());
  ipc.handle("spaced-review:status", (_event, noteId) => review.status(readingNoteId(noteId)));
  ipc.handle("spaced-review:details", (_event, noteId) => review.details(readingNoteId(noteId)));
  ipc.handle("spaced-review:enroll", (_event, noteId) => review.enroll(readingNoteId(noteId)));
  ipc.handle("spaced-review:pause", (_event, value) => {
    if (!object(value) || !exactKeys(value, ["noteId", "paused"]) || typeof value.paused !== "boolean") {
      throw new Error("Invalid review pause state.");
    }
    return review.setPaused(readingNoteId(value.noteId), value.paused);
  });
  ipc.handle("spaced-review:next", () => review.next());
  ipc.handle("spaced-review:rate", (_event, input) => review.rate(validateRating(input)));
  ipc.handle("spaced-review:image-failed", (_event, value) => {
    if (!object(value) || !exactKeys(value, ["noteId", "attachmentId"])) throw new Error("Invalid review image.");
    return review.imageFailed(readingNoteId(value.noteId), readingNoteId(value.attachmentId));
  });
  ipc.handle("spaced-review:retry-images", () => review.retryImages());
}

interface IpcRegistrar {
  handle(
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => unknown
  ): unknown;
}

export interface EpubFileDialog {
  showOpenDialog(options: {
    title: string;
    properties: ["openFile"];
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

interface ReaderLibrary {
  listBooks(): LibraryBook[] | Promise<LibraryBook[]>;
  importFromPath(path: string): Promise<ImportBookResult>;
  getChapterContent(bookId: string, chapterId: string): Promise<ChapterContent>;
  saveReadingState(input: SaveReadingStateInput): LibraryBook | Promise<LibraryBook>;
  setShelfStatus(input: SetShelfStatusInput): Promise<LibraryBook>;
  setPinned(input: SetBookPinnedInput): LibraryBook | Promise<LibraryBook>;
  deleteBook(bookId: string): void | Promise<void>;
  saveReadingRange(input: SaveReadingRangeInput): LibraryBook | Promise<LibraryBook>;
  saveAnnotations(input: SaveAnnotationsInput): LibraryBook | Promise<LibraryBook>;
}

interface ReaderChat {
  getSnapshot(): ChatSnapshot;
  connect(): Promise<ChatSnapshot>;
  sendMessage(input: SendChatMessageInput): Promise<ChatSnapshot>;
  submitReadingNote(draftId: string): ChatSnapshot;
  prepareReadingNoteDraft?(draftId: string): PreparedConversationReadingNote;
  saveReadingNoteDraft?(input: CreateReadingNoteFromDraftInput): ReadingNote;
  decideReadingNoteUpdate?(proposalId: string, decision: "apply" | "reject"): ChatSnapshot;
  startNewConversation(): ChatSnapshot;
  selectConversation(conversationId: string): ChatSnapshot;
  removeConversation(conversationId: string): Promise<ChatSnapshot>;
  stopResponse(): Promise<ChatSnapshot>;
}

interface ReaderReadingNotes {
  list(input?: ReadingNoteListInput): ReadingNote[];
  listPage(input: ReadingNotePageInput): ReadingNotePage;
  activeBookTitles(): string[];
  get(noteId: string): ReadingNote | undefined;
  counts(): ReadingNoteCounts;
  update(input: UpdateReadingNoteInput): ReadingNote;
  trash(noteId: string): ReadingNote;
  restore(noteId: string): ReadingNote;
  emptyTrash(): number;
}

interface ReaderReadingNoteDrafts {
  begin(input: BeginReadingNoteDraftInput): { draftId: string };
  create(input: CreateReadingNoteFromDraftInput): ReadingNote;
  discard(draftId: string): void;
}

interface ReaderReadingNoteAttachments {
  stage(input: UploadReadingNoteAttachmentInput): ReadingNoteAttachmentSnapshot;
  readDataUrl(attachmentId: string): string;
  copyForNote(attachmentId: string, noteId: string): ReadingNoteAttachmentSnapshot;
  discardStaged(attachmentIds: string[]): number;
}

interface ReaderReadingNoteAi {
  startCreate(input: StartReadingNoteDraftInput): ReadingNoteAiSnapshot;
  complete(sessionId: string): Promise<ReadingNoteAiSnapshot>;
  startEdit(noteId: string): ReadingNoteAiSnapshot;
  startTransform(draft: ReadingNoteAiDraft): ReadingNoteAiSnapshot;
  send(
    sessionId: string,
    request: string,
    model?: CodexChatModel
  ): Promise<ReadingNoteAiSnapshot>;
  accept(sessionId: string, appliedContent?: string): ReadingNoteAiSnapshot;
  reject(sessionId: string): ReadingNoteAiSnapshot;
  stop(sessionId: string): Promise<ReadingNoteAiSnapshot>;
  save(sessionId: string, draft: ReadingNoteAiDraft): ReadingNote;
  discard(sessionId?: string): void;
}

interface ReaderReadingNoteMemoryImage {
  templates: {
    get(): MemoryImageTemplateSettings;
    create(input: CreateMemoryImageTemplateInput): MemoryImageTemplateSettings;
    update(input: UpdateMemoryImageTemplateInput): MemoryImageTemplateSettings;
    remove(input: MemoryImageTemplateIdentityInput): MemoryImageTemplateSettings;
    setDefault(input: MemoryImageTemplateIdentityInput): MemoryImageTemplateSettings;
  };
  listActive(): Promise<ReadingNoteMemoryImageSnapshot[]>;
  getState(noteId: string, side?: MemoryImageSide): Promise<ReadingNoteMemoryImageSnapshot>;
  generate(input: GenerateReadingNoteMemoryImageInput): Promise<ReadingNoteMemoryImageSnapshot>;
  generateMissing?(noteId: string, options?: MissingVisualOptions): Promise<ReadingNoteMemoryImageSnapshot>;
  adjust(input: AdjustReadingNoteMemoryImageInput): Promise<ReadingNoteMemoryImageSnapshot>;
  revise(input: MemoryImageDraftInput): Promise<ReadingNoteMemoryImageSnapshot>;
  confirm(input: MemoryImageDraftInput): Promise<ReadingNoteMemoryImageSnapshot>;
  discard(noteId: string, side?: MemoryImageSide): Promise<ReadingNoteMemoryImageSnapshot>;
  stop(noteId: string): Promise<ReadingNoteMemoryImageSnapshot>;
  remove(noteId: string, side?: MemoryImageSide): Promise<ReadingNoteMemoryImageSnapshot>;
  assign?(noteId: string, side: MemoryImageSide): Promise<ReadingNoteMemoryImageSnapshot>;
}

export function parseReadingNoteListInput(value: unknown): ReadingNoteListInput {
  if (!object(value) || (value.status !== "active" && value.status !== "trashed") ||
    (value.sort !== "recent" && value.sort !== "alphabetical")) {
    throw new Error("Invalid reading-note query.");
  }
  const input: ReadingNoteListInput = { status: value.status, sort: value.sort };
  if (value.tagIds !== undefined) {
    if (!Array.isArray(value.tagIds) || value.tagIds.some(id => typeof id !== "string" || !id.trim())) throw new Error("Invalid tag filter.");
    if (value.tagIds.length) input.tagIds = [...new Set(value.tagIds as string[])];
  }
  for (const key of ["search", "bookTitle", "chapterTitle"] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") {
      throw new Error("Invalid reading-note query.");
    }
    if (typeof value[key] === "string" && value[key].trim()) input[key] = value[key].trim();
  }
  if (input.status === "trashed" && (input.search || input.bookTitle || input.chapterTitle)) {
    throw new Error("Invalid reading-note query.");
  }
  return input;
}

function parseReadingNotePageInput(value: unknown): ReadingNotePageInput {
  const input = parseReadingNoteListInput(value);
  if (!object(value) || value.cursor === undefined) return input;
  if (typeof value.cursor !== "string" || value.cursor.length > 2048 ||
    !/^[A-Za-z0-9_-]+$/.test(value.cursor)) throw new Error("Invalid reading-note cursor.");
  return { ...input, cursor: value.cursor };
}

function readingNoteId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid reading-note identifier.");
  }
  return value.trim();
}

function memoryImageTemplateKind(value: unknown): MemoryImageTemplateKind {
  if (value !== "purpose" && value !== "style") {
    throw new Error("Invalid memory-image template kind.");
  }
  return value;
}

function boundedText(value: unknown, label: string, limit: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > limit) {
    throw new Error(`Invalid memory-image ${label}.`);
  }
  return value.trim();
}

function memoryImageTemplateCreate(value: unknown): CreateMemoryImageTemplateInput {
  if (!object(value) || !exactKeys(value, value.side === undefined ? ["kind", "name", "prompt"] : ["kind", "name", "prompt", "side"])) {
    throw new Error("Invalid memory-image template creation.");
  }
  return {
    kind: memoryImageTemplateKind(value.kind),
    ...(value.side !== undefined ? { side: imageSide(value.side) } : {}),
    name: boundedText(value.name, "template name", 60),
    prompt: boundedText(value.prompt, "template prompt", 4_000)
  };
}

function memoryImageTemplateUpdate(value: unknown): UpdateMemoryImageTemplateInput {
  if (!object(value) || !exactKeys(value, value.side === undefined ? ["kind", "id", "name", "prompt"] : ["kind", "id", "name", "prompt", "side"])) {
    throw new Error("Invalid memory-image template update.");
  }
  return {
    ...memoryImageTemplateCreate({ kind: value.kind, name: value.name, prompt: value.prompt, ...(value.side !== undefined ? { side: value.side } : {}) }),
    id: boundedText(value.id, "template identifier", 200)
  };
}

function memoryImageTemplateDefault(value: unknown) {
  if (!object(value) || !exactKeys(value, value.side === undefined ? ["kind", "id"] : ["kind", "id", "side"])) {
    throw new Error("Invalid memory-image template selection.");
  }
  if (value.side !== undefined && value.side !== "understand" && value.side !== "recall") {
    throw new Error("Invalid memory-image side.");
  }
  return { ...memoryImageTemplateIdentity({ kind: value.kind, id: value.id }),
    ...(value.side === undefined ? {} : { side: value.side }) };
}

function memoryImageTemplateIdentity(value: unknown): MemoryImageTemplateIdentityInput {
  if (!object(value) || !exactKeys(value, ["kind", "id"])) {
    throw new Error("Invalid memory-image template selection.");
  }
  return {
    kind: memoryImageTemplateKind(value.kind),
    id: boundedText(value.id, "template identifier", 200)
  };
}

function memoryImagePromptSnapshot(value: unknown, label: string): MemoryImagePromptSnapshot {
  if (!object(value)) throw new Error(`Invalid memory-image ${label}.`);
  const keys = value.id === undefined ? ["name", "prompt"] : ["id", "name", "prompt"];
  if (!exactKeys(value, keys)) throw new Error(`Invalid memory-image ${label}.`);
  return {
    ...(value.id === undefined ? {} : { id: boundedText(value.id, `${label} identifier`, 200) }),
    name: boundedText(value.name, `${label} name`, 60),
    prompt: boundedText(value.prompt, `${label} prompt`, 4_000)
  };
}

function imageSide(value: unknown): MemoryImageSide | undefined {
  if (value === undefined) return undefined;
  if (!isMemoryImageSide(value)) throw new Error("Invalid memory-image side.");
  return value;
}

function memoryImageDraftInput(value: unknown): MemoryImageDraftInput {
  if (!object(value) || !exactKeys(value, ["noteId", "draftId", "text", ...(value.instruction === undefined ? [] : ["instruction"]), ...(value.side === undefined ? [] : ["side"])]) ||
    typeof value.text !== "string" || !value.text.trim() || value.text.length > 12_000 ||
    (value.instruction !== undefined && (typeof value.instruction !== "string" || value.instruction.length > 2_000))) {
    throw new Error("Invalid memory-image text draft.");
  }
  return { ...(value.side === undefined ? {} : { side: imageSide(value.side) }), noteId: readingNoteId(value.noteId), draftId: readingNoteId(value.draftId), text: value.text,
    ...(typeof value.instruction === "string" ? { instruction: value.instruction } : {}) };
}

function memoryImageGenerationMode(value: unknown): { generationMode?: "review" | "direct" } {
  if (value === undefined) return {};
  if (value !== "review" && value !== "direct") throw new Error("Invalid memory-image generation mode.");
  return { generationMode: value };
}

function memoryImageGeneration(value: unknown): GenerateReadingNoteMemoryImageInput {
  if (!object(value)) throw new Error("Invalid memory-image generation.");
  const keys = value.extraInstruction === undefined
    ? ["noteId", "purpose", "style"]
    : ["noteId", "purpose", "style", "extraInstruction"];
  if (value.generationMode !== undefined) keys.push("generationMode");
  if (value.side !== undefined) keys.push("side");
  if (!exactKeys(value, keys) || (value.extraInstruction !== undefined &&
    (typeof value.extraInstruction !== "string" || value.extraInstruction.trim().length > 2_000))) {
    throw new Error("Invalid memory-image generation.");
  }
  return {
    ...(value.side === undefined ? {} : { side: imageSide(value.side) }),
    ...memoryImageGenerationMode(value.generationMode),
    noteId: boundedText(value.noteId, "generation note identifier", 200),
    purpose: memoryImagePromptSnapshot(value.purpose, "purpose"),
    style: memoryImagePromptSnapshot(value.style, "style"),
    ...(typeof value.extraInstruction === "string" && value.extraInstruction.trim()
      ? { extraInstruction: value.extraInstruction.trim() }
      : {})
  };
}

function memoryImageAdjustment(value: unknown): AdjustReadingNoteMemoryImageInput {
  if (!object(value) || !exactKeys(value, ["noteId", "instruction", ...(value.generationMode === undefined ? [] : ["generationMode"]), ...(value.side === undefined ? [] : ["side"])])) {
    throw new Error("Invalid memory-image adjustment.");
  }
  return {
    ...(value.side === undefined ? {} : { side: imageSide(value.side) }),
    ...memoryImageGenerationMode(value.generationMode),
    noteId: boundedText(value.noteId, "adjustment note identifier", 200),
    instruction: boundedText(value.instruction, "adjustment instruction", 2_000)
  };
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function optionalBookId(value: Record<string, unknown>): { bookId?: string } {
  if (value.bookId === undefined) return {};
  if (typeof value.bookId !== "string" || !value.bookId.trim()) throw new Error("Invalid source book ID.");
  return { bookId: value.bookId };
}

function optionalChapterId(value: Record<string, unknown>): { chapterId?: string } {
  if (value.chapterId === undefined) return {};
  if (typeof value.chapterId !== "string" || !value.chapterId.trim()) throw new Error("Invalid source chapter ID.");
  return { chapterId: value.chapterId };
}

function readingNoteAiStartInput(value: unknown): StartReadingNoteDraftInput {
  const keys = ["bookTitle", "chapterTitle", "readingSegment", "userDraft",
    ...(object(value) && value.chapterId !== undefined ? ["chapterId"] : []), ...(object(value) && value.bookId !== undefined ? ["bookId"] : []),
    ...(object(value) && value.images !== undefined ? ["images"] : [])];
  if (!object(value) || !exactKeys(value, keys) ||
    ["bookTitle", "chapterTitle", "readingSegment", "userDraft"]
      .some((key) => typeof value[key] !== "string" || !(value[key] as string).trim())) {
    throw new Error("Invalid reading-note AI start.");
  }
  return {
    ...optionalBookId(value),
    ...optionalChapterId(value),
    bookTitle: (value.bookTitle as string).trim(),
    chapterTitle: (value.chapterTitle as string).trim(),
    readingSegment: (value.readingSegment as string).trim(),
    userDraft: (value.userDraft as string).trim(),
    ...(value.images !== undefined
      ? { images: parseChatImages(value.images, "book", undefined, BOOK_IMAGE_MAX_BYTES) }
      : {})
  };
}

function readingNoteAiSendInput(value: unknown): {
  sessionId: string;
  request: string;
  model?: CodexChatModel;
} {
  if (!object(value) ||
    typeof value.sessionId !== "string" || !value.sessionId.trim() ||
    typeof value.request !== "string" || !value.request.trim()) {
    throw new Error("Invalid reading-note AI request.");
  }
  if (value.model !== undefined && !isCodexChatModel(value.model)) {
    throw new Error("Invalid reading-note AI model.");
  }
  const keys = value.model === undefined
    ? ["sessionId", "request"]
    : ["sessionId", "request", "model"];
  if (!exactKeys(value, keys)) throw new Error("Invalid reading-note AI request.");
  return {
    sessionId: value.sessionId.trim(),
    request: value.request.trim(),
    ...(value.model ? { model: value.model } : {})
  };
}

function readingNoteAiDraftInput(value: unknown): ReadingNoteAiDraft {
  if (!object(value) || !exactKeys(value, ["title", "content"]) ||
    typeof value.title !== "string" || !value.title.trim() ||
    typeof value.content !== "string" || !value.content.trim()) {
    throw new Error("Invalid reading-note AI draft.");
  }
  return { title: value.title.trim(), content: value.content.trim() };
}

function readingNoteAiSaveInput(value: unknown): {
  sessionId: string;
  draft: ReadingNoteAiDraft;
} {
  if (!object(value) || !exactKeys(value, ["sessionId", "title", "content"]) ||
    typeof value.sessionId !== "string" || !value.sessionId.trim() ||
    typeof value.title !== "string" || !value.title.trim() ||
    typeof value.content !== "string" || !value.content.trim()) {
    throw new Error("Invalid reading-note AI save.");
  }
  return {
    sessionId: value.sessionId.trim(),
    draft: { title: value.title.trim(), content: value.content.trim() }
  };
}

function readingNoteUpdateInput(value: unknown): UpdateReadingNoteInput {
  if (!object(value) || !exactKeys(value, ["id", "baseRevision", "title", "content"]) ||
    typeof value.id !== "string" || !value.id.trim() ||
    typeof value.baseRevision !== "number" || !Number.isInteger(value.baseRevision) ||
    value.baseRevision < 1 || typeof value.title !== "string") {
    throw new Error("Invalid reading-note update.");
  }
  return {
    id: value.id.trim(),
    baseRevision: value.baseRevision,
    title: value.title.trim(),
    content: parseReadingNoteDocument(value.content)
  };
}

function readingNoteDraftSource(value: unknown): BeginReadingNoteDraftInput {
  const keys = ["bookTitle", "chapterTitle", "readingSegment", ...(object(value) && value.chapterId !== undefined ? ["chapterId"] : []), ...(object(value) && value.bookId !== undefined ? ["bookId"] : [])];
  if (!object(value) || !exactKeys(value, keys) ||
    keys.some((key) => typeof value[key] !== "string" || !value[key].trim())) {
    throw new Error("Invalid reading-note draft source.");
  }
  return {
    ...optionalBookId(value),
    ...optionalChapterId(value),
    bookTitle: (value.bookTitle as string).trim(),
    chapterTitle: (value.chapterTitle as string).trim(),
    readingSegment: (value.readingSegment as string).trim()
  };
}

function createReadingNoteFromDraft(value: unknown): CreateReadingNoteFromDraftInput {
  if (!object(value) || !exactKeys(value, ["draftId", "title", "content"]) ||
    typeof value.draftId !== "string" || !value.draftId.trim() || typeof value.title !== "string") {
    throw new Error("Invalid reading-note creation.");
  }
  return {
    draftId: value.draftId.trim(),
    title: value.title.trim(),
    content: parseReadingNoteDocument(value.content)
  };
}

function uploadReadingNoteAttachment(value: unknown): UploadReadingNoteAttachmentInput {
  if (!object(value) || !exactKeys(value, ["name", "mimeType", "bytes"]) ||
    typeof value.name !== "string" || typeof value.mimeType !== "string" ||
    !(value.bytes instanceof Uint8Array)) throw new Error("Invalid reading-note attachment upload.");
  return { name: value.name, mimeType: value.mimeType, bytes: value.bytes };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseChatInput(value: unknown): SendChatMessageInput {
  if (!object(value) || typeof value.text !== "string") {
    throw new Error("Invalid chat message.");
  }
  if (value.model !== undefined && !isCodexChatModel(value.model)) {
    throw new Error("Invalid chat model.");
  }
  const base: SendChatMessageInput = {
    text: value.text,
    ...(isCodexChatModel(value.model) ? { model: value.model } : {}),
    ...(isChatIntent(value.intent) ? { intent: value.intent } : {})
  };
  if (value.noteReferenceIds !== undefined) {
    if (!Array.isArray(value.noteReferenceIds) || value.noteReferenceIds.some(id => typeof id !== "string" || !id.trim() || id.length > 200)) throw new Error("Invalid note reference identifiers.");
    base.noteReferenceIds = [...new Set(value.noteReferenceIds.map(id => (id as string).trim()))];
  }
  if (value.noteReferences !== undefined || value.noteUpdates !== undefined) throw new Error("Note references must be loaded by the App.");
  if (value.images !== undefined) {
    base.images = parseChatImages(value.images, "reader", 4, 10 * 1024 * 1024);
  }
  if (value.intent !== undefined && !isChatIntent(value.intent)) {
    throw new Error("Invalid chat intent.");
  }
  if (value.quote !== undefined) {
    if (!object(value.quote) || typeof value.quote.text !== "string" || !value.quote.text.trim()) {
      throw new Error("Invalid chat quote.");
    }
    base.quote = { text: value.quote.text };
  }
  if (value.readingSource !== undefined) {
    const source = value.readingSource;
    if (!object(source) || typeof source.bookTitle !== "string" || !source.bookTitle.trim() ||
      typeof source.chapterTitle !== "string" || !source.chapterTitle.trim() ||
      typeof source.readingSegment !== "string" || !source.readingSegment.trim() ||
      (source.bookImageCount !== undefined &&
        (!Number.isInteger(source.bookImageCount) || Number(source.bookImageCount) < 0))) {
      throw new Error("Invalid reading source snapshot.");
    }
    base.readingSource = {
      ...optionalBookId(source),
      ...optionalChapterId(source),
      bookTitle: source.bookTitle,
      chapterTitle: source.chapterTitle,
      readingSegment: source.readingSegment,
      ...(source.bookImageCount !== undefined ? { bookImageCount: Number(source.bookImageCount) } : {})
    };
  }
  if (value.context !== undefined) {
    if (!object(value.context)) throw new Error("Invalid chat context.");
    const context: NonNullable<SendChatMessageInput["context"]> = {};
    for (const key of ["bookTitle", "chapterTitle", "readingSegment"] as const) {
      const field = value.context[key];
      if (field !== undefined && typeof field !== "string") {
        throw new Error("Invalid chat context.");
      }
      if (typeof field === "string") context[key] = field;
    }
    if (value.context.images !== undefined) {
      const images = value.context.images;
      if (!context.readingSegment?.trim()) {
        throw new Error("Invalid book images in the reading segment.");
      }
      context.images = parseChatImages(images, "book", undefined, BOOK_IMAGE_MAX_BYTES);
    }
    base.context = context;
  }
  if (base.intent && !base.context?.readingSegment?.trim()) {
    throw new Error("Reading-segment shortcuts require a reading segment.");
  }
  return base;
}


export function registerReaderIpc(
  ipc: IpcRegistrar,
  fileDialog: EpubFileDialog,
  library: ReaderLibrary,
  chat: ReaderChat,
  readingNotes?: ReaderReadingNotes,
  readingNoteAi?: ReaderReadingNoteAi,
  readingNoteDrafts?: ReaderReadingNoteDrafts,
  readingNoteAttachments?: ReaderReadingNoteAttachments,
  readingNoteMemoryImage?: ReaderReadingNoteMemoryImage
): void {
  ipc.handle("library:list", () => library.listBooks());
  ipc.handle("library:import", async () => {
    const selection = await fileDialog.showOpenDialog({
      title: "Import EPUB",
      properties: ["openFile"],
      filters: [{ name: "EPUB books", extensions: ["epub"] }]
    });
    const path = selection.filePaths[0];
    return selection.canceled || !path
      ? { status: "cancelled" as const }
      : library.importFromPath(path);
  });
  ipc.handle("library:chapter", (_event, bookId, chapterId) => {
    if (typeof bookId !== "string" || typeof chapterId !== "string") {
      throw new Error("Invalid chapter request.");
    }
    return library.getChapterContent(bookId, chapterId);
  });
  ipc.handle("library:save-reading-state", (_event, value) => {
    if (!object(value) || typeof value.bookId !== "string" || !value.bookId.trim() ||
      (value.view !== "overview" && value.view !== "reader") ||
      (value.chapterId !== null && typeof value.chapterId !== "string") ||
      typeof value.scrollProgress !== "number") {
      throw new Error("Invalid reading state.");
    }
    return library.saveReadingState({
      bookId: value.bookId,
      view: value.view,
      chapterId: value.chapterId,
      scrollProgress: value.scrollProgress
    });
  });
  ipc.handle("library:set-shelf-status", (_event, value) => {
    if (!object(value) || typeof value.bookId !== "string" || !value.bookId.trim() ||
        (value.status !== "finished" && value.status !== "reading" && value.status !== "unread")) {
      throw new Error("Invalid shelf status.");
    }
    return library.setShelfStatus({ bookId: value.bookId, status: value.status });
  });
  ipc.handle("library:set-pinned", (_event, value) => {
    if (!object(value) || typeof value.bookId !== "string" || !value.bookId.trim() ||
      typeof value.pinned !== "boolean") {
      throw new Error("Invalid pinned state.");
    }
    return library.setPinned({ bookId: value.bookId, pinned: value.pinned });
  });
  ipc.handle("library:delete", (_event, bookId) => {
    if (typeof bookId !== "string" || !bookId.trim()) {
      throw new Error("Invalid book identifier.");
    }
    return library.deleteBook(bookId);
  });
  ipc.handle("library:save-range", (_event, value) => {
    if (!object(value) || typeof value.bookId !== "string" ||
      typeof value.chapterId !== "string" || !object(value.range) ||
      !Number.isInteger(value.range.start) || !Number.isInteger(value.range.end)) {
      throw new Error("Invalid reading range.");
    }
    return library.saveReadingRange({
      bookId: value.bookId,
      chapterId: value.chapterId,
      range: { start: Number(value.range.start), end: Number(value.range.end) }
    });
  });
  ipc.handle("library:save-annotations", (_event, value) => {
    if (!object(value) || typeof value.bookId !== "string" ||
      typeof value.chapterId !== "string" || !Array.isArray(value.annotations)) {
      throw new Error("Invalid annotations.");
    }
    return library.saveAnnotations({
      bookId: value.bookId,
      chapterId: value.chapterId,
      annotations: value.annotations as SaveAnnotationsInput["annotations"]
    });
  });
  ipc.handle("chat:get", () => chat.getSnapshot());
  ipc.handle("chat:connect", () => chat.connect());
  ipc.handle("chat:send", (_event, value) => chat.sendMessage(parseChatInput(value)));
  ipc.handle("chat:prepare-reading-note-draft", (_event, draftId) => {
    if (typeof draftId !== "string" || !draftId.trim() || !chat.prepareReadingNoteDraft) throw new Error("Invalid reading-note draft identifier.");
    return chat.prepareReadingNoteDraft(draftId);
  });
  ipc.handle("chat:save-reading-note-draft", (_event, value) => {
    if (!chat.saveReadingNoteDraft) throw new Error("Conversation note creation is unavailable.");
    return chat.saveReadingNoteDraft(createReadingNoteFromDraft(value));
  });
  ipc.handle("chat:submit-reading-note", (_event, draftId) => {
    if (typeof draftId !== "string" || !draftId.trim()) {
      throw new Error("Invalid reading-note draft identifier.");
    }
    return chat.submitReadingNote(draftId);
  });
  ipc.handle("chat:decide-note-update", (_event, value) => {
    if (!object(value) || !exactKeys(value, ["proposalId", "decision"]) || typeof value.proposalId !== "string" || !value.proposalId.trim() ||
      (value.decision !== "apply" && value.decision !== "reject")) throw new Error("Invalid note update decision.");
    if (!chat.decideReadingNoteUpdate) throw new Error("Note update service unavailable.");
    return chat.decideReadingNoteUpdate(value.proposalId, value.decision);
  });
  ipc.handle("chat:new", () => chat.startNewConversation());
  ipc.handle("chat:select", (_event, conversationId) => {
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      throw new Error("Invalid AI conversation identifier.");
    }
    return chat.selectConversation(conversationId);
  });
  ipc.handle("chat:remove", (_event, conversationId) => {
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      throw new Error("Invalid AI conversation identifier.");
    }
    return chat.removeConversation(conversationId);
  });
  ipc.handle("chat:stop", () => chat.stopResponse());
  if (readingNotes) {
    ipc.handle("reading-notes:list", (_event, value) =>
      readingNotes.list(parseReadingNoteListInput(value)));
    ipc.handle("reading-notes:list-page", (_event, value) =>
      readingNotes.listPage(parseReadingNotePageInput(value)));
    ipc.handle("reading-notes:book-titles", () => readingNotes.activeBookTitles());
    ipc.handle("reading-notes:get", (_event, noteId) => readingNotes.get(readingNoteId(noteId)));
    ipc.handle("reading-notes:counts", () => readingNotes.counts());
    ipc.handle("reading-notes:update", (_event, value) =>
      readingNotes.update(readingNoteUpdateInput(value)));
    ipc.handle("reading-notes:trash", (_event, noteId) =>
      readingNotes.trash(readingNoteId(noteId)));
    ipc.handle("reading-notes:restore", (_event, noteId) =>
      readingNotes.restore(readingNoteId(noteId)));
    ipc.handle("reading-notes:empty-trash", () => readingNotes.emptyTrash());
  }
  if (readingNoteDrafts) {
    ipc.handle("reading-notes:begin-draft", (_event, value) =>
      readingNoteDrafts.begin(readingNoteDraftSource(value)));
    ipc.handle("reading-notes:create", (_event, value) =>
      readingNoteDrafts.create(createReadingNoteFromDraft(value)));
    ipc.handle("reading-notes:discard-draft", (_event, draftId) =>
      readingNoteDrafts.discard(readingNoteId(draftId)));
  }
  if (readingNoteAttachments) {
    ipc.handle("reading-notes:attachments-upload", (_event, value) =>
      readingNoteAttachments.stage(uploadReadingNoteAttachment(value)));
    ipc.handle("reading-notes:attachments-read", (_event, attachmentId) =>
      readingNoteAttachments.readDataUrl(readingNoteId(attachmentId)));
    ipc.handle("reading-notes:attachments-copy", (_event, value) => {
      if (!object(value) || !exactKeys(value, ["attachmentId", "noteId"])) {
        throw new Error("Invalid reading-note attachment copy.");
      }
      return readingNoteAttachments.copyForNote(
        readingNoteId(value.attachmentId), readingNoteId(value.noteId));
    });
    ipc.handle("reading-notes:attachments-discard-staged", (_event, value) => {
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
        throw new Error("Invalid staged reading-note attachments.");
      }
      return readingNoteAttachments.discardStaged([...new Set(value.map(readingNoteId))]);
    });
  }
  if (readingNoteAi) {
    ipc.handle("reading-notes:ai-start-create", (_event, value) =>
      readingNoteAi.startCreate(readingNoteAiStartInput(value)));
    ipc.handle("reading-notes:ai-complete", (_event, sessionId) =>
      readingNoteAi.complete(readingNoteId(sessionId)));
    ipc.handle("reading-notes:ai-start-edit", (_event, noteId) =>
      readingNoteAi.startEdit(readingNoteId(noteId)));
    ipc.handle("reading-notes:ai-start-transform", (_event, value) =>
      readingNoteAi.startTransform(readingNoteAiDraftInput(value)));
    ipc.handle("reading-notes:ai-send", (_event, value) => {
      const input = readingNoteAiSendInput(value);
      return readingNoteAi.send(input.sessionId, input.request, input.model);
    });
    ipc.handle("reading-notes:ai-accept", (_event, sessionId, appliedContent) => {
      if (appliedContent !== undefined && (typeof appliedContent !== "string" ||
        !appliedContent.trim() || appliedContent.length > 1_000_000)) {
        throw new Error("Invalid applied reading-note content.");
      }
      return appliedContent === undefined
        ? readingNoteAi.accept(readingNoteId(sessionId))
        : readingNoteAi.accept(readingNoteId(sessionId), appliedContent);
    });
    ipc.handle("reading-notes:ai-reject", (_event, sessionId) =>
      readingNoteAi.reject(readingNoteId(sessionId)));
    ipc.handle("reading-notes:ai-stop", (_event, sessionId) =>
      readingNoteAi.stop(readingNoteId(sessionId)));
    ipc.handle("reading-notes:ai-save", (_event, value) => {
      const input = readingNoteAiSaveInput(value);
      return readingNoteAi.save(input.sessionId, input.draft);
    });
    ipc.handle("reading-notes:ai-discard", (_event, sessionId) =>
      readingNoteAi.discard(readingNoteId(sessionId)));
  }
  if (readingNoteMemoryImage) {
    ipc.handle("reading-notes:memory-image-templates-get", () =>
      readingNoteMemoryImage.templates.get());
    ipc.handle("reading-notes:memory-image-templates-create", (_event, value) =>
      readingNoteMemoryImage.templates.create(memoryImageTemplateCreate(value)));
    ipc.handle("reading-notes:memory-image-templates-update", (_event, value) =>
      readingNoteMemoryImage.templates.update(memoryImageTemplateUpdate(value)));
    ipc.handle("reading-notes:memory-image-templates-remove", (_event, value) =>
      readingNoteMemoryImage.templates.remove(memoryImageTemplateIdentity(value)));
    ipc.handle("reading-notes:memory-image-templates-set-default", (_event, value) =>
      readingNoteMemoryImage.templates.setDefault(memoryImageTemplateDefault(value)));
    ipc.handle("reading-notes:memory-image-list-active", () =>
      readingNoteMemoryImage.listActive());
    ipc.handle("reading-notes:memory-image-get", (_event, noteId, side) =>
      side === undefined ? readingNoteMemoryImage.getState(readingNoteId(noteId)) : readingNoteMemoryImage.getState(readingNoteId(noteId), imageSide(side)));
    ipc.handle("reading-notes:memory-image-generate", (_event, value) =>
      readingNoteMemoryImage.generate(memoryImageGeneration(value)));
    ipc.handle("reading-notes:memory-image-generate-missing", (_event, noteId, options) => {
      const id = readingNoteId(noteId);
      if (!readingNoteMemoryImage.generateMissing) throw new Error("Quick image generation is unavailable.");
      if (options === undefined) return readingNoteMemoryImage.generateMissing(id);
      if (!object(options) || Object.keys(options).some(side => !isMemoryImageSide(side))) throw new Error("Invalid visual settings.");
      const parsed: MissingVisualOptions = {};
      for (const [side, value] of Object.entries(options)) {
        if (!object(value) || !exactKeys(value, ["purpose", "style", ...(value.extraInstruction === undefined ? [] : ["extraInstruction"])])) throw new Error("Invalid visual settings.");
        const input = memoryImageGeneration({ ...value, noteId: id, side });
        parsed[side as MemoryImageSide] = { purpose: input.purpose, style: input.style, ...(input.extraInstruction ? { extraInstruction: input.extraInstruction } : {}) };
      }
      return readingNoteMemoryImage.generateMissing(id, parsed);
    });
    ipc.handle("reading-notes:memory-image-adjust", (_event, value) =>
      readingNoteMemoryImage.adjust(memoryImageAdjustment(value)));
    ipc.handle("reading-notes:memory-image-revise", (_event, value) =>
      readingNoteMemoryImage.revise(memoryImageDraftInput(value)));
    ipc.handle("reading-notes:memory-image-confirm", (_event, value) =>
      readingNoteMemoryImage.confirm(memoryImageDraftInput(value)));
    ipc.handle("reading-notes:memory-image-discard", (_event, noteId, side) =>
      side === undefined ? readingNoteMemoryImage.discard(readingNoteId(noteId)) : readingNoteMemoryImage.discard(readingNoteId(noteId), imageSide(side)));
    ipc.handle("reading-notes:memory-image-stop", (_event, noteId) =>
      readingNoteMemoryImage.stop(readingNoteId(noteId)));
    ipc.handle("reading-notes:memory-image-assign", (_event, noteId, side) => {
      const parsed = imageSide(side);
      if (!parsed || !readingNoteMemoryImage.assign) throw new Error("Image attribution is unavailable.");
      return readingNoteMemoryImage.assign(readingNoteId(noteId), parsed);
    });
    ipc.handle("reading-notes:memory-image-remove", (_event, noteId, side) =>
      side === undefined ? readingNoteMemoryImage.remove(readingNoteId(noteId)) : readingNoteMemoryImage.remove(readingNoteId(noteId), imageSide(side)));
  }
}
