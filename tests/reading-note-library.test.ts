import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { LocalReadingNoteStore } from "../src/main/reading-note-store";
import type { CreateReadingNoteInput } from "../src/shared/contracts";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";

const relativity: CreateReadingNoteInput = {
  sourceDraftId: "draft-relativity",
  title: "Why are mass and energy equivalent?",
  content: markdownToReadingNoteDocument("Because **mass** is a concentrated form of energy."),
  bookTitle: "Relativity",
  chapterTitle: "Mass and energy"
};

const systems: CreateReadingNoteInput = {
  sourceDraftId: "draft-systems",
  title: "How does a balancing loop work?",
  content: markdownToReadingNoteDocument("It acts against a change to move a system toward a goal."),
  bookTitle: "Thinking in Systems",
  chapterTitle: "Feedback loops"
};

test("the reading-note store queries active notes by title and source with stable sorting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-library-"));
  let id = 0;
  let now = 100;
  try {
    const store = new LocalReadingNoteStore(directory, {
      createId: () => `note-${++id}`,
      now: () => ++now
    });
    const older = store.create(relativity);
    const newer = store.create(systems);

    assert.deepEqual(store.list({ status: "active", sort: "recent" }).map(({ id }) => id), [
      newer.id,
      older.id
    ]);
    assert.deepEqual(store.list({
      status: "active",
      search: "MASS AND",
      bookTitle: "Relativity",
      chapterTitle: "Mass and energy",
      sort: "alphabetical"
    }).map(({ id }) => id), [older.id]);
    assert.deepEqual(store.list({ status: "active", bookTitle: "missing", sort: "recent" }), []);
    assert.deepEqual(store.get(older.id), older);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the reading-note library pages lightweight summaries without transferring content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-pages-"));
  let id = 0;
  try {
    const store = new LocalReadingNoteStore(directory, {
      createId: () => `note-${++id}`,
      now: () => id
    });
    for (let index = 0; index < 53; index++) {
      store.create({ ...relativity, sourceDraftId: `draft-${index}`, title: `Title ${index}` });
    }
    const input = { status: "active" as const, sort: "recent" as const };
    const first = store.listPage(input);
    assert.equal(first.items.length, 50);
    assert.ok(first.nextCursor);
    assert.equal("content" in first.items[0]!, false);
    assert.equal("sourceDraftId" in first.items[0]!, false);
    const second = store.listPage({ ...input, cursor: first.nextCursor });
    assert.equal(second.items.length, 3);
    assert.equal(second.nextCursor, undefined);
    assert.deepEqual([...first.items, ...second.items].map(item => item.id), store.list(input).map(item => item.id));
    assert.deepEqual(store.activeBookTitles(), ["Relativity"]);
    assert.throws(() => store.listPage({ ...input, search: "Title", cursor: first.nextCursor }), /cursor/i);
    store.trash("note-1");
    assert.throws(() => store.listPage({ ...input, cursor: first.nextCursor }), /cursor/i);
    assert.equal(store.listPage(input).items.length, 50);
    assert.equal(store.counts().active, 52);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("soft deletion, restore, and empty Trash persist without changing note content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-trash-"));
  let now = 200;
  try {
    const store = new LocalReadingNoteStore(directory, {
      createId: () => "note-1",
      now: () => ++now
    });
    const created = store.create(relativity);
    const trashed = store.trash(created.id);
    assert.equal(trashed.trashedAt, 202);
    assert.deepEqual(store.list({ status: "active", sort: "recent" }), []);
    assert.deepEqual(store.list({ status: "trashed", sort: "recent" }), [trashed]);
    assert.throws(() => store.trash(created.id), /already in Trash/i);

    const restored = store.restore(created.id);
    assert.equal(restored.title, created.title);
    assert.deepEqual(restored.content, created.content);
    assert.throws(() => store.restore(created.id), /not in Trash/i);
    store.trash(created.id);
    assert.equal(store.emptyTrash(), 1);
    assert.deepEqual(store.list({ status: "trashed", sort: "recent" }), []);
    assert.equal(new LocalReadingNoteStore(directory).get(created.id), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("version 1 reading-note data loads as active and upgrades after the next mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-v1-notes-"));
  try {
    await writeFile(join(directory, "reading-notes.json"), JSON.stringify({
      version: 1,
      notes: [{
        id: "legacy-note",
        sourceDraftId: relativity.sourceDraftId,
        prompt: relativity.title,
        content: "Because **mass** is a concentrated form of energy.",
        bookTitle: relativity.bookTitle,
        chapterTitle: relativity.chapterTitle,
        createdAt: 90
      }]
    }));
    const store = new LocalReadingNoteStore(directory, { now: () => 300 });
    assert.equal(store.list({ status: "active", sort: "recent" })[0]?.id, "legacy-note");
    store.trash("legacy-note");
    assert.match(await readFile(join(directory, "reading-notes.json"), "utf8"), /"version": 8/);
    assert.equal(new LocalReadingNoteStore(directory).list({
      status: "trashed",
      sort: "recent"
    })[0]?.trashedAt, 300);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("empty Trash permanently removes only trashed notes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-empty-trash-"));
  let id = 0;
  try {
    const store = new LocalReadingNoteStore(directory, {
      createId: () => `note-${++id}`,
      now: () => 400 + id
    });
    const active = store.create(relativity);
    const trashed = store.create(systems);
    store.trash(trashed.id);
    assert.equal(store.emptyTrash(), 1);
    assert.equal(store.get(trashed.id), undefined);
    assert.equal(store.get(active.id)?.id, active.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("active reading notes support guarded content-only updates without changing their source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-edit-note-"));
  let now = 500;
  try {
    const store = new LocalReadingNoteStore(directory, {
      createId: () => "note-edit",
      now: () => ++now
    });
    const created = store.create(relativity);
    const baseRevision = created.revision;
    const updated = store.update({
      id: created.id,
      baseRevision,
      title: "How does mass relate to energy?",
      content: markdownToReadingNoteDocument("Mass and energy are **equivalent** descriptions.")
    });

    assert.equal(updated.title, "How does mass relate to energy?");
    assert.deepEqual(updated.content, markdownToReadingNoteDocument("Mass and energy are **equivalent** descriptions."));
    assert.equal(updated.updatedAt, 502);
    assert.equal(updated.bookTitle, created.bookTitle);
    assert.equal(updated.chapterTitle, created.chapterTitle);
    assert.equal(updated.createdAt, created.createdAt);
    assert.equal(updated.sourceDraftId, created.sourceDraftId);
    assert.throws(() => store.update({
      id: created.id,
      baseRevision,
      title: "Stale overwrite",
      content: markdownToReadingNoteDocument("Must fail.")
    }), /changed.*reopen/i);
    store.trash(created.id);
    assert.throws(() => store.update({
      id: created.id,
      baseRevision: updated.revision,
      title: "Trash overwrite",
      content: markdownToReadingNoteDocument("Must fail.")
    }), /active/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("version 2 notes gain a stable update version without losing lifecycle data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-v2-update-"));
  try {
    await writeFile(join(directory, "reading-notes.json"), JSON.stringify({
      version: 2,
      notes: [{
        id: "legacy-v2",
        sourceDraftId: relativity.sourceDraftId,
        prompt: relativity.title,
        content: "Because **mass** is a concentrated form of energy.",
        bookTitle: relativity.bookTitle,
        chapterTitle: relativity.chapterTitle,
        createdAt: 700
      }]
    }));
    const store = new LocalReadingNoteStore(directory, { now: () => 800 });
    const loaded = store.get("legacy-v2");
    assert.equal(loaded?.updatedAt, 700);
    store.update({
      id: "legacy-v2",
      baseRevision: 1,
      title: "Updated title",
      content: markdownToReadingNoteDocument("Updated content")
    });
    assert.match(await readFile(join(directory, "reading-notes.json"), "utf8"), /"version": 8/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
