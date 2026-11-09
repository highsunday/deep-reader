import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { test, vi } from "vitest";
import { ChatController, composeCodexInput } from "../src/main/chat-controller";
import { LocalChatConversationStore } from "../src/main/chat-conversation-store";
import { SpawnedCodexAppServerClient } from "../src/main/codex-app-server-client";
import { InMemoryEpubLibrary } from "../src/main/epub-library";
import { extractReadingSegment } from "../src/renderer/reading-range";
import { createFakeCodexAppServer } from "./fake-codex-app-server";

async function minimalEpub(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);
  zip.file("EPUB/package.opf", `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Thinking in Systems</dc:title>
        <dc:creator>Example Author</dc:creator>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
        <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="chapter"/></spine>
    </package>`);
  zip.file("EPUB/nav.xhtml", `<?xml version="1.0"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Feedback Loops</a></li></ol></nav></body>
    </html>`);
  zip.file("EPUB/chapter.xhtml", `<?xml version="1.0"?>
    <html xmlns="http://www.w3.org/1999/xhtml"><body>
      <h1>Feedback Loops</h1>
      <p>Before secret. Inside concept. After hidden.</p>
      <ol start="3"><li>Third item</li></ol>
      <table><tr><th colspan="2">Heading</th></tr><tr><td rowspan="2">Cell</td><td>Value</td></tr></table>
      <script>never execute</script>
    </body></html>`);
  zip.file("EPUB/cover.png", Buffer.from([137, 80, 78, 71]));
  return zip.generateAsync({ type: "nodebuffer" });
}

test.each(['nav', 'ncx'])('B72 TC7: %s anchors survive same-file chapter merging as reading headings', async format => {
  const zip = await JSZip.loadAsync(await minimalEpub());
  zip.file('EPUB/nav.xhtml', `<html><body><nav><ol>
    <li><a href="chapter.xhtml#a">A</a></li><li><a href="chapter.xhtml#b">B</a></li>
    <li><a href="chapter.xhtml#c">C</a><ol><li><a href="chapter.xhtml#child">Child</a></li></ol></li>
  </ol></nav></body></html>`);
  if (format === 'ncx') {
    zip.file('EPUB/package.opf', (await zip.file('EPUB/package.opf')!.async('text'))
      .replace('properties="nav"', '').replace('<spine>', '<spine toc="ncx">')
      .replace('</manifest>', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/></manifest>'));
    zip.file('EPUB/toc.ncx', `<ncx><navMap>
      <navPoint><navLabel><text>A</text></navLabel><content src="chapter.xhtml#a"/></navPoint>
      <navPoint><navLabel><text>B</text></navLabel><content src="chapter.xhtml#b"/></navPoint>
      <navPoint><navLabel><text>C</text></navLabel><content src="chapter.xhtml#c"/>
        <navPoint><navLabel><text>Child</text></navLabel><content src="chapter.xhtml#child"/></navPoint>
      </navPoint></navMap></ncx>`);
  }
  zip.file('EPUB/chapter.xhtml', '<html><body><p id="a"><b>A</b></p><p>甲乙</p><p id="b"><b>B</b></p><p>一二三四五</p><p id="fake" data-reading-heading-level="1"><b>Bold prose</b></p><p id="c"><b>C</b></p><p id="child"><b>Child</b></p><p>子節</p></body></html>');
  const library = new InMemoryEpubLibrary();
  const imported = await library.importFromBuffer(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.notEqual(imported.status, 'cancelled');
  if (imported.status === 'cancelled') throw new Error('Unexpected cancelled import');
  const { book } = imported;
  // Same-file top-level entries are still merged in the visible book chapter list.
  assert.equal(book.chapters.filter(c => c.depth === 0).length, 1);
  const content = await library.getChapterContent(book.id, book.chapters[0].id);
  for (const id of ['a', 'b', 'c']) assert.match(content.contentHtml, new RegExp(`<p id="${id}" data-reading-heading-level="1">`));
  assert.match(content.contentHtml, /<p id="child" data-reading-heading-level="2">/);
  assert.match(content.contentHtml, /<p id="fake"><b>Bold prose/);
  assert.equal(content.contentHtml.replace(/<[^>]+>/g, ''), 'A甲乙B一二三四五Bold proseCChild子節');
});

test.each([
  '<p id="opening">Opening.</p></p><p></p></p><p>Ending.</p></p>',
  '<p id="opening">Opening.<p>Ending.'
])("malformed EPUB chapters preserve text and sanitization: %s", async (body) => {
  const zip = await JSZip.loadAsync(await minimalEpub());
  zip.file("EPUB/chapter.xhtml", `<html><body>${body}
    <script>unsafe script</script><iframe>unsafe frame</iframe>
    <img src="cover.png" onerror="unsafe event"><img src="https://example.com/tracker.png">
    <p onclick="unsafe click">Final &amp; safe.</p></body></html>`);
  const library = new InMemoryEpubLibrary();
  const imported = await library.importFromBuffer(await zip.generateAsync({ type: "nodebuffer" }));
  assert.equal(imported.status, "imported");
  if (imported.status !== "imported") throw new Error("Expected imported book");
  const { book } = imported;
  const content = await library.getChapterContent(book.id, book.chapters[0]!.id);
  assert.match(content.contentHtml, /id="opening"/);
  assert.match(content.contentHtml, /Opening\.[\s\S]*Ending\.[\s\S]*Final &amp; safe\./);
  assert.match(content.contentHtml, /<img src="data:image\/png;base64,/);
  assert.doesNotMatch(content.contentHtml, /unsafe|onerror|onclick|https:|script|iframe/);
});

test("a detailed explanation focuses on the original selection within the reading segment", () => {
  const input = composeCodexInput({
    text: "請詳細說明這段內容",
    quote: { text: "Inside concept." },
    context: {
      bookTitle: "Thinking in Systems",
      chapterTitle: "Feedback Loops",
      readingSegment: "Before secret. Inside concept. After hidden."
    }
  });

  assert.match(input, /Current START\/END reading segment:[\s\S]*Before secret\. Inside concept\. After hidden\./);
  assert.match(input, /Selected passage to explain:[\s\S]*Inside concept\./);
  assert.match(input, /meaning, key concepts, and reasoning relationships/);
  assert.match(input, /Do not assume book content that was not provided/);
});

async function hierarchicalEpub(): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await minimalEpub());
  zip.file("EPUB/nav.xhtml", `<?xml version="1.0"?>
    <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <body><nav epub:type="toc"><ol>
        <li><a href="chapter.xhtml">Feedback Loops</a><ol>
          <li><a href="chapter.xhtml#balancing">Balancing Loops</a></li>
          <li><a href="chapter.xhtml#reinforcing">Reinforcing Loops</a></li>
        </ol></li>
      </ol></nav></body>
    </html>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function epub2WithNcx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0"?>
    <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
      <rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles>
    </container>`);
  zip.file("EPUB/package.opf", `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>NCX Book</dc:title>
        <dc:creator>Example Author</dc:creator>
      </metadata>
      <manifest>
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="one" href="text/one.xhtml" media-type="application/xhtml+xml"/>
        <item id="bridge" href="text/bridge.xhtml" media-type="application/xhtml+xml"/>
        <item id="two" href="text/two.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine toc="ncx">
        <itemref idref="one"/>
        <itemref idref="bridge"/>
        <itemref idref="two"/>
      </spine>
    </package>`);
  zip.file("EPUB/toc.ncx", `<?xml version="1.0"?>
    <ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
      <navMap>
        <navPoint id="one"><navLabel><text>First Chapter</text></navLabel><content src="text/one.xhtml"/>
          <navPoint id="two"><navLabel><text>Nested Section</text></navLabel><content src="text/two.xhtml#section-two"/></navPoint>
        </navPoint>
      </navMap>
    </ncx>`);
  zip.file("EPUB/text/one.xhtml", `<?xml version="1.0"?><html><body><h1>First Chapter</h1><p>Opening text.</p></body></html>`);
  zip.file("EPUB/text/bridge.xhtml", `<?xml version="1.0"?><html><body><p>Bridge content retained.</p></body></html>`);
  zip.file("EPUB/text/two.xhtml", `<?xml version="1.0"?><html><body><h2 id="section-two">Nested Section</h2><p>Second text.</p></body></html>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function waitUntil(check: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for fake Codex.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("books, reading ranges, and chapter annotations survive an application restart", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-library-"));
  try {
    const firstSession = new InMemoryEpubLibrary({ storageDirectory });
    const imported = await firstSession.importFromBuffer(await minimalEpub());
    assert.notEqual(imported.status, "cancelled");
    if (imported.status === "cancelled") return;
    const chapterId = imported.book.chapters[0]!.id;
    await firstSession.saveReadingRange({
      bookId: imported.book.id,
      chapterId,
      range: { start: 12, end: 34 }
    });
    await firstSession.saveAnnotations({
      bookId: imported.book.id,
      chapterId,
      annotations: [{ id: "a1", start: 12, end: 26, text: "Inside concept", color: "green" }]
    });

    const secondSession = new InMemoryEpubLibrary({ storageDirectory });
    const restoredBooks = await secondSession.listBooks();
    assert.equal(restoredBooks.length, 1);
    assert.deepEqual(restoredBooks[0]!.chapterRanges[chapterId], { start: 12, end: 34 });
    assert.deepEqual(restoredBooks[0]!.chapterAnnotations[chapterId], [
      { id: "a1", start: 12, end: 26, text: "Inside concept", color: "green" }
    ]);
    await assert.rejects(() => secondSession.saveAnnotations({
      bookId: restoredBooks[0]!.id,
      chapterId,
      annotations: [
        { id: "a1", start: 12, end: 26, text: "Inside concept", color: "green" },
        { id: "a2", start: 20, end: 30, text: "overlap", color: "blue" }
      ]
    }), /Overlapping/);
    await assert.rejects(() => secondSession.saveAnnotations({
      bookId: restoredBooks[0]!.id,
      chapterId,
      annotations: [
        { id: "invalid-color", start: 30, end: 37, text: "invalid", color: "orange" as never }
      ]
    }), /Invalid annotation/);
    await secondSession.saveAnnotations({
      bookId: restoredBooks[0]!.id,
      chapterId,
      annotations: []
    });
    const thirdSession = new InMemoryEpubLibrary({ storageDirectory });
    assert.deepEqual((await thirdSession.listBooks())[0]!.chapterAnnotations, {});
    assert.match(
      (await secondSession.getChapterContent(restoredBooks[0]!.id, chapterId)).contentHtml,
      /Inside concept\./
    );
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test("saved libraries without annotation data migrate as empty annotations", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-library-legacy-"));
  try {
    const firstSession = new InMemoryEpubLibrary({ storageDirectory });
    await firstSession.importFromBuffer(await minimalEpub());
    const manifestPath = join(storageDirectory, "library.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.books[0].chapterAnnotations;
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const migrated = await new InMemoryEpubLibrary({ storageDirectory }).listBooks();
    assert.deepEqual(migrated[0]!.chapterAnnotations, {});
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test("legacy annotations without a color migrate to yellow and unknown colors are discarded", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-library-annotation-colors-"));
  try {
    const firstSession = new InMemoryEpubLibrary({ storageDirectory });
    const imported = await firstSession.importFromBuffer(await minimalEpub());
    assert.notEqual(imported.status, "cancelled");
    if (imported.status === "cancelled") return;
    const chapterId = imported.book.chapters[0]!.id;
    const manifestPath = join(storageDirectory, "library.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.books[0].chapterAnnotations = {
      [chapterId]: [
        { id: "legacy-yellow", start: 12, end: 26, text: "Inside concept" },
        { id: "unknown", start: 28, end: 35, text: "unknown", color: "orange" }
      ]
    };
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const migrated = await new InMemoryEpubLibrary({ storageDirectory }).listBooks();
    assert.deepEqual(migrated[0]!.chapterAnnotations[chapterId], [
      { id: "legacy-yellow", start: 12, end: 26, text: "Inside concept", color: "yellow" }
    ]);
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test("each book persists its last opened chapter and normalizes stale progress", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-library-progress-"));
  try {
    const firstSession = new InMemoryEpubLibrary({ storageDirectory });
    const imported = await firstSession.importFromBuffer(await hierarchicalEpub());
    assert.notEqual(imported.status, "cancelled");
    if (imported.status === "cancelled") return;
    const lastChapter = imported.book.chapters[1]!;
    const saved = await firstSession.saveLastChapter(imported.book.id, lastChapter.id);
    assert.equal(saved.lastChapterId, lastChapter.id);

    const secondSession = new InMemoryEpubLibrary({ storageDirectory });
    assert.equal((await secondSession.listBooks())[0]!.lastChapterId, lastChapter.id);

    const manifestPath = join(storageDirectory, "library.json");
    let manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.books[0].readingState;
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const legacy = (await new InMemoryEpubLibrary({ storageDirectory }).listBooks())[0]!;
    assert.deepEqual(legacy.readingState, {
      view: "overview",
      chapterId: lastChapter.id,
      scrollProgress: 0
    });

    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.books[0].readingState = {
      view: "reader",
      chapterId: "stale-chapter",
      scrollProgress: 0.75
    };
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const safeFallback = (await new InMemoryEpubLibrary({ storageDirectory }).listBooks())[0]!;
    assert.deepEqual(safeFallback.readingState, {
      view: "overview",
      chapterId: lastChapter.id,
      scrollProgress: 0.75
    });

    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.books[0].lastChapterId = "stale-chapter";
    manifest.books[0].readingState = {
      view: "reader",
      chapterId: "stale-chapter",
      scrollProgress: 0.5
    };
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const normalized = (await new InMemoryEpubLibrary({ storageDirectory }).listBooks())[0]!;
    assert.equal(normalized.lastChapterId, undefined);
    assert.deepEqual(normalized.readingState, {
      view: "overview",
      chapterId: null,
      scrollProgress: 0.5
    });
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test("each book persists its own reading view, chapter, and relative scroll position", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-library-reading-state-"));
  try {
    const firstSession = new InMemoryEpubLibrary({ storageDirectory });
    const firstImport = await firstSession.importFromBuffer(await hierarchicalEpub());
    const secondImport = await firstSession.importFromBuffer(await minimalEpub());
    assert.notEqual(firstImport.status, "cancelled");
    assert.notEqual(secondImport.status, "cancelled");
    if (firstImport.status === "cancelled" || secondImport.status === "cancelled") return;
    const firstChapter = firstImport.book.chapters[1]!;
    const secondChapter = secondImport.book.chapters[0]!;

    await firstSession.saveReadingState({
      bookId: firstImport.book.id,
      view: "reader",
      chapterId: firstChapter.id,
      scrollProgress: 0.5
    });
    await firstSession.saveReadingState({
      bookId: secondImport.book.id,
      view: "overview",
      chapterId: secondChapter.id,
      scrollProgress: 0.25
    });

    const reloaded = await new InMemoryEpubLibrary({ storageDirectory }).listBooks();
    assert.deepEqual(reloaded.find(({ id }) => id === firstImport.book.id)?.readingState, {
      view: "reader",
      chapterId: firstChapter.id,
      scrollProgress: 0.5
    });
    assert.deepEqual(reloaded.find(({ id }) => id === secondImport.book.id)?.readingState, {
      view: "overview",
      chapterId: secondChapter.id,
      scrollProgress: 0.25
    });
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test("starred books stay pinned in import order and persist across reloads", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-library-pinned-"));
  try {
    const firstSession = new InMemoryEpubLibrary({ storageDirectory });
    const firstImport = await firstSession.importFromBuffer(await hierarchicalEpub());
    const secondImport = await firstSession.importFromBuffer(await minimalEpub());
    assert.notEqual(firstImport.status, "cancelled");
    assert.notEqual(secondImport.status, "cancelled");
    if (firstImport.status === "cancelled" || secondImport.status === "cancelled") return;

    assert.equal(firstImport.book.pinned, false);
    assert.equal(secondImport.book.pinned, false);
    await firstSession.setPinned({ bookId: secondImport.book.id, pinned: true });
    assert.deepEqual(
      (await firstSession.listBooks()).map(({ id, pinned }) => [id, pinned]),
      [[firstImport.book.id, false], [secondImport.book.id, true]]
    );

    await firstSession.setPinned({ bookId: firstImport.book.id, pinned: true });
    assert.deepEqual(
      (await firstSession.listBooks()).map(({ id }) => id),
      [firstImport.book.id, secondImport.book.id]
    );

    await firstSession.setPinned({ bookId: firstImport.book.id, pinned: false });
    assert.deepEqual(
      (await firstSession.listBooks()).map(({ id, pinned }) => [id, pinned]),
      [[firstImport.book.id, false], [secondImport.book.id, true]]
    );

    const reloaded = await new InMemoryEpubLibrary({ storageDirectory }).listBooks();
    assert.deepEqual(
      reloaded.map(({ id, pinned }) => [id, pinned]),
      [[firstImport.book.id, false], [secondImport.book.id, true]]
    );

    const manifestPath = join(storageDirectory, "library.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.books[0].pinned;
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
    const legacy = await new InMemoryEpubLibrary({ storageDirectory }).listBooks();
    assert.equal(legacy.find(({ id }) => id === firstImport.book.id)?.pinned, false);
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test("pinning rejects an unknown book without changing the library", async () => {
  const library = new InMemoryEpubLibrary();
  const imported = await library.importFromBuffer(await minimalEpub());
  assert.notEqual(imported.status, "cancelled");
  await assert.rejects(
    () => library.setPinned({ bookId: "missing-book", pinned: true }),
    /Book not found/
  );
  assert.equal((await library.listBooks())[0]?.pinned, false);
});

test("deleting a book permanently removes its manifest entry and EPUB", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-library-delete-"));
  try {
    const firstSession = new InMemoryEpubLibrary({ storageDirectory });
    const imported = await firstSession.importFromBuffer(await minimalEpub());
    assert.notEqual(imported.status, "cancelled");
    if (imported.status === "cancelled") return;
    const epubPath = join(storageDirectory, `${imported.book.id}.epub`);
    await access(epubPath);
    await firstSession.deleteBook(imported.book.id);
    assert.deepEqual(await firstSession.listBooks(), []);
    await assert.rejects(() => access(epubPath));
    assert.deepEqual(await new InMemoryEpubLibrary({ storageDirectory }).listBooks(), []);
    await assert.rejects(() => firstSession.deleteBook(imported.book.id), /Book not found/);
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test("imports an EPUB and sends only the START/END segment through a real Codex transport", async () => {
  const library = new InMemoryEpubLibrary();
  const imported = await library.importFromBuffer(await minimalEpub());
  assert.notEqual(imported.status, "cancelled");
  if (imported.status === "cancelled") return;
  assert.equal(imported.book.title, "Thinking in Systems");
  assert.match(imported.book.coverDataUrl ?? "", /^data:image\/png;base64,/);
  assert.equal(imported.book.chapters[0]?.title, "Feedback Loops");

  const chapter = await library.getChapterContent(
    imported.book.id,
    imported.book.chapters[0]!.id
  );
  assert.doesNotMatch(chapter.contentHtml, /script|never execute/i);
  assert.match(chapter.contentHtml, /<ol start="3">/);
  assert.match(chapter.contentHtml, /<th colspan="2">Heading<\/th>/);
  assert.match(chapter.contentHtml, /<td rowspan="2">Cell<\/td>/);
  const chapterText = chapter.contentHtml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const start = chapterText.indexOf("Inside concept.");
  const end = start + "Inside concept.".length;
  const selected = extractReadingSegment(chapterText, { start, end });
  assert.equal(selected, "Inside concept.");

  const fake = createFakeCodexAppServer();
  const controller = new ChatController({
    createClient: () => new SpawnedCodexAppServerClient({
      spawnProcess: () => fake.child
    }),
    workingDirectory: "/tmp/reader-ai-range-chat-smoke"
  });
  const connected = await controller.connect();
  assert.equal(connected.connection, "ready");
  assert.equal(connected.allowance.fiveHour?.remainingPercent, 75);
  assert.equal(connected.allowance.weekly?.remainingPercent, 62);
  await controller.sendMessage({
    text: "What is the key idea?",
    model: "gpt-5.6-terra",
    context: {
      bookTitle: imported.book.title,
      chapterTitle: imported.book.chapters[0]!.title,
      readingSegment: selected
    }
  });
  await waitUntil(() => controller.getSnapshot().activeTurnId === null);
  await controller.sendMessage({ text: "Why does it matter?", readingSource: {
    bookTitle: imported.book.title,
    chapterTitle: imported.book.chapters[0]!.title,
    readingSegment: selected
  } });
  await waitUntil(() => controller.getSnapshot().activeTurnId === null);

  const threadStarts = fake.requests.filter(({ method }) => method === "thread/start");
  const turns = fake.requests.filter(({ method }) => method === "turn/start");
  assert.equal(threadStarts.length, 1);
  assert.equal(turns.length, 2);
  assert.equal(turns[0]?.params?.threadId, "reader-thread-1");
  assert.equal(turns[1]?.params?.threadId, "reader-thread-1");
  assert.equal(turns[0]?.params?.model, "gpt-5.6-terra");
  assert.equal(turns[1]?.params?.model, undefined);
  assert.deepEqual(controller.getSnapshot().messages[2]?.readingSource, {
    bookTitle: imported.book.title,
    chapterTitle: imported.book.chapters[0]!.title,
    readingSegment: selected
  });
  assert.match((turns[1]?.params?.input as Array<{ text: string }>)[0]!.text, /Current START\/END reading segment:\nInside concept/);
  const firstInput = (turns[0]?.params?.input as Array<{ text: string }>)[0]!.text;
  assert.match(firstInput, /Thinking in Systems/);
  assert.match(firstInput, /Feedback Loops/);
  assert.match(firstInput, /Inside concept\./);
  assert.doesNotMatch(firstInput, /Before secret|After hidden/);
  assert.deepEqual(
    controller.getSnapshot().messages.map(({ role, status }) => [role, status]),
    [
      ["user", "completed"],
      ["assistant", "completed"],
      ["user", "completed"],
      ["assistant", "completed"]
    ]
  );
  controller.close();
});

test("refreshes Codex allowance every minute, preserves it on failure, and stops after close", async () => {
  vi.useFakeTimers();
  try {
    const fake = createFakeCodexAppServer(0, (readCount) => {
      if (readCount === 2) return new Error("temporary allowance failure");
      const usedPercent = readCount === 1 ? 28 : 33;
      return {
        rateLimits: {
          primary: {
            usedPercent,
            windowDurationMins: 10_080,
            resetsAt: 1_800_000_000
          },
          secondary: null
        },
        rateLimitsByLimitId: null
      };
    });
    const controller = new ChatController({
      createClient: () => new SpawnedCodexAppServerClient({
        spawnProcess: () => fake.child
      }),
      workingDirectory: "/tmp/reader-ai-range-chat-allowance"
    });

    await controller.connect();
    assert.equal(controller.getSnapshot().allowance.weekly?.remainingPercent, 72);

    fake.emitNotification("account/rateLimits/updated", {
      rateLimits: {
        primary: {
          usedPercent: 50,
          windowDurationMins: 300,
          resetsAt: 1_800_100_000
        },
        secondary: null
      }
    });
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(controller.getSnapshot().allowance.fiveHour?.remainingPercent, 50);
    assert.equal(controller.getSnapshot().allowance.weekly?.remainingPercent, 72);

    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(
      fake.requests.filter(({ method }) => method === "account/rateLimits/read").length,
      2
    );
    assert.equal(controller.getSnapshot().allowance.weekly?.remainingPercent, 72);

    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(
      fake.requests.filter(({ method }) => method === "account/rateLimits/read").length,
      3
    );
    assert.equal(controller.getSnapshot().allowance.weekly?.remainingPercent, 67);

    controller.close();
    await vi.advanceTimersByTimeAsync(120_000);
    assert.equal(
      fake.requests.filter(({ method }) => method === "account/rateLimits/read").length,
      3
    );
  } finally {
    vi.useRealTimers();
  }
});

test("imports hierarchical navigation entries with depth and fragments", async () => {
  const library = new InMemoryEpubLibrary();
  const imported = await library.importFromBuffer(await hierarchicalEpub());
  assert.notEqual(imported.status, "cancelled");
  if (imported.status === "cancelled") return;

  assert.deepEqual(
    imported.book.chapters.map(({ title, depth, fragment }) => ({ title, depth, fragment })),
    [
      { title: "Feedback Loops", depth: 0, fragment: null },
      { title: "Balancing Loops", depth: 1, fragment: "balancing" },
      { title: "Reinforcing Loops", depth: 1, fragment: "reinforcing" }
    ]
  );
  assert.equal(new Set(imported.book.chapters.map(({ id }) => id)).size, 3);

  const section = imported.book.chapters[1]!;
  const content = await library.getChapterContent(imported.book.id, section.id);
  assert.equal(content.chapterId, section.id);
  assert.match(content.contentHtml, /Feedback Loops/);
});

test("imports EPUB 2 NCX chapters and retains spine content between TOC entries", async () => {
  const library = new InMemoryEpubLibrary();
  const imported = await library.importFromBuffer(await epub2WithNcx());
  assert.notEqual(imported.status, "cancelled");
  if (imported.status === "cancelled") return;

  assert.deepEqual(
    imported.book.chapters.map(({ title, depth, fragment, contentHrefs }) => ({
      title,
      depth,
      fragment,
      contentHrefs
    })),
    [
      {
        title: "First Chapter",
        depth: 0,
        fragment: null,
        contentHrefs: ["EPUB/text/one.xhtml", "EPUB/text/bridge.xhtml"]
      },
      {
        title: "Nested Section",
        depth: 1,
        fragment: "section-two",
        contentHrefs: ["EPUB/text/two.xhtml"]
      }
    ]
  );
  assert.equal(imported.book.epubParseVersion, 4);

  const first = await library.getChapterContent(imported.book.id, imported.book.chapters[0]!.id);
  assert.match(first.contentHtml, /Opening text/);
  assert.match(first.contentHtml, /Bridge content retained/);
  assert.doesNotMatch(first.contentHtml, /Second text/);
});

test("rebuilds legacy chapter indexes and migrates reading data by href", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-library-ncx-migration-"));
  try {
    const firstSession = new InMemoryEpubLibrary({ storageDirectory });
    const imported = await firstSession.importFromBuffer(await epub2WithNcx());
    assert.notEqual(imported.status, "cancelled");
    if (imported.status === "cancelled") return;

    const manifestPath = join(storageDirectory, "library.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.books[0].epubParseVersion;
    manifest.books[0].chapters = [
      { id: "legacy-one", title: "one", href: "EPUB/text/one.xhtml", order: 0 },
      { id: "legacy-bridge", title: "bridge", href: "EPUB/text/bridge.xhtml", order: 1 },
      { id: "legacy-two", title: "two", href: "EPUB/text/two.xhtml", order: 2 }
    ];
    manifest.books[0].lastChapterId = "legacy-two";
    manifest.books[0].chapterRanges = { "legacy-two": { start: 2, end: 12 } };
    manifest.books[0].chapterAnnotations = {
      "legacy-two": [{ id: "legacy-note", start: 2, end: 8, text: "Nested" }]
    };
    await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

    const migratedLibrary = new InMemoryEpubLibrary({ storageDirectory });
    const migrated = (await migratedLibrary.listBooks())[0]!;
    const nested = migrated.chapters.find(({ href }) => href === "EPUB/text/two.xhtml")!;
    assert.equal(migrated.chapters.length, 2);
    assert.equal(nested.title, "Nested Section");
    assert.equal(migrated.epubParseVersion, 4);
    assert.equal(migrated.lastChapterId, nested.id);
    assert.deepEqual(migrated.chapterRanges[nested.id], { start: 2, end: 12 });
    assert.deepEqual(migrated.chapterAnnotations[nested.id], [
      { id: "legacy-note", start: 2, end: 8, text: "Nested", color: "yellow" }
    ]);

    const persisted = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(persisted.books[0].epubParseVersion, 4);
    assert.equal(persisted.books[0].chapters.length, 2);
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test("AI conversations persist, switch by resuming their Codex thread, and archive on removal", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-chat-"));
  try {
    const firstFake = createFakeCodexAppServer();
    let id = 0;
    let now = 100;
    const first = new ChatController({
      createClient: () => new SpawnedCodexAppServerClient({
        spawnProcess: () => firstFake.child
      }),
      workingDirectory: "/tmp/reader-ai-range-chat-history",
      conversationStore: new LocalChatConversationStore(storageDirectory),
      createConversationId: () => `conversation-${++id}`,
      now: () => ++now
    });
    await first.connect();
    await first.sendMessage({
      text: "Explain the opening",
      quote: { text: "A selected opening passage." },
      context: { bookTitle: "Example Book", chapterTitle: "Opening" }
    });
    await waitUntil(() => first.getSnapshot().activeTurnId === null);
    first.startNewConversation();
    await first.sendMessage({ text: "What is the second idea?" });
    await waitUntil(() => first.getSnapshot().activeTurnId === null);
    assert.deepEqual(first.getSnapshot().conversations.map(({ id }) => id), [
      "conversation-2",
      "conversation-1"
    ]);
    first.close();

    const secondFake = createFakeCodexAppServer();
    const second = new ChatController({
      createClient: () => new SpawnedCodexAppServerClient({
        spawnProcess: () => secondFake.child
      }),
      workingDirectory: "/tmp/reader-ai-range-chat-history",
      conversationStore: new LocalChatConversationStore(storageDirectory)
    });
    assert.equal(second.getSnapshot().activeConversationId, "conversation-2");
    assert.equal(second.getSnapshot().messages[0]?.text, "What is the second idea?");
    second.selectConversation("conversation-1");
    assert.deepEqual(second.getSnapshot().messages[0]?.quote, {
      text: "A selected opening passage."
    });
    await second.connect();
    await second.sendMessage({ text: "Continue" });
    await waitUntil(() => second.getSnapshot().activeTurnId === null);
    assert.equal(
      secondFake.requests.find(({ method }) => method === "thread/resume")?.params?.threadId,
      "reader-thread-1"
    );
    assert.match(String(secondFake.requests.find(({ method }) => method === "thread/resume")?.params?.developerInstructions), /reading-note-update/);
    await second.removeConversation("conversation-2");
    assert.equal(
      secondFake.requests.find(({ method }) => method === "thread/archive")?.params?.threadId,
      "reader-thread-2"
    );
    assert.deepEqual(second.getSnapshot().conversations.map(({ id }) => id), ["conversation-1"]);
    second.close();
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test("an active Codex response can be interrupted from the conversation composer", async () => {
  const fake = createFakeCodexAppServer(50);
  const controller = new ChatController({
    createClient: () => new SpawnedCodexAppServerClient({
      spawnProcess: () => fake.child
    }),
    workingDirectory: "/tmp/reader-ai-range-chat-stop"
  });
  await controller.connect();
  await controller.sendMessage({ text: "Explain this" });
  assert.match(controller.getSnapshot().activeTurnId ?? "", /^turn-/);
  await controller.stopResponse();
  assert.deepEqual(
    fake.requests.find(({ method }) => method === "turn/interrupt")?.params,
    { threadId: "reader-thread-1", turnId: "turn-1" }
  );
  controller.close();
});

test("B35 loads paginated models and refreshes the catalog without losing it on failure", async () => {
  vi.useFakeTimers();
  let generation = 0;
  const requests: Array<Record<string, unknown> | undefined> = [];
  const controller = new ChatController({
    workingDirectory: process.cwd(),
    createClient: () => ({
      initialize: async () => {},
      readAccount: async () => ({ account: { type: "chatgpt" }, requiresOpenaiAuth: false }),
      onNotification: () => () => {}, onExit: () => () => {}, close: () => {},
      request: async (method, params) => {
        if (method !== "model/list") return {};
        requests.push(params);
        if (generation === 2) throw new Error("offline");
        if (params?.cursor === "page2") return { data: [{ id: "future", model: "future-model", displayName: "Future model" }], nextCursor: null };
        return { data: [{ id: "astra", model: "gpt-6-astra", displayName: "GPT-6", isDefault: true },
          ...(generation ? [{ model: "new-model", displayName: "New model" }] : [])], nextCursor: "page2" };
      }
    })
  });
  try {
    const state = await controller.connect();
    assert.deepEqual(state.models?.map((model) => model.id), ["gpt-6-astra", "future-model"]);
    assert.equal(requests[1]?.cursor, "page2");
    generation = 1;
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(controller.getSnapshot().models?.some((model) => model.id === "new-model"), true);
    generation = 2;
    await vi.advanceTimersByTimeAsync(60_000);
    assert.equal(controller.getSnapshot().connection, "ready");
    assert.equal(controller.getSnapshot().models?.length, 3);
  } finally {
    controller.close();
    vi.useRealTimers();
  }
});

 test("B35 chooses an available model without pinning future model names", async () => {
  const { availableChatModel, isCodexChatModel } = await import("../src/shared/contracts");
  const models = [{ id: "future-model", label: "Future", isDefault: true }, { id: "gpt-6-astra", label: "GPT-6" }];
  assert.equal(availableChatModel(models, "gpt-6-astra"), "gpt-6-astra");
  assert.equal(availableChatModel(models, "removed"), "future-model");
  assert.equal(availableChatModel([{ id: "first", label: "First" }], "removed"), "first");
  assert.equal(isCodexChatModel("future-model"), true);
  assert.equal(isCodexChatModel("invalid model"), false);
});

test("B73 same-range natural-language note creation sends actual current book image inputs to Codex", async () => {
  const { prepareReadingNoteAwareMessage } = await import("../src/renderer/reading-note-workflow");
  const { prepareReadingSegmentDelivery } = await import("../src/renderer/reading-segment-delivery");
  const fake = createFakeCodexAppServer();
  const controller = new ChatController({ createClient: () => new SpawnedCodexAppServerClient({ spawnProcess: () => fake.child }), workingDirectory: "/tmp/b73-source-image-test" });
  const images = [{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }];
  const segment = { bookId: "b", chapterId: "c", bookTitle: "系統", chapterTitle: "回饋", readingSegment: "負回饋圖 [Book image 1]", range: { start: 0, end: 10 }, images };
  try {
    await controller.connect();
    const first = prepareReadingNoteAwareMessage({ text: "解釋這個負回饋圖", model: "gpt-5.6-sol", segment, readingNotePending: false });
    await controller.sendMessage(first.input);
    await waitUntil(() => controller.getSnapshot().activeTurnId === null);
    const second = prepareReadingNoteAwareMessage({ text: "把剛才討論的負回饋整理成筆記", model: "gpt-5.6-sol", segment,
      readingNotePending: false, lastProvidedKey: prepareReadingSegmentDelivery(segment).key });
    await controller.sendMessage(second.input);
    await waitUntil(() => controller.getSnapshot().activeTurnId === null);
    const turns = fake.requests.filter(r => r.method === "turn/start");
    const input = turns[1]!.params!.input as Array<{ type: string; url?: string; text?: string }>;
    assert.equal(input.filter(item => item.type === "image").length, 1);
    assert.equal(input.find(item => item.type === "image")!.url, images[0]!.dataUrl);
    assert.match(input.find(item => item.type === "text")!.text!, /\[Book image 1\]/);
    assert.equal(input.some(item => item.type === "skill"), false);
  } finally { controller.close(); }
});

test("F75 finished books retain their status when browsed and after reopening the library", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "deep-reading-finished-"));
  try {
    const library = new InMemoryEpubLibrary({ storageDirectory });
    const result = await library.importFromBuffer(await minimalEpub());
    assert.ok(result.status !== "cancelled");
    const bookId = result.book.id;
    await library.setShelfStatus({ bookId, status: "finished" });
    await library.saveLastChapter(bookId, result.book.chapters[0].id);
    const reopened = new InMemoryEpubLibrary({ storageDirectory });
    assert.equal((await reopened.listBooks())[0].shelfStatus, "finished");
    assert.equal((await reopened.setShelfStatus({ bookId, status: "reading" })).shelfStatus, "reading");
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});

test('B76 TC4: a top-level chapter includes nested spine documents before the next top-level chapter', async () => {
  const zip = await JSZip.loadAsync(await minimalEpub());
  zip.file('EPUB/package.opf', (await zip.file('EPUB/package.opf')!.async('string'))
    .replace('</manifest>', '<item id="child" href="child.xhtml" media-type="application/xhtml+xml"/><item id="next" href="next.xhtml" media-type="application/xhtml+xml"/></manifest>')
    .replace('</spine>', '<itemref idref="child"/><itemref idref="next"/></spine>'));
  zip.file('EPUB/nav.xhtml', '<html><body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">Parent</a><ol><li><a href="chapter.xhtml#section">Section</a><ol><li><a href="child.xhtml">Child</a></li></ol></li></ol></li><li><a href="next.xhtml">Next</a></li></ol></nav></body></html>');
  zip.file('EPUB/child.xhtml', '<html><body><p>Nested document text</p></body></html>');
  zip.file('EPUB/next.xhtml', '<html><body><p>Next chapter text</p></body></html>');
  const library = new InMemoryEpubLibrary();
  const imported = await library.importFromBuffer(await zip.generateAsync({type: 'nodebuffer'}));
  if (imported.status === 'cancelled') throw new Error('Unexpected cancellation');
  const {book} = imported;
  const content = await library.getChapterContent(book.id, book.chapters[0].id);
  assert.match(content.contentHtml, /Nested document text/);
  assert.doesNotMatch(content.contentHtml, /Next chapter text/);
  assert.match((await library.getChapterContent(book.id, book.chapters[1].id)).contentHtml, /Nested document text/);
});


test("F77 TC2/3/4/6: explicit unread preserves progress across restart and resumes reading", async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), "f77-unread-"));
  try {
    const library = new InMemoryEpubLibrary({ storageDirectory });
    const imported = await library.importFromBuffer(await minimalEpub());
    assert.ok(imported.status !== "cancelled");
    const id = imported.book.id;
    const chapterId = imported.book.chapters[0].id;
    await library.saveReadingState({ bookId: id, view: "reader", chapterId, scrollProgress: 0.42 });
    await library.setPinned({ bookId: id, pinned: true });
    await library.saveReadingRange({ bookId: id, chapterId, range: { start: 2, end: 10 } });
    await library.saveAnnotations({ bookId: id, chapterId,
      annotations: [{ id: "f77-annotation", start: 2, end: 6, text: "fore", color: "yellow" }] });
    const before = (await library.listBooks())[0];
    const moved = await library.setShelfStatus({ bookId: id, status: "unread" });
    assert.deepEqual(moved, { ...before, shelfStatus: "unread" });
    const reopened = new InMemoryEpubLibrary({ storageDirectory });
    assert.deepEqual((await reopened.listBooks())[0], moved);
    const overview = await reopened.saveReadingState({ bookId: id, view: "overview", chapterId, scrollProgress: 0.42 });
    assert.equal(overview.shelfStatus, "unread");
    const resumed = await reopened.saveReadingState({ bookId: id, view: "reader", chapterId, scrollProgress: 0.42 });
    assert.equal(resumed.shelfStatus, "reading");
    assert.equal(resumed.readingState.scrollProgress, 0.42);
    await assert.rejects(reopened.setShelfStatus({ bookId: id, status: "invalid" as never }), /Invalid shelf status/);
    assert.equal((await reopened.listBooks())[0].shelfStatus, "reading");
  } finally { await rm(storageDirectory, { recursive: true, force: true }); }
});
