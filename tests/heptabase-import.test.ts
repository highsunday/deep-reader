import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReadingNote } from "../src/shared/contracts";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import { HeptabaseImportController } from "../src/main/heptabase-import";
const dirs: string[] = [];
afterEach(() =>
  dirs.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
const note: ReadingNote = {
  id: "n",
  sourceDraftId: "d",
  title: "Title $(touch hacked)",
  bookTitle: "Book",
  chapterTitle: "Chapter",
  createdAt: 1,
  updatedAt: 1,
  revision: 1,
  content: markdownToReadingNoteDocument(
    "Body\n\n```\nreading-note-asset:body\n```",
  ),
};
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
function fixture(notes = [note]) {
  const dir = mkdtempSync(join(tmpdir(), "hepta-test-"));
  dirs.push(dir);
  let markdown = "";
  const run = vi.fn(async (args: string[]): Promise<any> => {
    if (args[0] === "--version") return "0.9.0";
    if (args[0] === "start") return { status: "ready" };
    if (args[0] === "card")
      return { results: [], total: 0, offset: 0, limit: 100 };
    if (args[0] === "file")
      return {
        status: "succeeded",
        fileKind: "image",
        fileId: args[args.indexOf("--file-id") + 1],
        fileUri: "heptabase://file/33333333-3333-4333-8333-333333333333",
      };
    if (args[0] === "note" && args[1] === "create") {
      markdown = readFileSync(
        args[args.indexOf("--content-file") + 1]!,
        "utf8",
      );
      return { id: "created", title: notes[0]!.title };
    }
    if (args[0] === "note" && args[1] === "read")
      return {
        id: "created",
        content: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "heading",
              content: [{ type: "text", text: notes[0]!.title }],
            },
            {
              type: "image",
              attrs: { fileId: "33333333-3333-4333-8333-333333333333" },
            },
          ],
        }),
      };
    throw new Error("Unexpected command");
  });
  const readImage = vi.fn(() => image);
  const c = new HeptabaseImportController(dir, {
    get: (id) => notes.find((n) => n.id === id),
    readImage,
    run,
  });
  return { c, run, readImage, dir, markdown: () => markdown };
}
async function done(c: HeptabaseImportController) {
  await vi.waitFor(() => expect(c.get()?.running).toBe(false));
  return c.get()!;
}
test("F79 preserves structured image positions and literal code, excludes recall, and cleans temp files", async () => {
  const illustrated = {
    ...note,
    memoryImages: {
      understand: { attachmentId: "understand", basedOnRevision: 1 },
      recall: { attachmentId: "recall", basedOnRevision: 1 },
    },
    content: {
      ...note.content,
      blocks: [
        ...note.content.blocks,
        {
          id: "img",
          type: "image" as const,
          props: { assetId: "body", alt: "Body" },
          children: [],
        },
      ],
    },
  };
  const f = fixture([illustrated]);
  await f.c.start(["n", "n"]);
  const b = await done(f.c);
  expect(b.items).toHaveLength(1);
  expect(b.items[0]!.status).toBe("created");
  expect(f.markdown()).toContain("# Title \\$\\(touch hacked\\)");
  expect(f.markdown()).toContain("reading-note-asset:body");
  expect(f.markdown()).toContain("![Body](heptabase://file/");
  expect(f.readImage.mock.calls).toHaveLength(2);
  expect(f.markdown()).toContain("Source: Book · Chapter");
  expect(readdirSync(f.dir).some((n) => n.startsWith("temp-"))).toBe(false);
});
test("F79 exact title matching pages through notes and skips without reading/uploading images", async () => {
  const f = fixture();
  f.run.mockImplementation(async (args) => {
    if (args[0] === "--version") return "0.9.0";
    if (args[0] === "start") return { status: "ready" };
    const offset = Number(args[args.indexOf("--offset") + 1]);
    return {
      results:
        offset === 0
          ? [{ id: "other", title: note.title + " extra", objectType: "note" }]
          : [{ id: "exists", title: note.title, objectType: "note" }],
      total: 2,
    };
  });
  await f.c.start(["n"]);
  expect((await done(f.c)).items[0]!.status).toBe("duplicate");
  expect(f.readImage).not.toHaveBeenCalled();
  expect(f.run.mock.calls.filter(([a]) => a[0] === "card")).toHaveLength(2);
});
test("F79 same-batch titles skip; failures retry without repeating success; uncertain creates never resend", async () => {
  const f = fixture([
    note,
    { ...note, id: "two" },
    { ...note, id: "bad", title: "Bad" },
  ]);
  const original = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (args) => {
    if (
      args[0] === "note" &&
      args[1] === "create" &&
      readFileSync(args.at(-1)!, "utf8").includes("# Bad")
    )
      throw new Error("CLI timed out");
    return original(args);
  });
  await f.c.start(["n", "two", "bad"]);
  let b = await done(f.c);
  expect(b.items.map((i) => i.status)).toEqual([
    "created",
    "duplicate",
    "uncertain",
  ]);
  const count = f.run.mock.calls.filter(
    ([a]) => a[0] === "note" && a[1] === "create",
  ).length;
  await f.c.retry();
  b = await done(f.c);
  expect(b.items[2]!.status).toBe("uncertain");
  expect(
    f.run.mock.calls.filter(([a]) => a[0] === "note" && a[1] === "create"),
  ).toHaveLength(count);
  const restored = new HeptabaseImportController(f.dir, {
    get: () => note,
    readImage: () => image,
    run: f.run,
  });
  expect(restored.get()!.items[2]!.status).toBe("uncertain");
});
test("F79 preflight failure and invalid notes have no uploads; only definite failures are retryable", async () => {
  const f = fixture();
  await expect(f.c.start([])).rejects.toThrow();
  await expect(f.c.start(["missing"])).rejects.toThrow();
  f.run.mockResolvedValueOnce("0.8.0");
  await expect(f.c.start(["n"])).rejects.toThrow(/0.9/);
  expect(f.c.get()).toBeUndefined();
  const illustrated = {
    ...note,
    memoryImages: { understand: { attachmentId: "image", basedOnRevision: 1 } },
  };
  const g = fixture([illustrated]);
  g.readImage.mockImplementationOnce(() => {
    throw new Error("Image missing");
  });
  await g.c.start(["n"]);
  expect((await done(g.c)).items[0]!.status).toBe("failed");
  await g.c.retry();
  expect((await done(g.c)).items[0]!.status).toBe("created");
});

test("F79 registered IPC rejects untrusted callers and passes only note IDs to Main", async () => {
  const { registerHeptabaseImportIpc } = await import(
    "../src/main/heptabase-import-ipc"
  );
  const f = fixture();
  const handlers = new Map<string, Function>();
  const trusted = { sender: "main" };
  registerHeptabaseImportIpc(
    {
      handle: (name, handler) => {
        handlers.set(name, handler);
      },
    },
    f.c,
    (event) => {
      if (event !== trusted) throw new Error("Untrusted");
    },
  );
  for (const handler of handlers.values())
    expect(() => handler({})).toThrow("Untrusted");
  await handlers.get("reading-notes:heptabase-start")!(trusted, ["n"]);
  await done(f.c);
  expect(
    handlers.get("reading-notes:heptabase-get")!(trusted).items[0].status,
  ).toBe("created");
});

test("F79 blocks recreating an unconfirmed title in a new batch and after restart", async () => {
  const f = fixture();
  const original = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (args) => {
    if (args[0] === "note" && args[1] === "create")
      throw new Error("Connection lost");
    return original(args);
  });
  await f.c.start(["n"]);
  expect((await done(f.c)).items[0]!.status).toBe("uncertain");
  await f.c.start(["n"]);
  expect((await done(f.c)).items[0]!.status).toBe("uncertain");
  const restored = new HeptabaseImportController(f.dir, {
    get: () => note,
    readImage: () => image,
    run: f.run,
  });
  await restored.start(["n"]);
  await done(restored);
  expect(
    f.run.mock.calls.filter(([a]) => a[0] === "note" && a[1] === "create"),
  ).toHaveLength(1);
});
test("F79 already-existing titles are skipped even if a local image is unavailable", async () => {
  const f = fixture([
    {
      ...note,
      memoryImages: {
        understand: { attachmentId: "missing", basedOnRevision: 1 },
      },
    },
  ]);
  f.readImage.mockImplementation(() => {
    throw new Error("Missing");
  });
  const original = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (args) =>
    args[0] === "card"
      ? {
          results: [{ id: "existing", title: note.title, objectType: "note" }],
          total: 1,
        }
      : original(args),
  );
  await f.c.start(["n"]);
  expect((await done(f.c)).items[0]!.status).toBe("duplicate");
  expect(f.run.mock.calls.some(([a]) => a[0] === "file")).toBe(false);
});

test("F79 freezes saved note and image bytes before asynchronous preflight", async () => {
  const originalNote = {
    ...note,
    memoryImages: { understand: { attachmentId: "old", basedOnRevision: 1 } },
  };
  const f = fixture([originalNote]);
  const original = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (args) => {
    if (args[0] === "--version") {
      originalNote.title = "Changed later";
      originalNote.content = markdownToReadingNoteDocument("Changed body");
      originalNote.memoryImages = {
        understand: { attachmentId: "new", basedOnRevision: 1 },
      };
    }
    return original(args);
  });
  await f.c.start(["n"]);
  expect((await done(f.c)).items[0]!.title).toBe(note.title);
  expect(f.markdown()).toContain("Body");
  expect(f.markdown()).not.toContain("Changed body");
  expect(f.readImage).toHaveBeenCalledExactlyOnceWith("old");
});
test("F79 file import retries the same saved file ID after an unknown file upload", async () => {
  const illustrated = {
    ...note,
    memoryImages: { understand: { attachmentId: "image", basedOnRevision: 1 } },
  };
  const f = fixture([illustrated]);
  const original = f.run.getMockImplementation()!;
  let first = true;
  f.run.mockImplementation(async (args) => {
    if (args[0] === "file" && first) {
      first = false;
      throw new Error("Upload result unknown");
    }
    return original(args);
  });
  await f.c.start(["n"]);
  expect((await done(f.c)).items[0]!.status).toBe("failed");
  await f.c.retry();
  expect((await done(f.c)).items[0]!.status).toBe("created");
  const uploads = f.run.mock.calls
    .filter(([a]) => a[0] === "file")
    .map(([a]) => a[a.indexOf("--file-id") + 1]);
  expect(uploads).toHaveLength(2);
  expect(uploads[0]).toBe(uploads[1]);
});
test("F79 malformed readback cannot claim an image import succeeded", async () => {
  const f = fixture([
    {
      ...note,
      memoryImages: {
        understand: { attachmentId: "image", basedOnRevision: 1 },
      },
    },
  ]);
  const original = f.run.getMockImplementation()!;
  f.run.mockImplementation(async (args) =>
    args[0] === "note" && args[1] === "read"
      ? {
          content: JSON.stringify({
            type: "doc",
            content: [
              { type: "text", text: "33333333-3333-4333-8333-333333333333" },
            ],
          }),
        }
      : original(args),
  );
  await f.c.start(["n"]);
  expect((await done(f.c)).items[0]!.status).toBe("uncertain");
});
