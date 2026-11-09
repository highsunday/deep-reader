import assert from "node:assert/strict";
import { test } from "vitest";
import { createChatImageCompressor } from "../src/main/chat-image-compression";
import { ChatController } from "../src/main/chat-controller";
import { SpawnedCodexAppServerClient } from "../src/main/codex-app-server-client";
import { createFakeCodexAppServer } from "./fake-codex-app-server";

const large = `data:image/png;base64,${Buffer.alloc(600 * 1024).toString("base64")}`;
const jpeg = Buffer.from("compressed jpeg");
function codec(alpha = 255, output = jpeg) {
  return {
    isEmpty: () => false,
    toBitmap: () => Buffer.from([0, 0, 0, alpha]),
    getSize: () => ({ width: 1200, height: 600 }),
    resize: () => { throw new Error("must not upscale"); },
    toJPEG: (quality: number) => { assert.equal(quality, 80); return output; }
  };
}

test("B59 compresses large opaque images at quality 80 without upscaling", () => {
  const compress = createChatImageCompressor(() => codec());
  assert.equal(compress(large), `data:image/jpeg;base64,${jpeg.toString("base64")}`);
});

test("B59 resizes wide images to 1600 with best quality before encoding", () => {
  const image = {
    ...codec(), getSize: () => ({ width: 2048, height: 1130 }),
    resize: (options: { width: number; quality: string }) => {
      assert.deepEqual(options, { width: 1600, quality: "best" });
      return codec();
    },
    toJPEG: () => { throw new Error("must encode the resized image"); }
  };
  assert.equal(createChatImageCompressor(() => image)(large), `data:image/jpeg;base64,${jpeg.toString("base64")}`);
});

test("B59 preserves originals when resizing fails", () => {
  const image = { ...codec(), getSize: () => ({ width: 2048, height: 1130 }), resize: () => { throw new Error("resize failed"); } };
  assert.equal(createChatImageCompressor(() => image)(large), large);
});

test("B59 preserves small, animated, transparent and undecodable images", () => {
  const compress = createChatImageCompressor(() => { throw new Error("must not decode"); });
  assert.equal(compress("data:image/png;base64,AA=="), "data:image/png;base64,AA==");
  const gif = large.replace("image/png", "image/gif");
  assert.equal(compress(gif), gif);
  assert.equal(createChatImageCompressor(() => codec(0))(large), large);
  assert.equal(createChatImageCompressor(() => ({ ...codec(), isEmpty: () => true }))(large), large);
  assert.equal(compress(large), large);
});

test("B59 keeps originals when encoding fails or increases the payload", () => {
  assert.equal(createChatImageCompressor(() => codec(255, Buffer.alloc(700 * 1024)))(large), large);
  assert.equal(createChatImageCompressor(() => ({ ...codec(), toJPEG: () => { throw new Error("encode failed"); } }))(large), large);
});

test("B59 compresses both wire image sources while retaining saved originals and ordering", async () => {
  const fake = createFakeCodexAppServer();
  const controller = new ChatController({
    createClient: () => new SpawnedCodexAppServerClient({ spawnProcess: () => fake.child }),
    workingDirectory: "/tmp/reading-chat-compression-test",
    compressImage: dataUrl => `compressed:${dataUrl}`
  });
  const bookImage = { dataUrl: "book-original" };
  const readerImage = { dataUrl: "reader-original" };
  try {
    await controller.sendMessage({ text: "Explain", images: [readerImage], context: {
      bookTitle: "Book", chapterTitle: "Chapter", readingSegment: "[Book image 1]", images: [bookImage]
    } });
    const turn = fake.requests.find(request => request.method === "turn/start")!;
    const items = turn.params!.input as Array<{ type: string; url?: string }>;
    assert.deepEqual(items.filter(item => item.type === "image").map(item => item.url), ["compressed:book-original", "compressed:reader-original"]);
    assert.equal(controller.getSnapshot().messages[0]!.images![0]!.dataUrl, "reader-original");
    assert.equal(bookImage.dataUrl, "book-original");
  } finally { controller.close(); }
});
