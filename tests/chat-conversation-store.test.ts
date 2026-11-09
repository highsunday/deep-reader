import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  LocalChatConversationStore,
  limitStoredChatConversations,
  type StoredChatConversation
} from "../src/main/chat-conversation-store";

function conversation(index: number): StoredChatConversation {
  return {
    id: `conversation-${index}`,
    threadId: `thread-${index}`,
    title: `Question ${index}`,
    createdAt: index,
    updatedAt: index,
    source: index % 2 ? { bookTitle: "Book", chapterTitle: `Chapter ${index}` } : null,
    messages: Array.from({ length: index }, (_, messageIndex) => ({
      id: `message-${index}-${messageIndex}`,
      turnId: `turn-${index}`,
      role: messageIndex % 2 ? "assistant" as const : "user" as const,
      text: "Saved message",
      status: "completed" as const
    }))
  };
}

test("conversation history retains only the ten most recently updated conversations", () => {
  const retained = limitStoredChatConversations(
    Array.from({ length: 12 }, (_, index) => conversation(index + 1))
  );
  assert.deepEqual(retained.map(({ id }) => id),
    Array.from({ length: 10 }, (_, index) => `conversation-${index + 3}`));
  assert.equal(retained.at(-1)?.messages.length, 12);
});

test("conversation history is saved atomically and interrupted replies recover as failed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-conversations-"));
  try {
    const store = new LocalChatConversationStore(directory);
    const saved = conversation(1);
    saved.messages[0]!.status = "streaming";
    store.save({ version: 1, selectedConversationId: saved.id, conversations: [saved] });
    const loaded = store.load();
    assert.equal(loaded.selectedConversationId, saved.id);
    assert.equal(loaded.conversations[0]?.messages[0]?.status, "failed");
    assert.match(await readFile(join(directory, "conversations.json"), "utf8"), /conversation-1/);

    await writeFile(join(directory, "conversations.json"), "broken", "utf8");
    assert.throws(() => store.load(), /Unable to load local AI conversation history/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("conversation history preserves a structured original-selection quote", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-quoted-conversation-"));
  try {
    const store = new LocalChatConversationStore(directory);
    const saved = conversation(1);
    saved.messages[0]!.quote = { text: "The complete selected passage." };
    store.save({ version: 1, selectedConversationId: saved.id, conversations: [saved] });

    assert.deepEqual(store.load().conversations[0]?.messages[0]?.quote, {
      text: "The complete selected passage."
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("conversation history preserves the full reading segment snapshot for each user turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-export-source-"));
  try {
    const store = new LocalChatConversationStore(directory);
    const saved = conversation(2);
    saved.messages[0]!.readingSource = {
      bookTitle: "系統之美", chapterTitle: "回饋",
      readingSegment: "完整第一段\n完整第二段"
    };
    store.save({ version: 1, selectedConversationId: saved.id, conversations: [saved] });
    assert.deepEqual(store.load().conversations[0]?.messages[0]?.readingSource,
      saved.messages[0]!.readingSource);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("conversation history preserves a structured reading-note intent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-intent-conversation-"));
  try {
    const store = new LocalChatConversationStore(directory);
    const saved = conversation(1);
    saved.messages[0]!.intent = "createReadingNote";
    store.save({ version: 1, selectedConversationId: saved.id, conversations: [saved] });

    assert.equal(
      store.load().conversations[0]?.messages[0]?.intent,
      "createReadingNote"
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("conversation history restores pasted images on user messages", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-image-conversation-"));
  try {
    const store = new LocalChatConversationStore(directory);
    const saved = conversation(1);
    const image = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
    saved.messages[0]!.images = [image];
    store.save({ version: 1, selectedConversationId: saved.id, conversations: [saved] });
    assert.deepEqual(store.load().conversations[0]?.messages[0]?.images, [image]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("conversation history preserves App-supplied Create Note images separately from pasted images", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-note-source-images-"));
  try {
    const store = new LocalChatConversationStore(directory);
    const saved = conversation(1);
    const image = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
    saved.messages[0]!.intent = "createReadingNote";
    saved.messages[0]!.bookImages = [image];
    store.save({ version: 1, selectedConversationId: saved.id, conversations: [saved] });
    const restored = store.load().conversations[0]!.messages[0]!;
    assert.deepEqual(restored.bookImages, [image]);
    assert.equal(restored.images, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
