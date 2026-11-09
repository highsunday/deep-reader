import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { afterEach, test, vi } from "vitest";
import type { ReadingNote } from "../src/shared/contracts";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import { buildReadingNoteExport, saveReadingNoteExport } from "../src/main/reading-note-export";

const image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
const note: ReadingNote = {
  id: "note-1", sourceDraftId: "draft-1", title: "Why feedback overshoots",
  content: markdownToReadingNoteDocument("The correction arrives too late."),
  bookTitle: "Thinking in Systems", chapterTitle: "Feedback", createdAt: 1, updatedAt: 1, revision: 2
};
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));

test("a text-only reading note exports as one Markdown file", async () => {
  const built = await buildReadingNoteExport(note, vi.fn());
  assert.equal(built.extension, "md");
  assert.equal(built.filename, "Why feedback overshoots");
  assert.equal(built.markdown, "The correction arrives too late.\n\n---\n\nSource: Thinking in Systems · Feedback\n");
  assert.deepEqual(built.assets, []);
  const directory = mkdtempSync(join(tmpdir(), "note-export-")); directories.push(directory);
  const path = join(directory, "note.md");
  const result = await saveReadingNoteExport(note.id, {
    get: () => note,
    readDataUrl: vi.fn(),
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: path }))
  });
  assert.deepEqual(result, { status: "exported", path });
  assert.equal(readFileSync(path, "utf8"), built.markdown);
  assert.deepEqual(readdirSync(directory), ["note.md"]);
});

test("understanding and body images are inline; recall image is excluded", async () => {
  const illustrated: ReadingNote = {
    ...note,
    content: {
      version: 1,
      blocks: [
        ...note.content.blocks,
        { id: "body-image", type: "image", props: { assetId: "body", alt: "原文圖" }, children: [] }
      ]
    },
    memoryImages: {
      recall: { attachmentId: "recall", basedOnRevision: 2 },
      understand: { attachmentId: "understand", basedOnRevision: 2 }
    }
  };
  const readDataUrl = vi.fn((_id: string) => image);
  const built = await buildReadingNoteExport(illustrated, readDataUrl);
  assert.equal(built.extension, "zip");
  assert.deepEqual(readDataUrl.mock.calls.map(call => call[0]), ["understand", "body"]);
  assert.match(built.markdown, /^!\[理解圖\]\(assets\/image-1\.png\)\n\nThe correction arrives too late\.\n\n!\[原文圖\]\(assets\/image-2\.png\)/);
  assert.doesNotMatch(built.markdown, /reading-note-asset:|recall/);
  const directory = mkdtempSync(join(tmpdir(), "note-export-")); directories.push(directory);
  const path = join(directory, "note.zip");
  await saveReadingNoteExport(note.id, {
    get: () => illustrated,
    readDataUrl,
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: path }))
  });
  const zip = await JSZip.loadAsync(readFileSync(path));
  assert.deepEqual(Object.keys(zip.files).filter(name => !name.endsWith("/")).sort(),
    ["Why feedback overshoots.md", "assets/image-1.png", "assets/image-2.png"]);
  assert.equal(await zip.file("Why feedback overshoots.md")?.async("string"), built.markdown);
});

test("nested note content and its image remain in the exported Markdown", async () => {
  const nested: ReadingNote = {
    ...note,
    content: {
      version: 1,
      blocks: [{
        id: "parent", type: "bulletListItem", props: {},
        content: [{ type: "text", text: "Parent idea", styles: {} }],
        children: [{
          id: "child", type: "bulletListItem", props: {},
          content: [{ type: "text", text: "Nested idea", styles: {} }],
          children: [{ id: "nested-image", type: "image", props: { assetId: "body", alt: "Nested image" }, children: [] }]
        }]
      }]
    }
  };
  const built = await buildReadingNoteExport(nested, () => image);
  assert.match(built.markdown, /- Parent idea\n  - Nested idea\n    !\[Nested image\]\(assets\/image-1\.png\)/);
  assert.equal(built.assets.length, 1);
});

test("cancelling or failing to read an attachment writes nothing", async () => {
  const directory = mkdtempSync(join(tmpdir(), "note-export-")); directories.push(directory);
  const cancelled = await saveReadingNoteExport(note.id, {
    get: () => note,
    readDataUrl: vi.fn(),
    showSaveDialog: vi.fn(async () => ({ canceled: true }))
  });
  assert.deepEqual(cancelled, { status: "cancelled" });
  const illustrated = { ...note, memoryImages: { understand: { attachmentId: "missing", basedOnRevision: 2 } } };
  await assert.rejects(saveReadingNoteExport(note.id, {
    get: () => illustrated,
    readDataUrl: () => { throw new Error("Attachment unavailable"); },
    showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: join(directory, "note.zip") }))
  }), /Attachment unavailable/);
  assert.deepEqual(readdirSync(directory), []);
});

test("a trashed reading note cannot be exported", async () => {
  const showSaveDialog = vi.fn();
  await assert.rejects(saveReadingNoteExport(note.id, {
    get: () => ({ ...note, trashedAt: 10 }),
    readDataUrl: vi.fn(),
    showSaveDialog
  }), /unavailable for export/);
  assert.equal(showSaveDialog.mock.calls.length, 0);
});

test("F72 batches text and illustrated notes without filename or asset collisions", async () => {
  const { saveReadingNotesExport } = await import("../src/main/reading-note-export");
  const directory = mkdtempSync(join(tmpdir(), "batch-export-")); directories.push(directory);
  const path = join(directory, "notes.zip");
  const notes = ["Idea", "idea", "Idea (2)", "Idea/"].map((title, index) => ({
    ...note, id: `batch-${index}`, title,
    memoryImages: { understand: { attachmentId: `understand-${index}`, basedOnRevision: 2 }, recall: { attachmentId: "recall", basedOnRevision: 2 } }
  }));
  const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: path }));
  const readDataUrl = vi.fn(() => image);
  await saveReadingNotesExport([...notes.map(n => n.id), notes[0]!.id], {
    get: id => notes.find(n => n.id === id), readDataUrl, showSaveDialog
  });
  assert.equal(showSaveDialog.mock.calls.length, 1);
  const zip = await JSZip.loadAsync(readFileSync(path));
  const markdownPaths = Object.keys(zip.files).filter(p => p.endsWith(".md"));
  assert.equal(markdownPaths.length, 4);
  assert.equal(new Set(markdownPaths.map(p => p.toLowerCase())).size, 4);
  const images = new Set<string>();
  for (const md of markdownPaths) {
    const content = await zip.file(md)!.async("string");
    const asset = /!\[理解圖\]\(([^)]+)\)/.exec(content)![1]!;
    assert.ok(zip.file(decodeURI(asset)));
    images.add(asset);
    assert.match(content, /Source: Thinking in Systems/);
    assert.doesNotMatch(content, /reading-note-asset:|recall/);
  }
  assert.equal(images.size, 4);
  assert.equal(readDataUrl.mock.calls.length, 4);
  const secondText = { ...note, id: "text-2", title: "Second text note" };
  await saveReadingNotesExport([note.id, secondText.id], { get: id => id === note.id ? note : secondText, readDataUrl, showSaveDialog });
  const textZip = await JSZip.loadAsync(readFileSync(path));
  assert.equal(await textZip.file(`${note.title}.md`)!.async("string"), (await buildReadingNoteExport(note, readDataUrl)).markdown);
  assert.equal(await textZip.file(`${secondText.title}.md`)!.async("string"), (await buildReadingNoteExport(secondText, readDataUrl)).markdown);
  assert.equal(Object.keys(textZip.files).length, 2);
});

test("F72 rejects invalid batches and leaves no file on cancellation or attachment failure", async () => {
  const { saveReadingNotesExport } = await import("../src/main/reading-note-export");
  const directory = mkdtempSync(join(tmpdir(), "batch-export-")); directories.push(directory);
  const path = join(directory, "notes.zip");
  const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: path }));
  const deps = { get: (id: string) => id === note.id ? note : undefined, readDataUrl: () => image, showSaveDialog };
  for (const ids of [[], [note.id, "missing"], [""]]) await assert.rejects(saveReadingNotesExport(ids, deps));
  await assert.rejects(saveReadingNotesExport([note.id], { ...deps, get: () => ({ ...note, trashedAt: 1 }) }));
  assert.equal(showSaveDialog.mock.calls.length, 0);
  assert.deepEqual(await saveReadingNotesExport([note.id], { ...deps, showSaveDialog: async () => ({ canceled: true }) }), { status: "cancelled" });
  await assert.rejects(saveReadingNotesExport([note.id], {
    ...deps, get: () => ({ ...note, memoryImages: { understand: { attachmentId: "missing", basedOnRevision: 2 } } }),
    readDataUrl: () => { throw new Error("Missing image"); }
  }), /Missing image/);
  assert.deepEqual(readdirSync(directory), []);
  await assert.rejects(saveReadingNotesExport([note.id], { ...deps, showSaveDialog: async () => ({ canceled: false, filePath: join(directory, "absent", "notes.zip") }) }));
  assert.deepEqual(readdirSync(directory), []);
});

test("F72 freezes saved content and image bytes before awaiting the save dialog", async () => {
  const { saveReadingNotesExport } = await import("../src/main/reading-note-export");
  const directory = mkdtempSync(join(tmpdir(), "batch-export-")); directories.push(directory);
  const path = join(directory, "notes.zip");
  const saved: ReadingNote = { ...note, content: markdownToReadingNoteDocument("Saved version"), memoryImages: { understand: { attachmentId: "original", basedOnRevision: 2 } } };
  await saveReadingNotesExport([note.id], {
    get: () => saved, readDataUrl: () => image,
    showSaveDialog: async () => {
      saved.title = "Changed after export started";
      saved.content = markdownToReadingNoteDocument("Later edit");
      saved.memoryImages = {};
      return { canceled: false, filePath: path };
    }
  });
  const zip = await JSZip.loadAsync(readFileSync(path));
  const content = await zip.file(`${note.title}.md`)!.async("string");
  assert.match(content, /Saved version/);
  assert.doesNotMatch(content, /Later edit/);
  assert.ok(zip.file("assets/note-1/image-1.png"));
});
