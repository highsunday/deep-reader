import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";
import { LocalReadingNoteStore } from "../src/main/reading-note-store";
import { ReadingNoteMemoryImageController } from "../src/main/reading-note-memory-image-controller";
import { registerReaderIpc } from "../src/main/app-ipc";
import type { CodexAppServerClient, CodexNotification } from "../src/main/codex-app-server-client";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function createNote(store: LocalReadingNoteStore) {
  return store.create({
    sourceDraftId: "draft-1",
    title: "Delayed feedback overshoots",
    content: markdownToReadingNoteDocument("A correction arrives after the system crosses its target."),
    bookTitle: "Thinking in Systems",
    chapterTitle: "Feedback"
  });
}

test("F34 TC1: two sides survive reload, text edits, trash and removing only recall", async () => {
  const directory = await mkdtemp(join(tmpdir(), "two-sided-notes-"));
  try {
    let store = new LocalReadingNoteStore(directory);
    const note = createNote(store);
    const recall = store.setMemoryImage({ id: note.id, baseRevision: 1, side: "recall", attachmentId: "recall-image" });
    const both = store.setMemoryImage({ id: note.id, baseRevision: recall.revision, side: "understand", attachmentId: "understand-image" });
    assert.equal(both.memoryImages?.recall?.attachmentId, "recall-image");
    assert.equal(both.memoryImages?.understand?.attachmentId, "understand-image");
    store.update({ id: note.id, baseRevision: both.revision, title: note.title, content: note.content });
    store.trash(note.id); store.restore(note.id);
    store = new LocalReadingNoteStore(directory);
    const loaded = store.get(note.id)!;
    const removed = store.removeMemoryImage({ id: note.id, baseRevision: loaded.revision, side: "recall" });
    assert.equal(removed.memoryImages?.recall, undefined);
    assert.equal(removed.memoryImages?.understand?.attachmentId, "understand-image");
    assert.deepEqual(removed.content, note.content);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("F34 TC2: v6 known-purpose image migrates to understanding without copying to recall", async () => {
  const directory = await mkdtemp(join(tmpdir(), "two-sided-migration-"));
  try {
    const store = new LocalReadingNoteStore(directory);
    const note = createNote(store);
    await writeFile(join(directory, "reading-notes.json"), JSON.stringify({ version: 6, notes: [{ ...note,
      memoryImage: { attachmentId: "old-understand", basedOnRevision: 1, recipe: {
        purpose: { id: "purpose-concept-structure", name: "Structure", prompt: "Explain ideas" },
        style: { name: "Vector", prompt: "Use shapes" }, adjustments: []
      } }
    }] }));
    const migrated = new LocalReadingNoteStore(directory).get(note.id)!;
    assert.equal(migrated.memoryImages?.understand?.attachmentId, "old-understand");
    assert.equal(migrated.memoryImages?.recall, undefined);
    assert.equal(migrated.memoryImage, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("version 4 notes migrate without inventing a memory image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-memory-migration-"));
  try {
    const legacy = {
      version: 4,
      notes: [{
        id: "note-1",
        sourceDraftId: "draft-1",
        title: "Legacy note",
        content: markdownToReadingNoteDocument("Existing content."),
        bookTitle: "Book",
        chapterTitle: "Chapter",
        createdAt: 10,
        updatedAt: 20,
        revision: 3,
        trashedAt: 30
      }]
    };
    await writeFile(join(directory, "reading-notes.json"), JSON.stringify(legacy));
    const store = new LocalReadingNoteStore(directory);
    assert.equal(store.list()[0]?.memoryImage, undefined);
    store.restore("note-1");
    const persisted = JSON.parse(await readFile(join(directory, "reading-notes.json"), "utf8"));
    assert.equal(persisted.version, 8);
    assert.deepEqual(persisted.tags, []);
    assert.equal(persisted.notes[0].title, "Legacy note");
    assert.equal(persisted.notes[0].memoryImage, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the store binds one memory image to the exact saved revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-memory-store-"));
  try {
    const store = new LocalReadingNoteStore(directory, {
      createId: () => "note-1",
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(20)
    });
    const note = createNote(store);
    const saved = store.setMemoryImage({
      id: note.id,
      baseRevision: note.revision,
      attachmentId: "asset-1",
      revisedPrompt: "A delayed steering wheel"
    });
    assert.deepEqual(saved.memoryImage, {
      attachmentId: "asset-1",
      basedOnRevision: 1,
      revisedPrompt: "A delayed steering wheel"
    });
    assert.equal(saved.revision, 2);
    assert.throws(() => store.setMemoryImage({
      id: note.id,
      baseRevision: 1,
      attachmentId: "asset-stale"
    }), /changed/i);
    assert.equal(store.get(note.id)?.memoryImage?.attachmentId, "asset-1");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the store persists the exact purpose, style, and adjustment recipe used by an image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-memory-recipe-"));
  try {
    const store = new LocalReadingNoteStore(directory, {
      createId: () => "note-1",
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(20)
    });
    const note = createNote(store);
    const recipe = {
      purpose: { id: "purpose-custom", name: "Concept ladder", prompt: "Arrange ideas as steps." },
      style: { id: "style-custom", name: "Blueprint", prompt: "Use cyan blueprint lines." },
      extraInstruction: "Put the cause at the bottom.",
      adjustments: ["Make the top step brighter."]
    };
    const saved = store.setMemoryImage({
      id: note.id,
      baseRevision: note.revision,
      attachmentId: "asset-1",
      revisedPrompt: "Codex revised prompt",
      recipe
    });

    assert.deepEqual(saved.memoryImage?.recipe, recipe);
    const persisted = JSON.parse(await readFile(join(directory, "reading-notes.json"), "utf8"));
    assert.equal(persisted.version, 8);
    assert.deepEqual(persisted.tags, []);
    assert.deepEqual(persisted.notes[0].memoryImage.recipe, recipe);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the store removes only the memory image at the exact saved revision", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-memory-remove-"));
  try {
    const store = new LocalReadingNoteStore(directory, {
      createId: () => "note-1",
      now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(20).mockReturnValueOnce(30).mockReturnValueOnce(40)
    });
    const note = createNote(store);
    const withImage = store.setMemoryImage({
      id: note.id,
      baseRevision: note.revision,
      attachmentId: "asset-1"
    });
    const removed = store.removeMemoryImage({ id: note.id, baseRevision: withImage.revision });
    assert.equal(removed.memoryImage, undefined);
    assert.equal(removed.revision, 3);
    assert.equal(removed.title, note.title);
    assert.deepEqual(removed.content, note.content);
    assert.equal(removed.bookTitle, note.bookTitle);
    assert.throws(() => store.removeMemoryImage({
      id: note.id,
      baseRevision: withImage.revision
    }), /changed/i);
    const latest = store.get(note.id)!;
    store.trash(note.id);
    assert.throws(() => store.removeMemoryImage({
      id: note.id,
      baseRevision: latest.revision + 1
    }), /active/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class ImageClient implements CodexAppServerClient {
  readonly requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  readonly events = new EventEmitter();
  constructor(private readonly capability = true, private readonly result = onePixelPng.toString("base64"), private readonly draftText?: string, private readonly automaticDraft = true) {}
  private preparing = false;
  async initialize() {}
  async readAccount() { return { account: { type: "chatgpt" }, requiresOpenaiAuth: false }; }
  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === "modelProvider/capabilities/read") return { imageGeneration: this.capability };
    if (method === "thread/start") { this.preparing = (params?.config as Record<string, unknown>)?.["features.image_generation"] === false; return { thread: { id: "thread-image" } }; }
    if (method === "turn/start") {
      const draftText = this.draftText ?? (this.preparing && this.automaticDraft ? "A concrete mnemonic" : undefined);
      setTimeout(() => {
        this.events.emit("notification", {
          method: "item/completed",
          params: {
            threadId: "thread-image",
            turnId: "turn-image",
            item: draftText !== undefined ? { id: "text-1", type: "agentMessage", phase: "final_answer", text: draftText } : {
              id: "image-1",
              type: "imageGeneration",
              status: "completed",
              revisedPrompt: "A concrete mnemonic",
              result: this.result,
              failure: null
            }
          }
        } satisfies CodexNotification);
        this.events.emit("notification", {
          method: "turn/completed",
          params: { threadId: "thread-image", turnId: "turn-image", turn: { id: "turn-image", status: "completed" } }
        } satisfies CodexNotification);
      }, 0);
      return { turn: { id: "turn-image" } };
    }
    if (method === "turn/interrupt") return {};
    throw new Error(`Unexpected request: ${method}`);
  }
  onNotification(listener: (notification: CodexNotification) => void) {
    this.events.on("notification", listener);
    return () => this.events.off("notification", listener);
  }
  onExit(listener: (error: Error) => void) {
    this.events.on("exit", listener);
    return () => this.events.off("exit", listener);
  }
  close() {}
}

async function generateReviewed(controller: ReadingNoteMemoryImageController, input: Parameters<ReadingNoteMemoryImageController["prepareGenerate"]>[0]) {
  const prepared = await controller.prepareGenerate(input);
  if (!prepared.draft || prepared.phase !== "ready") return prepared;
  return controller.confirm({ noteId: prepared.noteId, draftId: prepared.draft.id, text: prepared.draft.text });
}

async function adjustReviewed(controller: ReadingNoteMemoryImageController, input: Parameters<ReadingNoteMemoryImageController["prepareAdjust"]>[0]) {
  const prepared = await controller.prepareAdjust(input);
  if (!prepared.draft || prepared.phase !== "ready") return prepared;
  return controller.confirm({ noteId: prepared.noteId, draftId: prepared.draft.id, text: prepared.draft.text });
}

test("B37 completed image saves without waiting for turn completion", async () => {
  vi.useFakeTimers();
  try {
    for (const adjust of [false, true]) {
      const client = new ImageClient();
      const subscribe = client.onNotification.bind(client);
      client.onNotification = listener => subscribe(event => {
        if (event.method !== "turn/completed") listener(event);
      });
      const note = { id: "note", sourceDraftId: "draft", title: "Title", content: markdownToReadingNoteDocument("Content"), bookTitle: "Book", chapterTitle: "Chapter", createdAt: 1, updatedAt: 1, revision: 1, memoryImage: { attachmentId: "old", basedOnRevision: 1 } };
      const save = vi.fn((input) => ({ ...note, revision: 2, memoryImage: { attachmentId: input.attachmentId, basedOnRevision: 1 } }));
      const controller = new ReadingNoteMemoryImageController({
        createClient: () => client, workingDirectory: "/runtime",
        store: { get: () => note, setMemoryImage: save, removeMemoryImage: vi.fn() },
        attachments: { localPath: () => "/managed/old.png", stage: vi.fn(() => ({ id: "new", name: "image.png", mimeType: "image/png" as const, size: onePixelPng.length, url: "reading-note-asset:new" })), reconcile: vi.fn(), discardStaged: vi.fn() }
      });
      try {
        const running = adjust
          ? controller.prepareAdjust({ noteId: note.id, instruction: "Use blue", generationMode: "direct" })
          : controller.prepareGenerate({ noteId: note.id, purpose: { name: "Purpose", prompt: "Explain" }, style: { name: "Style", prompt: "Blue" }, generationMode: "direct" });
        await vi.advanceTimersByTimeAsync(10);
        assert.equal(save.mock.calls.length, 1, "a final image must be saved before the 120-second turn timeout");
        const result = await running;
        assert.equal(result.phase, "ready");
        assert.equal(result.note?.memoryImage?.attachmentId, "new");
        assert.deepEqual(result.completion?.sides, ["recall"]);
      } finally { controller.close(); }
    }
  } finally { vi.useRealTimers(); }
});

test("B37 incomplete and foreign images cannot finish work; terminal failure preserves the old image", async () => {
  vi.useFakeTimers();
  try {
    for (const mode of ["in-progress", "foreign", "failure", "stale", "stopped"] as const) {
      const client = new ImageClient();
      const note = { id: "note", sourceDraftId: "draft", title: "Title", content: markdownToReadingNoteDocument("Content"), bookTitle: "Book", chapterTitle: "Chapter", createdAt: 1, updatedAt: 1, revision: 1, memoryImage: { attachmentId: "old", basedOnRevision: 1 } };
      const save = vi.fn();
      const subscribe = client.onNotification.bind(client);
      let controller: ReadingNoteMemoryImageController;
      client.onNotification = listener => subscribe(event => {
        if (event.method === "turn/completed") return;
        const params = event.params as { turnId: string; item: Record<string, unknown> };
        if (mode === "in-progress") params.item.status = "in_progress";
        if (mode === "foreign") params.turnId = "another-turn";
        if (mode === "failure") { params.item.status = "failed"; params.item.failure = { resetsAt: 123 }; }
        if (mode === "stale") note.revision++;
        if (mode === "stopped") void controller.stop(note.id);
        listener(event);
      });
      controller = new ReadingNoteMemoryImageController({
        createClient: () => client, workingDirectory: "/runtime",
        store: { get: () => note, setMemoryImage: save, removeMemoryImage: vi.fn() },
        attachments: { localPath: () => "/managed/old.png", stage: vi.fn(() => ({ id: "new", name: "image.png", mimeType: "image/png" as const, size: onePixelPng.length, url: "reading-note-asset:new" })), reconcile: vi.fn(), discardStaged: vi.fn(() => 1) }
      });
      try {
        let finished = false;
        const running = controller.prepareAdjust({ noteId: note.id, instruction: "Blue", generationMode: "direct" }).then(result => { finished = true; return result; });
        await vi.advanceTimersByTimeAsync(10);
        if (mode === "in-progress" || mode === "foreign") {
          assert.equal(finished, false);
          await controller.stop(note.id);
        }
        const result = await running;
        assert.equal(result.phase, "error");
        if (mode === "failure") assert.equal(result.resetsAt, 123);
        assert.equal(save.mock.calls.length, 0);
        assert.equal(note.memoryImage.attachmentId, "old");
      } finally { controller.close(); }
    }
  } finally { vi.useRealTimers(); }
});

test("active generations remain queryable when a renderer reloads", async () => {
  const note = {
    id: "note-reload", sourceDraftId: "draft-1", title: "Reload-safe progress",
    content: markdownToReadingNoteDocument("The main process owns ongoing image work."),
    bookTitle: "Book", chapterTitle: "Chapter", createdAt: 1, updatedAt: 1, revision: 1
  };
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const controller = new ReadingNoteMemoryImageController({
    createClient: () => new ImageClient(),
    workingDirectory: "/runtime",
    store: {
      get: () => note,
      setMemoryImage: vi.fn((input) => ({
        ...note,
        revision: 2,
        memoryImage: { attachmentId: input.attachmentId, basedOnRevision: input.baseRevision }
      })),
      removeMemoryImage: vi.fn()
    },
    attachments: {
      stage: vi.fn(() => ({ id: "asset-reload", name: "memory-image.png", mimeType: "image/png" as const, size: onePixelPng.length, url: "reading-note-asset:asset-reload" })),
      reconcile: vi.fn(),
      discardStaged: vi.fn()
    },
    onStateChanged: (snapshot) => {
      if (snapshot.phase === "generating") markStarted();
    }
  });

  const generation = generateReviewed(controller, note.id);
  await started;
  const active = await controller.listActive();
  assert.equal(active.length, 1);
  assert.equal(active[0]?.noteId, note.id);
  assert.equal(active[0]?.phase, "generating");
  assert.ok(active[0]?.draft);
  await generation;
  assert.deepEqual(await controller.listActive(), []);
});

test("explicit generation uses only saved title/content and commits one validated image", async () => {
  const client = new ImageClient();
  const note = {
    id: "note-1",
    sourceDraftId: "draft-1",
    title: "Delayed feedback overshoots",
    content: markdownToReadingNoteDocument("A correction arrives after the target is crossed."),
    bookTitle: "Secret source book",
    chapterTitle: "Secret source chapter",
    createdAt: 1,
    updatedAt: 1,
    revision: 4
  };
  const stage = vi.fn(() => ({ id: "asset-new", name: "memory-image.png", mimeType: "image/png" as const, size: onePixelPng.length, url: "reading-note-asset:asset-new" }));
  const setMemoryImage = vi.fn((input) => ({
    ...note,
    revision: 5,
    memoryImage: { attachmentId: input.attachmentId, basedOnRevision: input.baseRevision, revisedPrompt: input.revisedPrompt }
  }));
  const reconcile = vi.fn();
  const controller = new ReadingNoteMemoryImageController({
    createClient: () => client,
    workingDirectory: "/isolated/runtime",
    store: { get: () => note, setMemoryImage, removeMemoryImage: vi.fn() },
    attachments: { stage, reconcile, discardStaged: vi.fn() }
  });

  const prepared = await controller.prepareGenerate(note.id);
  const input = { noteId: note.id, draftId: prepared.draft!.id, text: prepared.draft!.text };
  const firstGeneration = controller.confirm(input);
  const concurrentGeneration = controller.confirm(input);
  const [completed, concurrent] = await Promise.all([firstGeneration, concurrentGeneration]);
  assert.equal(completed.phase, "ready");
  assert.equal(concurrent.phase, "generating");
  assert.equal(completed.note?.memoryImage?.attachmentId, "asset-new");
  const turn = client.requests.findLast(({ method }) => method === "turn/start");
  assert.deepEqual(
    client.requests.find(({ method }) => method === "modelProvider/capabilities/read")?.params,
    {}
  );
  assert.equal(client.requests.filter(({ method }) => method === "turn/start").length, 2);
  const serialized = JSON.stringify(turn?.params);
  assert.match(serialized, /Delayed feedback overshoots/);
  assert.match(serialized, /correction arrives after the target/);
  assert.doesNotMatch(serialized, /Secret source book|Secret source chapter|readingSegment|conversation/i);
  assert.match(serialized, /1:1|square/);
  assert.match(serialized, /概念結構/);
  assert.match(serialized, /Allow short labels and relation words/);
  assert.match(serialized, /never paragraphs or a text-heavy poster/);
  assert.equal(stage.mock.calls.length, 1);
  assert.equal(setMemoryImage.mock.calls[0]?.[0].id, "note-1");
  assert.equal(setMemoryImage.mock.calls[0]?.[0].baseRevision, 4);
  assert.equal(setMemoryImage.mock.calls[0]?.[0].attachmentId, "asset-new");
  assert.equal(setMemoryImage.mock.calls[0]?.[0].revisedPrompt, "A concrete mnemonic");
  assert.equal(setMemoryImage.mock.calls[0]?.[0].recipe.purpose.name, "概念結構");
  assert.equal(setMemoryImage.mock.calls[0]?.[0].recipe.style.name, "極簡向量");
  assert.deepEqual(reconcile.mock.calls[0]?.[0], "note-1");
});

test("generation composes the selected purpose, style, and extra instruction without an image input", async () => {
  const client = new ImageClient();
  const note = {
    id: "note-1", sourceDraftId: "draft-1", title: "Causal ladders",
    content: markdownToReadingNoteDocument("Prerequisites support later consequences."),
    bookTitle: "Secret", chapterTitle: "Secret", createdAt: 1, updatedAt: 1, revision: 2
  };
  const setMemoryImage = vi.fn((input) => ({
    ...note,
    revision: 3,
    memoryImage: {
      attachmentId: input.attachmentId,
      basedOnRevision: input.baseRevision,
      recipe: input.recipe
    }
  }));
  const controller = new ReadingNoteMemoryImageController({
    createClient: () => client,
    workingDirectory: "/runtime",
    store: { get: () => note, setMemoryImage, removeMemoryImage: vi.fn() },
    attachments: {
      stage: vi.fn(() => ({ id: "asset-new", name: "memory-image.png", mimeType: "image/png" as const, size: onePixelPng.length, url: "reading-note-asset:asset-new" })),
      reconcile: vi.fn(),
      discardStaged: vi.fn()
    }
  });
  const purpose = { id: "purpose-custom", name: "Concept ladder", prompt: "Arrange the ideas as ascending steps." };
  const style = { id: "style-custom", name: "Blueprint", prompt: "Use cyan blueprint lines." };

  const completed = await generateReviewed(controller, {
    noteId: note.id,
    purpose,
    style,
    extraInstruction: "Put the root cause at the bottom."
  });

  assert.equal(completed.phase, "ready");
  const turn = client.requests.findLast(({ method }) => method === "turn/start");
  const input = (turn?.params?.input as Array<{ type: string; text?: string }>) ?? [];
  assert.deepEqual(input.map(({ type }) => type), ["text"]);
  assert.match(input[0]?.text ?? "", /Arrange the ideas as ascending steps/);
  assert.match(input[0]?.text ?? "", /Use cyan blueprint lines/);
  assert.match(input[0]?.text ?? "", /Put the root cause at the bottom/);
  assert.doesNotMatch(input[0]?.text ?? "", /2-4 main objects|No text/);
  assert.deepEqual(setMemoryImage.mock.calls[0]?.[0].recipe, {
    purpose,
    style,
    extraInstruction: "Put the root cause at the bottom.",
    adjustments: []
  });
});

test("adjusting uses only the current managed image and appends one successful instruction", async () => {
  const client = new ImageClient();
  const recipe = {
    purpose: { id: "purpose-custom", name: "Concept ladder", prompt: "Arrange the ideas as ascending steps." },
    style: { id: "style-custom", name: "Blueprint", prompt: "Use cyan blueprint lines." },
    adjustments: ["Make the first step larger."]
  };
  const note = {
    id: "note-1", sourceDraftId: "draft-1", title: "Causal ladders",
    content: markdownToReadingNoteDocument("Prerequisites support later consequences."),
    bookTitle: "Secret", chapterTitle: "Secret", createdAt: 1, updatedAt: 1, revision: 4,
    memoryImage: { attachmentId: "asset-current", basedOnRevision: 3, recipe }
  };
  const setMemoryImage = vi.fn((input) => ({
    ...note,
    revision: 5,
    memoryImage: {
      attachmentId: input.attachmentId,
      basedOnRevision: input.baseRevision,
      recipe: input.recipe
    }
  }));
  const localPath = vi.fn((_attachmentId: string) => "/managed/asset-current.png");
  const controller = new ReadingNoteMemoryImageController({
    createClient: () => client,
    workingDirectory: "/runtime",
    store: { get: () => note, setMemoryImage, removeMemoryImage: vi.fn() },
    attachments: {
      stage: vi.fn(() => ({ id: "asset-adjusted", name: "memory-image.png", mimeType: "image/png" as const, size: onePixelPng.length, url: "reading-note-asset:asset-adjusted" })),
      localPath,
      reconcile: vi.fn(),
      discardStaged: vi.fn()
    }
  });

  const completed = await adjustReviewed(controller, { noteId: note.id, instruction: "Make the final step glow." });

  assert.equal(completed.phase, "ready");
  assert.equal(localPath.mock.calls[0]?.[0], "asset-current");
  const turn = client.requests.findLast(({ method }) => method === "turn/start");
  const input = turn?.params?.input as Array<Record<string, unknown>>;
  assert.deepEqual(input.map(({ type }) => type), ["text", "localImage"]);
  assert.deepEqual(input[1], { type: "localImage", path: "/managed/asset-current.png" });
  assert.match(String(input[0]?.text), /Make the final step glow/);
  assert.deepEqual(setMemoryImage.mock.calls[0]?.[0].recipe.adjustments, [
    "Make the first step larger.",
    "Make the final step glow."
  ]);
});

test("an unavailable provider and a stale result never mutate the note", async () => {
  const unavailable = new ImageClient(false);
  const note = {
    id: "note-1", sourceDraftId: "draft-1", title: "Title",
    content: markdownToReadingNoteDocument("Content"), bookTitle: "Book", chapterTitle: "Chapter",
    createdAt: 1, updatedAt: 1, revision: 2
  };
  const setMemoryImage = vi.fn();
  const unavailableController = new ReadingNoteMemoryImageController({
    createClient: () => unavailable,
    workingDirectory: "/runtime",
    store: { get: () => note, setMemoryImage, removeMemoryImage: vi.fn() },
    attachments: { stage: vi.fn(), reconcile: vi.fn(), discardStaged: vi.fn() }
  });
  const state = await unavailableController.getState(note.id);
  assert.equal(state.phase, "unavailable");
  const unavailableGeneration = await generateReviewed(unavailableController, note.id);
  assert.equal(unavailableGeneration.phase, "unavailable");
  assert.equal(setMemoryImage.mock.calls.length, 0);

  let revision = 2;
  const staleController = new ReadingNoteMemoryImageController({
    createClient: () => new ImageClient(),
    workingDirectory: "/runtime",
    store: {
      get: () => ({ ...note, revision }),
      setMemoryImage,
      removeMemoryImage: vi.fn()
    },
    attachments: {
      stage: vi.fn((input) => { revision = 3; return { id: "stale-asset", name: input.name, mimeType: "image/png" as const, size: input.bytes.length, url: "reading-note-asset:stale-asset" }; }),
      reconcile: vi.fn(),
      discardStaged: vi.fn()
    }
  });
  const stale = await generateReviewed(staleController, note.id);
  assert.equal(stale.phase, "error");
  assert.match(stale.status, /changed/i);
  assert.equal(setMemoryImage.mock.calls.length, 0);
});

test("explicit removal clears the image and reconciles only remaining note attachments", async () => {
  const note = {
    id: "note-1", sourceDraftId: "draft-1", title: "Title",
    content: markdownToReadingNoteDocument("Content"), bookTitle: "Book", chapterTitle: "Chapter",
    createdAt: 1, updatedAt: 1, revision: 3,
    memoryImage: { attachmentId: "asset-memory", basedOnRevision: 2 }
  };
  const removed = { ...note, revision: 4, memoryImage: undefined };
  const removeMemoryImage = vi.fn((_input: { id: string; baseRevision: number }) => removed);
  const reconcile = vi.fn((_noteId: string, _attachmentIds: string[]) => undefined);
  const controller = new ReadingNoteMemoryImageController({
    createClient: () => new ImageClient(),
    workingDirectory: "/runtime",
    store: { get: () => note, setMemoryImage: vi.fn(), removeMemoryImage },
    attachments: { stage: vi.fn(), reconcile, discardStaged: vi.fn() }
  });

  const snapshot = await controller.remove(note.id);

  assert.equal(snapshot.phase, "ready");
  assert.equal(snapshot.note?.memoryImage, undefined);
  assert.deepEqual(removeMemoryImage.mock.calls[0]?.[0], { id: note.id, baseRevision: 3 });
  assert.deepEqual(reconcile.mock.calls[0], [note.id, []]);
});

test("memory-image IPC exposes active recovery plus note-scoped operations", async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const purpose = { id: "purpose-1", name: "Purpose", prompt: "Purpose prompt" };
  const style = { id: "style-1", name: "Style", prompt: "Style prompt" };
  const templateSettings = {
    purposes: [{ ...purpose, kind: "purpose" as const, builtIn: false }],
    styles: [{ ...style, kind: "style" as const, builtIn: false }],
    defaultPurposeId: purpose.id,
    defaultStyleId: style.id
  };
  const memoryImage = {
    revise: vi.fn(), confirm: vi.fn(), discard: vi.fn(),
    templates: {
      get: vi.fn(() => templateSettings),
      create: vi.fn((_input: unknown) => templateSettings),
      update: vi.fn(() => templateSettings),
      remove: vi.fn(() => templateSettings),
      setDefault: vi.fn((_input: unknown) => templateSettings)
    },
    listActive: vi.fn(async () => [{ noteId: "note-1", phase: "generating" as const, available: true, status: "Generating." }]),
    getState: vi.fn(async (noteId: string) => ({ noteId, phase: "ready" as const, available: true, status: "Ready." })),
    generate: vi.fn(async (input) => ({ noteId: input.noteId, phase: "generating" as const, available: true, status: "Generating." })),
    generateMissing: vi.fn(async (noteId: string) => ({ noteId, phase: "ready" as const, available: true, status: "Both visuals ready." })),
    adjust: vi.fn(async (input) => ({ noteId: input.noteId, phase: "generating" as const, available: true, status: "Adjusting." })),
    stop: vi.fn(async (noteId: string) => ({ noteId, phase: "error" as const, available: true, status: "Stopped." })),
    remove: vi.fn(async (noteId: string) => ({ noteId, phase: "ready" as const, available: true, status: "Removed." }))
  };
  registerReaderIpc(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { showOpenDialog: vi.fn() } as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    undefined,
    undefined,
    memoryImage
  );
  await handlers.get("reading-notes:memory-image-templates-get")?.(undefined);
  await handlers.get("reading-notes:memory-image-templates-create")?.(undefined, {
    kind: "purpose", name: "New purpose", prompt: "New prompt"
  });
  await handlers.get("reading-notes:memory-image-templates-update")?.(undefined, {
    kind: "purpose", id: "purpose-1", name: "Changed", prompt: "Changed prompt"
  });
  await handlers.get("reading-notes:memory-image-templates-remove")?.(undefined, {
    kind: "purpose", id: "purpose-1"
  });
  await handlers.get("reading-notes:memory-image-templates-set-default")?.(undefined, {
    kind: "style", id: "style-1"
  });
  for (const side of ["understand", "recall"] as const) {
    const input = { kind: "style", id: "style-1", side };
    await handlers.get("reading-notes:memory-image-templates-set-default")?.(undefined, input);
    assert.deepEqual(memoryImage.templates.setDefault.mock.calls.at(-1), [input]);
  }
  for (const side of [null, "front", "both", 1]) {
    assert.throws(() => handlers.get("reading-notes:memory-image-templates-set-default")?.(undefined, { kind: "style", id: "style-1", side }), /Invalid/);
  }
  for (const side of ["understand", "recall"] as const) {
    const input = { kind: "purpose", name: "Scoped purpose", prompt: "Scoped instructions", side };
    await handlers.get("reading-notes:memory-image-templates-create")?.(undefined, input);
    assert.deepEqual(memoryImage.templates.create.mock.calls.at(-1), [input]);
    const update = { ...input, id: "purpose-1" };
    await handlers.get("reading-notes:memory-image-templates-update")?.(undefined, update);
    assert.deepEqual(memoryImage.templates.update.mock.calls.at(-1), [update]);
  }
  for (const side of [null, "front", "both", 1]) {
    const input = { kind: "purpose", name: "Invalid", prompt: "Instructions", side };
    assert.throws(() => handlers.get("reading-notes:memory-image-templates-create")?.(undefined, input), /Invalid/);
    assert.throws(() => handlers.get("reading-notes:memory-image-templates-update")?.(undefined, { ...input, id: "purpose-1" }), /Invalid/);
  }
  await handlers.get("reading-notes:memory-image-list-active")?.(undefined);
  await handlers.get("reading-notes:memory-image-get")?.(undefined, " note-1 ");
  await handlers.get("reading-notes:memory-image-generate")?.(undefined, {
    noteId: "note-1", purpose, style, extraInstruction: "Extra"
  });
  await handlers.get("reading-notes:memory-image-adjust")?.(undefined, {
    noteId: "note-1", instruction: "Make it brighter"
  });
  await handlers.get("reading-notes:memory-image-stop")?.(undefined, "note-1");
  await handlers.get("reading-notes:memory-image-generate-missing")?.(undefined, "note-1");
  assert.deepEqual(memoryImage.generateMissing.mock.calls, [["note-1"]]);
  const options = { understand: { purpose, style, extraInstruction: "Use larger shapes" } };
  await handlers.get("reading-notes:memory-image-generate-missing")?.(undefined, "note-1", options);
  assert.deepEqual(memoryImage.generateMissing.mock.calls.at(-1), ["note-1", options]);
  for (const invalid of [null, { other: {} }, { understand: { purpose, style, side: "recall" } }, { understand: { purpose, style: null } }]) {
    assert.throws(() => handlers.get("reading-notes:memory-image-generate-missing")?.(undefined, "note-1", invalid), /Invalid/);
  }
  assert.throws(() => handlers.get("reading-notes:memory-image-generate-missing")?.(undefined, ""), /Invalid|note/i);
  await handlers.get("reading-notes:memory-image-remove")?.(undefined, "note-1");
  for (const generationMode of ["direct", "review"]) {
    await handlers.get("reading-notes:memory-image-generate")?.(undefined, { noteId: "note-1", purpose, style, generationMode });
    assert.equal(memoryImage.generate.mock.calls.at(-1)?.[0].generationMode, generationMode);
    await handlers.get("reading-notes:memory-image-adjust")?.(undefined, { noteId: "note-1", instruction: "Blue", generationMode });
    assert.equal(memoryImage.adjust.mock.calls.at(-1)?.[0].generationMode, generationMode);
  }
  for (const generationMode of [null, true, "automatic", 1]) {
    assert.throws(() => handlers.get("reading-notes:memory-image-generate")?.(undefined, { noteId: "note-1", purpose, style, generationMode }), /Invalid/i);
    assert.throws(() => handlers.get("reading-notes:memory-image-adjust")?.(undefined, { noteId: "note-1", instruction: "Blue", generationMode }), /Invalid/i);
  }
  const draftInput = { noteId: "note-1", draftId: "draft-1", text: "Editable image description" };
  await handlers.get("reading-notes:memory-image-revise")?.(undefined, { ...draftInput, instruction: "Use blue" });
  await handlers.get("reading-notes:memory-image-confirm")?.(undefined, draftInput);
  await handlers.get("reading-notes:memory-image-discard")?.(undefined, "note-1");
  assert.deepEqual(memoryImage.confirm.mock.calls[0], [draftInput]);
  assert.deepEqual(memoryImage.revise.mock.calls[0], [{ ...draftInput, instruction: "Use blue" }]);
  assert.deepEqual(memoryImage.discard.mock.calls[0], ["note-1"]);
  for (const side of ["recall", "understand"]) {
    await handlers.get("reading-notes:memory-image-generate")?.(undefined, { noteId: "note-1", side, purpose, style });
    assert.equal(memoryImage.generate.mock.calls.at(-1)?.[0].side, side);
    await handlers.get("reading-notes:memory-image-confirm")?.(undefined, { ...draftInput, side });
    assert.deepEqual(memoryImage.confirm.mock.calls.at(-1), [{ ...draftInput, side }]);
  }
  for (const side of [null, "front", "both", 1]) {
    assert.throws(() => handlers.get("reading-notes:memory-image-generate")?.(undefined, { noteId: "note-1", side, purpose, style }), /Invalid/i);
    assert.throws(() => handlers.get("reading-notes:memory-image-remove")?.(undefined, "note-1", side), /Invalid/i);
  }

  for (const value of [{ ...draftInput, text: " " }, { ...draftInput, text: "x".repeat(12_001) }, { ...draftInput, draftId: "" }, { ...draftInput, localImagePath: "/arbitrary" }]) {
    assert.throws(() => handlers.get("reading-notes:memory-image-confirm")?.(undefined, value), /Invalid/i);
  }
  assert.equal(memoryImage.listActive.mock.calls.length, 1);
  assert.equal(memoryImage.templates.get.mock.calls.length, 1);
  assert.deepEqual(memoryImage.templates.create.mock.calls[0]?.[0], {
    kind: "purpose", name: "New purpose", prompt: "New prompt"
  });
  assert.equal(memoryImage.getState.mock.calls[0]?.[0], "note-1");
  assert.deepEqual(memoryImage.generate.mock.calls[0]?.[0], {
    noteId: "note-1", purpose, style, extraInstruction: "Extra"
  });
  assert.deepEqual(memoryImage.adjust.mock.calls[0]?.[0], {
    noteId: "note-1", instruction: "Make it brighter"
  });
  assert.equal(memoryImage.stop.mock.calls[0]?.[0], "note-1");
  assert.equal(memoryImage.remove.mock.calls[0]?.[0], "note-1");
  await assert.rejects(async () => handlers.get("reading-notes:memory-image-generate")?.(undefined, {
    noteId: " ", purpose, style
  }), /memory-image generation/i);
  await assert.rejects(async () => handlers.get("reading-notes:memory-image-adjust")?.(undefined, {
    noteId: "note-1", instruction: "", unexpected: true
  }), /memory-image adjustment/i);
  await assert.rejects(async () => handlers.get("reading-notes:memory-image-templates-create")?.(undefined, {
    kind: "style", name: "n".repeat(61), prompt: "Valid"
  }), /template name/i);
  await assert.rejects(async () => handlers.get("reading-notes:memory-image-generate")?.(undefined, {
    noteId: "note-1", purpose, style, extraInstruction: "x".repeat(2_001)
  }), /memory-image generation/i);
});

test("F28 text preparation cannot save an image, and confirmation requires a current draft", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memory-draft-"));
  try {
    const store = new LocalReadingNoteStore(directory);
    const note = createNote(store);
    const controller = new ReadingNoteMemoryImageController({
      createClient: () => new ImageClient(true, onePixelPng.toString("base64"), undefined, false), workingDirectory: "/runtime", store,
      attachments: { stage: vi.fn(), reconcile: vi.fn(), discardStaged: vi.fn() }
    });
    const result = await controller.prepareGenerate(note.id);
    assert.equal(result.phase, "error"); // An image tool result is never a text draft.
    assert.equal(store.get(note.id)?.revision, note.revision);
    await assert.rejects(() => controller.confirm({ noteId: note.id, draftId: "missing", text: "A blue circle" }), /draft/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function draftFixture(run: (value: {
  controller: ReadingNoteMemoryImageController; store: LocalReadingNoteStore; note: ReturnType<typeof createNote>;
  clients: ImageClient[]; stage: ReturnType<typeof vi.fn>; reconcile: ReturnType<typeof vi.fn>; nextText(value: string | undefined): void;
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "memory-review-"));
  const store = new LocalReadingNoteStore(directory);
  const note = createNote(store);
  const clients: ImageClient[] = [];
  let draftText: string | undefined = "A boat crossing the target while its delayed rudder turns. Label: delayed feedback.";
  const stage = vi.fn(() => ({ id: "asset-reviewed", name: "image.png", mimeType: "image/png" as const, size: onePixelPng.length, url: "reading-note-asset:asset-reviewed" }));
  const reconcile = vi.fn();
  const controller = new ReadingNoteMemoryImageController({
    createClient: () => { const client = new ImageClient(true, onePixelPng.toString("base64"), draftText); clients.push(client); return client; },
    workingDirectory: "/runtime", store,
    attachments: { stage, localPath: (id) => `/managed/${id}.png`, reconcile, discardStaged: vi.fn() }
  });
  try { await run({ controller, store, note, clients, stage, reconcile, nextText: (text) => { draftText = text; } }); }
  finally { controller.close(); await rm(directory, { recursive: true, force: true }); }
}

function lastTurn(clients: ImageClient[]) {
  return clients.flatMap((client) => client.requests).findLast(({ method }) => method === "turn/start")!.params!;
}

test("B36 adjustment uses the attached conversation image in direct and reviewed generation", async () => {
  for (const generationMode of ["direct", "review"] as const) {
    await draftFixture(async ({ controller, store, note, clients, nextText }) => {
      store.setMemoryImage({ id: note.id, baseRevision: note.revision, attachmentId: "original" });
      if (generationMode === "direct") nextText(undefined);
      const prepared = await controller.prepareAdjust({ noteId: note.id, instruction: "Use blue", generationMode });
      let result = prepared;
      if (generationMode === "review") {
        assert.ok(prepared.draft);
        nextText(undefined);
        result = await controller.confirm({ noteId: note.id, draftId: prepared.draft.id, text: prepared.draft.text });
      }
      assert.equal(result.phase, "ready");
      const start = clients.flatMap(c => c.requests).findLast(r => r.method === "thread/start")!;
      assert.match(String(start.params?.developerInstructions), /num_last_images_to_include: 1/);
      assert.match(String(start.params?.developerInstructions), /omit referenced_image_paths/);
      assert.deepEqual((lastTurn(clients).input as unknown[])[1], { type: "localImage", path: "/managed/original.png" });
      assert.equal(store.get(note.id)?.memoryImage?.attachmentId, "asset-reviewed");
    });
  }
});

test("B36 no-image completion exposes the final failure reason and preserves the saved image", async () => {
  await draftFixture(async ({ controller, store, note, nextText, stage }) => {
    const saved = store.setMemoryImage({ id: note.id, baseRevision: note.revision, attachmentId: "original" });
    const reason = "影像工具無法存取提供的圖片路徑，因此未能產生調整後的圖片。";
    nextText(reason);
    const result = await controller.prepareAdjust({ noteId: note.id, instruction: "Use blue", generationMode: "direct" });
    assert.equal(result.phase, "error");
    assert.ok(result.status.includes(reason), result.status);
    assert.deepEqual(store.get(note.id), saved);
    assert.equal(stage.mock.calls.length, 0);
  });
});

test("B36 no-image errors bound final text and ignore commentary", async () => {
  for (const commentaryOnly of [false, true]) {
    const client = new ImageClient(true, "", "x".repeat(3_000));
    const subscribe = client.onNotification.bind(client);
    client.onNotification = (listener) => subscribe((notification) => {
      const params = notification.params as { item?: { type: string; phase?: string } };
      if (commentaryOnly && params.item?.type === "agentMessage") params.item.phase = "commentary";
      listener(notification);
    });
    const note = { id: "note", sourceDraftId: "draft", title: "Title", content: markdownToReadingNoteDocument("Content"), bookTitle: "Book", chapterTitle: "Chapter", createdAt: 1, updatedAt: 1, revision: 1 };
    const save = vi.fn();
    const controller = new ReadingNoteMemoryImageController({
      createClient: () => client, workingDirectory: "/runtime",
      store: { get: () => note, setMemoryImage: save, removeMemoryImage: vi.fn() },
      attachments: { stage: vi.fn(), reconcile: vi.fn(), discardStaged: vi.fn() }
    });
    try {
      const result = await controller.prepareGenerate({ noteId: note.id, purpose: { name: "Purpose", prompt: "Explain" }, style: { name: "Style", prompt: "Blue" }, generationMode: "direct" });
      assert.equal(result.phase, "error");
      assert.equal(result.status, "Codex completed without a memory image." + (commentaryOnly ? "" : " " + "x".repeat(2_000)));
      assert.equal(save.mock.calls.length, 0);
    } finally { controller.close(); }
  }
});

test("F28 generation reviews and revises edited text before one explicit confirmation", async () => {
  await draftFixture(async ({ controller, store, note, clients, stage, nextText }) => {
    const prepared = await controller.prepareGenerate(note.id);
    assert.equal(prepared.phase, "ready");
    assert.equal(prepared.draft?.mode, "generate");
    assert.equal(store.get(note.id)?.revision, note.revision);
    assert.equal(stage.mock.calls.length, 0);
    const config = clients.flatMap((client) => client.requests).findLast(({ method }) => method === "thread/start")!.params!.config as Record<string, unknown>;
    assert.equal(config["features.image_generation"], false);
    assert.equal((lastTurn(clients).input as unknown[]).length, 1);
    assert.equal((await controller.getState(note.id)).draft?.id, prepared.draft!.id);
    assert.deepEqual(await controller.listActive(), []);
    const edited = "Use a bicycle with a delayed handlebar, keep the target marker.";
    nextText("A bicycle crossing the target. Blue monochrome.");
    const revised = await controller.revise({ noteId: note.id, draftId: prepared.draft!.id, text: edited, instruction: "Make it blue" });
    const prompt = (lastTurn(clients).input as Array<{ text: string }>)[0]!.text;
    assert.ok(prompt.includes(edited));
    assert.ok(prompt.includes("Make it blue"));
    assert.equal(stage.mock.calls.length, 0);
    await assert.rejects(() => controller.confirm({ noteId: note.id, draftId: prepared.draft!.id, text: edited }), /draft/i);
    const finalText = "A blue bicycle, with the words delayed feedback.";
    nextText(undefined);
    const saved = await controller.confirm({ noteId: note.id, draftId: revised.draft!.id, text: finalText });
    assert.equal(saved.note?.memoryImage?.attachmentId, "asset-reviewed");
    assert.ok((lastTurn(clients).input as Array<{ text: string }>)[0]!.text.includes(finalText));
    assert.equal(stage.mock.calls.length, 1);
    assert.equal(saved.draft, undefined);
    await assert.rejects(() => controller.confirm({ noteId: note.id, draftId: revised.draft!.id, text: finalText }), /draft/i);
  });
});

test("F28 adjustment preserves the managed image through review and rejects stale or discarded drafts", async () => {
  await draftFixture(async ({ controller, store, note, clients, stage, nextText }) => {
    const withImage = store.setMemoryImage({ id: note.id, baseRevision: note.revision, attachmentId: "original" });
    const prepared = await controller.prepareAdjust({ noteId: note.id, instruction: "Use blue while keeping the layout" });
    assert.equal(prepared.draft?.mode, "adjust");
    assert.equal(store.get(note.id)?.memoryImage?.attachmentId, "original");
    assert.deepEqual((lastTurn(clients).input as unknown[])[1], { type: "localImage", path: "/managed/original.png" });
    assert.equal(stage.mock.calls.length, 0);
    await assert.rejects(() => controller.confirm({ noteId: note.id, draftId: prepared.draft!.id, text: "  " }), /non-empty/i);
    store.update({ id: note.id, baseRevision: withImage.revision, title: "Changed title", content: note.content });
    await assert.rejects(() => controller.confirm({ noteId: note.id, draftId: prepared.draft!.id, text: "Blue" }), /changed/i);
    const current = await controller.prepareAdjust({ noteId: note.id, instruction: "Blue" });
    nextText(undefined);
    const saved = await controller.confirm({ noteId: note.id, draftId: current.draft!.id, text: "Blue, keep the original layout" });
    assert.equal(saved.note?.memoryImage?.attachmentId, "asset-reviewed");
    assert.deepEqual((lastTurn(clients).input as unknown[])[1], { type: "localImage", path: "/managed/original.png" });
    nextText("Another text draft");
    const abandoned = await controller.prepareGenerate(note.id);
    await controller.discard(note.id);
    assert.equal((await controller.getState(note.id)).draft, undefined);
    await assert.rejects(() => controller.confirm({ noteId: note.id, draftId: abandoned.draft!.id, text: "New" }), /draft/i);
    store.trash(note.id);
    await assert.rejects(() => controller.prepareGenerate(note.id), /active/i);
  });
});

test("F28 stopping, duplicate confirmation and failed generation keep the reviewed draft", async () => {
  await draftFixture(async ({ controller, store, note, clients, nextText }) => {
    const prepared = await controller.prepareGenerate(note.id);
    const input = { noteId: note.id, draftId: prepared.draft!.id, text: "Edited draft to retain" };
    // The text-only fake provides no image, so the image attempt must fail without saving.
    const rendering = controller.confirm(input);
    await controller.confirm(input);
    const failed = await rendering;
    assert.equal(failed.phase, "error");
    assert.equal(failed.draft?.text, input.text);
    assert.equal(store.get(note.id)?.revision, note.revision);
    assert.equal(clients.filter((client) => client.requests.some(({ method }) => method === "turn/start")).length, 2);
    nextText(undefined);
    const retry = controller.confirm(input);
    await controller.stop(note.id);
    const stopped = await retry;
    assert.equal(stopped.phase, "error");
    assert.equal(stopped.draft?.text, input.text);
    assert.equal(store.get(note.id)?.revision, note.revision);
    const success = await controller.confirm(input);
    assert.equal(success.phase, "ready");
    assert.ok(success.note?.memoryImage);
  });
});

test("F29 memory image drafting and rendering explicitly use Astra", async () => {
  await draftFixture(async ({ controller, note, clients, nextText }) => {
    const prepared = await controller.prepareGenerate(note.id);
    const start = clients.flatMap((client) => client.requests).findLast(({ method }) => method === "thread/start");
    assert.equal(start?.params?.model, "gpt-6-astra");
    nextText(undefined);
    await controller.confirm({ noteId: note.id, draftId: prepared.draft!.id, text: prepared.draft!.text });
    assert.equal(clients.flatMap((client) => client.requests).findLast(({ method }) => method === "thread/start")?.params?.model, "gpt-6-astra");
  });
});

test("B32 preserves the service error across state refreshes", async () => {
  class FailedClient extends ImageClient {
    override onNotification(listener: (notification: CodexNotification) => void) {
      return super.onNotification((notification) => {
        if (notification.method === "turn/completed") listener({ ...notification,
          params: { threadId: "thread-image", turnId: "turn-image", turn: { id: "turn-image", status: "failed", error: { message: "This model requires a newer version of Codex." } } }
        });
        else listener(notification);
      });
    }
  }
  const directory = await mkdtemp(join(tmpdir(), "memory-error-"));
  try {
    const store = new LocalReadingNoteStore(directory); const note = createNote(store);
    const controller = new ReadingNoteMemoryImageController({ createClient: () => new FailedClient(), workingDirectory: "/runtime", store,
      attachments: { stage: vi.fn(), reconcile: vi.fn(), discardStaged: vi.fn() } });
    const failed = await controller.prepareGenerate(note.id);
    assert.equal(failed.status, "This model requires a newer version of Codex.");
    assert.deepEqual(await controller.getState(note.id), failed);
    assert.equal(store.get(note.id)?.revision, note.revision);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("F32 direct generation and adjustment save images without a review turn", async () => {
  await draftFixture(async ({ controller, store, note, clients, stage, nextText }) => {
    nextText(undefined);
    const purpose = { id: "p", name: "Purpose", prompt: "Show feedback" };
    const style = { id: "s", name: "Style", prompt: "Use blue" };
    const result = await controller.prepareGenerate({ noteId: note.id, purpose, style, extraInstruction: "Use a boat", generationMode: "direct" });
    assert.equal(result.phase, "ready");
    assert.equal(result.draft, undefined);
    assert.equal(stage.mock.calls.length, 1);
    assert.equal(store.get(note.id)?.memoryImage?.attachmentId, "asset-reviewed");
    assert.equal((lastTurn(clients).input as unknown[]).length, 1);
    assert.ok(JSON.stringify(lastTurn(clients)).includes("Use a boat"));
    const adjusted = await controller.prepareAdjust({ noteId: note.id, instruction: "Make the rudder brighter", generationMode: "direct" });
    assert.equal(adjusted.phase, "ready");
    assert.equal(adjusted.draft, undefined);
    assert.equal(stage.mock.calls.length, 2);
    assert.deepEqual((lastTurn(clients).input as unknown[])[1], { type: "localImage", path: "/managed/asset-reviewed.png" });
    assert.deepEqual(store.get(note.id)?.memoryImage?.recipe?.adjustments, ["Make the rudder brighter"]);
    const starts = clients.flatMap(c => c.requests).filter(r => r.method === "thread/start");
    assert.equal(starts.length, 2);
    for (const start of starts) assert.notEqual((start.params?.config as Record<string, unknown>)["features.image_generation"], false);
  });
});

test("F32 direct failure, stop, duplicates, stale revisions and Trash preserve the saved image", async () => {
  await draftFixture(async ({ controller, store, note, clients, nextText, stage }) => {
    const saved = store.setMemoryImage({ id: note.id, baseRevision: note.revision, attachmentId: "original" });
    const input = { noteId: note.id, instruction: "Use blue", generationMode: "direct" as const };
    // A text-only response cannot replace the saved image.
    assert.equal((await controller.prepareAdjust(input)).phase, "error");
    assert.equal(store.get(note.id)?.memoryImage?.attachmentId, "original");
    nextText(undefined);
    const running = controller.prepareAdjust(input);
    assert.equal((await controller.prepareAdjust(input)).phase, "generating");
    assert.equal((await controller.listActive()).length, 1);
    await controller.stop(note.id);
    assert.equal((await running).phase, "error");
    assert.equal(store.get(note.id)?.revision, saved.revision);
    assert.equal(clients.filter(c => c.requests.some(r => r.method === "turn/start")).length <= 2, true);
    stage.mockImplementationOnce(() => {
      store.update({ id: note.id, baseRevision: saved.revision, title: "Changed", content: saved.content });
      return { id: "stale-asset", name: "image.png", mimeType: "image/png", size: onePixelPng.length, url: "reading-note-asset:stale-asset" };
    });
    assert.equal((await controller.prepareAdjust(input)).phase, "error");
    assert.equal(store.get(note.id)?.memoryImage?.attachmentId, "original");
    assert.equal((await controller.prepareAdjust(input)).phase, "ready");
    store.trash(note.id);
    await assert.rejects(() => controller.prepareAdjust(input), /active/i);
  });
});


test("F34 TC2: unknown legacy attribution preserves images and rejects occupied, stale and Trash targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "two-sided-assign-"));
  try {
    let store = new LocalReadingNoteStore(directory);
    const note = createNote(store);
    const legacy = store.setMemoryImage({ id: note.id, baseRevision: note.revision, attachmentId: "unknown" });
    store = new LocalReadingNoteStore(directory);
    assert.equal(store.get(note.id)?.memoryImage?.attachmentId, "unknown");
    const filled = store.setMemoryImage({ id: note.id, baseRevision: legacy.revision, side: "recall", attachmentId: "existing" });
    assert.throws(() => store.assignMemoryImage({ id: note.id, baseRevision: filled.revision, side: "recall" }), /empty/);
    assert.throws(() => store.assignMemoryImage({ id: note.id, baseRevision: legacy.revision, side: "understand" }), /changed/);
    const trash = store.trash(note.id);
    assert.throws(() => store.assignMemoryImage({ id: note.id, baseRevision: trash.revision, side: "understand" }), /Trash/);
    const restored = store.restore(note.id);
    const assigned = store.assignMemoryImage({ id: note.id, baseRevision: restored.revision, side: "understand" });
    assert.equal(assigned.memoryImages?.recall?.attachmentId, "existing");
    assert.equal(assigned.memoryImages?.understand?.attachmentId, "unknown");
    assert.equal(assigned.memoryImage, undefined);
    assert.deepEqual(new LocalReadingNoteStore(directory).get(note.id), assigned);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("F34 TC5: each face uses its own reference in direct/review and reconciliation retains the other face", async () => {
  for (const side of ["recall", "understand"] as const) {
    for (const generationMode of ["direct", "review"] as const) {
      await draftFixture(async ({ controller, store, note, clients, nextText, reconcile }) => {
        const recall = store.setMemoryImage({ id: note.id, baseRevision: note.revision, side: "recall", attachmentId: "original-recall" });
        store.setMemoryImage({ id: note.id, baseRevision: recall.revision, side: "understand", attachmentId: "original-understand" });
        const otherSide = side === "recall" ? "understand" : "recall";
        if (generationMode === "direct") nextText(undefined);
        let result = await controller.prepareAdjust({ noteId: note.id, side, instruction: "Use blue", generationMode });
        if (generationMode === "review") {
          assert.equal(result.draft?.side, side);
          const draft = result.draft!;
          await assert.rejects(() => controller.confirm({ noteId: note.id, side: otherSide, draftId: draft.id, text: draft.text }), /draft/);
          nextText(undefined);
          result = await controller.confirm({ noteId: note.id, side, draftId: draft.id, text: draft.text });
        }
        assert.equal(result.phase, "ready");
        assert.equal(result.side, side);
        assert.deepEqual((lastTurn(clients).input as unknown[])[1], { type: "localImage", path: `/managed/original-${side}.png` });
        assert.equal(store.get(note.id)?.memoryImages?.[side]?.attachmentId, "asset-reviewed");
        assert.equal(store.get(note.id)?.memoryImages?.[otherSide]?.attachmentId, `original-${otherSide}`);
        assert.deepEqual(new Set(reconcile.mock.calls.at(-1)?.[1]), new Set(["asset-reviewed", `original-${otherSide}`]));
        const removed = await controller.remove(note.id, side);
        assert.equal(removed.note?.memoryImages?.[side], undefined);
        assert.equal(removed.note?.memoryImages?.[otherSide]?.attachmentId, `original-${otherSide}`);
        assert.deepEqual(reconcile.mock.calls.at(-1)?.[1], [`original-${otherSide}`]);
      });
    }
  }
});

test("F34 TC5: drafts remain face-specific and a note change makes an older face draft stale", async () => {
  await draftFixture(async ({ controller, store, note, nextText }) => {
    const recipe = { purpose: { name: "Custom", prompt: "Visual cue" }, style: { name: "Style", prompt: "Blue" } };
    const recall = await controller.prepareGenerate({ noteId: note.id, side: "recall", ...recipe });
    const understand = await controller.prepareGenerate({ noteId: note.id, side: "understand", ...recipe });
    assert.equal((await controller.getState(note.id, "recall")).draft?.id, recall.draft?.id);
    await controller.discard(note.id, "understand");
    assert.equal((await controller.getState(note.id, "understand")).draft, undefined);
    assert.equal((await controller.getState(note.id, "recall")).draft?.id, recall.draft?.id);
    nextText(undefined);
    const result = await controller.prepareGenerate({ noteId: note.id, side: "understand", ...recipe, generationMode: "direct" });
    assert.equal(result.note?.memoryImages?.understand?.attachmentId, "asset-reviewed");
    await assert.rejects(() => controller.confirm({ noteId: note.id, side: "recall", draftId: recall.draft!.id, text: recall.draft!.text }), /changed/);
    assert.equal(store.get(note.id)?.memoryImages?.recall, undefined);
    assert.ok(understand.draft);
  });
});

async function batchFixture(action: (context: {
  store: LocalReadingNoteStore;
  note: ReturnType<typeof createNote>;
  controller: ReadingNoteMemoryImageController;
  stage: ReturnType<typeof vi.fn>;
  events: import('../src/shared/contracts').ReadingNoteMemoryImageSnapshot[];
}) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "visual-pair-"));
  try {
    const store = new LocalReadingNoteStore(directory);
    const note = createNote(store);
    let asset = 0;
    const stage = vi.fn(() => ({ id: `pair-${++asset}`, name: "visual.png", mimeType: "image/png" as const, size: onePixelPng.length, url: "reading-note-asset:pair" }));
    const events: import('../src/shared/contracts').ReadingNoteMemoryImageSnapshot[] = [];
    const controller = new ReadingNoteMemoryImageController({ store, workingDirectory: "/runtime", createClient: () => new ImageClient(),
      attachments: { stage, reconcile: vi.fn(), discardStaged: vi.fn() }, onStateChanged: value => events.push(value) });
    await action({ store, note, controller, stage, events });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("Quick generation saves both faces with distinct recommended recipes and fresh revisions", async () => {
  await batchFixture(async ({ controller, note, store, stage, events }) => {
    const result = await controller.generateMissing(note.id);
    assert.equal(result.batch?.phase, "completed");
    assert.deepEqual(result.batch?.completed, ["understand", "recall"]);
    const saved = store.get(note.id)!;
    assert.equal(saved.revision, 3);
    assert.equal(saved.memoryImages?.understand?.recipe?.purpose.id, "purpose-concept-structure");
    assert.equal(saved.memoryImages?.recall?.recipe?.purpose.id, "purpose-surreal-association");
    assert.equal(saved.memoryImages?.understand?.attachmentId, "pair-1");
    assert.equal(saved.memoryImages?.recall?.attachmentId, "pair-2");
    assert.equal(stage.mock.calls.length, 2);
    assert.deepEqual(events.filter(event => event.phase === "generating").map(event => event.side), ["understand", "recall"]);
    await controller.generateMissing(note.id);
    assert.equal(stage.mock.calls.length, 2, "existing visuals are not regenerated");
  });
});

test("Quick generation retries only the missing face after a partial failure", async () => {
  await batchFixture(async ({ controller, note, store, stage }) => {
    stage.mockImplementationOnce(() => ({ id: "kept-front", name: "visual.png", mimeType: "image/png", size: onePixelPng.length, url: "reading-note-asset:kept-front" }));
    stage.mockImplementationOnce(() => { throw new Error("Temporary image failure"); });
    const failed = await controller.generateMissing(note.id);
    assert.equal(failed.batch?.phase, "error");
    assert.equal(store.get(note.id)?.memoryImages?.understand?.attachmentId, "kept-front");
    assert.equal(store.get(note.id)?.memoryImages?.recall, undefined);
    const retry = await controller.generateMissing(note.id);
    assert.equal(retry.batch?.phase, "completed");
    assert.deepEqual(retry.batch?.sides, ["recall"]);
    assert.equal(store.get(note.id)?.memoryImages?.understand?.attachmentId, "kept-front");
    assert.equal(stage.mock.calls.length, 3);
  });
});

test("Stopping a quick pair cancels queued work and duplicate clicks cannot start another pair", async () => {
  await batchFixture(async ({ controller, note, store, stage }) => {
    const running = controller.generateMissing(note.id);
    await assert.rejects(() => controller.generateMissing(note.id), /already in progress/);
    await controller.stop(note.id);
    const stopped = await running;
    assert.equal(stopped.batch?.phase, "stopped");
    assert.equal(stage.mock.calls.length, 0);
    assert.equal(store.get(note.id)?.memoryImages, undefined);
  });
});

test("Quick generation preserves an existing review draft rather than silently replacing it", async () => {
  await batchFixture(async ({ controller, note }) => {
    const prepared = await controller.prepareGenerate({ noteId: note.id, side: "understand", purpose: { name: "Purpose", prompt: "Explain" }, style: { name: "Style", prompt: "Blue" } });
    await assert.rejects(() => controller.generateMissing(note.id), /Finish or discard/);
    assert.equal((await controller.getState(note.id, "understand")).draft?.id, prepared.draft?.id);
  });
});


test("removing the recall side also removes an unclassified legacy image without bringing it back on reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "legacy-recall-removal-"));
  try {
    let store = new LocalReadingNoteStore(directory);
    const note = createNote(store);
    const legacy = store.setMemoryImage({ id: note.id, baseRevision: note.revision, attachmentId: "old-recall" });
    const removed = store.removeMemoryImage({ id: note.id, baseRevision: legacy.revision, side: "recall" });
    assert.equal(removed.memoryImage, undefined);
    assert.equal(removed.memoryImages?.recall, undefined);
    store = new LocalReadingNoteStore(directory);
    assert.equal(store.get(note.id)?.memoryImage, undefined);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test("missing-side generation saves selected recipes and keeps the existing side", async () => {
  await draftFixture(async ({ controller, store, note, clients, nextText }) => {
    store.setMemoryImage({ id: note.id, baseRevision: note.revision, side: "recall", attachmentId: "keep-back" });
    const choice = { purpose: { id: "purpose-concept-contrast", name: "Compare", prompt: "Compare the ideas side by side." },
      style: { id: "style-storybook-watercolor", name: "Watercolor", prompt: "Use soft watercolor." }, extraInstruction: "Emphasize the key distinction." };
    nextText(undefined);
    const result = await controller.generateMissing(note.id, { understand: choice });
    assert.equal(result.phase, "ready");
    assert.deepEqual(result.note?.memoryImages?.understand?.recipe, { ...choice, adjustments: [] });
    assert.equal(result.note?.memoryImages?.recall?.attachmentId, "keep-back");
    assert.match(JSON.stringify(lastTurn(clients).input), /Use soft watercolor/);
  });
});

test("invalid batch settings are rejected before either image is generated", async () => {
  await draftFixture(async ({ controller, clients, note }) => {
    const choice = { purpose: { id: "purpose-memory-palace", name: "Recall", prompt: "Recall the ideas." }, style: { name: "Style", prompt: "Paint." } };
    await assert.rejects(() => controller.generateMissing(note.id, { understand: choice }), /selected side/);
    assert.equal(clients.length, 0);
  });
});

test('F39 TC5/6: controller marks only persisted image completions, including partial batches', async () => {
  await batchFixture(async ({ controller, note, stage, events }) => {
    stage.mockImplementationOnce(() => ({ id: 'partial', name: 'visual.png', mimeType: 'image/png', size: onePixelPng.length, url: 'reading-note-asset:partial' }));
    stage.mockImplementationOnce(() => { throw new Error('Generation failed'); });
    const result = await controller.generateMissing(note.id);
    assert.deepEqual(result.completion?.sides, ['understand']);
    assert.ok(result.note?.memoryImages?.understand);
    const finished = await controller.generateMissing(note.id);
    assert.deepEqual(finished.completion?.sides, ['recall']);
    const idle = await controller.generateMissing(note.id);
    assert.equal(idle.completion, undefined);
    const removed = await controller.remove(note.id, 'recall');
    assert.equal(removed.completion, undefined);
    assert.ok(events.some(e => e.phase === 'generating' && !e.completion));
  });
});


test("B49 reviewed adjustment can finish after two minutes and still saves; a stalled job remains bounded", async () => {
  const directory = await mkdtemp(join(tmpdir(), "memory-slow-"));
  vi.useFakeTimers();
  try {
    for (const stalled of [false, true]) {
      const store = new LocalReadingNoteStore(join(directory, String(stalled)));
      const base = createNote(store);
      const created = store.setMemoryImage({ id: base.id, baseRevision: base.revision, side: "understand", attachmentId: "other" });
      const note = store.setMemoryImage({ id: created.id, baseRevision: created.revision, side: "recall", attachmentId: "old" });
      const controller = new ReadingNoteMemoryImageController({
        workingDirectory: "/runtime", store,
        createClient: () => {
          const client = new ImageClient();
          const subscribe = client.onNotification.bind(client);
          client.onNotification = listener => subscribe(event => {
            const params = event.params as { item?: { type: string } };
            if (params.item?.type === "imageGeneration") {
              if (!stalled) setTimeout(() => listener(event), 180_000);
            } else if (event.method !== "turn/completed" || client.requests.some(r => r.method === "thread/start" && (r.params?.config as Record<string, unknown>)?.["features.image_generation"] === false)) listener(event);
          });
          return client;
        },
        attachments: { localPath: () => "/managed/old.png", stage: () => ({ id: "new", name: "image.png", mimeType: "image/png", size: onePixelPng.length, url: "reading-note-asset:new" }), reconcile: vi.fn(), discardStaged: vi.fn() }
      });
      try {
        const preparing = controller.prepareAdjust({ noteId: note.id, side: "recall", instruction: "Use blue" });
        await vi.advanceTimersByTimeAsync(10);
        const prepared = await preparing;
        assert.ok(prepared.draft);
        const running = controller.confirm({ noteId: note.id, side: "recall", draftId: prepared.draft.id, text: prepared.draft.text });
        await vi.advanceTimersByTimeAsync(130_000);
        assert.equal((await controller.listActive()).length, 1, "image generation must survive the old two-minute cutoff");
        await vi.advanceTimersByTimeAsync(stalled ? 480_000 : 60_000);
        const result = await running;
        assert.equal(result.phase, stalled ? "error" : "ready");
        assert.equal(store.get(note.id)?.memoryImages?.recall?.attachmentId, stalled ? "old" : "new");
        assert.deepEqual(result.completion?.sides, stalled ? undefined : ["recall"]);
        assert.equal(store.get(note.id)?.memoryImages?.understand?.attachmentId, "other");
        assert.equal((await controller.listActive()).length, 0);
      } finally { controller.close(); }
    }
  } finally { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); }
});
