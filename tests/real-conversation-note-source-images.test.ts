import { expect, test } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatController } from "../src/main/chat-controller";
import { SpawnedCodexAppServerClient } from "../src/main/codex-app-server-client";
import { LocalReadingNoteStore } from "../src/main/reading-note-store";
import { LocalReadingNoteAttachmentStore } from "../src/main/reading-note-attachment-store";
import { readingNoteArtifacts } from "../src/shared/reading-note-artifact";
import { prepareReadingNoteAwareMessage } from "../src/renderer/reading-note-workflow";

test.skipIf(process.env.REAL_NOTE_SOURCE_IMAGES !== "1")("B73 real model selects a useful original figure after same-range discussion", async () => {
  const dir = mkdtempSync(join(tmpdir(), "b73-real-"));
  const client = new SpawnedCodexAppServerClient();
  const store = new LocalReadingNoteStore(join(dir, "notes"));
  const assets = new LocalReadingNoteAttachmentStore(join(dir, "notes"));
  const controller = new ChatController({ createClient: () => client, workingDirectory: dir, readingNoteStore: store, readingNoteAttachmentStore: assets });
  const image = { dataUrl: `data:image/png;base64,${readFileSync("tests/fixtures/thermostat-feedback.png").toString("base64")}` };
  const decorative = { dataUrl: `data:image/png;base64,${readFileSync("tests/fixtures/decorative-chapter-divider.png").toString("base64")}` };
  const segment = { bookId: "fixture", chapterId: "feedback", bookTitle: "回饋機制測試書", chapterTitle: "恆溫器負回饋",
    range: { start: 0, end: 150 }, readingSegment: "恆溫器比較目標與室溫：低於目標時增加供熱，接近目標時減少供熱，使差距縮小。\n[Book image 1]\n圖1顯示目標、比較器、加熱器與室溫回到比較器的負回饋迴路。\n[Book image 2]\n圖2是章節裝飾分隔線，不提供回饋機制資訊。", images: [image, decorative] };
  async function wait() {
    for (let i = 0; i < 240; i++) {
      if (!controller.getSnapshot().activeTurnId) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("AI response timed out");
  }
  let threadId: string | null = null;
  try {
    const connected = await controller.connect(); expect(connected.connection).toBe("ready");
    const model = connected.models?.find(m => m.isDefault)?.id ?? connected.models?.[0]?.id ?? "gpt-5.6-sol";
    const first = prepareReadingNoteAwareMessage({ text: "這張恆溫器圖怎麼說明負回饋？我覺得關鍵是溫度接近目標時供熱會減少。先討論即可，先不要建立筆記。", model, segment, readingNotePending: false });
    await controller.sendMessage(first.input); await wait();
    threadId = controller.getSnapshot().threadId;
    expect(readingNoteArtifacts(controller.getSnapshot().messages).drafts).toHaveLength(0);
    const second = prepareReadingNoteAwareMessage({ text: "把剛才討論的恆溫器負回饋機制整理成一張筆記，讓我修改確認保存。", model, segment, readingNotePending: false, lastProvidedKey: first.delivery.key });
    await controller.sendMessage(second.input); await wait();
    const messages = controller.getSnapshot().messages;
    const drafts = readingNoteArtifacts(messages).drafts;
    mkdirSync("reports/b73-conversation-note-source-images", { recursive: true });
    writeFileSync("reports/b73-conversation-note-source-images/real-model.json", JSON.stringify({ model, turns: messages.map(({ bookImages, ...message }) => ({ ...message, bookImageCount: bookImages?.length })), drafts }, null, 2));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.content).toMatch(/!\[[^\]]+\]\(book-image:1\)/);
    expect(drafts[0]!.content).not.toContain("book-image:2");
    expect(store.list()).toHaveLength(0);
    const prepared = controller.prepareReadingNoteDraft(drafts[0]!.draftId);
    expect(prepared.stagedAttachmentIds).toHaveLength(1);
    expect(assets.readDataUrl(prepared.stagedAttachmentIds[0]!)).toBe(image.dataUrl);
  } finally {
    if (threadId) await client.request("thread/archive", { threadId }).catch(() => undefined);
    controller.close(); rmSync(dir, { recursive: true, force: true });
  }
}, 260_000);
