import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatController } from "../src/main/chat-controller";
import { SpawnedCodexAppServerClient } from "../src/main/codex-app-server-client";
import { LocalReadingNoteStore } from "../src/main/reading-note-store";
import { LocalReadingNoteAttachmentStore } from "../src/main/reading-note-attachment-store";
import { readingNoteArtifacts } from "../src/shared/reading-note-artifact";

test.skipIf(process.env.REAL_NOTE_READER_IMAGES !== "1")("B74 real model embeds the requested current reader attachment", async () => {
  const dir = mkdtempSync(join(tmpdir(), "b74-real-"));
  const client = new SpawnedCodexAppServerClient();
  const store = new LocalReadingNoteStore(dir);
  const assets = new LocalReadingNoteAttachmentStore(dir);
  const controller = new ChatController({ createClient: () => client, workingDirectory: dir, readingNoteStore: store, readingNoteAttachmentStore: assets });
  const image = { dataUrl: `data:image/png;base64,${readFileSync("tests/fixtures/thermostat-feedback.png").toString("base64")}` };
  let threadId: string | null = null;
  try {
    const connected = await controller.connect(); expect(connected.connection).toBe("ready");
    const model = connected.models?.find(m => m.isDefault)?.id ?? connected.models?.[0]?.id;
    await controller.sendMessage({ text: "幫我建立一張筆記，主要根據我附上的恆溫器示意圖說明負回饋如何縮小差距，並把這張圖放入筆記中。請讓我確認保存。", model, images: [image], context: {
      bookTitle: "回饋機制測試書", chapterTitle: "恆溫器負回饋", readingSegment: "恆溫器比較目標與室溫：低於目標時增加供熱，接近目標時減少供熱，使差距縮小。此區段沒有原書圖片，提問附件為讀者提供的輔助圖。"
    } });
    for (let i = 0; i < 240 && controller.getSnapshot().activeTurnId; i++) await new Promise(resolve => setTimeout(resolve, 500));
    const snapshot = controller.getSnapshot(); threadId = snapshot.threadId;
    const drafts = readingNoteArtifacts(snapshot.messages).drafts;
    mkdirSync("reports/b74-conversation-note-images", { recursive: true });
    writeFileSync("reports/b74-conversation-note-images/real-model.json", JSON.stringify({ model, messages: snapshot.messages.map(({ images, bookImages, ...m }) => ({ ...m, readerImageCount: images?.length, bookImageCount: bookImages?.length })), drafts }, null, 2));
    expect(snapshot.activeTurnId).toBeNull();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.content).toMatch(/!\[[^\]]+\]\(reader-image:1\)/);
    expect(drafts[0]!.content).not.toContain("book-image:");
    const prepared = controller.prepareReadingNoteDraft(drafts[0]!.draftId);
    expect(store.list()).toHaveLength(0);
    expect(assets.readDataUrl(prepared.stagedAttachmentIds[0]!)).toBe(image.dataUrl);
  } finally {
    if (threadId) await client.request("thread/archive", { threadId }).catch(() => undefined);
    controller.close(); rmSync(dir, { recursive: true, force: true });
  }
}, 160_000);
