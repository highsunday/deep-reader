export interface ReadingRange {
  start: number;
  end: number;
}

export const ANNOTATION_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type AnnotationColor = typeof ANNOTATION_COLORS[number];
export const DEFAULT_ANNOTATION_COLOR: AnnotationColor = "yellow";

export interface Annotation {
  id: string;
  start: number;
  end: number;
  text: string;
  /** Missing only while loading annotation data saved before F26. */
  color?: AnnotationColor;
}

export interface BookChapter {
  id: string;
  title: string;
  href: string;
  order: number;
  contentHrefs?: string[];
  depth?: number;
  fragment?: string | null;
}

export type BookView = "overview" | "reader";

export interface BookReadingState {
  view: BookView;
  chapterId: string | null;
  scrollProgress: number;
}

export interface LibraryBook {
  id: string;
  epubParseVersion?: number;
  title: string;
  author: string;
  pinned?: boolean;
  shelfStatus?: "unread" | "reading" | "finished";
  coverDataUrl?: string;
  chapters: BookChapter[];
  lastChapterId?: string;
  readingState: BookReadingState;
  chapterRanges: Record<string, ReadingRange>;
  chapterAnnotations: Record<string, Annotation[]>;
}

export interface ChapterContent {
  bookId: string;
  chapterId: string;
  title: string;
  contentHtml: string;
}

export type ImportBookResult =
  | { status: "cancelled" }
  | { status: "imported" | "existing"; book: LibraryBook };

export interface SaveReadingRangeInput {
  bookId: string;
  chapterId: string;
  range: ReadingRange;
}

export interface SaveReadingStateInput extends BookReadingState {
  bookId: string;
}

export interface SetShelfStatusInput {
  bookId: string;
  status: "unread" | "reading" | "finished";
}

export interface SetBookPinnedInput {
  bookId: string;
  pinned: boolean;
}

export interface SaveAnnotationsInput {
  bookId: string;
  chapterId: string;
  annotations: Annotation[];
}

export type ConnectionPhase =
  | "disconnected"
  | "connecting"
  | "ready"
  | "auth-required"
  | "error";

export interface ChatMessage {
  id: string;
  turnId: string | null;
  role: "user" | "assistant";
  text: string;
  intent?: ChatIntent;
  quote?: ChatQuote;
  readingSource?: ReadingSourceSnapshot;
  images?: ReadingSegmentImage[];
  /** App-supplied source images for a Create Note turn, never reader attachments. */
  bookImages?: ReadingSegmentImage[];
  noteReferences?: import('./reading-note-reference').NoteReference[];
  noteUpdates?: import('./reading-note-reference').NoteUpdate[];
  noteUpdateError?: string;
  status: "streaming" | "completed" | "failed";
}

/** The full START/END text visible when a reader sends a turn, for later copying. */
export interface ReadingSourceSnapshot {
  chapterId?: string;
  bookId?: string;
  bookTitle: string;
  chapterTitle: string;
  readingSegment: string;
  bookImageCount?: number;
}

export interface ChatQuote {
  text: string;
}

export interface ChatContext {
  bookTitle?: string;
  chapterTitle?: string;
  readingSegment?: string;
  images?: ReadingSegmentImage[];
}

export interface ReadingSegmentImage {
  dataUrl: string;
}

export type ChatIntent =
  | "readingGuide"
  | "explainReadingSegment"
  | "learningQuestionQuiz"
  | "readingCoach"
  | "selfRetelling"
  | "createReadingNote";

export function isChatIntent(value: unknown): value is ChatIntent {
  return value === "readingGuide" || value === "explainReadingSegment" ||
    value === "learningQuestionQuiz" || value === "readingCoach" || value === "selfRetelling" ||
    value === "createReadingNote";
}

import type { ReadingNoteDocument } from "./reading-note-document";

export type MemoryImageTemplateKind = "purpose" | "style";

export interface MemoryImageTemplate {
  id: string;
  kind: MemoryImageTemplateKind;
  side?: MemoryImageSide;
  name: string;
  prompt: string;
  builtIn: boolean;
}

export interface MemoryImageTemplateSettings {
  purposes: MemoryImageTemplate[];
  styles: MemoryImageTemplate[];
  defaultPurposeId: string;
  defaultStyleId: string;
  defaultsBySide?: Partial<Record<MemoryImageSide, { purposeId?: string; styleId?: string }>>;
}

export interface CreateMemoryImageTemplateInput {
  kind: MemoryImageTemplateKind;
  side?: MemoryImageSide;
  name: string;
  prompt: string;
}

export interface UpdateMemoryImageTemplateInput extends CreateMemoryImageTemplateInput {
  id: string;
}

export interface MemoryImageTemplateIdentityInput {
  kind: MemoryImageTemplateKind;
  id: string;
}

export interface SetMemoryImageTemplateDefaultInput extends MemoryImageTemplateIdentityInput {
  side?: MemoryImageSide;
}

export interface MemoryImagePromptSnapshot {
  id?: string;
  name: string;
  prompt: string;
}

export interface ReadingNoteMemoryImageRecipe {
  purpose: MemoryImagePromptSnapshot;
  style: MemoryImagePromptSnapshot;
  extraInstruction?: string;
  adjustments: string[];
}

export type MemoryImageSide = "recall" | "understand";

export type MemoryImageGenerationMode = "review" | "direct";

export interface GenerateReadingNoteMemoryImageInput {
  side?: MemoryImageSide;
  generationMode?: MemoryImageGenerationMode;
  noteId: string;
  purpose: MemoryImagePromptSnapshot;
  style: MemoryImagePromptSnapshot;
  extraInstruction?: string;
}

export type MissingVisualOptions = Partial<Record<MemoryImageSide, Pick<GenerateReadingNoteMemoryImageInput, "purpose" | "style" | "extraInstruction">>>;

export interface AdjustReadingNoteMemoryImageInput {
  side?: MemoryImageSide;
  generationMode?: MemoryImageGenerationMode;
  noteId: string;
  instruction: string;
}

export interface ReadingNoteTag { id: string; name: string; }

export interface ChangeReadingNoteTagsInput {
  noteIds: string[];
  tagId: string;
  action: "add" | "remove";
}

export interface ChangeBookTagInput {
  bookId: string;
  tagId: string;
  action: "add" | "remove";
}

export interface BookTagsApi {
  list(): Promise<Record<string, string[]>>;
  change(input: ChangeBookTagInput): Promise<string[]>;
}

export interface ReadingNoteTagsApi {
  list(): Promise<ReadingNoteTag[]>;
  create(name: string): Promise<ReadingNoteTag>;
  rename(input: { id: string; name: string }): Promise<ReadingNoteTag>;
  matchingIds(query: ReadingNoteListInput): Promise<string[]>;
  change(input: ChangeReadingNoteTagsInput): Promise<number>;
}

export interface ReadingNote {
  chapterId?: string;
  bookId?: string;
  tagIds?: string[];
  id: string;
  sourceDraftId: string;
  title: string;
  content: ReadingNoteDocument;
  bookTitle: string;
  chapterTitle: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  /** Legacy image awaiting attribution; new images belong to a side. */
  memoryImage?: ReadingNoteMemoryImage;
  memoryImages?: Partial<Record<MemoryImageSide, ReadingNoteMemoryImage>>;
  trashedAt?: number;
}

export interface ReadingNoteMemoryImage {
  attachmentId: string;
  basedOnRevision: number;
  revisedPrompt?: string;
  recipe?: ReadingNoteMemoryImageRecipe;
}

export interface SetReadingNoteMemoryImageInput {
  side?: MemoryImageSide;
  id: string;
  baseRevision: number;
  attachmentId: string;
  revisedPrompt?: string;
  recipe?: ReadingNoteMemoryImageRecipe;
}

export interface RemoveReadingNoteMemoryImageInput {
  side?: MemoryImageSide;
  id: string;
  baseRevision: number;
}

export interface MemoryImageDraft {
  side?: MemoryImageSide;
  id: string;
  mode: "generate" | "adjust";
  text: string;
  baseRevision: number;
}

export interface MemoryImageDraftInput {
  side?: MemoryImageSide;
  noteId: string;
  draftId: string;
  text: string;
  instruction?: string;
}

export type ReadingNoteMemoryImagePhase = "unavailable" | "ready" | "preparing" | "generating" | "error";

export interface ReadingNoteMemoryImageSnapshot {
  /** Emitted only after generated images are saved; running batch faces wait for its terminal event. */
  completion?: { sides: MemoryImageSide[] };
  batch?: {
    sides: MemoryImageSide[];
    completed: MemoryImageSide[];
    phase: "running" | "completed" | "stopped" | "error";
  };
  side?: MemoryImageSide;
  draft?: MemoryImageDraft;
  noteId: string;
  phase: ReadingNoteMemoryImagePhase;
  available: boolean;
  status: string;
  note?: ReadingNote;
  resetsAt?: number;
}

export type ReadingNoteStatus = "active" | "trashed";
export type ReadingNoteSort = "recent" | "alphabetical";

export interface ReadingNoteListInput {
  tagIds?: string[];
  status: ReadingNoteStatus;
  search?: string;
  bookTitle?: string;
  chapterTitle?: string;
  sort: ReadingNoteSort;
}

export interface ReadingNotePageInput extends ReadingNoteListInput {
  cursor?: string;
}

export type ReadingNoteSummary = Omit<ReadingNote, "content" | "sourceDraftId">;

export interface ReadingNotePage {
  items: ReadingNoteSummary[];
  nextCursor?: string;
}

export interface ReadingNoteCounts {
  active: number;
  trashed: number;
}

export interface CreateReadingNoteInput {
  chapterId?: string;
  bookId?: string;
  /** Main-process-only reserved identity used to commit attachment ownership atomically. */
  id?: string;
  sourceDraftId: string;
  title: string;
  content: ReadingNoteDocument;
  bookTitle: string;
  chapterTitle: string;
}

export interface UpdateReadingNoteInput {
  id: string;
  baseRevision: number;
  title: string;
  content: ReadingNoteDocument;
}

export interface BeginReadingNoteDraftInput {
  chapterId?: string;
  bookId?: string;
  bookTitle: string;
  chapterTitle: string;
  readingSegment: string;
}

export interface CreateReadingNoteFromDraftInput {
  draftId: string;
  title: string;
  content: ReadingNoteDocument;
}

export interface PreparedConversationReadingNote {
  markdown: string;
  draftId: string;
  title: string;
  content: ReadingNoteDocument;
  source: BeginReadingNoteDraftInput;
  stagedAttachmentIds: string[];
}

export interface ReadingNoteAttachmentSnapshot {
  id: string;
  name: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  size: number;
  url: string;
}

export interface UploadReadingNoteAttachmentInput {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export type ReadingNoteAiPhase = "ready" | "responding" | "error";

export interface ReadingNoteAiDraft {
  title: string;
  content: string;
}

export interface ReadingNoteAiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface ReadingNoteAiSnapshot {
  sessionId: string;
  mode: "create" | "edit" | "transform";
  phase: ReadingNoteAiPhase;
  draft?: ReadingNoteAiDraft;
  streamingDraft?: ReadingNoteAiDraft;
  messages: ReadingNoteAiMessage[];
  hasChanges: boolean;
  status: string;
}

export interface StartReadingNoteDraftInput {
  chapterId?: string;
  bookId?: string;
  bookTitle: string;
  chapterTitle: string;
  readingSegment: string;
  userDraft: string;
  images?: ReadingSegmentImage[];
}

export const CODEX_CHAT_MODELS = [
  { id: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6-Luna" },
  { id: "gpt-5.5", label: "GPT-5.5" },
  { id: "gpt-5.4", label: "GPT-5.4" },
  { id: "gpt-5.4-mini", label: "GPT-5.4-Mini" },
  { id: "gpt-5.3-codex-spark", label: "GPT-5.3-Codex-Spark" }
] as const;

export interface CodexModelOption {
  id: string;
  label: string;
  isDefault?: boolean;
}

export type CodexChatModel = string;

export function availableChatModel(models: readonly CodexModelOption[], selected: string): string {
  return models.some(({ id }) => id === selected) ? selected
    : models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? selected;
}

export function isCodexChatModel(value: unknown): value is CodexChatModel {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value);
}

export interface SendChatMessageInput {
  noteReferenceIds?: string[];
  text: string;
  images?: ReadingSegmentImage[];
  model?: CodexChatModel;
  context?: ChatContext;
  quote?: ChatQuote;
  readingSource?: ReadingSourceSnapshot;
  intent?: ChatIntent;
}

export interface CodexAccount {
  type: string;
  email?: string;
}

export interface AiUsageAllowanceWindow {
  remainingPercent: number;
  resetsAt: number;
}

export interface AiUsageAllowance {
  phase: "loading" | "available" | "unavailable";
  fiveHour: AiUsageAllowanceWindow | null;
  weekly: AiUsageAllowanceWindow | null;
  detail: string;
}

export interface ChatSnapshot {
  voice?: import("./reading-voice").ReadingVoiceState;
  models?: CodexModelOption[];
  connection: ConnectionPhase;
  connectionDetail: string;
  account: CodexAccount | null;
  allowance: AiUsageAllowance;
  threadId: string | null;
  activeTurnId: string | null;
  messages: ChatMessage[];
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  managementBusy: boolean;
  conversationError?: string | null;
}

export interface ChatConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: Pick<ChatContext, "bookTitle" | "chapterTitle"> | null;
}

export interface ReaderDesktopApi {
  conceptVideos?: import('./concept-video').ConceptVideoApi;
  whiteboards?: import("./whiteboard").WhiteboardsApi;
  practice?: import("./practice").PracticeApi;
  chapterScratchpad?: import("./chapter-scratchpad").ChapterScratchpadApi;
  library: {
    listBooks(): Promise<LibraryBook[]>;
    importBook(): Promise<ImportBookResult>;
    getChapterContent(bookId: string, chapterId: string): Promise<ChapterContent>;
    saveReadingState(input: SaveReadingStateInput): Promise<LibraryBook>;
    setShelfStatus(input: SetShelfStatusInput): Promise<LibraryBook>;
    setPinned(input: SetBookPinnedInput): Promise<LibraryBook>;
    deleteBook(bookId: string): Promise<void>;
    saveReadingRange(input: SaveReadingRangeInput): Promise<LibraryBook>;
    saveAnnotations(input: SaveAnnotationsInput): Promise<LibraryBook>;
  };
  readingNotes: {
    tags?: ReadingNoteTagsApi;
    bookTags?: BookTagsApi;
    review?: import("./spaced-review").SpacedReviewApi;
    list(input: ReadingNoteListInput): Promise<ReadingNote[]>;
    listPage(input: ReadingNotePageInput): Promise<ReadingNotePage>;
    activeBookTitles(): Promise<string[]>;
    get(noteId: string): Promise<ReadingNote | undefined>;
    counts(): Promise<ReadingNoteCounts>;
    beginDraft(input: BeginReadingNoteDraftInput): Promise<{ draftId: string }>;
    create(input: CreateReadingNoteFromDraftInput): Promise<ReadingNote>;
    discardDraft(draftId: string): Promise<void>;
    update(input: UpdateReadingNoteInput): Promise<ReadingNote>;
    trash(noteId: string): Promise<ReadingNote>;
    restore(noteId: string): Promise<ReadingNote>;
    emptyTrash(): Promise<number>;
    cardPool?: import("./card-note-upload").CardNoteUploadApi;
    heptabase?: import("./heptabase-import").HeptabaseImportApi;
    attachments: {
      upload(input: UploadReadingNoteAttachmentInput): Promise<ReadingNoteAttachmentSnapshot>;
      readDataUrl(attachmentId: string): Promise<string>;
      copyForNote(attachmentId: string, noteId: string): Promise<ReadingNoteAttachmentSnapshot>;
      discardStaged(attachmentIds: string[]): Promise<number>;
    };
    memoryImage?: {
      templates: {
        get(): Promise<MemoryImageTemplateSettings>;
        create(input: CreateMemoryImageTemplateInput): Promise<MemoryImageTemplateSettings>;
        update(input: UpdateMemoryImageTemplateInput): Promise<MemoryImageTemplateSettings>;
        remove(input: MemoryImageTemplateIdentityInput): Promise<MemoryImageTemplateSettings>;
        setDefault(input: SetMemoryImageTemplateDefaultInput): Promise<MemoryImageTemplateSettings>;
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
      onStateChanged(listener: (snapshot: ReadingNoteMemoryImageSnapshot) => void): () => void;
    };
    ai: {
      startCreate(input: StartReadingNoteDraftInput): Promise<ReadingNoteAiSnapshot>;
      complete(sessionId: string): Promise<ReadingNoteAiSnapshot>;
      startEdit(noteId: string): Promise<ReadingNoteAiSnapshot>;
      startTransform(draft: ReadingNoteAiDraft): Promise<ReadingNoteAiSnapshot>;
      send(
        sessionId: string,
        request: string,
        model?: CodexChatModel
      ): Promise<ReadingNoteAiSnapshot>;
      accept(sessionId: string, appliedContent?: string): Promise<ReadingNoteAiSnapshot>;
      reject(sessionId: string): Promise<ReadingNoteAiSnapshot>;
      stop(sessionId: string): Promise<ReadingNoteAiSnapshot>;
      save(sessionId: string, draft: ReadingNoteAiDraft): Promise<ReadingNote>;
      discard(sessionId: string): Promise<void>;
      onStateChanged(listener: (snapshot: ReadingNoteAiSnapshot) => void): () => void;
    };
  };
  chat: {
    voice?: import("./reading-voice").ReadingVoiceApi;
    getState(): Promise<ChatSnapshot>;
    connect(): Promise<ChatSnapshot>;
    sendMessage(input: SendChatMessageInput): Promise<ChatSnapshot>;
    submitReadingNote(draftId: string): Promise<ChatSnapshot>;
    prepareReadingNoteDraft(draftId: string): Promise<PreparedConversationReadingNote>;
    saveReadingNoteDraft(input: CreateReadingNoteFromDraftInput): Promise<ReadingNote>;
    decideReadingNoteUpdate?(proposalId: string, decision: 'apply' | 'reject'): Promise<ChatSnapshot>;
    startNewConversation(): Promise<ChatSnapshot>;
    selectConversation(conversationId: string): Promise<ChatSnapshot>;
    removeConversation(conversationId: string): Promise<ChatSnapshot>;
    stopResponse(): Promise<ChatSnapshot>;
    onStateChanged(listener: (snapshot: ChatSnapshot) => void): () => void;
  };
}
