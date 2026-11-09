import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test, vi } from "vitest";
import { ReadingNoteAiController } from "../src/main/reading-note-ai-controller";
import type { CodexAppServerClient, CodexNotification } from "../src/main/codex-app-server-client";
import type { ReadingNote } from "../src/shared/contracts";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";

class StubClient implements CodexAppServerClient {
  readonly requests: Array<{ method: string; params?: Record<string, unknown> }> = [];
  readonly events = new EventEmitter();
  closed = false;

  constructor(
    private readonly response: (params: Record<string, unknown>) => string,
    private readonly streamChunks?: (text: string) => string[],
    private readonly deltasBeforeStartResponse = false,
    private readonly responseTurnId?: string,
    private readonly canonicalResponse?: string | readonly string[],
    private readonly canonicalTurnId = "turn-1"
  ) {}

  async initialize(): Promise<void> {}
  async readAccount() { return { account: { type: "chatgpt" }, requiresOpenaiAuth: false }; }
  async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ method, params });
    if (method === "thread/start") return { thread: { id: "thread-1" } };
    if (method === "thread/read") {
      const finalTexts = this.canonicalResponse === undefined
        ? []
        : Array.isArray(this.canonicalResponse)
          ? this.canonicalResponse
          : [this.canonicalResponse];
      return {
        thread: {
          id: "thread-1",
          turns: finalTexts.length === 0 ? [] : [{
            id: this.canonicalTurnId,
            items: finalTexts.map((text, index) => ({
              type: "agentMessage",
              id: `answer-${index + 1}`,
              text,
              phase: "final_answer"
            }))
          }]
        }
      };
    }
    if (method === "turn/start") {
      const turnId = `turn-${this.requests.filter(({ method: candidate }) => candidate === "turn/start").length}`;
      const text = this.response(params ?? {});
      const emitDeltas = () => {
        for (const delta of this.streamChunks?.(text) ?? []) {
          this.events.emit("notification", {
            method: "item/agentMessage/delta",
            params: { threadId: "thread-1", turnId, delta }
          } satisfies CodexNotification);
        }
      };
      if (this.deltasBeforeStartResponse) emitDeltas();
      setTimeout(() => {
        if (!this.deltasBeforeStartResponse) emitDeltas();
        this.events.emit("notification", {
          method: "item/completed",
          params: { threadId: "thread-1", turnId, item: { type: "agentMessage", text } }
        } satisfies CodexNotification);
        this.events.emit("notification", {
          method: "turn/completed",
          params: { threadId: "thread-1", turnId, turn: { id: turnId, status: "completed" } }
        } satisfies CodexNotification);
      }, 0);
      return { turn: { id: this.responseTurnId ?? turnId } };
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
  close() { this.closed = true; }
}

test("AI Complete Note receives the current source image as visual input", async () => {
  const image = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
  const client = new StubClient(() => result("session-1", "圖解", "碗形圖說明收斂。"));
  const controller = new ReadingNoteAiController({
    createClient: () => client,
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1"
  });
  const sourceWithImage = {
    bookTitle: "Book", chapterTitle: "Chapter",
    readingSegment: "[Book image 1] Figure 3.2", userDraft: "說明此圖",
    images: [image]
  };
  controller.startCreate(sourceWithImage);
  await controller.send("session-1", "Complete this note.");
  const turn = client.requests.find(({ method }) => method === "turn/start");
  assert.deepEqual((turn?.params?.input as Array<Record<string, unknown>>).filter(item => item.type === "image"), [
    { type: "image", url: image.dataUrl }
  ]);
});

test("F58 AI Complete Note compresses only transmitted source images", async () => {
  const image = { dataUrl: "original-book-image" };
  const client = new StubClient(() => result("session-1", "圖解", "![來源圖](book-image:1)"));
  const compressImage = vi.fn(() => "compressed-book-image");
  const controller = new ReadingNoteAiController({
    createClient: () => client, compressImage,
    workingDirectory: "/runtime", completeSkillPath: "/complete/SKILL.md", completeSkillInstructions: "complete",
    editSkillPath: "/edit/SKILL.md", editSkillInstructions: "edit", store: { create: vi.fn(), get: vi.fn(), update: vi.fn() }, createId: () => "session-1"
  });
  const session = controller.startCreate({ bookTitle: "Book", chapterTitle: "Chapter", readingSegment: "[Book image 1]", userDraft: "說明", images: [image] });
  await controller.complete(session.sessionId);
  const turn = client.requests.find(request => request.method === "turn/start")!;
  assert.deepEqual((turn.params!.input as Array<{type: string; url?: string}>).filter(item => item.type === "image"), [{ type: "image", url: "compressed-book-image" }]);
  assert.equal(image.dataUrl, "original-book-image");
  assert.throws(() => controller.accept(session.sessionId), /Apply the selected source images/);
  controller.close();
});

test("AI note proposals stream decoded title and Markdown before the final artifact completes", async () => {
  const snapshots: Array<{
    phase: string;
    streamingDraft?: { title: string; content: string };
    draft?: { title: string; content: string };
  }> = [];
  const finalText = result(
    "session-1",
    "Why feedback says \"more\"",
    "First line\n\nA path uses `C:\\\\notes` and 中文。"
  );
  const contentStart = finalText.indexOf('"content"');
  const splitAt = finalText.indexOf("and 中文") + 4;
  const client = new StubClient(
    () => finalText,
    (text) => [text.slice(0, contentStart), text.slice(contentStart, splitAt), text.slice(splitAt)]
  );
  const controller = new ReadingNoteAiController({
    createClient: () => client,
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1",
    onStateChanged: (snapshot) => snapshots.push(snapshot)
  });

  controller.startCreate({
    bookTitle: "Book",
    chapterTitle: "Chapter",
    readingSegment: "Segment",
    userDraft: "Draft"
  });
  const completed = await controller.send("session-1", "Rewrite this note.");

  assert.equal(snapshots.some(({ phase, streamingDraft }) =>
    phase === "responding" && streamingDraft?.title === 'Why feedback says "more"' &&
    streamingDraft.content.includes("First line")), true);
  assert.equal(snapshots.some(({ streamingDraft }) =>
    streamingDraft?.content.includes("C:\\\\notes") && streamingDraft.content.includes("中文")), true);
  assert.equal(completed.streamingDraft, undefined);
  assert.equal(completed.draft?.content, "First line\n\nA path uses `C:\\\\notes` and 中文。");
  assert.equal(client.requests.some(({ method }) => method === "thread/read"), false);
});

test("an existing note keeps early AI deltas that arrive before turn start returns", async () => {
  const snapshots: Array<{
    phase: string;
    streamingDraft?: { title: string; content: string };
  }> = [];
  const finalText = result(
    "session-1",
    "Existing note, clarified",
    "Existing content now gains a concrete example."
  );
  const client = new StubClient(
    () => finalText,
    (text) => [text.slice(0, -12), text.slice(-12)],
    true
  );
  const controller = new ReadingNoteAiController({
    createClient: () => client,
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1",
    onStateChanged: (snapshot) => snapshots.push(snapshot)
  });

  controller.startTransform({
    title: "Existing note",
    content: "Existing content."
  });
  const completed = await controller.send("session-1", "Add a concrete example.");

  assert.equal(snapshots.some(({ phase, streamingDraft }) =>
    phase === "responding" && streamingDraft?.content.includes("concrete example")), true);
  assert.equal(completed.draft?.title, "Existing note, clarified");
});

test("an early AI notification cannot bind a different turn than the start response", async () => {
  const finalText = result("session-1", "Candidate", "Candidate content");
  const client = new StubClient(
    () => finalText,
    (text) => [text],
    true,
    "different-turn"
  );
  const controller = new ReadingNoteAiController({
    createClient: () => client,
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1"
  });

  controller.startTransform({ title: "Existing", content: "Existing content" });

  await assert.rejects(
    controller.send("session-1", "Rewrite this."),
    /inconsistent reading-note turn identifiers/
  );
});

test("a malformed live response recovers the canonical final proposal from the completed turn", async () => {
  const canonical = result(
    "session-1",
    "Recovered title",
    "Recovered complete content."
  );
  const client = new StubClient(
    () => canonical.slice(0, canonical.indexOf('"content"') + 12),
    undefined,
    false,
    undefined,
    canonical
  );
  const controller = new ReadingNoteAiController({
    createClient: () => client,
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1"
  });

  controller.startCreate({
    bookTitle: "Book",
    chapterTitle: "Chapter",
    readingSegment: "Segment",
    userDraft: "Draft"
  });
  const completed = await controller.send("session-1", "Complete this note.");

  assert.deepEqual(completed.draft, {
    title: "Recovered title",
    content: "Recovered complete content."
  });
  assert.equal(client.requests.some(({ method, params }) =>
    method === "thread/read" && params?.threadId === "thread-1" &&
    params.includeTurns === true), true);
});

test("a malformed live response recovers a canonical discussion without creating a proposal", async () => {
  const canonical = result(
    "session-1",
    undefined,
    undefined,
    "The note already says this clearly."
  );
  const client = new StubClient(
    () => "```reading-note-ai-turn\n{",
    undefined,
    false,
    undefined,
    canonical
  );
  const controller = new ReadingNoteAiController({
    createClient: () => client,
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1"
  });

  controller.startTransform({ title: "Existing", content: "Existing content" });
  const completed = await controller.send("session-1", "Explain this note.");

  assert.deepEqual(completed.draft, {
    title: "Existing",
    content: "Existing content"
  });
  assert.equal(completed.hasChanges, false);
  assert.equal(completed.messages.at(-1)?.text, "The note already says this clearly.");
});

test("canonical recovery rejects another turn, another session, or multiple valid final artifacts", async () => {
  for (const [canonicalResponse, canonicalTurnId] of [
    [result("session-1", "Wrong turn", "Wrong turn content"), "another-turn"],
    [result("another-session", "Forged", "Forged content"), "turn-1"],
    [[
      result("session-1", "First", "First content"),
      result("session-1", "Second", "Second content")
    ], "turn-1"]
  ] as const) {
    const client = new StubClient(
      () => "invalid live response",
      undefined,
      false,
      undefined,
      canonicalResponse,
      canonicalTurnId
    );
    const controller = new ReadingNoteAiController({
      createClient: () => client,
      workingDirectory: "/runtime",
      completeSkillPath: "/runtime/complete/SKILL.md",
      completeSkillInstructions: "complete",
      editSkillPath: "/runtime/edit/SKILL.md",
      editSkillInstructions: "edit",
      store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
      createId: () => "session-1"
    });
    controller.startTransform({ title: "Existing", content: "Existing content" });

    await assert.rejects(
      controller.send("session-1", "Rewrite this note."),
      /invalid reading-note AI response/i
    );
  }
});

function result(sessionId: string, title?: string, content?: string, reply = "I prepared a clearer version.") {
  return `\`\`\`reading-note-ai-turn\n${JSON.stringify({
    version: 2,
    kind: "reading-note-ai-turn",
    sessionId,
    reply,
    proposal: title && content ? { title, content } : null
  })}\n\`\`\``;
}

const savedNote: ReadingNote = {
  id: "note-1",
  sourceDraftId: "draft-1",
  title: "What is a reinforcing loop?",
  content: markdownToReadingNoteDocument("A reinforcing loop amplifies change."),
  bookTitle: "Thinking in Systems",
  chapterTitle: "Feedback",
  createdAt: 100,
  updatedAt: 100,
  revision: 1
};

test("source-backed AI conversation changes no baseline until accept, then every later turn excludes source", async () => {
  const clients: StubClient[] = [];
  const responses = [
    (params: Record<string, unknown>) => {
      const input = params.input as Array<{ text: string }>;
      const payload = JSON.parse(input[0]!.text.match(/Completion payload: (\{.*\})/)![1]);
      assert.deepEqual(Object.keys(payload).sort(), ["conversationContext", "editingConversation", "readingSegment", "request", "sessionId", "userDraft"]);
      assert.equal(payload.readingSegment, "A loop feeds its output back as input.");
      assert.equal(payload.userDraft, "feedback makes changes bigger");
      assert.match(payload.conversationContext, /User: Why does feedback amplify change\?/);
      assert.match(payload.conversationContext, /AI: Because output becomes new input\./);
      assert.equal(payload.request, "Could this explanation be clearer?");
      return result(payload.sessionId, undefined, undefined, "Do you want the note to emphasize causality or terminology?");
    },
    (params: Record<string, unknown>) => {
      const input = params.input as Array<{ text: string }>;
      const payload = JSON.parse(input[0]!.text.match(/Completion payload: (\{.*\})/)![1]);
      assert.match(JSON.stringify(payload.editingConversation), /emphasize causality or terminology/);
      return result(payload.sessionId, "How can feedback amplify change?", "A reinforcing loop feeds output back as input.");
    },
    (params: Record<string, unknown>) => {
      const input = params.input as Array<{ text: string }>;
      const payload = JSON.parse(input[0]!.text.match(/Edit payload: (\{.*\})/)![1]);
      assert.equal(input[0]!.text.includes("A reinforcing loop feeds output"), true);
      assert.equal(input[0]!.text.includes("Thinking in Systems"), false);
      assert.equal(input[0]!.text.includes("feedback makes changes bigger"), false);
      assert.equal(input[0]!.text.includes("Why does feedback amplify change"), false);
      return result(payload.sessionId, payload.title, `${payload.content}\n\nThis makes the direction of change clearer.`);
    }
  ];
  const controller = new ReadingNoteAiController({
    createClient: () => {
      const client = new StubClient(responses[clients.length]!);
      clients.push(client);
      return client;
    },
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "Complete only from the reading segment.",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "Edit only the supplied card content.",
    getConversationContext: () => [
      "User: Why does feedback amplify change?",
      "AI: Because output becomes new input."
    ].join("\n\n"),
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1"
  });

  const started = controller.startCreate({
    bookTitle: "Thinking in Systems",
    chapterTitle: "Feedback",
    readingSegment: "A loop feeds its output back as input.",
    userDraft: "feedback makes changes bigger"
  });
  assert.equal(started.phase, "ready");
  const clarified = await controller.send("session-1", "Could this explanation be clearer?");
  assert.equal(clarified.draft, undefined);
  assert.equal(clarified.messages.at(-1)?.text, "Do you want the note to emphasize causality or terminology?");
  const completed = await controller.send("session-1", "Emphasize causality.");
  assert.equal(completed.draft?.title, "How can feedback amplify change?");
  const accepted = controller.accept("session-1");
  assert.equal(accepted.draft, undefined);
  const edited = await controller.send("session-1", "Make the relationship clearer.");
  assert.match(edited.draft?.content ?? "", /direction of change/);
  assert.equal(clients.length, 3);
  assert.equal(clients.every(({ closed }) => closed), true);
});

test("after applying a source image, later AI edits receive its managed attachment reference", async () => {
  const image = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
  const clients: StubClient[] = [];
  const controller = new ReadingNoteAiController({
    createClient: () => {
      const client = new StubClient((params) => {
        const input = params.input as Array<{ text: string }>;
        return clients.length === 1
          ? result("session-1", "圖解", "碗形圖說明收斂。\n\n![原文圖](book-image:1)")
          : result("session-1", "圖解", "碗形圖說明收斂。\n\n![原文圖](reading-note-asset:asset-1)");
      });
      clients.push(client);
      return client;
    },
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1"
  });
  controller.startCreate({ bookTitle: "Book", chapterTitle: "Chapter",
    readingSegment: "[Book image 1]", userDraft: "說明此圖", images: [image] });
  await controller.send("session-1", "完成筆記");
  controller.accept("session-1", "碗形圖說明收斂。\n\n![原文圖](reading-note-asset:asset-1)");
  await controller.send("session-1", "讓文字更清楚");
  const editTurn = clients[1]!.requests.find(({ method }) => method === "turn/start");
  const input = editTurn?.params?.input as Array<{ text: string }>;
  assert.match(input[0]!.text, /reading-note-asset:asset-1/);
  assert.doesNotMatch(input[0]!.text, /book-image:1/);
  assert.equal(input.some(item => (item as { type?: string }).type === "image"), false);
  assert.throws(() => controller.accept("session-1", "tampered"), /match the AI proposal|no AI proposal/i);
});

test("AI completion omits conversation context when no visible conversation is selected", async () => {
  const client = new StubClient((params) => {
    const input = params.input as Array<{ text: string }>;
    const payload = JSON.parse(input[0]!.text.match(/Completion payload: (\{.*\})/)![1]);
    assert.deepEqual(Object.keys(payload).sort(), ["editingConversation", "readingSegment", "request", "sessionId", "userDraft"]);
    return result(payload.sessionId, "A prompt", "Some content");
  });
  const controller = new ReadingNoteAiController({
    createClient: () => client,
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    getConversationContext: () => undefined,
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1"
  });
  controller.startCreate({
    bookTitle: "Book",
    chapterTitle: "Chapter",
    readingSegment: "Segment",
    userDraft: "Draft"
  });
  await controller.send("session-1", "Complete this note.", "gpt-5.6-terra");
  const turnStart = client.requests.find(({ method }) => method === "turn/start");
  assert.equal(turnStart?.params?.model, "gpt-5.6-terra");
  const outputSchema = turnStart?.params?.outputSchema as {
    additionalProperties?: boolean;
    required?: string[];
    properties?: {
      sessionId?: { enum?: string[] };
      proposal?: { anyOf?: unknown[] };
    };
  };
  assert.equal(outputSchema.additionalProperties, false);
  assert.deepEqual(outputSchema.required, [
    "version",
    "kind",
    "sessionId",
    "proposal",
    "reply"
  ]);
  assert.deepEqual(outputSchema.properties?.sessionId?.enum, ["session-1"]);
  assert.equal(outputSchema.properties?.proposal?.anyOf?.length, 2);
});

test("rejecting a proposal clears only the candidate and preserves the source-backed conversation", async () => {
  const payloads: Record<string, unknown>[] = [];
  const client = new StubClient((params) => {
    const input = params.input as Array<{ text: string }>;
    const payload = JSON.parse(input[0]!.text.match(/Completion payload: (\{.*\})/)![1]);
    payloads.push(payload);
    return result(payload.sessionId, "Candidate title", "Candidate content");
  });
  const controller = new ReadingNoteAiController({
    createClient: () => client,
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    store: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
    createId: () => "session-1"
  });
  controller.startCreate({
    bookTitle: "Book",
    chapterTitle: "Chapter",
    readingSegment: "Trusted source",
    userDraft: "Reader draft"
  });
  const proposed = await controller.send("session-1", "Rewrite this.");
  assert.equal(proposed.draft?.title, "Candidate title");

  const rejected = controller.reject("session-1");
  assert.equal(rejected.draft, undefined);
  assert.equal(rejected.messages.length, 2);
  assert.match(rejected.status, /not applied/i);

  await controller.send("session-1", "Try a different direction.");
  assert.equal(payloads[1]?.readingSegment, "Trusted source");
  assert.equal(payloads[1]?.userDraft, "Reader draft");
  assert.equal("proposal" in payloads[1]!, false);
});

test("saving a new note uses the Main-owned source and saving an edit uses a stale guard", async () => {
  const create = vi.fn().mockImplementation((input) => ({
    id: "created-note",
    createdAt: 200,
    updatedAt: 200,
    ...input
  }));
  const update = vi.fn().mockImplementation((input) => ({ ...savedNote, ...input }));
  const get = vi.fn().mockReturnValue(savedNote);
  let session = 0;
  const controller = new ReadingNoteAiController({
    createClient: () => new StubClient(() => result(
      "session-1",
      "A prompt",
      "Some content"
    )),
    workingDirectory: "/runtime",
    completeSkillPath: "/runtime/complete/SKILL.md",
    completeSkillInstructions: "complete",
    editSkillPath: "/runtime/edit/SKILL.md",
    editSkillInstructions: "edit",
    store: { create, get, update },
    createId: () => `session-${++session}`
  });

  controller.startCreate({
    bookId: "trusted-book-id",
    bookTitle: "Trusted book",
    chapterTitle: "Trusted chapter",
    readingSegment: "Trusted segment",
    userDraft: "My thought"
  });
  await controller.complete("session-1");
  controller.save("session-1", { title: "Edited title", content: "Edited content" });
  assert.deepEqual(create.mock.calls[0]?.[0], {
    sourceDraftId: "session-1",
    title: "Edited title",
    content: markdownToReadingNoteDocument("Edited content"),
    bookId: "trusted-book-id",
    bookTitle: "Trusted book",
    chapterTitle: "Trusted chapter"
  });

  controller.startEdit("note-1");
  controller.save("session-2", { title: "Changed", content: "Changed content" });
  assert.deepEqual(update.mock.calls[0]?.[0], {
    id: "note-1",
    baseRevision: 1,
    title: "Changed",
    content: markdownToReadingNoteDocument("Changed content")
  });
});
