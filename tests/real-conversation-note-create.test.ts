import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatController } from "../src/main/chat-controller";
import { SpawnedCodexAppServerClient } from "../src/main/codex-app-server-client";
import { LocalReadingNoteStore } from "../src/main/reading-note-store";
import { readingNoteArtifacts } from "../src/shared/reading-note-artifact";

test.skipIf(process.env.REAL_CONVERSATION_NOTE !== "1")("F73 authenticated model creates a note from the current segment and clarified discussion without a handwritten draft", async () => {
  const dir = mkdtempSync(join(tmpdir(), "f73-real-"));
  const client = new SpawnedCodexAppServerClient();
  const store = new LocalReadingNoteStore(join(dir, "notes"));
  const controller = new ChatController({ createClient: () => client, workingDirectory: dir, readingNoteStore: store });
  const source = { bookTitle: "測試書籍", chapterTitle: "回饋", readingSegment: "負回饋會根據目前狀態與目標之間的差距來調整行動，使差距縮小。回饋可能有時間延遲，過度頻繁調整反而可能引起震盪。" };
  async function wait() {
    for (let i = 0; i < 240; i++) {
      if (!controller.getSnapshot().activeTurnId) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("AI response timed out");
  }
  let threadId: string | null = null;
  try {
    const connected = await controller.connect();
    expect(connected.connection).toBe("ready");
    const model = connected.models?.find(m => m.isDefault)?.id ?? connected.models?.[0]?.id;
    await controller.sendMessage({ model, text: "我想用『每週檢查學習進度』理解負回饋：跟每週目標比較，再調整下週練習量。一天沒進步就頻繁改方法可能反而干擾學習。這個例子對嗎？簡短討論即可，先不要建立筆記。", context: source, readingSource: source });
    await wait();
    threadId = controller.getSnapshot().threadId;
    expect(readingNoteArtifacts(controller.getSnapshot().messages).drafts).toHaveLength(0);
    await controller.sendMessage({ model, text: "把剛才討論的負回饋整理成一張筆記，保留我們釐清的每週學習進度例子，讓我能修改、確認保存。", readingSource: source });
    await wait();
    const messages = controller.getSnapshot().messages;
    const drafts = readingNoteArtifacts(messages).drafts;
    mkdirSync("reports/f73-conversation-note", { recursive: true });
    writeFileSync("reports/f73-conversation-note/real-model.json", JSON.stringify({ model, messages, drafts }, null, 2));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.content).toMatch(/每週|每周/);
    expect(store.list()).toHaveLength(0);
    const prepared = controller.prepareReadingNoteDraft(drafts[0]!.draftId);
    expect(prepared.source).toEqual(source);
    expect(prepared.title).toBeTruthy();
  } finally {
    if (threadId) await client.request("thread/archive", { threadId }).catch(() => undefined);
    controller.close(); rmSync(dir, { recursive: true, force: true });
  }
}, 260_000);
