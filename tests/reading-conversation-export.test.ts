import assert from "node:assert/strict";
import { test } from "vitest";
import { copyReadingConversation, formatReadingConversation } from "../src/renderer/reading-conversation-export";
import type { ChatSnapshot } from "../src/shared/contracts";

function snapshot(): ChatSnapshot {
  return {
    connection: "ready", connectionDetail: "", account: null,
    allowance: { phase: "unavailable", fiveHour: null, weekly: null, detail: "" },
    threadId: "thread-1", activeTurnId: null, managementBusy: false,
    activeConversationId: "conversation-1",
    conversations: [{ id: "conversation-1", title: "迴路", createdAt: 1, updatedAt: 2,
      source: { bookTitle: "系統之美", chapterTitle: "回饋" } }],
    messages: [
      { id: "u1", turnId: "t1", role: "user", text: "這是什麼意思？", status: "completed",
        quote: { text: "第一行   \n第二行" },
        readingSource: { bookTitle: "系統之美", chapterTitle: "回饋", readingSegment: "START 原文\n完整第二段 END" } },
      { id: "a1", turnId: "t1", role: "assistant", text: "這是第一個回答。", status: "completed" },
      { id: "u2", turnId: "t2", role: "user", text: "請畫出關係", status: "completed",
        readingSource: { bookTitle: "系統之美", chapterTitle: "回饋", readingSegment: "另一段完整原文" } },
      { id: "a2", turnId: "t2", role: "assistant", text: "第二個回答。", status: "completed" }
    ]
  };
}

test("copyable Markdown preserves speakers, ordered turns, exact quotes and each reading segment", () => {
  const markdown = formatReadingConversation(snapshot());
  assert.ok(markdown);
  assert.match(markdown, /系統之美/);
  assert.match(markdown, /回饋/);
  assert.ok(markdown.indexOf("這是什麼意思？") < markdown.indexOf("這是第一個回答。"));
  assert.ok(markdown.indexOf("這是第一個回答。") < markdown.indexOf("請畫出關係"));
  assert.match(markdown, /使用者/);
  assert.match(markdown, /AI/);
  assert.ok(markdown.includes("第一行   \n第二行"));
  assert.ok(markdown.includes("START 原文\n完整第二段 END"));
  assert.ok(markdown.includes("另一段完整原文"));
});

test("legacy reading conversations retain their quote and mark missing full context", () => {
  const chat = snapshot();
  delete chat.messages[0]!.readingSource;
  const markdown = formatReadingConversation(chat);
  assert.ok(markdown?.includes("第一行   \n第二行"));
  assert.match(markdown ?? "", /完整閱讀區段未保存/);
  assert.ok(markdown?.includes("另一段完整原文"));
});

test("copy excludes incomplete AI responses and indicates images need separate attachment", () => {
  const chat = snapshot();
  chat.messages.push({ id: "u3", turnId: "t3", role: "user", text: "看圖", status: "completed",
    images: [{ dataUrl: "data:image/png;base64,AA==" }] });
  chat.messages.push({ id: "a3", turnId: "t3", role: "assistant", text: "未完成", status: "streaming" });
  const markdown = formatReadingConversation(chat);
  assert.match(markdown ?? "", /1 張圖片/);
  assert.doesNotMatch(markdown ?? "", /未完成/);
  assert.doesNotMatch(markdown ?? "", /data:image/);
});

test("empty conversation cannot copy; clipboard rejection is reported", async () => {
  const chat = snapshot();
  chat.messages = [];
  assert.equal(formatReadingConversation(chat), null);
  let wrote = false;
  assert.equal(await copyReadingConversation(chat, async () => { wrote = true; }), false);
  assert.equal(wrote, false);
  await assert.rejects(() => copyReadingConversation(snapshot(), async () => { throw new Error("denied"); }), /denied/);
});

test('F63: copying retains the reference snapshot and readable decision, excluding internal update JSON', () => {
  const chat = snapshot();
  const content = { version: 1 as const, blocks: [{ id: 'b', type: 'paragraph' as const, props: {}, children: [], content: [{ type: 'text' as const, text: '原理解', styles: {} }] }] };
  chat.messages[0]!.noteReferences = [{ id: 'n', title: 'A筆記', content, bookTitle: 'A書', chapterTitle: 'A章', revision: 1 }];
  chat.messages[1]!.text = '修改說明。\n```reading-note-update\n{"version":1,"proposals":[]}\n```';
  chat.messages[1]!.noteUpdates = [{ id: 'p', noteId: 'n', baseRevision: 1, originalTitle: 'A筆記', title: '新理解', content, summary: '加入 B 書的理解', status: 'applied', appliedRevision: 2 }];
  const markdown = formatReadingConversation(chat)!;
  assert.match(markdown, /引用筆記：A筆記/); assert.match(markdown, /A書／A章 · 版本 1/);
  assert.match(markdown, /更新筆記：A筆記（已套用）/); assert.match(markdown, /加入 B 書的理解/);
  assert.doesNotMatch(markdown, /reading-note-update|"proposals"/);
});
