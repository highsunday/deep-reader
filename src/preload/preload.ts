import { prepareBookImagesForIpc } from "./svg-book-images";
import type { MemoryImageSide, MissingVisualOptions } from "../shared/contracts";
import { contextBridge, ipcRenderer } from "electron";
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
  MemoryImageTemplateIdentityInput,
  SetMemoryImageTemplateDefaultInput,
  MemoryImageTemplateSettings,
  UpdateMemoryImageTemplateInput,
  BeginReadingNoteDraftInput,
  CreateReadingNoteFromDraftInput,
  ReadingNoteAttachmentSnapshot,
  UploadReadingNoteAttachmentInput,
  ReaderDesktopApi,
  SaveAnnotationsInput,
  SaveReadingRangeInput,
  SaveReadingStateInput,
  SetShelfStatusInput,
  SetBookPinnedInput,
  SendChatMessageInput,
  StartReadingNoteDraftInput,
  UpdateReadingNoteInput
} from "../shared/contracts";

const api: ReaderDesktopApi = Object.freeze({
  conceptVideos: Object.freeze({
    capability: () => ipcRenderer.invoke('concept-videos:capability'),
    list: (filter?: import('../shared/concept-video').ConceptVideoFilter) => ipcRenderer.invoke('concept-videos:list', filter),
    poll: (token?: string) => ipcRenderer.invoke('concept-videos:poll', token),
    get: (id: string) => ipcRenderer.invoke('concept-videos:get', id),
    create: (input: import('../shared/concept-video').CreateConceptVideo) => prepareBookImagesForIpc(input).then(prepared => ipcRenderer.invoke('concept-videos:create', prepared)),
    save: (input: import('../shared/concept-video').SaveConceptVideo) => prepareBookImagesForIpc(input).then(prepared => ipcRenderer.invoke('concept-videos:save', prepared)),
    append: (input: import('../shared/concept-video').ConceptVideoIdentity & { question: string }) => ipcRenderer.invoke('concept-videos:append', input),
    remove: (input: import('../shared/concept-video').ConceptVideoIdentity) => ipcRenderer.invoke('concept-videos:remove', input),
    generate: (input: import('../shared/concept-video').ConceptVideoIdentity) => ipcRenderer.invoke('concept-videos:generate', input),
    compare: (input: import('../shared/concept-video').ConceptVideoIdentity) => ipcRenderer.invoke('concept-videos:compare', input),
    cancel: (id: string) => ipcRenderer.invoke('concept-videos:cancel', id),
    adopt: (input: import('../shared/concept-video').ConceptVideoIdentity & { versionId: string }) => ipcRenderer.invoke('concept-videos:adopt', input),
    media: (input: { id: string; versionId: string }) => ipcRenderer.invoke('concept-videos:media', input),
    poster: (input: { id: string; versionId: string }) => ipcRenderer.invoke('concept-videos:poster', input),
    requestAi: (input: { id: string; baseRevision?: number; operation: 'discuss' | 'generate' }) => ipcRenderer.invoke('concept-videos:request-ai', input)
  }),
  practice: Object.freeze({
    list: () => ipcRenderer.invoke("practice:list"),
    setPinned: (input: import("../shared/practice").SetPracticePinned) => ipcRenderer.invoke("practice:set-pinned", input)
  }),
  whiteboards: Object.freeze({
    list: (search?: string) => ipcRenderer.invoke("whiteboards:list", search),
    get: (id: string) => ipcRenderer.invoke("whiteboards:get", id),
    create: (title: string) => ipcRenderer.invoke("whiteboards:create", title),
    save: (input: import("../shared/whiteboard").SaveWhiteboard) => ipcRenderer.invoke("whiteboards:save", input),
    remove: (id: string) => ipcRenderer.invoke("whiteboards:remove", id)
  }),
  chapterScratchpad: Object.freeze({
    get: (key: import("../shared/chapter-scratchpad").ChapterScratchpadKey) => ipcRenderer.invoke("chapter-scratchpad:get", key),
    save: (input: import("../shared/chapter-scratchpad").SaveChapterScratchpad) => ipcRenderer.invoke("chapter-scratchpad:save", input),
    attachments: Object.freeze({
      upload: (input: UploadReadingNoteAttachmentInput): Promise<ReadingNoteAttachmentSnapshot> => ipcRenderer.invoke("reading-notes:attachments-upload", input),
      readDataUrl: (id: string): Promise<string> => ipcRenderer.invoke("reading-notes:attachments-read", id)
    })
  }),
  library: Object.freeze({
    listBooks: (): Promise<LibraryBook[]> => ipcRenderer.invoke("library:list"),
    importBook: (): Promise<ImportBookResult> => ipcRenderer.invoke("library:import"),
    getChapterContent: (bookId: string, chapterId: string): Promise<ChapterContent> =>
      ipcRenderer.invoke("library:chapter", bookId, chapterId),
    saveReadingState: (input: SaveReadingStateInput): Promise<LibraryBook> =>
      ipcRenderer.invoke("library:save-reading-state", input),
    setShelfStatus: (input: SetShelfStatusInput): Promise<LibraryBook> =>
      ipcRenderer.invoke("library:set-shelf-status", input),
    setPinned: (input: SetBookPinnedInput): Promise<LibraryBook> =>
      ipcRenderer.invoke("library:set-pinned", input),
    deleteBook: (bookId: string): Promise<void> =>
      ipcRenderer.invoke("library:delete", bookId),
    saveReadingRange: (input: SaveReadingRangeInput): Promise<LibraryBook> =>
      ipcRenderer.invoke("library:save-range", input),
    saveAnnotations: (input: SaveAnnotationsInput): Promise<LibraryBook> =>
      ipcRenderer.invoke("library:save-annotations", input)
  }),
  readingNotes: Object.freeze({
    bookTags: Object.freeze({
      list: () => ipcRenderer.invoke("reading-notes:book-tags-list"),
      change: (input: import("../shared/contracts").ChangeBookTagInput) => ipcRenderer.invoke("reading-notes:book-tags-change", input)
    }),
    tags: Object.freeze({
      list: () => ipcRenderer.invoke("reading-notes:tags-list"),
      create: (name: string) => ipcRenderer.invoke("reading-notes:tags-create", name),
      rename: (input: { id: string; name: string }) => ipcRenderer.invoke("reading-notes:tags-rename", input),
      matchingIds: (query: ReadingNoteListInput) => ipcRenderer.invoke("reading-notes:tags-matching-ids", query),
      change: (input: import("../shared/contracts").ChangeReadingNoteTagsInput) => ipcRenderer.invoke("reading-notes:tags-change", input)
    }),
    review: Object.freeze({
      voice: Object.freeze({
        start: (input: import("../shared/review-voice").StartReviewVoiceInput) => ipcRenderer.invoke("review-voice:start", input),
        stop: (id: string) => ipcRenderer.invoke("review-voice:stop", id),
        assess: (id: string) => ipcRenderer.invoke("review-voice:assess", id),
        discard: (id: string) => ipcRenderer.invoke("review-voice:discard", id),
        onChanged: (listener: (state: import("../shared/review-voice").ReviewVoiceSnapshot) => void) => {
          const handler = (_event: Electron.IpcRendererEvent, state: import("../shared/review-voice").ReviewVoiceSnapshot) => listener(state);
          ipcRenderer.on("review-voice:state", handler);
          return () => { ipcRenderer.removeListener("review-voice:state", handler); };
        }
      }),
      summary: () => ipcRenderer.invoke("spaced-review:summary"),
      settings: () => ipcRenderer.invoke("spaced-review:settings"),
      saveSettings: (input: import("../shared/spaced-review").ReviewSettings) => ipcRenderer.invoke("spaced-review:save-settings", input),
      status: (noteId: string) => ipcRenderer.invoke("spaced-review:status", noteId),
      details: (noteId: string) => ipcRenderer.invoke("spaced-review:details", noteId),
      enroll: (noteId: string) => ipcRenderer.invoke("spaced-review:enroll", noteId),
      setPaused: (noteId: string, paused: boolean) => ipcRenderer.invoke("spaced-review:pause", { noteId, paused }),
      next: () => ipcRenderer.invoke("spaced-review:next"),
      rate: (input: import("../shared/spaced-review").RateReviewInput) => ipcRenderer.invoke("spaced-review:rate", input),
      imageFailed: (noteId: string, attachmentId: string) => ipcRenderer.invoke("spaced-review:image-failed", { noteId, attachmentId }),
      retryImages: () => ipcRenderer.invoke("spaced-review:retry-images"),
      onChanged: (listener: () => void) => {
        ipcRenderer.on("spaced-review:changed", listener);
        return () => { ipcRenderer.removeListener("spaced-review:changed", listener); };
      }
    }),
    list: (input: ReadingNoteListInput): Promise<ReadingNote[]> =>
      ipcRenderer.invoke("reading-notes:list", input),
    listPage: (input: ReadingNotePageInput): Promise<ReadingNotePage> =>
      ipcRenderer.invoke("reading-notes:list-page", input),
    activeBookTitles: (): Promise<string[]> => ipcRenderer.invoke("reading-notes:book-titles"),
    get: (noteId: string): Promise<ReadingNote | undefined> =>
      ipcRenderer.invoke("reading-notes:get", noteId),
    counts: (): Promise<ReadingNoteCounts> => ipcRenderer.invoke("reading-notes:counts"),
    beginDraft: (input: BeginReadingNoteDraftInput): Promise<{ draftId: string }> =>
      prepareBookImagesForIpc(input).then(prepared => ipcRenderer.invoke("reading-notes:begin-draft", prepared)),
    create: (input: CreateReadingNoteFromDraftInput): Promise<ReadingNote> =>
      ipcRenderer.invoke("reading-notes:create", input),
    discardDraft: (draftId: string): Promise<void> =>
      ipcRenderer.invoke("reading-notes:discard-draft", draftId),
    update: (input: UpdateReadingNoteInput): Promise<ReadingNote> =>
      ipcRenderer.invoke("reading-notes:update", input),
    trash: (noteId: string): Promise<ReadingNote> =>
      ipcRenderer.invoke("reading-notes:trash", noteId),
    restore: (noteId: string): Promise<ReadingNote> =>
      ipcRenderer.invoke("reading-notes:restore", noteId),
    emptyTrash: (): Promise<number> => ipcRenderer.invoke("reading-notes:empty-trash"),
    cardPool: Object.freeze({
      start: (noteIds: string[]) => ipcRenderer.invoke("reading-notes:card-pool-start", noteIds),
      get: () => ipcRenderer.invoke("reading-notes:card-pool-get"),
      retry: () => ipcRenderer.invoke("reading-notes:card-pool-retry")
    }),
    heptabase: Object.freeze({
      start: (noteIds: string[]) => ipcRenderer.invoke("reading-notes:heptabase-start", noteIds),
      get: () => ipcRenderer.invoke("reading-notes:heptabase-get"),
      retry: () => ipcRenderer.invoke("reading-notes:heptabase-retry")
    }),
    attachments: Object.freeze({
      upload: (input: UploadReadingNoteAttachmentInput): Promise<ReadingNoteAttachmentSnapshot> =>
        ipcRenderer.invoke("reading-notes:attachments-upload", input),
      readDataUrl: (attachmentId: string): Promise<string> =>
        ipcRenderer.invoke("reading-notes:attachments-read", attachmentId),
      copyForNote: (attachmentId: string, noteId: string): Promise<ReadingNoteAttachmentSnapshot> =>
        ipcRenderer.invoke("reading-notes:attachments-copy", { attachmentId, noteId }),
      discardStaged: (attachmentIds: string[]): Promise<number> =>
        ipcRenderer.invoke("reading-notes:attachments-discard-staged", attachmentIds)
    }),
    memoryImage: Object.freeze({
      templates: Object.freeze({
        get: (): Promise<MemoryImageTemplateSettings> =>
          ipcRenderer.invoke("reading-notes:memory-image-templates-get"),
        create: (input: CreateMemoryImageTemplateInput): Promise<MemoryImageTemplateSettings> =>
          ipcRenderer.invoke("reading-notes:memory-image-templates-create", input),
        update: (input: UpdateMemoryImageTemplateInput): Promise<MemoryImageTemplateSettings> =>
          ipcRenderer.invoke("reading-notes:memory-image-templates-update", input),
        remove: (input: MemoryImageTemplateIdentityInput): Promise<MemoryImageTemplateSettings> =>
          ipcRenderer.invoke("reading-notes:memory-image-templates-remove", input),
        setDefault: (input: SetMemoryImageTemplateDefaultInput): Promise<MemoryImageTemplateSettings> =>
          ipcRenderer.invoke("reading-notes:memory-image-templates-set-default", input)
      }),
      assign: (noteId: string, side: MemoryImageSide): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-assign", noteId, side),
      listActive: (): Promise<ReadingNoteMemoryImageSnapshot[]> =>
        ipcRenderer.invoke("reading-notes:memory-image-list-active"),
      generateMissing: (noteId: string, options?: MissingVisualOptions): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-generate-missing", noteId, options),
      getState: (noteId: string, side?: MemoryImageSide): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-get", noteId, side),
      generate: (input: GenerateReadingNoteMemoryImageInput): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-generate", input),
      adjust: (input: AdjustReadingNoteMemoryImageInput): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-adjust", input),
      revise: (input: MemoryImageDraftInput): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-revise", input),
      confirm: (input: MemoryImageDraftInput): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-confirm", input),
      discard: (noteId: string, side?: MemoryImageSide): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-discard", noteId, side),
      stop: (noteId: string): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-stop", noteId),
      remove: (noteId: string, side?: MemoryImageSide): Promise<ReadingNoteMemoryImageSnapshot> =>
        ipcRenderer.invoke("reading-notes:memory-image-remove", noteId, side),
      onStateChanged(listener: (snapshot: ReadingNoteMemoryImageSnapshot) => void) {
        const wrapped = (_event: Electron.IpcRendererEvent, snapshot: ReadingNoteMemoryImageSnapshot) =>
          listener(snapshot);
        ipcRenderer.on("reading-notes:memory-image-state", wrapped);
        return () => ipcRenderer.off("reading-notes:memory-image-state", wrapped);
      }
    }),
    ai: Object.freeze({
      startCreate: (input: StartReadingNoteDraftInput): Promise<ReadingNoteAiSnapshot> =>
        prepareBookImagesForIpc(input).then(prepared => ipcRenderer.invoke("reading-notes:ai-start-create", prepared)),
      complete: (sessionId: string): Promise<ReadingNoteAiSnapshot> =>
        ipcRenderer.invoke("reading-notes:ai-complete", sessionId),
      startEdit: (noteId: string): Promise<ReadingNoteAiSnapshot> =>
        ipcRenderer.invoke("reading-notes:ai-start-edit", noteId),
      startTransform: (draft: ReadingNoteAiDraft): Promise<ReadingNoteAiSnapshot> =>
        ipcRenderer.invoke("reading-notes:ai-start-transform", draft),
      send: (
        sessionId: string,
        request: string,
        model?: CodexChatModel
      ): Promise<ReadingNoteAiSnapshot> =>
        ipcRenderer.invoke("reading-notes:ai-send", {
          sessionId,
          request,
          ...(model ? { model } : {})
        }),
      accept: (sessionId: string, appliedContent?: string): Promise<ReadingNoteAiSnapshot> =>
        ipcRenderer.invoke("reading-notes:ai-accept", sessionId,
          ...(appliedContent === undefined ? [] : [appliedContent])),
      reject: (sessionId: string): Promise<ReadingNoteAiSnapshot> =>
        ipcRenderer.invoke("reading-notes:ai-reject", sessionId),
      stop: (sessionId: string): Promise<ReadingNoteAiSnapshot> =>
        ipcRenderer.invoke("reading-notes:ai-stop", sessionId),
      save: (sessionId: string, draft: ReadingNoteAiDraft): Promise<ReadingNote> =>
        ipcRenderer.invoke("reading-notes:ai-save", { sessionId, ...draft }),
      discard: (sessionId: string): Promise<void> =>
        ipcRenderer.invoke("reading-notes:ai-discard", sessionId),
      onStateChanged(listener: (snapshot: ReadingNoteAiSnapshot) => void) {
        const wrapped = (_event: Electron.IpcRendererEvent, snapshot: ReadingNoteAiSnapshot) =>
          listener(snapshot);
        ipcRenderer.on("reading-notes:ai-state", wrapped);
        return () => ipcRenderer.off("reading-notes:ai-state", wrapped);
      }
    })
  }),
  chat: Object.freeze({
    voice: Object.freeze({
      start: (input: import("../shared/reading-voice").StartReadingVoiceInput) => ipcRenderer.invoke("reading-voice:start", input),
      stop: (sessionId: string) => ipcRenderer.invoke("reading-voice:stop", sessionId)
    }),
    getState: (): Promise<ChatSnapshot> => ipcRenderer.invoke("chat:get"),
    connect: (): Promise<ChatSnapshot> => ipcRenderer.invoke("chat:connect"),
    sendMessage: (input: SendChatMessageInput): Promise<ChatSnapshot> =>
      prepareBookImagesForIpc(input).then(prepared => ipcRenderer.invoke("chat:send", prepared)),
    prepareReadingNoteDraft: (draftId: string) => ipcRenderer.invoke("chat:prepare-reading-note-draft", draftId),
    saveReadingNoteDraft: (input: CreateReadingNoteFromDraftInput): Promise<ReadingNote> => ipcRenderer.invoke("chat:save-reading-note-draft", input),
    submitReadingNote: (draftId: string): Promise<ChatSnapshot> =>
      ipcRenderer.invoke("chat:submit-reading-note", draftId),
    decideReadingNoteUpdate: (proposalId: string, decision: "apply" | "reject"): Promise<ChatSnapshot> =>
      ipcRenderer.invoke("chat:decide-note-update", { proposalId, decision }),
    startNewConversation: (): Promise<ChatSnapshot> => ipcRenderer.invoke("chat:new"),
    selectConversation: (conversationId: string): Promise<ChatSnapshot> =>
      ipcRenderer.invoke("chat:select", conversationId),
    removeConversation: (conversationId: string): Promise<ChatSnapshot> =>
      ipcRenderer.invoke("chat:remove", conversationId),
    stopResponse: (): Promise<ChatSnapshot> => ipcRenderer.invoke("chat:stop"),
    onStateChanged(listener: (snapshot: ChatSnapshot) => void) {
      const wrapped = (_event: Electron.IpcRendererEvent, snapshot: ChatSnapshot) =>
        listener(snapshot);
      ipcRenderer.on("chat:state", wrapped);
      return () => ipcRenderer.off("chat:state", wrapped);
    }
  })
});

contextBridge.exposeInMainWorld("readerExample", api);
