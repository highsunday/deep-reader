import assert from "node:assert/strict";
import { test } from "vitest";
import { composeCodexInput, composeCodexTurnInput } from "../src/main/chat-controller";

test("pasted images reach Codex separately from book images", () => {
  const items = composeCodexTurnInput({
    text: "Compare these",
    context: { readingSegment: "[Book image 1]", images: [{ dataUrl: "data:image/png;base64,Ym9vaw==" }] },
    images: [{ dataUrl: "data:image/png;base64,dXNlcg==" }]
  }, {});
  assert.match(String(items[0]?.text), /reader.*image|attached image/i);
  assert.deepEqual(items.slice(1), [
    { type: "image", url: "data:image/png;base64,Ym9vaw==" },
    { type: "image", url: "data:image/png;base64,dXNlcg==" }
  ]);
});
import {
  readingSegmentShortcutFallbackError,
  readingSegmentShortcutsDisabled,
  readingSegmentShortcutText
} from "../src/renderer/reading-segment-shortcuts";

const context = {
  bookTitle: "Thinking in Systems",
  chapterTitle: "Feedback Loops",
  readingSegment: "Inside the START and END boundaries."
};

test("F46 T1: formula images are sent as visual inputs matched to source markers", () => {
  const dataUrl = "data:image/png;base64,aGVsbG8=";
  const items = composeCodexTurnInput({
    text: "請翻譯這段",
    context: { ...context, readingSegment: "The rule is [Book image 1].", images: [{ dataUrl }] }
  }, {});
  assert.match(String(items[0]?.text), /\[Book image 1\]/);
  assert.match(String(items[0]?.text), /uncertain|illegible/i);
  assert.deepEqual(items[1], { type: "image", url: dataUrl });
});

test("a reading guide builds an outline, concepts, and active-reading prompts from the reading segment", () => {
  const input = composeCodexInput({
    text: "請為這段產生導讀",
    intent: "readingGuide",
    context
  });

  assert.match(input, /Current START\/END reading segment:[\s\S]*Inside the START and END boundaries\./);
  assert.match(input, /structured outline/i);
  assert.match(input, /key concepts/i);
  assert.match(input, /active-reading prompts/i);
  assert.match(input, /plain, everyday language/i);
  assert.match(input, /what the segment is trying to say and why it matters/i);
  assert.match(input, /define unavoidable terms/i);
  assert.match(input, /preserve the author's important distinctions/i);
  assert.match(input, /same language as the user's question/i);
  assert.match(input, /Do not assume book content that was not provided/);
});

test("the right-sidebar detailed explanation expands the whole reading segment", () => {
  const input = composeCodexInput({
    text: "請展開並詳細說明這段內容",
    intent: "explainReadingSegment",
    context
  });

  assert.match(input, /explain the entire reading segment/i);
  assert.match(input, /meaning, key concepts, reasoning relationships/i);
  assert.match(input, /how its parts connect/i);
  assert.match(input, /plain-language summary/i);
  assert.match(input, /short, direct sentences/i);
  assert.match(input, /define unavoidable terms/i);
  assert.match(input, /familiar example or analogy/i);
  assert.match(input, /why each conclusion follows/i);
  assert.match(input, /do not make the explanation vague/i);
  assert.match(input, /same language as the user's question/i);
  assert.match(input, /Do not assume book content that was not provided/);
  assert.doesNotMatch(input, /Selected passage to explain/);
});

test("an original selection requests a local plain-language explanation within the reading segment", () => {
  const input = composeCodexInput({
    text: "請用白話說明這段內容",
    quote: { text: "Inside the START and END boundaries." },
    context
  });

  assert.match(input, /Selected passage to explain:[\s\S]*Inside the START and END boundaries\./);
  assert.match(input, /reader selected this because they do not understand it/i);
  assert.match(input, /one-sentence plain-language gist/i);
  assert.match(input, /unpack the selected passage one step at a time/i);
  assert.match(input, /define unavoidable technical terms immediately/i);
  assert.match(input, /everyday example or analogy/i);
  assert.match(input, /connect it back to the selected passage's actual wording/i);
  assert.match(input, /do not merely rephrase/i);
  assert.match(input, /do not oversimplify or distort/i);
  assert.match(input, /current reading segment only/i);
  assert.match(input, /Do not assume book content that was not provided/);
});

test("reading-segment shortcuts use concise visible messages and useful fallback errors", () => {
  assert.equal(readingSegmentShortcutText("readingGuide"), "請為這段產生導讀");
  assert.equal(
    readingSegmentShortcutText("explainReadingSegment"),
    "請展開並詳細說明這段內容"
  );
  assert.equal(
    readingSegmentShortcutText("learningQuestionQuiz"),
    "請根據這段內容產生理解測驗"
  );
  assert.equal(
    readingSegmentShortcutText("selfRetelling"),
    "請讓我用自己的話復述這段內容"
  );
  assert.equal(
    readingSegmentShortcutText("createReadingNote"),
    "請幫我產生一張閱讀筆記；先問我想記住哪一個具體觀念"
  );
  assert.equal(readingSegmentShortcutFallbackError("readingGuide"), "無法產生導讀。");
  assert.equal(
    readingSegmentShortcutFallbackError("explainReadingSegment"),
    "無法送出詳細說明請求。"
  );
  assert.equal(
    readingSegmentShortcutFallbackError("learningQuestionQuiz"),
    "無法產生理解測驗。"
  );
  assert.equal(readingSegmentShortcutFallbackError("selfRetelling"), "無法建立自我復述。");
  assert.equal(
    readingSegmentShortcutFallbackError("createReadingNote"),
    "無法建立閱讀筆記草稿。"
  );
});

test("reading-segment shortcuts disable without content or while AI conversation actions are unavailable", () => {
  const available = {
    hasReadingSegment: true,
    connection: "ready" as const,
    activeTurnId: null,
    managementBusy: false,
    conversationActionPending: false
  };
  assert.equal(readingSegmentShortcutsDisabled(available), false);
  assert.equal(readingSegmentShortcutsDisabled({ ...available, hasReadingSegment: false }), true);
  assert.equal(readingSegmentShortcutsDisabled({ ...available, connection: "disconnected" }), true);
  assert.equal(readingSegmentShortcutsDisabled({ ...available, activeTurnId: "turn-1" }), true);
  assert.equal(readingSegmentShortcutsDisabled({ ...available, managementBusy: true }), true);
  assert.equal(readingSegmentShortcutsDisabled({
    ...available,
    conversationActionPending: true
  }), true);
});


test("detailed elaboration fills gaps while distinguishing supplemental knowledge from the author", () => {
  for (const quote of [undefined, { text: "Inside the START and END boundaries." }]) {
    const input = composeCodexInput({ text: "請詳細闡明", intent: "explainReadingSegment", context, quote });
    assert.match(input, /briefly mentioned or left unexplained/i);
    assert.match(input, /implicit premises and intermediate reasoning steps/i);
    assert.match(input, /existing general knowledge/i);
    assert.match(input, /AI 補充理解/);
    assert.match(input, /never attribute supplemental knowledge or inferred premises to the author/i);
    assert.match(input, /state uncertainty/i);
    if (quote) {
      assert.match(input, /Focus the elaboration on the selected passage/i);
      assert.doesNotMatch(input, /Explain the entire reading segment/i);
      assert.doesNotMatch(input, /Plain-language selected-passage request/i);
    }
  }
});


test("B40 a quoted concept is the only elaboration target, with the segment separated as background", () => {
  const quote = "否定能力讓人能在不確定、神祕、疑惑時，不貿然去抓取事實和理由。";
  const readingSegment = `政治立場的故事。${quote}認知複雜度的說明。賈伯斯的故事尚未結束……`;
  const input = composeCodexInput({
    text: "請詳細闡明這段原文，補足簡略帶過的背景、推理與例子",
    intent: "explainReadingSegment", quote: { text: quote }, context: { readingSegment }
  });
  assert.match(input, /Only elaboration target — selected passage:\n否定能力/);
  assert.match(input, /Background reading segment — for disambiguation only:\n政治立場/);
  assert.ok(input.indexOf(quote) < input.indexOf(readingSegment));
  assert.doesNotMatch(input, /unpack the segment step by step|what role each part plays in the whole segment|Current START\/END reading segment:/i);
  assert.match(input, /Do not make background-only stories, people or concepts into separate topics/i);
  assert.match(input, /Do not comment on incomplete beginnings or endings of the background/i);
  assert.match(input, /Organize by gaps in understanding of the target/i);
  assert.match(input, /Each section must add an explanation missing from the target/i);
  assert.match(input, /Before answering, check that every heading directly explains the target/i);
});

test("B40 absent and blank quotations retain whole-segment elaboration", () => {
  for (const quote of [undefined, { text: "   " }]) {
    const input = composeCodexInput({ text: "請詳細闡明", intent: "explainReadingSegment", quote, context });
    assert.match(input, /Explain the entire reading segment/);
    assert.match(input, /Current START\/END reading segment:/);
    assert.doesNotMatch(input, /Only elaboration target|Background reading segment/);
  }
});
