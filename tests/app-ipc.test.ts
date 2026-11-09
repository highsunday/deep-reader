import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { parseVideoSource } from "../src/shared/concept-video";
import { registerReaderIpc } from "../src/main/app-ipc";
import type { ChatSnapshot, LibraryBook } from "../src/shared/contracts";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";

const book: LibraryBook = {
  id: "book-1",
  title: "The Example Book",
  author: "Example Author",
  chapters: [{ id: "chapter-1", title: "Chapter One", href: "chapter.xhtml", order: 0 }],
  readingState: { view: "overview", chapterId: null, scrollProgress: 0 },
  chapterRanges: {},
  chapterAnnotations: {}
};

const chatSnapshot: ChatSnapshot = {
  connection: "ready",
  connectionDetail: "Connected",
  account: { type: "chatgpt", email: "reader@example.com" },
  allowance: {
    phase: "available",
    fiveHour: { remainingPercent: 75, resetsAt: 1_800_000_000 },
    weekly: { remainingPercent: 62, resetsAt: 1_800_500_000 },
    detail: "Shared account allowance loaded."
  },
  threadId: null,
  activeTurnId: null,
  messages: [],
  conversations: [],
  activeConversationId: null,
  managementBusy: false
};

function chatApi(overrides: Record<string, unknown> = {}) {
  return {
    getSnapshot: () => chatSnapshot,
    connect: vi.fn().mockResolvedValue(chatSnapshot),
    sendMessage: vi.fn().mockResolvedValue(chatSnapshot),
    submitReadingNote: vi.fn().mockReturnValue(chatSnapshot),
    startNewConversation: vi.fn().mockReturnValue(chatSnapshot),
    selectConversation: vi.fn().mockReturnValue(chatSnapshot),
    removeConversation: vi.fn().mockResolvedValue(chatSnapshot),
    stopResponse: vi.fn().mockResolvedValue(chatSnapshot),
    ...overrides
  };
}

test("the import IPC opens an EPUB-only picker and imports the selected path", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const dialog = {
    showOpenDialog: vi.fn().mockResolvedValue({
      canceled: false,
      filePaths: ["/books/example.epub"]
    })
  };
  const library = {
    listBooks: vi.fn().mockReturnValue([]),
    importFromPath: vi.fn().mockResolvedValue({ status: "imported", book }),
    getChapterContent: vi.fn(),
    saveReadingState: vi.fn(),
    setShelfStatus: vi.fn(),
    setPinned: vi.fn(),
    deleteBook: vi.fn(),
    saveReadingRange: vi.fn(),
    saveAnnotations: vi.fn()
  };
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    dialog,
    library,
    chatApi()
  );

  const result = await handlers.get("library:import")?.(undefined);
  assert.deepEqual(result, { status: "imported", book });
  assert.equal(library.importFromPath.mock.calls[0]?.[0], "/books/example.epub");
  assert.deepEqual(dialog.showOpenDialog.mock.calls[0]?.[0], {
    title: "Import EPUB",
    properties: ["openFile"],
    filters: [{ name: "EPUB books", extensions: ["epub"] }]
  });
});

test("cancelling the native EPUB picker is a safe no-op", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const library = {
    listBooks: vi.fn().mockReturnValue([]),
    importFromPath: vi.fn(),
    getChapterContent: vi.fn(),
    saveReadingState: vi.fn(),
    setShelfStatus: vi.fn(),
    setPinned: vi.fn(),
    deleteBook: vi.fn(),
    saveReadingRange: vi.fn(),
    saveAnnotations: vi.fn()
  };
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
    library,
    chatApi()
  );

  assert.deepEqual(
    await handlers.get("library:import")?.(undefined),
    { status: "cancelled" }
  );
  assert.equal(library.importFromPath.mock.calls.length, 0);
});

test("chat IPC forwards an allowed model and rejects malformed models", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const sendMessage = vi.fn().mockResolvedValue(chatSnapshot);
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState: vi.fn(),
      setShelfStatus: vi.fn(),
      setPinned: vi.fn(),
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(),
      saveAnnotations: vi.fn()
    },
    chatApi({ sendMessage })
  );

  await handlers.get("chat:send")?.(undefined, {
    text: "Explain this",
    model: "gpt-6-astra",
    quote: { text: "Selected passage" }
  });
  assert.deepEqual(sendMessage.mock.calls[0]?.[0], {
    text: "Explain this",
    model: "gpt-6-astra",
    quote: { text: "Selected passage" }
  });
  await handlers.get("chat:send")?.(undefined, {
    text: "請根據這段內容產生理解測驗",
    intent: "learningQuestionQuiz",
    context: { readingSegment: "The bounded segment." }
  });
  assert.deepEqual(sendMessage.mock.calls[1]?.[0], {
    text: "請根據這段內容產生理解測驗",
    intent: "learningQuestionQuiz",
    context: { readingSegment: "The bounded segment." }
  });
  const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  await handlers.get("chat:send")?.(undefined, {
    text: "Read the formula",
    context: { readingSegment: "[Book image 1]", images: [{ dataUrl }] }
  });
  assert.deepEqual(sendMessage.mock.calls[2]?.[0].context.images, [{ dataUrl }]);
  await handlers.get("chat:send")?.(undefined, { text: "What is shown?", images: [{ dataUrl }] });
  assert.deepEqual(sendMessage.mock.calls[3]?.[0].images, [{ dataUrl }]);
  for (const invalidImage of [
    { dataUrl: "https://example.com/image.png" },
    { dataUrl: "data:image/avif;base64,aGVsbG8=" },
    { dataUrl: "data:image/png;base64,aGVsbG8=" }
  ]) {
    await assert.rejects(async () => handlers.get("chat:send")?.(undefined, {
      text: "What is shown?", images: [invalidImage]
    }), /image/i);
  }
  await assert.rejects(async () => handlers.get("chat:send")?.(undefined, {
    text: "What is shown?", images: Array.from({ length: 5 }, () => ({ dataUrl }))
  }), /最多 4 張圖片/);
  await assert.rejects(async () => handlers.get("chat:send")?.(undefined, {
    text: "What is shown?", images: [{ dataUrl: `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")}` }]
  }), /oversized reader image/i);
  const largePng = `data:image/png;base64,${Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4 * 1024 * 1024 - 8)
  ]).toString("base64")}`;
  await assert.rejects(async () => handlers.get("chat:send")?.(undefined, {
    text: "What is shown?", images: Array.from({ length: 3 }, () => ({ dataUrl: largePng }))
  }), /Too many reader image bytes/i);
  for (const invalidImage of [
    { dataUrl: "https://example.com/formula.png" },
    { dataUrl: "data:image/avif;base64,aGVsbG8=" },
    { dataUrl: "data:image/png;base64,not-valid!" },
    { dataUrl: "data:image/png;base64,aGVsbG8=" }
  ]) {
    await assert.rejects(async () => handlers.get("chat:send")?.(undefined, {
      text: "Read the formula",
      context: { readingSegment: "[Book image 1]", images: [invalidImage] }
    }), /book image/i);
  }
  const distinctBookImages = Array.from({ length: 12 }, (_, index) => ({
    dataUrl: `data:image/png;base64,${Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from([index])
    ]).toString("base64")}`
  }));
  const manyBookImageMarkers = distinctBookImages.map((_, index) => `[Book image ${index + 1}]`).join(" ");
  await handlers.get("chat:send")?.(undefined, {
    text: "Read the formula",
    context: { readingSegment: manyBookImageMarkers, images: distinctBookImages }
  });
  assert.deepEqual(sendMessage.mock.calls[4]?.[0].context.images, distinctBookImages);
  assert.equal(sendMessage.mock.calls[4]?.[0].context.readingSegment, manyBookImageMarkers);
  await assert.rejects(async () => handlers.get("chat:send")?.(undefined, {
    text: "Read the formula",
    context: { readingSegment: "[Book image 1]", images: [{
      dataUrl: `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString("base64")}`
    }] }
  }), /oversized book image/i);
  await assert.rejects(async () => handlers.get("chat:send")?.(undefined, {
    text: "Read the formula",
    context: { readingSegment: "[Book image 1] through [Book image 6]", images: Array.from({ length: 6 }, () => ({ dataUrl: largePng })) }
  }), /Too many book image bytes/i);
  await assert.rejects(
    async () => handlers.get("chat:send")?.(undefined, {
      text: "Explain this",
      model: "invalid model\n"
    }),
    /Invalid chat model/
  );
  await assert.rejects(
    async () => handlers.get("chat:send")?.(undefined, {
      text: "Explain this",
      quote: { text: 123 }
    }),
    /Invalid chat quote/
  );
  await handlers.get("chat:send")?.(undefined, {
    text: "Follow up",
    readingSource: { bookTitle: "Book", chapterTitle: "Chapter", readingSegment: "Entire segment" }
  });
  assert.deepEqual(sendMessage.mock.lastCall?.[0].readingSource, {
    bookTitle: "Book", chapterTitle: "Chapter", readingSegment: "Entire segment"
  });
  await assert.rejects(async () => handlers.get("chat:send")?.(undefined, {
    text: "Follow up",
    readingSource: { bookTitle: "Book", chapterTitle: "Chapter", readingSegment: "" }
  }), /Invalid reading source snapshot/);
});

test("chat IPC forwards reading-segment shortcut intents and rejects unknown intents", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const sendMessage = vi.fn().mockResolvedValue(chatSnapshot);
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState: vi.fn(),
      setShelfStatus: vi.fn(),
      setPinned: vi.fn(),
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(),
      saveAnnotations: vi.fn()
    },
    chatApi({ sendMessage })
  );

  await handlers.get("chat:send")?.(undefined, {
    text: "請為這段產生導讀",
    intent: "readingGuide",
    context: { readingSegment: "The bounded segment." }
  });
  assert.deepEqual(sendMessage.mock.calls[0]?.[0], {
    text: "請為這段產生導讀",
    intent: "readingGuide",
    context: { readingSegment: "The bounded segment." }
  });
  await handlers.get("chat:send")?.(undefined, {
    text: "請讓我用自己的話復述這段內容",
    intent: "selfRetelling",
    context: { readingSegment: "The bounded segment." }
  });
  assert.deepEqual(sendMessage.mock.calls[1]?.[0], {
    text: "請讓我用自己的話復述這段內容",
    intent: "selfRetelling",
    context: { readingSegment: "The bounded segment." }
  });
  await assert.rejects(
    async () => handlers.get("chat:send")?.(undefined, {
      text: "Unknown shortcut",
      intent: "summarizeTheWholeBook"
    }),
    /Invalid chat intent/
  );
});

test("chat IPC manages saved conversations and validates identifiers", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const startNewConversation = vi.fn().mockReturnValue(chatSnapshot);
  const selectConversation = vi.fn().mockReturnValue(chatSnapshot);
  const removeConversation = vi.fn().mockResolvedValue(chatSnapshot);
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState: vi.fn(),
      setShelfStatus: vi.fn(),
      setPinned: vi.fn(),
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(),
      saveAnnotations: vi.fn()
    },
    chatApi({ startNewConversation, selectConversation, removeConversation })
  );

  await handlers.get("chat:new")?.(undefined);
  await handlers.get("chat:select")?.(undefined, "conversation-1");
  await handlers.get("chat:remove")?.(undefined, "conversation-1");
  assert.equal(startNewConversation.mock.calls.length, 1);
  assert.deepEqual(selectConversation.mock.calls[0], ["conversation-1"]);
  assert.deepEqual(removeConversation.mock.calls[0], ["conversation-1"]);
  await assert.rejects(
    async () => handlers.get("chat:select")?.(undefined, ""),
    /Invalid AI conversation identifier/
  );
});

test("chat IPC forwards the stop-response action", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const stopResponse = vi.fn().mockResolvedValue(chatSnapshot);
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState: vi.fn(),
      setShelfStatus: vi.fn(),
      setPinned: vi.fn(),
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(),
      saveAnnotations: vi.fn()
    },
    chatApi({ stopResponse })
  );
  await handlers.get("chat:stop")?.(undefined);
  assert.equal(stopResponse.mock.calls.length, 1);
});

test("chat IPC submits reading notes by draft id only", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const submitReadingNote = vi.fn().mockReturnValue(chatSnapshot);
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState: vi.fn(),
      setShelfStatus: vi.fn(),
      setPinned: vi.fn(),
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(),
      saveAnnotations: vi.fn()
    },
    chatApi({ submitReadingNote })
  );

  await handlers.get("chat:submit-reading-note")?.(undefined, "draft-1");
  assert.deepEqual(submitReadingNote.mock.calls[0], ["draft-1"]);
  await assert.rejects(
    async () => handlers.get("chat:submit-reading-note")?.(undefined, " "),
    /Invalid reading-note draft identifier/
  );
  await assert.rejects(
    async () => handlers.get("chat:submit-reading-note")?.(undefined, {
      draftId: "draft-1",
      prompt: "Renderer must not supply content"
    }),
    /Invalid reading-note draft identifier/
  );
});

test("reading-note Library IPC validates queries and exposes lifecycle actions without create authority", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const readingNotes = {
    list: vi.fn().mockReturnValue([]),
    listPage: vi.fn().mockReturnValue({ items: [] }),
    activeBookTitles: vi.fn().mockReturnValue([]),
    get: vi.fn(),
    counts: vi.fn().mockReturnValue({ active: 0, trashed: 0 }),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    emptyTrash: vi.fn().mockReturnValue(0)
  };
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState: vi.fn(),
      setShelfStatus: vi.fn(),
      setPinned: vi.fn(),
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(),
      saveAnnotations: vi.fn()
    },
    chatApi(),
    readingNotes
  );

  await handlers.get("reading-notes:list")?.(undefined, {
    status: "active",
    search: " feedback ",
    bookTitle: "Thinking in Systems",
    sort: "alphabetical"
  });
  assert.deepEqual(readingNotes.list.mock.calls[0]?.[0], {
    status: "active",
    search: "feedback",
    bookTitle: "Thinking in Systems",
    sort: "alphabetical"
  });
  await handlers.get("reading-notes:list-page")?.(undefined, {
    status: "active", sort: "recent", cursor: "opaque_2"
  });
  assert.deepEqual(readingNotes.listPage.mock.calls[0]?.[0], {
    status: "active", sort: "recent", cursor: "opaque_2"
  });
  await handlers.get("reading-notes:book-titles")?.(undefined);
  assert.equal(readingNotes.activeBookTitles.mock.calls.length, 1);
  await assert.rejects(async () => handlers.get("reading-notes:list-page")?.(undefined, {
    status: "active", sort: "recent", cursor: "bad!"
  }), /cursor/i);
  await handlers.get("reading-notes:trash")?.(undefined, "note-1");
  await handlers.get("reading-notes:restore")?.(undefined, "note-1");
  await handlers.get("reading-notes:empty-trash")?.(undefined);
  assert.deepEqual(readingNotes.trash.mock.calls[0], ["note-1"]);
  assert.deepEqual(readingNotes.restore.mock.calls[0], ["note-1"]);
  assert.equal(readingNotes.emptyTrash.mock.calls.length, 1);
  assert.equal(handlers.has("reading-notes:create"), false);

  for (const invalid of [
    { status: "deleted", sort: "recent" },
    { status: "active", sort: "unknown" },
    { status: "trashed", sort: "recent", search: "not allowed" }
  ]) {
    await assert.rejects(
      async () => handlers.get("reading-notes:list")?.(undefined, invalid),
      /Invalid reading-note query/
    );
  }
  await assert.rejects(
    async () => handlers.get("reading-notes:trash")?.(undefined, { id: "note-1" }),
    /Invalid reading-note identifier/
  );
});

test("reading-note drafting IPC separates source-backed completion from content-only editing", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const readingNotes = {
    list: vi.fn().mockReturnValue([]),
    listPage: vi.fn().mockReturnValue({ items: [] }),
    activeBookTitles: vi.fn().mockReturnValue([]),
    get: vi.fn(),
    counts: vi.fn().mockReturnValue({ active: 0, trashed: 0 }),
    update: vi.fn(),
    trash: vi.fn(),
    restore: vi.fn(),
    emptyTrash: vi.fn().mockReturnValue(0)
  };
  const noteAi = {
    startCreate: vi.fn().mockReturnValue({ sessionId: "session-1" }),
    complete: vi.fn().mockResolvedValue({ sessionId: "session-1" }),
    startEdit: vi.fn().mockReturnValue({ sessionId: "session-2" }),
    startTransform: vi.fn().mockReturnValue({ sessionId: "session-3" }),
    send: vi.fn().mockResolvedValue({ sessionId: "session-2" }),
    accept: vi.fn().mockReturnValue({ sessionId: "session-2" }),
    reject: vi.fn().mockReturnValue({ sessionId: "session-2" }),
    stop: vi.fn().mockResolvedValue({ sessionId: "session-2" }),
    save: vi.fn(),
    discard: vi.fn()
  };
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState: vi.fn(),
      setShelfStatus: vi.fn(),
      setPinned: vi.fn(),
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(),
      saveAnnotations: vi.fn()
    },
    chatApi(),
    readingNotes,
    noteAi
  );

  await handlers.get("reading-notes:ai-start-create")?.(undefined, {
    bookTitle: "Trusted book",
    chapterTitle: "Trusted chapter",
    readingSegment: "Bounded text",
    userDraft: "My thought"
  });
  const sourceImage = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
  await handlers.get("reading-notes:ai-start-create")?.(undefined, {
    bookTitle: "Trusted book", chapterTitle: "Trusted chapter",
    readingSegment: "[Book image 1]", userDraft: "Explain this figure", images: [sourceImage]
  });
  await assert.rejects(async () => handlers.get("reading-notes:ai-start-create")?.(undefined, {
    bookTitle: "Trusted book", chapterTitle: "Trusted chapter",
    readingSegment: "[Book image 1]", userDraft: "Explain this figure",
    images: [{ dataUrl: "https://example.com/remote.png" }]
  }), /image/i);
  await handlers.get("reading-notes:ai-complete")?.(undefined, "session-1");
  await handlers.get("reading-notes:ai-start-edit")?.(undefined, "note-1");
  await handlers.get("reading-notes:ai-send")?.(undefined, {
    sessionId: "session-2",
    request: "Make it clearer",
    model: "gpt-6-astra"
  });
  await handlers.get("reading-notes:ai-accept")?.(undefined, "session-2");
  await handlers.get("reading-notes:ai-accept")?.(undefined, "session-2", "![figure](reading-note-asset:asset-1)");
  await handlers.get("reading-notes:ai-reject")?.(undefined, "session-2");
  await handlers.get("reading-notes:ai-save")?.(undefined, {
    sessionId: "session-2",
    title: "Title",
    content: "Content"
  });
  assert.deepEqual(noteAi.startCreate.mock.calls[0]?.[0], {
    bookTitle: "Trusted book",
    chapterTitle: "Trusted chapter",
    readingSegment: "Bounded text",
    userDraft: "My thought"
  });
  assert.deepEqual(noteAi.startCreate.mock.calls[1]?.[0]?.images, [sourceImage]);
  assert.deepEqual(noteAi.send.mock.calls[0], ["session-2", "Make it clearer", "gpt-6-astra"]);
  assert.deepEqual(noteAi.accept.mock.calls[0], ["session-2"]);
  assert.deepEqual(noteAi.accept.mock.calls[1], ["session-2", "![figure](reading-note-asset:asset-1)"]);
  assert.deepEqual(noteAi.reject.mock.calls[0], ["session-2"]);
  assert.deepEqual(noteAi.save.mock.calls[0], ["session-2", {
    title: "Title",
    content: "Content"
  }]);

  await assert.rejects(
    async () => handlers.get("reading-notes:ai-send")?.(undefined, {
      sessionId: "session-2",
      request: "Make it clearer",
      model: "invalid model\n"
    }),
    /Invalid reading-note AI model/
  );

  await handlers.get("reading-notes:update")?.(undefined, {
    id: "note-1",
    baseRevision: 1,
    title: "Manual title",
    content: markdownToReadingNoteDocument("Manual content")
  });
  assert.deepEqual(readingNotes.update.mock.calls[0]?.[0], {
    id: "note-1",
    baseRevision: 1,
    title: "Manual title",
    content: markdownToReadingNoteDocument("Manual content")
  });

  await assert.rejects(
    async () => handlers.get("reading-notes:ai-save")?.(undefined, {
      sessionId: "session-2",
      title: "Title",
      content: "Content",
      bookTitle: "Renderer must not override source"
    }),
    /Invalid reading-note AI save/
  );
  await assert.rejects(
    async () => handlers.get("reading-notes:update")?.(undefined, {
      id: "note-1",
      baseRevision: 1,
      title: "Title",
      content: markdownToReadingNoteDocument("Content"),
      chapterTitle: "Renderer must not override source"
    }),
    /Invalid reading-note update/
  );
});

test("annotation IPC forwards chapter highlights and rejects malformed payloads", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const saveAnnotations = vi.fn().mockResolvedValue(book);
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState: vi.fn(),
      setShelfStatus: vi.fn(),
      setPinned: vi.fn(),
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(),
      saveAnnotations
    },
    chatApi()
  );

  const input = {
    bookId: "book-1",
    chapterId: "chapter-1",
    annotations: [{ id: "a1", start: 0, end: 4, text: "idea" }]
  };
  await handlers.get("library:save-annotations")?.(undefined, input);
  assert.deepEqual(saveAnnotations.mock.calls[0]?.[0], input);
  await assert.rejects(
    async () => handlers.get("library:save-annotations")?.(undefined, {
      bookId: "book-1",
      chapterId: "chapter-1",
      annotations: "invalid"
    }),
    /Invalid annotations/
  );
});

test("library IPC saves complete reading state, deletes books, and rejects invalid input", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const saveReadingState = vi.fn().mockResolvedValue({
    ...book,
    lastChapterId: "chapter-1",
    readingState: { view: "reader", chapterId: "chapter-1", scrollProgress: 0.5 }
  });
  const deleteBook = vi.fn().mockResolvedValue(undefined);
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([book]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState,
      setShelfStatus: vi.fn(),
      setPinned: vi.fn(),
      deleteBook,
      saveReadingRange: vi.fn(),
      saveAnnotations: vi.fn()
    },
    chatApi()
  );

  const readingState = {
    bookId: "book-1",
    view: "reader",
    chapterId: "chapter-1",
    scrollProgress: 0.5
  };
  await handlers.get("library:save-reading-state")?.(undefined, readingState);
  await handlers.get("library:delete")?.(undefined, "book-1");
  assert.deepEqual(saveReadingState.mock.calls[0]?.[0], readingState);
  assert.deepEqual(deleteBook.mock.calls[0], ["book-1"]);
  for (const invalid of [
    null,
    { ...readingState, view: "contents" },
    { ...readingState, chapterId: 42 },
    { ...readingState, scrollProgress: "half" }
  ]) {
    await assert.rejects(
      async () => handlers.get("library:save-reading-state")?.(undefined, invalid),
      /Invalid reading state/
    );
  }
  for (const invalid of ["", "   ", 42]) {
    await assert.rejects(
      async () => handlers.get("library:delete")?.(undefined, invalid),
      /Invalid book identifier/
    );
  }
  assert.equal(deleteBook.mock.calls.length, 1);
});

test("library IPC forwards valid pin state and rejects malformed requests", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const setPinned = vi.fn().mockResolvedValue({ ...book, pinned: true });
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() },
    {
      listBooks: vi.fn().mockReturnValue([book]),
      importFromPath: vi.fn(),
      getChapterContent: vi.fn(),
      saveReadingState: vi.fn(),
      setShelfStatus: vi.fn(),
      setPinned,
      deleteBook: vi.fn(),
      saveReadingRange: vi.fn(),
      saveAnnotations: vi.fn()
    },
    chatApi()
  );

  const input = { bookId: "book-1", pinned: true };
  await handlers.get("library:set-pinned")?.(undefined, input);
  assert.deepEqual(setPinned.mock.calls[0]?.[0], input);
  for (const invalid of [
    null,
    { bookId: "", pinned: true },
    { bookId: "book-1", pinned: "yes" },
    { bookId: "book-1" }
  ]) {
    await assert.rejects(
      async () => handlers.get("library:set-pinned")?.(undefined, invalid),
      /Invalid pinned state/
    );
  }
  assert.equal(setPinned.mock.calls.length, 1);
});


test('B63 reading requests and video snapshots share per-image validation, with separate aggregate budgets', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const chat = chatApi();
  registerReaderIpc({ handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() }, {
      listBooks: vi.fn(), importFromPath: vi.fn(), getChapterContent: vi.fn(),
      saveReadingState: vi.fn(), setShelfStatus: vi.fn(), setPinned: vi.fn(), deleteBook: vi.fn(),
      saveReadingRange: vi.fn(), saveAnnotations: vi.fn()
    }, chat);
  const png = (size: number) => {
    const data = Buffer.alloc(size);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(data);
    return { dataUrl: `data:image/png;base64,${data.toString('base64')}` };
  };
  const context = { bookTitle: 'Book', chapterTitle: 'Chapter', readingSegment: 'Equations' };
  const source = { ...context, bookId: 'b', chapterId: 'c', range: { start: 0, end: 2 } };
  const exact = Array.from({ length: 4 }, () => png(5 * 1024 * 1024));
  // Add one byte to the total without exceeding the per-image limit.
  const oversized = [...exact.slice(0, 3), png(5 * 1024 * 1024 - 7), png(8)];
  for (const images of [Array.from({ length: 9 }, () => png(2 * 1024 * 1024)), exact]) {
    await handlers.get('chat:send')!(undefined, { text: 'Explain', context: { ...context, images } });
    assert.deepEqual(parseVideoSource({ ...source, images }).images, images);
  }
  assert.throws(() => handlers.get('chat:send')!(undefined, { text: 'Explain', context: { ...context, images: oversized } }));
  assert.equal(parseVideoSource({ ...source, images: oversized }).images.length, oversized.length);
  for (const images of [[png(5 * 1024 * 1024 + 1)],
    [{ dataUrl: 'data:image/png;base64,AAAA' }], [{ dataUrl: 'data:image/png;base64,iVBORw0KGgp=' }]]) {
    assert.throws(() => handlers.get('chat:send')!(undefined, { text: 'Explain', context: { ...context, images } }));
    assert.throws(() => parseVideoSource({ ...source, images }));
  }
});

test('F63: IPC accepts only note IDs and candidate decisions; rejects forged snapshots and payloads', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const chat = chatApi({ decideReadingNoteUpdate: vi.fn().mockReturnValue(chatSnapshot) });
  registerReaderIpc({ handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() }, { listBooks: vi.fn(), importFromPath: vi.fn(), getChapterContent: vi.fn(), saveReadingState: vi.fn(), setShelfStatus: vi.fn(), setPinned: vi.fn(), deleteBook: vi.fn(), saveReadingRange: vi.fn(), saveAnnotations: vi.fn() }, chat);
  await handlers.get('chat:send')!(undefined, { text: '討論 A', noteReferenceIds: ['a', 'a', 'c'] });
  assert.deepEqual(chat.sendMessage.mock.calls[0]?.[0].noteReferenceIds, ['a', 'c']);
  for (const value of [null, 'a', [''], [12], ['x'.repeat(201)]]) {
    assert.throws(() => handlers.get('chat:send')!(undefined, { text: '討論', noteReferenceIds: value }));
  }
  for (const extra of [{ noteReferences: [{ id: 'a', revision: 99 }] }, { noteUpdates: [] }]) {
    assert.throws(() => handlers.get('chat:send')!(undefined, { text: '討論', ...extra }));
  }
  assert.deepEqual(handlers.get('chat:decide-note-update')!(undefined, { proposalId: 'p', decision: 'apply' }), chatSnapshot);
  for (const value of [{ proposalId: 'p', decision: 'write' }, { proposalId: '', decision: 'apply' }, { proposalId: 'p', decision: 'apply', content: 'forged' }]) {
    assert.throws(() => handlers.get('chat:decide-note-update')!(undefined, value));
  }
});


test('F77 TC6: shelf status IPC accepts unread and rejects unknown states', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const setShelfStatus = vi.fn();
  registerReaderIpc({ handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() }, {
      listBooks: vi.fn(), importFromPath: vi.fn(), getChapterContent: vi.fn(),
      saveReadingState: vi.fn(), setShelfStatus, setPinned: vi.fn(), deleteBook: vi.fn(),
      saveReadingRange: vi.fn(), saveAnnotations: vi.fn()
    }, chatApi());
  const handler = handlers.get('library:set-shelf-status')!;
  await handler(undefined, { bookId: 'book-1', status: 'unread' });
  assert.deepEqual(setShelfStatus.mock.calls[0][0], { bookId: 'book-1', status: 'unread' });
  for (const status of ['unknown', '', null]) {
    await assert.rejects(async () => handler(undefined, { bookId: 'book-1', status }), /Invalid shelf status/);
  }
  assert.equal(setShelfStatus.mock.calls.length, 1);
});
