import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import {
  ReadingNoteAction,
  ReadingNoteCard,
  ReadingNoteDialog
} from "../src/renderer/ReadingNoteCard";
import { ChatMessageList } from "../src/renderer/App";

const draft = {
  version: 2 as const,
  draftId: "draft-1",
  title: "質量與能量",
  content: "質能等價可寫成 $E=mc^2$，表示靜止質量本身對應能量。"
};

test("a reading-note draft is a read-only source-backed card with explicit submission", () => {
  const collapsed = renderToStaticMarkup(
    <ReadingNoteCard
      open={false}
      draft={draft}
      source={{ bookTitle: "Relativity", chapterTitle: "Mass and energy" }}
      onOpen={() => undefined}
      onClose={() => undefined}
      onSubmit={() => undefined}
    />
  );
  const expanded = renderToStaticMarkup(
    <ReadingNoteCard
      open
      draft={draft}
      source={{ bookTitle: "Relativity", chapterTitle: "Mass and energy" }}
      onOpen={() => undefined}
      onClose={() => undefined}
      onSubmit={() => undefined}
    />
  );

  assert.match(collapsed, /Reading note draft · Review required/);
  assert.match(collapsed, /質量與能量/);
  assert.match(expanded, /Title/);
  assert.match(expanded, /Note Content/);
  assert.match(expanded, /Relativity/);
  assert.match(expanded, /Mass and energy/);
  assert.match(expanded, /aria-label="Save reading note"/);
  assert.match(expanded, /class="katex/);
  assert.doesNotMatch(expanded, /textarea|contenteditable|<input/i);
});

test("a Create Note draft previews its selected original book image", () => {
  const markup = renderToStaticMarkup(
    <ReadingNoteCard
      open
      draft={{ ...draft, version: 3, content: "說明。\n\n![原文示意圖](book-image:1)" }}
      sourceImages={[{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }]}
      source={{ bookTitle: "Relativity", chapterTitle: "Mass and energy" }}
      onOpen={() => undefined}
      onClose={() => undefined}
      onSubmit={() => undefined}
    />
  );
  assert.match(markup, /class="reading-note-book-image"/);
  assert.match(markup, /alt="原文示意圖"/);
  assert.match(markup, /data:image\/png;base64,iVBORw0KGgo=/);
});

test("the AI panel uses an original-app-style action to open the note", () => {
  const pending = renderToStaticMarkup(
    <ReadingNoteAction draft={draft} onOpen={() => undefined} />
  );
  const saved = renderToStaticMarkup(
    <ReadingNoteAction
      draft={draft}
      saved={{
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
      }}
      onOpen={() => undefined}
    />
  );
  assert.match(pending, /1 note to review/);
  assert.match(pending, /Review and save/);
  assert.match(saved, /Reading note saved/);
  assert.match(saved, /View note/);
});

test("the note action opens a separate read-only dialog with source and submission", () => {
  const markup = renderToStaticMarkup(
    <ReadingNoteDialog
      draft={draft}
      source={{ bookTitle: "Relativity", chapterTitle: "Mass and energy" }}
      onClose={() => undefined}
      onSubmit={() => undefined}
    />
  );
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /Review Reading Note/);
  assert.match(markup, /質量與能量/);
  assert.match(markup, /Relativity/);
  assert.match(markup, /Mass and energy/);
  assert.match(markup, /Save Reading Note/);
  assert.doesNotMatch(markup, /textarea|contenteditable|<input/i);
});

test("a saved card remains readable and cannot be submitted again", () => {
  const markup = renderToStaticMarkup(
    <ReadingNoteCard
      open
      draft={draft}
      source={{ bookTitle: "Relativity", chapterTitle: "Mass and energy" }}
      saved={{
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
      }}
      onOpen={() => undefined}
      onClose={() => undefined}
      onSubmit={() => undefined}
    />
  );
  assert.match(markup, /Reading note · Saved/);
  assert.match(markup, /Saved/);
  assert.doesNotMatch(markup, /aria-label="Save reading note"/);
});

test("reading-note cards have a narrow-panel read-only layout", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.reading-note-card\s*\{/);
  assert.match(styles, /\.reading-note-source\s*\{/);
  assert.match(styles, /@container chat-panel \(max-width: 560px\)[\s\S]*\.reading-note-body/);
});

test("the reading conversation hides artifact JSON and restores a source-backed draft card", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      source={{ bookTitle: "Relativity", chapterTitle: "Mass and energy" }}
      messages={[{
        id: "draft-message",
        turnId: "turn-1",
        role: "assistant",
        status: "completed",
        text: `草稿已準備好。\n\`\`\`reading-note-draft\n${JSON.stringify(draft)}\n\`\`\``
      }]}
    />
  );
  assert.match(markup, /草稿已準備好/);
  assert.match(markup, /1 note to review/);
  assert.match(markup, /Relativity/);
  assert.doesNotMatch(markup, />…</);
  assert.doesNotMatch(markup, /reading-note-draft|draftId/);
});

test("an artifact-only response renders the note action without placeholder or raw JSON", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      source={{ bookTitle: "Relativity", chapterTitle: "Mass and energy" }}
      messages={[{
        id: "draft-only-message",
        turnId: "turn-1",
        role: "assistant",
        status: "completed",
        text: `\`\`\`reading-note-draft\n${JSON.stringify(draft)}\n\`\`\``
      }]}
    />
  );
  assert.match(markup, /1 note to review/);
  assert.doesNotMatch(markup, />…</);
  assert.doesNotMatch(markup, /reading-note-draft|draftId/);
});
