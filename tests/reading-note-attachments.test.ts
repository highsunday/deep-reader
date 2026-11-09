import assert from "node:assert/strict";
import { access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { LocalReadingNoteAttachmentStore } from "../src/main/reading-note-attachment-store";

const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test("validated images are staged under opaque IDs and remain independent of the source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-attachments-"));
  const store = new LocalReadingNoteAttachmentStore(directory, {
    createId: () => "asset-1",
    now: () => 1_000
  });
  const attachment = store.stage({ name: "diagram.png", mimeType: "image/png", bytes: png });
  assert.equal(attachment.id, "asset-1");
  assert.equal(attachment.url, "reading-note-asset:asset-1");
  assert.match(store.readDataUrl("asset-1"), /^data:image\/png;base64,/);
  await access(join(directory, "reading-note-assets", "asset-1.png"));
});

test("attachment ingress rejects unsafe formats, spoofed bytes, and files over 20 MB", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-attachment-reject-"));
  const store = new LocalReadingNoteAttachmentStore(directory);
  assert.throws(() => store.stage({
    name: "vector.svg",
    mimeType: "image/svg+xml",
    bytes: new TextEncoder().encode("<svg><script /></svg>")
  }), /PNG|JPEG|WebP|GIF/i);
  assert.throws(() => store.stage({
    name: "fake.png",
    mimeType: "image/png",
    bytes: new TextEncoder().encode("not an image")
  }), /does not match|valid image/i);
  assert.throws(() => store.stage({
    name: "huge.png",
    mimeType: "image/png",
    bytes: new Uint8Array(20 * 1024 * 1024 + 1)
  }), /20 MB/i);
});

test("orphan cleanup waits for the undo grace period and never deletes a live reference", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-attachment-gc-"));
  let now = 2_000;
  let id = 0;
  const store = new LocalReadingNoteAttachmentStore(directory, {
    createId: () => `asset-${++id}`,
    now: () => now
  });
  const live = store.stage({ name: "live.png", mimeType: "image/png", bytes: png });
  const orphan = store.stage({ name: "orphan.png", mimeType: "image/png", bytes: png });
  store.reconcile("note-1", [live.id, orphan.id]);
  store.reconcile("note-1", [live.id]);
  assert.equal(store.collectGarbage(), 0);
  now += 24 * 60 * 60 * 1000 + 1;
  assert.equal(store.collectGarbage(), 1);
  assert.match(store.readDataUrl(live.id), /^data:image\/png;base64,/);
  assert.throws(() => store.readDataUrl(orphan.id), /not found/i);
});

test("copying an attachment for another note creates independent ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-attachment-copy-"));
  let id = 0;
  const store = new LocalReadingNoteAttachmentStore(directory, {
    createId: () => `asset-${++id}`,
    now: () => 3_000
  });
  const source = store.stage({ name: "source.png", mimeType: "image/png", bytes: png });
  store.reconcile("note-1", [source.id]);
  const copied = store.copyForNote(source.id, "note-2");
  assert.notEqual(copied.id, source.id);
  store.deleteForNotes(["note-1"]);
  assert.throws(() => store.readDataUrl(source.id), /not found/i);
  assert.match(store.readDataUrl(copied.id), /^data:image\/png;base64,/);
});

test("preparing a pasted document copies foreign images once and preserves same-note references", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-attachment-document-copy-"));
  let id = 0;
  const store = new LocalReadingNoteAttachmentStore(directory, {
    createId: () => `asset-${++id}`,
    now: () => 4_000
  });
  const source = store.stage({ name: "source.png", mimeType: "image/png", bytes: png });
  store.reconcile("note-1", [source.id]);
  const document = {
    version: 1 as const,
    blocks: ["image-a", "image-b"].map((blockId) => ({
      id: blockId,
      type: "image" as const,
      props: { assetId: source.id, alt: "Shared reader copy" },
      children: []
    }))
  };

  const prepared = store.prepareDocument("note-2", document);
  const copiedIds = prepared.blocks.map((block) => String(block.props.assetId));
  assert.equal(copiedIds[0], copiedIds[1]);
  assert.notEqual(copiedIds[0], source.id);
  store.reconcile("note-2", copiedIds);
  const preparedAgain = store.prepareDocument("note-2", prepared);
  assert.deepEqual(preparedAgain, prepared);
});

test("abandoning an untouched canvas removes only its still-staged images", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-attachment-discard-"));
  let id = 0;
  const store = new LocalReadingNoteAttachmentStore(directory, {
    createId: () => `asset-${++id}`,
    now: () => 5_000
  });
  const staged = store.stage({ name: "staged.png", mimeType: "image/png", bytes: png });
  const live = store.stage({ name: "live.png", mimeType: "image/png", bytes: png });
  store.reconcile("note-1", [live.id]);

  assert.equal(store.discardStaged([staged.id, live.id]), 1);
  assert.throws(() => store.readDataUrl(staged.id), /not found/i);
  assert.match(store.readDataUrl(live.id), /^data:image\/png;base64,/);
});
