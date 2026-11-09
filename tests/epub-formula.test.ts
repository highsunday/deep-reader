import { expect, test } from 'vitest';
import JSZip from 'jszip';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryEpubLibrary } from '../src/main/epub-library';

async function fixture(body: string, malformed = false) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
  zip.file('book.opf', '<package><metadata><title>Math book</title></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>');
  zip.file('c.xhtml', `<html><head><link rel="stylesheet" href="book.css"/></head><body>${body}${malformed ? '</bad>' : ''}</body></html>`);
  zip.file('book.css', 'img.formula {width:12.4em; background:url(https://invalid.test);} img.bad {width:expression(evil());} img.huge {width:999999px;}');
  zip.file('eq.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><text x="0" y="20">a+b</text></svg>');
  zip.file('pic.png', 'png');
  return zip.generateAsync({ type: 'nodebuffer' });
}
async function chapter(body: string, malformed = false) {
  const library = new InMemoryEpubLibrary();
  const result = await library.importFromBuffer(await fixture(body, malformed));
  if (result.status === 'cancelled') throw new Error('Unexpected cancel');
  const { book } = result;
  return (await library.getChapterContent(book.id, book.chapters[0].id)).contentHtml;
}
test.each([false, true])('B78 TC1 numeric text stays literal (malformed=%s)', async malformed => {
  const html = await chapter('<p><span>0</span><span>1</span><span>001</span><span>false</span><span>1e3</span></p>', malformed);
  for (const value of ['0', '1', '001', 'false', '1e3']) expect(html).toContain(`<span>${value}</span>`);
});
test('B78 TC2 local SVG survives only as image data, unsafe and missing sources remain omitted', async () => {
  const html = await chapter('<img src="eq.svg" onload="evil()"/><img src="pic.png"/><img src="missing.svg"/><img src="https://invalid.test/a.svg"/><svg onload="evil()"><script>evil()</script></svg>');
  expect(html).toContain('src="data:image/svg+xml;base64,');
  expect(html).toContain('src="data:image/png;base64,');
  expect(html.match(/<img /g)).toHaveLength(2);
  expect(html).not.toMatch(/onload|evil|<svg|https:/);
});
test('B78 TC3 math semantics survive without arbitrary publisher styles or classes', async () => {
  const html = await chapter('<div class="eq-num evil"><span class="eq-inline evil" style="position:fixed" onclick="evil()"><span class="it">a</span><span class="sup it">2</span><span class="sub">0</span><span class="root-kernel">x</span></span><div class="eq-tag">(1)</div></div>');
  for (const cls of ['eq-num', 'eq-inline', 'sup', 'sub', 'root-kernel', 'eq-tag']) expect(html).toContain(`epub-math-${cls}`);
  expect(html).not.toMatch(/evil|position:fixed|onclick/);
  expect(html).toContain('>2</span>');
});
test('B78 TC4 only bounded image widths from local CSS are retained', async () => {
  const html = await chapter('<img class="formula" src="eq.svg"/><img class="bad" src="eq.svg"/><img class="huge" src="eq.svg"/>');
  expect(html).toContain('style="width:12.4em"');
  expect(html.match(/style=/g)).toHaveLength(1);
  expect(html).not.toMatch(/expression|background|999999|invalid/);
});

test('B78 TC4 safe inline image size is retained, other inline CSS is not', async () => {
  const html = await chapter('<img src="eq.svg" style="width:8em;position:fixed;top:0"/><img src="eq.svg" style="width:0px"/><img src="eq.svg" style="width:100%;background:url(https://invalid.test)"/>');
  expect(html).toContain('style="width:8em"');
  expect(html).toContain('style="width:100%"');
  expect(html.match(/style=/g)).toHaveLength(2);
  expect(html).not.toMatch(/position|background|top:/);
});

test('B78 TC5 reopened saved book renders original assets without changing saved reading state', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'b78-library-'));
  try {
    const library = new InMemoryEpubLibrary({ storageDirectory });
    const imported = await library.importFromBuffer(await fixture('<p>Value <span>0</span></p><img src="eq.svg"/>'));
    if (imported.status === 'cancelled') throw new Error('Unexpected cancel');
    const book = imported.book;
    await library.saveReadingState({ bookId: book.id, chapterId: book.chapters[0].id, view: 'reader', scrollProgress: .4 });
    const before = await readFile(join(storageDirectory, 'library.json'), 'utf8');
    const reopened = new InMemoryEpubLibrary({ storageDirectory });
    const content = await reopened.getChapterContent(book.id, book.chapters[0].id);
    expect(content.contentHtml).toContain('<span>0</span>');
    expect(content.contentHtml).toContain('data:image/svg+xml;base64,');
    expect(await readFile(join(storageDirectory, 'library.json'), 'utf8')).toBe(before);
  } finally {
    await rm(storageDirectory, { recursive: true, force: true });
  }
});
