import { configureReaderPermissions } from './reader-permissions';
import { registerHeptabaseImportIpc } from "./heptabase-import-ipc";
import { registerReadingNoteTagsIpc } from "./reading-note-tags-ipc";
import { generateConversationTopicTitle } from "./conversation-topic-title";
import { ConceptVideoAi } from './concept-video-ai';
import { LocalPracticeStore } from "./practice-store";
import { ConceptVideoGenerator } from './concept-video-generator';
import { LocalConceptVideoStore } from './concept-video-store';
import { registerConceptVideoIpc } from './concept-video-ipc';
import { registerPracticeIpc } from "./practice-ipc";
import { LocalWhiteboardStore } from "./whiteboard-store";
import { registerWhiteboardIpc } from "./whiteboard-ipc";
import { ReviewVoiceController } from "./review-voice-controller";
import { registerReviewVoiceIpc } from "./review-voice-ipc";
import { readingVoiceBusy } from "../shared/reading-voice";
import { registerReadingVoiceIpc } from "./reading-voice-ipc";
import { readingNoteAttachmentIds } from "../shared/reading-note-images";
import { app, BrowserWindow, dialog, ipcMain, shell, nativeImage } from "electron";
import { createChatImageCompressor } from "./chat-image-compression";
import { mkdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import selfRetellingSkillMarkdown from "../../.agents/skills/practice-self-retelling/SKILL.md?raw";
import readingNoteSkillMarkdown from "../../.agents/skills/create-reading-note/SKILL.md?raw";
import completeReadingNoteSkillMarkdown from "../../.agents/skills/complete-reading-note/SKILL.md?raw";
import editReadingNoteSkillMarkdown from "../../.agents/skills/edit-reading-note/SKILL.md?raw";
import { registerReaderIpc, registerSpacedReviewIpc } from "./app-ipc";
import { SpacedReviewService } from "./spaced-review-service";
import { LocalChapterScratchpadStore } from "./chapter-scratchpad-store";
import { registerChapterScratchpadIpc } from "./chapter-scratchpad-ipc";
import {
  installBundledCompleteReadingNoteSkill,
  installBundledEditReadingNoteSkill,
  installBundledReadingNoteSkill,
  installBundledSelfRetellingSkill
} from "./bundled-skill";
import { ChatController } from "./chat-controller";
import { LocalChatConversationStore } from "./chat-conversation-store";
import { SpawnedCodexAppServerClient } from "./codex-app-server-client";
import { InMemoryEpubLibrary } from "./epub-library";
import { LocalReadingNoteStore } from "./reading-note-store";
import { ReadingNoteAiController } from "./reading-note-ai-controller";
import { ReadingNoteMemoryImageController } from "./reading-note-memory-image-controller";
import { LocalReadingNoteAttachmentStore } from "./reading-note-attachment-store";
import { CardNoteUploadController } from "./reading-note-upload";
import { HeptabaseImportController } from "./heptabase-import";
import { ReadingNoteDraftController } from "./reading-note-draft-controller";
import { LocalMemoryImageTemplateStore } from "./memory-image-template-store";
import { readingNoteDocumentAttachmentIds } from "../shared/reading-note-document";

let reviewVoice: ReviewVoiceController | undefined;
let mainWindow: BrowserWindow | null = null;
let chat: ChatController | undefined;
let readingNoteAi: ReadingNoteAiController | undefined;
let readingNoteMemoryImage: ReadingNoteMemoryImageController | undefined;

const appIconPath = join(
  __dirname,
  process.env.VITE_DEV_SERVER_URL ? "../src/renderer/public/app-icon.png" : "../dist-renderer/app-icon.png"
);

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: "#f5f0e7",
    icon: appIconPath,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: "no-user-gesture-required"
    }
  });
  configureReaderPermissions(window.webContents.session, window.webContents);
  const endVoice = () => { reviewVoice?.close(); const id = chat?.getSnapshot().voice?.sessionId; if (id) void chat?.stopVoice(id); };
  window.webContents.on("render-process-gone", endVoice);
  window.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) endVoice(); });
  window.on("closed", endVoice);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const current = window.webContents.getURL();
    if (url !== current) event.preventDefault();
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(__dirname, "../dist-renderer/index.html"));
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

app.whenReady().then(() => {
  if (process.platform === "darwin") app.dock?.setIcon(appIconPath);
  const library = new InMemoryEpubLibrary({
    storageDirectory: join(app.getPath("userData"), "library")
  });
  const codexWorkingDirectory = join(app.getPath("userData"), "codex-reader-context");
  mkdirSync(codexWorkingDirectory, { recursive: true });
  const selfRetellingSkill = installBundledSelfRetellingSkill(
    codexWorkingDirectory,
    selfRetellingSkillMarkdown
  );
  const readingNoteSkill = installBundledReadingNoteSkill(
    codexWorkingDirectory,
    readingNoteSkillMarkdown
  );
  const completeReadingNoteSkill = installBundledCompleteReadingNoteSkill(
    codexWorkingDirectory,
    completeReadingNoteSkillMarkdown
  );
  const editReadingNoteSkill = installBundledEditReadingNoteSkill(
    codexWorkingDirectory,
    editReadingNoteSkillMarkdown
  );
  const readingNoteStore = new LocalReadingNoteStore(
    join(app.getPath("userData"), "reading-notes")
  );
  registerReadingNoteTagsIpc(ipcMain, readingNoteStore);
  registerPracticeIpc(ipcMain, new LocalPracticeStore(join(app.getPath("userData"), "practice"), { getNote: id => readingNoteStore.get(id) }));
  registerWhiteboardIpc(ipcMain, new LocalWhiteboardStore(join(app.getPath("userData"), "whiteboards"), { getNote: id => readingNoteStore.get(id) }));
  const readingNoteAttachmentStore = new LocalReadingNoteAttachmentStore(
    join(app.getPath("userData"), "reading-notes")
  );
  const cardPoolUploads = new CardNoteUploadController(join(app.getPath("userData"), "reading-notes"), {
    get: id => readingNoteStore.get(id),
    tags: () => readingNoteStore.listTags(),
    readImage: id => readingNoteAttachmentStore.readDataUrl(id),
    baseUrl: process.env.NOTE_API_URL
  });
  const trustedCardPoolCaller = (event: import("electron").IpcMainInvokeEvent) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) throw new Error("Untrusted card pool upload caller.");
  };
  ipcMain.handle("reading-notes:card-pool-start", (event, ids: unknown) => { trustedCardPoolCaller(event); return cardPoolUploads.start(ids); });
  ipcMain.handle("reading-notes:card-pool-get", event => { trustedCardPoolCaller(event); return cardPoolUploads.get(); });
  ipcMain.handle("reading-notes:card-pool-retry", event => { trustedCardPoolCaller(event); return cardPoolUploads.retry(); });
  const memoryImageTemplateStore = new LocalMemoryImageTemplateStore(
    join(app.getPath("userData"), "reading-notes")
  );
  const reviewImageAvailability = new Map<string, { stamp: string; valid: boolean }>();
  const spacedReview = new SpacedReviewService(join(app.getPath("userData"), "reading-notes"), {
    notes: readingNoteStore,
    readImage: (id) => readingNoteAttachmentStore.readDataUrl(id),
    isImageAvailable: (id) => {
      const path = readingNoteAttachmentStore.localPath(id);
      const stat = statSync(path);
      const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const cached = reviewImageAvailability.get(id);
      if (cached?.stamp === stamp) return cached.valid;
      const valid = !nativeImage.createFromPath(path).isEmpty();
      if (reviewImageAvailability.size >= 1000) reviewImageAvailability.clear();
      reviewImageAvailability.set(id, { stamp, valid });
      return valid;
    },
    onChanged: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("spaced-review:changed");
    }
  });
  registerSpacedReviewIpc(ipcMain, spacedReview);
  for (const note of readingNoteStore.list()) {
    readingNoteAttachmentStore.reconcile(
      note.id,
      readingNoteAttachmentIds(note)
    );
  }
  const chapterScratchpads = new LocalChapterScratchpadStore(join(app.getPath("userData"), "chapter-scratchpads"), readingNoteAttachmentStore);
  const scratchpadAttachmentsReady = chapterScratchpads.reconcileAttachments();
  registerChapterScratchpadIpc(ipcMain, chapterScratchpads, async ({ bookId, chapterId }) =>
    (await library.listBooks()).some(book => book.id === bookId && book.chapters.some(chapter => chapter.id === chapterId)));
  if (scratchpadAttachmentsReady) readingNoteAttachmentStore.collectGarbage();
  const readingNoteDrafts = new ReadingNoteDraftController(
    readingNoteStore,
    randomUUID,
    readingNoteAttachmentStore
  );
  const readingNotes = {
    create: (input: Parameters<typeof readingNoteStore.create>[0]) => readingNoteStore.create(input),
    list: (input?: Parameters<typeof readingNoteStore.list>[0]) => readingNoteStore.list(input),
    listPage: (input: Parameters<typeof readingNoteStore.listPage>[0]) => readingNoteStore.listPage(input),
    activeBookTitles: () => readingNoteStore.activeBookTitles(),
    get: (noteId: string) => readingNoteStore.get(noteId),
    counts: () => readingNoteStore.counts(),
    update: (input: Parameters<typeof readingNoteStore.update>[0]) => {
      const content = readingNoteAttachmentStore.prepareDocument(input.id, input.content);
      const saved = readingNoteStore.update({ ...input, content });
      readingNoteAttachmentStore.reconcile(
        input.id,
        readingNoteAttachmentIds(saved)
      );
      spacedReview.changed();
      return saved;
    },
    trash: (noteId: string) => { const note = readingNoteStore.trash(noteId); spacedReview.changed(); return note; },
    restore: (noteId: string) => { const note = readingNoteStore.restore(noteId); spacedReview.changed(); return note; },
    emptyTrash: () => {
      const noteIds = readingNoteStore.trashedIds();
      const removed = readingNoteStore.emptyTrash();
      spacedReview.prune();
      readingNoteAttachmentStore.deleteForNotes(noteIds);
      return removed;
    }
  };
  chat = new ChatController({
    generateConversationTitle: (input, signal) => generateConversationTopicTitle(input, {
      createClient: () => new SpawnedCodexAppServerClient(), workingDirectory: codexWorkingDirectory
    }, signal),
    createClient: () => new SpawnedCodexAppServerClient(),
    compressImage: createChatImageCompressor(dataUrl => nativeImage.createFromDataURL(dataUrl)),
    workingDirectory: codexWorkingDirectory,
    selfRetellingSkillPath: selfRetellingSkill.path,
    readingNoteSkillPath: readingNoteSkill.path,
    conversationStore: new LocalChatConversationStore(
      join(app.getPath("userData"), "ai-conversations")
    ),
    readingNoteStore: readingNotes,
    readingNoteAttachmentStore
  });
  readingNoteAi = new ReadingNoteAiController({
    compressImage: createChatImageCompressor(dataUrl => nativeImage.createFromDataURL(dataUrl)),
    createClient: () => new SpawnedCodexAppServerClient(),
    workingDirectory: codexWorkingDirectory,
    completeSkillPath: completeReadingNoteSkill.path,
    completeSkillInstructions: completeReadingNoteSkillMarkdown,
    editSkillPath: editReadingNoteSkill.path,
    editSkillInstructions: editReadingNoteSkillMarkdown,
    store: readingNotes,
    getConversationContext: () => chat?.getReadingNoteConversationContext(),
    onStateChanged: (snapshot) => {
      if (!mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send("reading-notes:ai-state", snapshot);
      }
    }
  });
  readingNoteMemoryImage = new ReadingNoteMemoryImageController({
    createClient: () => new SpawnedCodexAppServerClient(),
    workingDirectory: codexWorkingDirectory,
    store: readingNoteStore,
    attachments: readingNoteAttachmentStore,
    onStateChanged: (snapshot) => {
      if (!mainWindow?.isDestroyed()) {
        mainWindow?.webContents.send("reading-notes:memory-image-state", snapshot);
      }
      if (snapshot.phase === "ready" || snapshot.phase === "error") spacedReview.changed();
    }
  });

  registerReaderIpc(
    ipcMain,
    {
      showOpenDialog: (options) => mainWindow
        ? dialog.showOpenDialog(mainWindow, options)
        : dialog.showOpenDialog(options)
    },
    library,
    chat,
    readingNotes,
    readingNoteAi,
    readingNoteDrafts,
    readingNoteAttachmentStore,
    {
      templates: {
        get: () => memoryImageTemplateStore.get(),
        create: (input) => { memoryImageTemplateStore.create(input); return memoryImageTemplateStore.get(); },
        update: (input) => { memoryImageTemplateStore.update(input); return memoryImageTemplateStore.get(); },
        remove: (input) => memoryImageTemplateStore.remove(input),
        setDefault: (input) => memoryImageTemplateStore.setDefault(input)
      },
      assign: (noteId, side) => readingNoteMemoryImage!.assign(noteId, side),
      listActive: () => readingNoteMemoryImage!.listActive(),
      getState: (noteId, side) => readingNoteMemoryImage!.getState(noteId, side),
      generate: (input) => readingNoteMemoryImage!.prepareGenerate(input),
      generateMissing: (noteId, options) => readingNoteMemoryImage!.generateMissing(noteId, options),
      adjust: (input) => readingNoteMemoryImage!.prepareAdjust(input),
      revise: (input) => readingNoteMemoryImage!.revise(input),
      confirm: (input) => readingNoteMemoryImage!.confirm(input),
      discard: (noteId, side) => readingNoteMemoryImage!.discard(noteId, side),
      stop: (noteId) => readingNoteMemoryImage!.stop(noteId),
      remove: (noteId, side) => readingNoteMemoryImage!.remove(noteId, side)
    }
  );
  const heptabaseImports = new HeptabaseImportController(join(app.getPath("userData"), "reading-notes"), {
    get: id => readingNoteStore.get(id),
    readImage: id => readingNoteAttachmentStore.readDataUrl(id)
  });
  registerHeptabaseImportIpc(ipcMain, heptabaseImports, trustedCardPoolCaller);
  reviewVoice = new ReviewVoiceController({
    createClient: () => new SpawnedCodexAppServerClient(), workingDirectory: codexWorkingDirectory,
    validateSource: context => spacedReview.validateVoiceSource(context),
    canStart: () => !readingVoiceBusy(chat?.getSnapshot().voice),
    onChanged: snapshot => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("review-voice:state", snapshot);
    }
  });
  const trustedVoiceCaller = (event: unknown) => {
    const e = event as import("electron").IpcMainInvokeEvent;
    return !!mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents && e.senderFrame === mainWindow.webContents.mainFrame;
  };
  registerReviewVoiceIpc(ipcMain, reviewVoice, trustedVoiceCaller);
  const videoStore = new LocalConceptVideoStore(join(app.getPath('userData'), 'concept-videos'));
  const videoGenerator = new ConceptVideoGenerator(videoStore);
  const videoAi = new ConceptVideoAi(videoStore, { createClient: () => new SpawnedCodexAppServerClient(), workingDirectory: codexWorkingDirectory, compressImage: createChatImageCompressor(dataUrl => nativeImage.createFromDataURL(dataUrl)) });
  app.on('before-quit', () => { videoGenerator.close(); videoAi.close(); });
  registerConceptVideoIpc(ipcMain, videoStore, {
    generator: videoGenerator, ai: videoAi,
    trusted: trustedVoiceCaller,
    sourceExists: async source => (await library.listBooks()).some(book => book.id === source.bookId && book.chapters.some(chapter => chapter.id === source.chapterId)),
    getMessages: () => chat?.getSnapshot().messages ?? []
  });
  registerReadingVoiceIpc(ipcMain, {
    startVoice: input => {
      if (reviewVoice?.busy) return Promise.reject(new Error("Finish voice review before starting reading voice."));
      return chat!.startVoice(input);
    }, stopVoice: sessionId => chat!.stopVoice(sessionId)
  }, (event) => {
    const e = event as import("electron").IpcMainInvokeEvent;
    return !!mainWindow && !mainWindow.isDestroyed() && e.sender === mainWindow.webContents && e.senderFrame === mainWindow.webContents.mainFrame;
  });
  chat.onStateChanged((snapshot) => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow?.webContents.send("chat:state", snapshot);
    }
  });

  mainWindow = createWindow();
  void chat.connect();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("before-quit", () => {
  reviewVoice?.close();
  readingNoteAi?.close();
  readingNoteMemoryImage?.close();
  chat?.close();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
