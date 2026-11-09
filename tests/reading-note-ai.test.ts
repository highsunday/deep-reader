import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  parseReadingNoteAiResponse,
  parseStreamingReadingNoteAiDraft
} from "../src/main/reading-note-ai-artifact";

function turn(overrides: Record<string, unknown> = {}) {
  return `\`\`\`reading-note-ai-turn\n${JSON.stringify({
    version: 2,
    kind: "reading-note-ai-turn",
    sessionId: "session-1",
    reply: "The relationship is already accurate; I can make the causal step more explicit.",
    proposal: {
      title: "Why feedback matters",
      content: "Feedback changes the next state of a system."
    },
    ...overrides
  })}\n\`\`\``;
}

test("the reading-note AI parser accepts a conversational reply with an optional proposal", () => {
  assert.deepEqual(parseReadingNoteAiResponse(turn(), "session-1"), {
    kind: "turn",
    reply: "The relationship is already accurate; I can make the causal step more explicit.",
    proposal: {
      title: "Why feedback matters",
      content: "Feedback changes the next state of a system."
    }
  });
  assert.deepEqual(parseReadingNoteAiResponse(turn({ proposal: null }), "session-1"), {
    kind: "turn",
    reply: "The relationship is already accurate; I can make the causal step more explicit."
  });
});

test("the reading-note AI parser normalizes a proposal with a misnested reply", () => {
  const response = turn({
    reply: undefined,
    proposal: {
      title: "Traditional positioning statements fail",
      content: "They record assumptions instead of testing them.",
      reply: "I kept the note focused on the template's core defect."
    }
  });

  assert.deepEqual(parseReadingNoteAiResponse(response, "session-1"), {
    kind: "turn",
    reply: "I kept the note focused on the template's core defect.",
    proposal: {
      title: "Traditional positioning statements fail",
      content: "They record assumptions instead of testing them."
    }
  });
});

test("schema-constrained bare JSON supports final parsing and partial proposal streaming", () => {
  const bare = JSON.stringify({
    version: 2,
    kind: "reading-note-ai-turn",
    sessionId: "session-1",
    proposal: {
      title: "A direct title",
      content: "First line\n\nSecond line"
    },
    reply: "A direct reply"
  });

  assert.deepEqual(parseReadingNoteAiResponse(bare, "session-1"), {
    kind: "turn",
    reply: "A direct reply",
    proposal: {
      title: "A direct title",
      content: "First line\n\nSecond line"
    }
  });
  assert.deepEqual(
    parseStreamingReadingNoteAiDraft(bare.slice(0, bare.indexOf("Second line") + 6)),
    { title: "A direct title", content: "First line\n\nSecond" }
  );
});

test("the reading-note AI parser rejects forged, ambiguous, empty, or trailing output", () => {
  for (const value of [
    turn({ sessionId: "another-session" }),
    turn({ reply: "" }),
    turn({ proposal: { title: "", content: "content" } }),
    turn({
      reply: undefined,
      proposal: {
        title: "Title",
        content: "Content",
        reply: "Reply",
        source: "forged"
      }
    }),
    turn({
      reply: undefined,
      proposal: { title: "Title", content: "Content", reply: "" }
    }),
    turn({ source: "forged" }),
    `${turn()}\n${turn()}`,
    `${turn()} trailing text`
  ]) {
    assert.throws(() => parseReadingNoteAiResponse(value, "session-1"), /invalid reading-note AI response/i);
  }
});

test("the reading-note AI parser accepts an exact content-boundary refusal", () => {
  const response = `\`\`\`reading-note-ai-refusal\n${JSON.stringify({
    version: 1,
    kind: "reading-note-ai-refusal",
    sessionId: "session-1",
    reason: "This request needs information that is not present in the card."
  })}\n\`\`\``;
  assert.deepEqual(parseReadingNoteAiResponse(response, "session-1"), {
    kind: "refusal",
    reason: "This request needs information that is not present in the card."
  });
});

test("completion and later editing use separate bounded skill contracts", () => {
  const complete = readFileSync(".agents/skills/complete-reading-note/SKILL.md", "utf8");
  const edit = readFileSync(".agents/skills/edit-reading-note/SKILL.md", "utf8");
  assert.match(complete, /readingSegment/);
  assert.match(complete, /userDraft/);
  assert.match(complete, /conversationContext/);
  assert.match(complete, /model(?:'s)? existing knowledge|general knowledge/i);
  assert.match(complete, /author(?:'s)? claim|author's position/i);
  assert.match(edit, /current `title`, current `content`/);
  assert.match(edit, /reply/i);
  assert.match(edit, /proposal/i);
  assert.match(edit, /Do not request or infer the reading segment, book, chapter, original reader draft/);
  assert.match(edit, /model(?:'s)? existing knowledge|general knowledge/i);
  assert.match(edit, /author(?:'s)? claim|author's position/i);
  assert.doesNotMatch(edit, /If the request needs any fact not already present in the card, refuse/);
  assert.match(complete, /cannot be completed safely[\s\S]*proposal[\s\S]*null/i);
  assert.match(edit, /cannot be completed safely[\s\S]*proposal[\s\S]*null/i);
  assert.match(complete, /top-level sibling[\s\S]*never be nested inside `proposal`/i);
  assert.match(edit, /top-level sibling[\s\S]*never be nested inside `proposal`/i);
});

test("draft completion keeps one concept in a shallow pyramid structure", () => {
  const complete = readFileSync(".agents/skills/complete-reading-note/SKILL.md", "utf8");

  assert.match(complete, /reader draft as the primary authority/i);
  assert.match(complete, /one core concept/i);
  assert.match(complete, /Feynman/i);
  assert.match(complete, /future review/i);
  assert.match(complete, /pyramid|top-down/i);
  assert.match(complete, /2[–-]4[^\n]*`##`/i);
  assert.match(complete, /core (?:conclusion|definition)/i);
  assert.match(complete, /do not use `#` or `###`/i);
  assert.match(complete, /nearby as `AI 補充`/i);
  assert.doesNotMatch(complete, /Improve structure, definitions, causal links, distinctions, and necessary examples/i);
  assert.doesNotMatch(complete, /Clearly distinguish a supplemental explanation when it is not stated by the author/i);
});
