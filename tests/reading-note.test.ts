import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, vi } from "vitest";
import {
  ChatController,
  composeCodexInput,
  composeCodexTurnInput,
  readerDeveloperInstructions
} from "../src/main/chat-controller";
import { LocalReadingNoteStore } from "../src/main/reading-note-store";
import { LocalReadingNoteAttachmentStore } from "../src/main/reading-note-attachment-store";
import {
  acceptedSourceImageMarkdown,
  validatedSourceImageReferences
} from "../src/shared/reading-note-book-images";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import {
  bookImagesForDraft,
  readingNoteArtifacts,
  readingNoteWorkflowPending,
  stripReadingNoteArtifacts
} from "../src/renderer/reading-note-artifact";

function artifact(language: string, value: unknown): string {
  return `\`\`\`${language}\n${JSON.stringify(value)}\n\`\`\``;
}

const draft = {
  version: 2 as const,
  draftId: "draft-relativity",
  title: "質量與能量的關係",
  content: "質能等價表示質量本身對應能量；在靜止系中可寫成 $E=mc^2$。"
};

const sourceImage = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };

test("the bounded app-provided skill creates exactly one source-free atomic draft", () => {
  const skill = readFileSync(".agents/skills/create-reading-note/SKILL.md", "utf8");
  const instructions = readerDeveloperInstructions();
  const input = composeCodexInput({
    text: "請產生一張關於質能等價原因的筆記",
    intent: "createReadingNote",
    context: {
      bookTitle: "Relativity",
      chapterTitle: "Mass and energy",
      readingSegment: "Mass and energy are two descriptions of one conserved quantity."
    }
  });

  assert.match(skill, /一次只(?:能|產生).*一張|exactly one/i);
  assert.match(skill, /普通問答|ordinary questions/i);
  assert.match(skill, /過寬|multiple.*concept|多個.*觀念/i);
  assert.match(skill, /內容不足|insufficient/i);
  assert.match(skill, /不得.*(?:外部知識|網路|工具)|(?:must|do) not.*(?:external knowledge|network|tools)/i);
  assert.match(skill, /pyramid|top-down/i);
  assert.match(skill, /2[–-]4[^\n]*`##`/i);
  assert.match(skill, /do not use `#` or `###`/i);
  assert.match(skill, /```reading-note-draft/);
  assert.match(instructions, /<app-provided-skill name="create-reading-note">/);
  assert.match(instructions, /explicit natural-language request/i);
  assert.match(input, /\$create-reading-note/);
  assert.match(input, /Current START\/END reading segment:[\s\S]*Mass and energy/);
  assert.match(input, /App adds the book and chapter source/i);
});

test("only the explicit create action attaches the creation skill; natural language uses developer routing", () => {
  const readingNoteSkillPath = "/runtime/.agents/skills/create-reading-note/SKILL.md";
  const typed = composeCodexTurnInput({
    text: "請幫我產生一張閱讀筆記",
    intent: "createReadingNote",
    context: { readingSegment: "Only this segment." }
  }, { readingNoteSkillPath });
  const naturalLanguage = composeCodexTurnInput({
    text: "幫我產生一張關於作者因果推論的筆記"
  }, { readingNoteSkillPath });

  const expected = {
    type: "skill",
    name: "create-reading-note",
    path: readingNoteSkillPath
  };
  assert.deepEqual(typed[1], expected);
  assert.equal(naturalLanguage.some(item => item.type === "skill"), false);
  const update = composeCodexTurnInput({ text: "幫我更新這個筆記", noteReferenceIds: ["a"] }, { readingNoteSkillPath });
  assert.equal(update.some(item => item.type === "skill"), false);
});

test("a persisted create-reading-note request stays pending until a valid draft arrives", () => {
  const started = [{
    id: "user-start",
    turnId: "turn-start",
    role: "user" as const,
    text: "請幫我產生一張閱讀筆記",
    intent: "createReadingNote" as const,
    status: "completed" as const
  }, {
    id: "assistant-question",
    turnId: "turn-start",
    role: "assistant" as const,
    text: "你最想記住哪一個具體觀念？",
    status: "completed" as const
  }];
  assert.equal(readingNoteWorkflowPending(started), true);
  assert.equal(readingNoteWorkflowPending([...started, {
    id: "user-answer",
    turnId: "turn-answer",
    role: "user" as const,
    text: "我們如何與感受疏離",
    status: "completed" as const
  }]), true);
  assert.equal(readingNoteWorkflowPending([...started, {
    id: "assistant-draft",
    turnId: "turn-draft",
    role: "assistant" as const,
    text: artifact("reading-note-draft", draft),
    status: "completed" as const
  }]), false);
});

test("reading-note artifacts reject extra fields, multiple drafts, and blank content", () => {
  const saved = {
    version: 1,
    draftId: draft.draftId,
    note: {
      id: "note-1",
      prompt: draft.title,
      content: draft.content,
      bookTitle: "Relativity",
      chapterTitle: "Mass and energy",
      createdAt: 1_800_000_000_000
    }
  };
  const messages = [
    { role: "assistant" as const, text: `草稿完成。\n${artifact("reading-note-draft", draft)}` },
    { role: "assistant" as const, text: artifact("reading-note-saved", saved) }
  ];
  assert.deepEqual(readingNoteArtifacts(messages), {
    drafts: [draft],
    saved: [saved]
  });
  assert.equal(stripReadingNoteArtifacts(messages[0]!.text), "草稿完成。");

  assert.deepEqual(readingNoteArtifacts([
    { role: "assistant", text: artifact("reading-note-draft", {
      ...draft,
      bookTitle: "AI must not supply this"
    }) }
  ]).drafts, []);
  assert.deepEqual(readingNoteArtifacts([
    { role: "assistant", text: artifact("reading-note-draft", [{ ...draft }, {
      ...draft, draftId: "draft-two"
    }]) }
  ]).drafts, []);
  assert.deepEqual(readingNoteArtifacts([{
    role: "assistant",
    text: `${artifact("reading-note-draft", draft)}\n${artifact("reading-note-draft", {
      ...draft,
      draftId: "draft-two"
    })}`
  }]).drafts, []);
  assert.deepEqual(readingNoteArtifacts([
    { role: "assistant", text: artifact("reading-note-draft", { ...draft, content: " " }) }
  ]).drafts, []);
});

test("version 3 accepts only standalone numbered source-image markers", () => {
  const imageDraft = { ...draft, version: 3, content: "關鍵關係。\n\n![關係圖](book-image:1)\n\n## 推論\n\n圖示呈現連結。" };
  assert.deepEqual(readingNoteArtifacts([{
    role: "assistant", text: artifact("reading-note-draft", imageDraft)
  }]).drafts, [imageDraft]);
  const textOnly = { ...imageDraft, content: "這個觀念只需要文字說明。" };
  assert.deepEqual(readingNoteArtifacts([{
    role: "assistant", text: artifact("reading-note-draft", textOnly)
  }]).drafts, [textOnly]);
  for (const content of [
    "說明 ![圖](book-image:1)",
    "![外部圖](https://example.com/image.png)",
    "![圖](data:image/png;base64,AAAA)",
    "![圖](book-image:0)"
  ]) {
    assert.deepEqual(readingNoteArtifacts([{
      role: "assistant", text: artifact("reading-note-draft", { ...imageDraft, content })
    }]).drafts, []);
  }
});

test("a later draft cannot borrow book images from an earlier completed Create Note", () => {
  const messages = [
    { role: "user" as const, text: "first", turnId: "turn-1", intent: "createReadingNote" as const,
      bookImages: [sourceImage] },
    { role: "assistant" as const, text: artifact("reading-note-draft", draft), turnId: "turn-1" },
    { role: "user" as const, text: "another topic", turnId: "turn-2" },
    { role: "assistant" as const, text: artifact("reading-note-draft", { ...draft, draftId: "second" }), turnId: "turn-2" }
  ];
  assert.deepEqual(bookImagesForDraft(messages, 3), []);
});

test("AI note image markers must select current book images and preserve all other proposal text", () => {
  const proposal = "碗形圖解。\n\n![原文圖](book-image:1)\n\n## 收斂\n\n軌跡下降。";
  const applied = "碗形圖解。\n\n![原文圖](reading-note-asset:asset-1)\n\n## 收斂\n\n軌跡下降。";
  assert.deepEqual(validatedSourceImageReferences(proposal, [sourceImage]), [{ index: 1, alt: "原文圖" }]);
  assert.equal(acceptedSourceImageMarkdown(proposal, applied, [sourceImage]), true);
  assert.equal(acceptedSourceImageMarkdown(proposal, applied.replace("軌跡下降", "不同內容"), [sourceImage]), false);
  assert.equal(acceptedSourceImageMarkdown(proposal, applied.replace("asset-1", "https://example.com/image"), [sourceImage]), false);
  assert.throws(() => validatedSourceImageReferences("![圖](book-image:2)", [sourceImage]), /unavailable/i);
  assert.throws(() => validatedSourceImageReferences("![圖](https://example.com/image.png)", [sourceImage]), /outside/i);
});

test("Create Note saves a selected book image at the model-chosen position as a managed attachment", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-note-book-image-"));
  try {
    const noteStore = new LocalReadingNoteStore(directory);
    const attachments = new LocalReadingNoteAttachmentStore(directory);
    const imageDraft = { ...draft, version: 3, content: "核心說明。\n\n![原文圖解](book-image:1)\n\n## 解釋\n\n關係如圖所示。" };
    const messages = [{
      id: "user-note", turnId: "turn-1", role: "user" as const,
      text: "請建立筆記", intent: "createReadingNote" as const,
      bookImages: [sourceImage], status: "completed" as const
    }, {
      id: "assistant-note", turnId: "turn-1", role: "assistant" as const,
      text: artifact("reading-note-draft", imageDraft), status: "completed" as const
    }];
    const controller = new ChatController({
      createClient: () => { throw new Error("AI should not be used for submission"); },
      workingDirectory: directory,
      conversationStore: {
        load: () => ({ version: 1, selectedConversationId: "conversation-1", conversations: [{
          id: "conversation-1", threadId: "thread-1", title: "Create note",
          createdAt: 1, updatedAt: 1,
          source: { bookTitle: "Book", chapterTitle: "Chapter" }, messages
        }] }),
        save: () => undefined
      },
      readingNoteStore: noteStore,
      readingNoteAttachmentStore: attachments
    });
    controller.submitReadingNote(imageDraft.draftId);
    const note = noteStore.list()[0]!;
    assert.deepEqual(note.content.blocks.map(block => block.type), ["paragraph", "image", "heading", "paragraph"]);
    const assetId = String(note.content.blocks[1]!.props.assetId);
    assert.equal(note.content.blocks[1]!.props.alt, "原文圖解");
    assert.equal(attachments.readDataUrl(assetId), sourceImage.dataUrl);
    assert.equal(new LocalReadingNoteAttachmentStore(directory).readDataUrl(assetId), sourceImage.dataUrl);
    assert.match(controller.getSnapshot().messages.at(-1)!.text, /reading-note-asset:/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Create Note refuses an image number absent from its App-supplied segment", () => {
  const create = vi.fn();
  const imageDraft = { ...draft, version: 3, content: "說明。\n\n![不在此區段](book-image:2)" };
  const controller = new ChatController({
    createClient: () => { throw new Error("AI should not be used for submission"); },
    workingDirectory: "/tmp/deep-reading-note-invalid-image",
    conversationStore: {
      load: () => ({ version: 1, selectedConversationId: "conversation-1", conversations: [{
        id: "conversation-1", threadId: "thread-1", title: "Create note",
        createdAt: 1, updatedAt: 1,
        source: { bookTitle: "Book", chapterTitle: "Chapter" },
        messages: [{ id: "user", turnId: "turn-1", role: "user", text: "筆記", intent: "createReadingNote",
          bookImages: [sourceImage], status: "completed" },
        { id: "assistant", turnId: "turn-1", role: "assistant",
          text: artifact("reading-note-draft", imageDraft), status: "completed" }]
      }] }),
      save: () => undefined
    },
    readingNoteStore: { create, list: vi.fn(() => []) },
    readingNoteAttachmentStore: { stage: vi.fn(), reconcile: vi.fn(), discardStaged: vi.fn(), prepareDocument: vi.fn() }
  });
  assert.throws(() => controller.submitReadingNote(imageDraft.draftId), /Book image 2 is unavailable/);
  assert.equal(create.mock.calls.length, 0);
});

test("the formal reading-note store writes atomically, reloads, and rejects a repeated draft", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-notes-"));
  try {
    const store = new LocalReadingNoteStore(directory, {
      createId: () => "note-1",
      now: () => 1_800_000_000_000
    });
    const note = store.create({
      sourceDraftId: draft.draftId,
      title: draft.title,
      content: markdownToReadingNoteDocument(draft.content),
      bookTitle: "Relativity",
      chapterTitle: "Mass and energy"
    });
    assert.deepEqual(note, {
      id: "note-1",
      sourceDraftId: draft.draftId,
      title: draft.title,
      content: markdownToReadingNoteDocument(draft.content),
      bookTitle: "Relativity",
      chapterTitle: "Mass and energy",
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
      revision: 1
    });
    assert.deepEqual(new LocalReadingNoteStore(directory).list(), [note]);
    assert.match(await readFile(join(directory, "reading-notes.json"), "utf8"), /note-1/);
    await assert.rejects(readFile(join(directory, "reading-notes.json.next"), "utf8"));
    assert.throws(() => store.create({
      sourceDraftId: draft.draftId,
      title: draft.title,
      content: markdownToReadingNoteDocument(draft.content),
      bookTitle: "Relativity",
      chapterTitle: "Mass and energy"
    }), /already been submitted/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the chat controller submits only a persisted draft with App-owned conversation source", () => {
  const create = vi.fn((input) => ({
    id: "note-1",
    ...input,
    createdAt: 1_800_000_000_000
  }));
  const save = vi.fn();
  const controller = new ChatController({
    createClient: () => { throw new Error("AI should not be used for submission"); },
    workingDirectory: "/tmp/deep-reading-note-submit",
    conversationStore: {
      load: () => ({
        version: 1 as const,
        selectedConversationId: "conversation-1",
        conversations: [{
          id: "conversation-1",
          threadId: "thread-1",
          title: "Create one note",
          createdAt: 1,
          updatedAt: 1,
          source: { bookTitle: "Relativity", chapterTitle: "Mass and energy" },
          messages: [{
            id: "assistant-draft",
            turnId: "turn-1",
            role: "assistant" as const,
            text: artifact("reading-note-draft", draft),
            status: "completed" as const
          }]
        }]
      }),
      save
    },
    readingNoteStore: { create, list: vi.fn(() => []) },
    createMessageId: () => "saved-message",
    now: () => 1_800_000_000_000
  });

  const snapshot = controller.submitReadingNote(draft.draftId);
  assert.deepEqual(create.mock.calls[0]?.[0], {
    sourceDraftId: draft.draftId,
    title: draft.title,
    content: markdownToReadingNoteDocument(draft.content),
    bookTitle: "Relativity",
    chapterTitle: "Mass and energy"
  });
  assert.match(snapshot.messages.at(-1)?.text ?? "", /```reading-note-saved/);
  assert.doesNotMatch(snapshot.messages.at(-1)?.text ?? "", /readingSegment/);
  assert.equal(save.mock.calls.length, 1);
  assert.throws(() => controller.submitReadingNote(draft.draftId), /already been submitted/i);
  assert.throws(() => controller.submitReadingNote("unknown-draft"), /draft was not found/i);
});

test("the chat controller exposes only the selected conversation's completed visible transcript", () => {
  const controller = new ChatController({
    createClient: () => { throw new Error("AI is not needed for transcript formatting"); },
    workingDirectory: "/tmp/deep-reading-note-context",
    conversationStore: {
      load: () => ({
        version: 1 as const,
        selectedConversationId: "conversation-1",
        conversations: [{
          id: "conversation-1",
          threadId: "thread-1",
          title: "Clarify one idea",
          createdAt: 1,
          updatedAt: 1,
          source: { bookTitle: "Another book", chapterTitle: "Another chapter" },
          messages: [{
            id: "user-1",
            turnId: "turn-1",
            role: "user" as const,
            text: "Why is this a trigger rather than a cause?",
            quote: { text: "Other people are a stimulus for our feelings." },
            status: "completed" as const
          }, {
            id: "assistant-1",
            turnId: "turn-1",
            role: "assistant" as const,
            text: `The distinction preserves agency.\n${artifact("reading-note-draft", draft)}`,
            status: "completed" as const
          }, {
            id: "assistant-failed",
            turnId: "turn-2",
            role: "assistant" as const,
            text: "Do not include this failed reply.",
            status: "failed" as const
          }, {
            id: "assistant-artifact",
            turnId: "turn-3",
            role: "assistant" as const,
            text: artifact("reading-note-saved", {
              version: 1,
              draftId: draft.draftId,
              note: {
                id: "note-1",
                title: draft.title,
                content: draft.content,
                bookTitle: "Book",
                chapterTitle: "Chapter",
                createdAt: 1
              }
            }),
            status: "completed" as const
          }]
        }]
      }),
      save: () => undefined
    }
  });

  const transcript = (controller as ChatController & {
    getReadingNoteConversationContext(): string | undefined;
  }).getReadingNoteConversationContext();
  assert.equal(transcript, [
    "User quote:\nOther people are a stimulus for our feelings.",
    "User:\nWhy is this a trigger rather than a cause?",
    "AI:\nThe distinction preserves agency."
  ].join("\n\n"));
});

test("the preload bridge creates notes only through an opaque source-bound draft", () => {
  const source = readFileSync(new URL("../src/preload/preload.ts", import.meta.url), "utf8");
  assert.match(source, /submitReadingNote:\s*\(draftId:\s*string\)/);
  assert.match(source, /ipcRenderer\.invoke\("chat:submit-reading-note",\s*draftId\)/);
  assert.match(source, /readingNotes:\s*Object\.freeze/);
  assert.match(source, /ipcRenderer\.invoke\("reading-notes:list",\s*input\)/);
  assert.match(source, /ipcRenderer\.invoke\("reading-notes:trash",\s*noteId\)/);
  assert.match(source, /reading-notes:begin-draft/);
  assert.match(source, /reading-notes:create/);
  assert.doesNotMatch(source, /create:\s*\([^)]*(?:bookTitle|chapterTitle|readingSegment)/);
  assert.doesNotMatch(source, /submitReadingNote:\s*\([^)]*(?:prompt|content|bookTitle|chapterTitle)/);
});

test("submission rejects a draft whose App-owned book or chapter source is incomplete", () => {
  const create = vi.fn();
  const controller = new ChatController({
    createClient: () => { throw new Error("AI should not be used for submission"); },
    workingDirectory: "/tmp/deep-reading-note-source",
    conversationStore: {
      load: () => ({
        version: 1 as const,
        selectedConversationId: "conversation-1",
        conversations: [{
          id: "conversation-1",
          threadId: "thread-1",
          title: "Incomplete source",
          createdAt: 1,
          updatedAt: 1,
          source: { bookTitle: "Relativity" },
          messages: [{
            id: "assistant-draft",
            turnId: "turn-1",
            role: "assistant" as const,
            text: artifact("reading-note-draft", draft),
            status: "completed" as const
          }]
        }]
      }),
      save: () => undefined
    },
    readingNoteStore: { create, list: vi.fn(() => []) }
  });

  assert.throws(
    () => controller.submitReadingNote(draft.draftId),
    /complete App-owned source/i
  );
  assert.equal(create.mock.calls.length, 0);
});

test("F73 prepares without saving, keeps originating source, and submits the reader's edited document once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "f73-conversation-note-"));
  try {
    const store = new LocalReadingNoteStore(directory);
    const attachments = new LocalReadingNoteAttachmentStore(directory);
    const imageDraft = { ...draft, version: 3, content: "討論後的理解 $E=mc^2$。\n\n![原圖](book-image:1)" };
    const controller = new ChatController({
      createClient: () => { throw new Error("No AI during preview or save"); }, workingDirectory: directory,
      readingNoteStore: store, readingNoteAttachmentStore: attachments,
      conversationStore: { load: () => ({ version: 1, selectedConversationId: "c", conversations: [{
        id: "c", title: "討論", threadId: "t", createdAt: 1, updatedAt: 1,
        source: { bookTitle: "Later book", chapterTitle: "Later chapter" },
        messages: [{ id: "u", role: "user", turnId: "one", text: "把剛才討論的質能關係整理成筆記", status: "completed",
          bookImages: [sourceImage], readingSource: { bookTitle: "Original book", chapterTitle: "Original chapter", readingSegment: "Only this segment." } },
          { id: "a", role: "assistant", turnId: "one", text: artifact("reading-note-draft", imageDraft), status: "completed" }]
      }] }), save: () => undefined }
    });
    const prepared = controller.prepareReadingNoteDraft(draft.draftId);
    assert.equal(store.list().length, 0);
    assert.equal(prepared.source.bookTitle, "Original book");
    assert.equal(prepared.source.readingSegment, "Only this segment.");
    assert.equal(prepared.stagedAttachmentIds.length, 1);
    assert.match(prepared.markdown, /reading-note-asset:/);
    assert.equal(attachments.readDataUrl(prepared.stagedAttachmentIds[0]!), sourceImage.dataUrl);
    const content = { ...prepared.content, blocks: [...prepared.content.blocks, ...markdownToReadingNoteDocument("我修改後的理解。").blocks] };
    const saved = controller.saveReadingNoteDraft({ draftId: draft.draftId, title: "我修改的標題", content });
    assert.equal(saved.title, "我修改的標題");
    assert.equal(saved.bookTitle, "Original book");
    assert.equal(saved.chapterTitle, "Original chapter");
    assert.match(JSON.stringify(saved.content), /我修改後的理解/);
    assert.equal(store.list().length, 1);
    assert.equal(readingNoteArtifacts(controller.getSnapshot().messages).saved[0]!.note.prompt, saved.title);
    assert.throws(() => controller.saveReadingNoteDraft({ draftId: draft.draftId, title: "Duplicate", content }), /already been submitted/);
    assert.throws(() => controller.prepareReadingNoteDraft("unknown"), /not found/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("F73 a natural creation request gets the current source even when repeated delivery is omitted", () => {
  const text = composeCodexInput({ text: "把剛才討論的回饋整理成一張筆記", readingSource: {
    bookTitle: "系統", chapterTitle: "回饋", readingSegment: "The current segment, not a previous one."
  } });
  assert.match(text, /Current START\/END reading segment:\nThe current segment/);
  const skill = readerDeveloperInstructions();
  assert.match(skill, /clarified understanding in the current reading conversation/);
  assert.match(skill, /No handwritten draft is required/);
  assert.match(skill, /Never present a discussion inference as the author's claim/);
});

test("F73 natural-language drafts reuse only images from the identical current source snapshot", () => {
  const source = { bookTitle: "Book", chapterTitle: "Chapter", readingSegment: "Diagram [Book image 1]", bookImageCount: 1 };
  const messages = [
    { role: "user" as const, text: "請解釋", turnId: "first", readingSource: source, bookImages: [sourceImage] },
    { role: "user" as const, text: "建立筆記", turnId: "second", readingSource: source },
    { role: "assistant" as const, text: artifact("reading-note-draft", draft), turnId: "second" }
  ];
  assert.deepEqual(bookImagesForDraft(messages, 2), [sourceImage]);
  assert.deepEqual(bookImagesForDraft([messages[0]!, { ...messages[1]!, readingSource: { ...source, readingSegment: "Different segment" } }, messages[2]!], 2), []);
});

test("B74 embedded Markdown fences do not truncate draft or saved JSON", () => {
  const nested = { ...draft, version: 3, content: "說明。\n\n```text\nA --> B\n```\n\n關係待確認。" };
  const response = artifact("reading-note-draft", nested);
  assert.deepEqual(readingNoteArtifacts([{ role: "assistant", text: response }]).drafts, [nested]);
  assert.equal(stripReadingNoteArtifacts("完成。\n" + response + "\n結尾。"), "完成。\n\n結尾。");
  const saved = { version: 1, draftId: draft.draftId, note: { id: "saved", prompt: draft.title,
    content: nested.content, bookTitle: "Book", chapterTitle: "Chapter", createdAt: 1 } };
  assert.deepEqual(readingNoteArtifacts([{ role: "assistant", text: artifact("reading-note-saved", saved) }]).saved, [saved]);
  assert.equal(stripReadingNoteArtifacts(artifact("reading-note-saved", saved)), "");
});

test("B74 reader attachment markers are distinct from book image markers", () => {
  const attached = { ...draft, version: 3, content: "讀者示意。\n\n![讀者圖](reader-image:1)" };
  assert.deepEqual(readingNoteArtifacts([{ role: "assistant", text: artifact("reading-note-draft", attached) }]).drafts, [attached]);
});

test("B74 current reader image survives preview, edited save and reload with nested code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "b74-reader-image-"));
  try {
    const store = new LocalReadingNoteStore(directory);
    const attachments = new LocalReadingNoteAttachmentStore(directory);
    const content = "讀者提供的關係圖。\n\n```text\nA --> B?\n```\n\n![讀者圖](reader-image:1)\n\n![再次說明](reader-image:1)";
    const messages = [
      { id: "u", role: "user" as const, turnId: "t", text: "依照附圖建立筆記並放入圖片", images: [sourceImage], status: "completed" as const },
      { id: "a", role: "assistant" as const, turnId: "t", text: artifact("reading-note-draft", { ...draft, version: 3, content }), status: "completed" as const }
    ];
    const controller = new ChatController({
      createClient: () => { throw new Error("No AI on prepare/save"); }, workingDirectory: directory,
      readingNoteStore: store, readingNoteAttachmentStore: attachments,
      conversationStore: { load: () => ({ version: 1, selectedConversationId: "c", conversations: [{
        id: "c", title: "附件", threadId: "t", createdAt: 1, updatedAt: 1,
        source: { bookTitle: "Book", chapterTitle: "Chapter" }, messages
      }] }), save: () => undefined }
    });
    const prepared = controller.prepareReadingNoteDraft(draft.draftId);
    assert.equal(store.list().length, 0);
    assert.equal(prepared.stagedAttachmentIds.length, 1);
    assert.equal(prepared.content.blocks.filter(b => b.type === "image").length, 2);
    assert.match(prepared.markdown, /```text/);
    assert.doesNotMatch(prepared.markdown, /reader-image:/);
    assert.equal(attachments.readDataUrl(prepared.stagedAttachmentIds[0]!), sourceImage.dataUrl);
    const saved = controller.saveReadingNoteDraft({ draftId: draft.draftId, title: "附圖筆記", content: prepared.content });
    assert.equal(new LocalReadingNoteStore(directory).list()[0]!.title, saved.title);
    const image = saved.content.blocks.find(b => b.type === "image")!;
    assert.equal(new LocalReadingNoteAttachmentStore(directory).readDataUrl(String(image.props.assetId)), sourceImage.dataUrl);
    assert.equal(stripReadingNoteArtifacts("說明\n" + messages[1]!.text), "說明");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("B74 direct submission uses current reader attachments and rejects missing or borrowed images", async () => {
  for (const [marker, currentImages, succeeds] of [
    ["reader-image:1", [sourceImage], true],
    ["reader-image:2", [sourceImage], false],
    ["reader-image:1", [], false],
    ["book-image:1", [sourceImage], false]
  ] as const) {
    const directory = await mkdtemp(join(tmpdir(), "b74-submit-image-"));
    try {
      const store = new LocalReadingNoteStore(directory);
      const attachments = new LocalReadingNoteAttachmentStore(directory);
      const controller = new ChatController({
        createClient: () => { throw new Error("No AI on save"); }, workingDirectory: directory,
        readingNoteStore: store, readingNoteAttachmentStore: attachments,
        conversationStore: { load: () => ({ version: 1, selectedConversationId: "c", conversations: [{
          id: "c", title: "附件", threadId: "t", createdAt: 1, updatedAt: 1,
          source: { bookTitle: "Book", chapterTitle: "Chapter" }, messages: [
            { id: "old", role: "user", turnId: "old", text: "舊圖", images: [sourceImage], status: "completed" },
            { id: "u", role: "user", turnId: "t", text: "建立筆記", images: [...currentImages], status: "completed" },
            { id: "a", role: "assistant", turnId: "t", status: "completed", text: artifact("reading-note-draft", { ...draft, version: 3, content: `說明。\n\n![圖](${marker})` }) }
          ]
        }] }), save: () => undefined }
      });
      if (succeeds) {
        controller.submitReadingNote(draft.draftId);
        const note = store.list()[0]!;
        assert.equal(attachments.readDataUrl(String(note.content.blocks[1]!.props.assetId)), sourceImage.dataUrl);
      } else {
        assert.throws(() => controller.prepareReadingNoteDraft(draft.draftId), /unavailable/);
        assert.throws(() => controller.submitReadingNote(draft.draftId), /unavailable/);
        assert.equal(store.list().length, 0);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});
