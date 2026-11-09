import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { LocalReadingNoteStore } from "../src/main/reading-note-store";

test("legacy prompt and Markdown migrate to a titled structured reading note", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-rich-migration-"));
  await writeFile(join(directory, "reading-notes.json"), JSON.stringify({
    version: 3,
    notes: [{
      id: "legacy-note",
      sourceDraftId: "legacy-draft",
      prompt: "Why does feedback oscillate?",
      content: "## Delay\n\nA **late** correction overshoots.",
      bookTitle: "Thinking in Systems",
      chapterTitle: "Feedback",
      createdAt: 100,
      updatedAt: 120
    }]
  }));

  const note = new LocalReadingNoteStore(directory).get("legacy-note") as unknown as {
    title: string;
    content: { version: number; blocks: Array<Record<string, unknown>> };
    revision: number;
  };

  assert.equal(note.title, "Why does feedback oscillate?");
  assert.equal(note.content.version, 1);
  assert.equal(note.content.blocks[0]?.type, "heading");
  assert.equal(note.content.blocks[1]?.type, "paragraph");
  assert.equal(note.revision, 1);
});

test("structured reading notes normalize blank titles and reject stale autosaves", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-rich-update-"));
  let now = 200;
  const store = new LocalReadingNoteStore(directory, {
    createId: () => "rich-note",
    now: () => now++
  });
  const content = {
    version: 1 as const,
    blocks: [{
      id: "block-1",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "My note", styles: {} }],
      children: []
    }]
  };

  const created = store.create({
    sourceDraftId: "rich-draft",
    title: " ",
    content,
    bookTitle: "A Book",
    chapterTitle: "A Chapter"
  } as never) as unknown as { title: string; revision: number; updatedAt: number };
  assert.equal(created.title, "Untitled");
  assert.equal(created.revision, 1);

  const updated = store.update({
    id: "rich-note",
    baseRevision: 1,
    title: "A clearer title",
    content
  } as never) as unknown as { title: string; revision: number };
  assert.equal(updated.title, "A clearer title");
  assert.equal(updated.revision, 2);
  assert.throws(() => store.update({
    id: "rich-note",
    baseRevision: 1,
    title: "Stale",
    content
  } as never), /changed|stale/i);

  const persisted = JSON.parse(await readFile(join(directory, "reading-notes.json"), "utf8"));
  assert.equal(persisted.version, 8);
  assert.deepEqual(persisted.tags, []);
  assert.equal(persisted.notes[0].prompt, undefined);
  assert.equal(persisted.notes[0].title, "A clearer title");
  assert.equal(persisted.notes[0].content.version, 1);
});

test("Library search and alphabetical sort use titles after migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-title-query-"));
  const store = new LocalReadingNoteStore(directory, {
    createId: (() => {
      const ids = ["note-b", "note-a"];
      return () => ids.shift() ?? "note-extra";
    })(),
    now: (() => {
      let value = 300;
      return () => value++;
    })()
  });
  const content = {
    version: 1 as const,
    blocks: [{ id: "p", type: "paragraph", props: {}, content: [], children: [] }]
  };
  store.create({ sourceDraftId: "draft-b", title: "Zebra loops", content, bookTitle: "B", chapterTitle: "C" } as never);
  store.create({ sourceDraftId: "draft-a", title: "Adaptive systems", content, bookTitle: "B", chapterTitle: "C" } as never);

  const searched = store.list({ status: "active", sort: "recent", search: "adaptive" });
  assert.deepEqual(searched.map((note) => (note as unknown as { title: string }).title), ["Adaptive systems"]);
  const sorted = store.list({ status: "active", sort: "alphabetical" });
  assert.deepEqual(sorted.map((note) => (note as unknown as { title: string }).title), ["Adaptive systems", "Zebra loops"]);
});
