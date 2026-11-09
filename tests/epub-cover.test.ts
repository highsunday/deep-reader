import { test, expect } from 'vitest';
import JSZip from 'jszip';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryEpubLibrary } from '../src/main/epub-library';

const front = Buffer.from('front-cover');
const dataUrl = `data:image/jpeg;base64,${front.toString('base64')}`;
async function epub(options: { marked?: boolean; guide?: string; page?: string; missing?: boolean; noCover?: boolean } = {}) {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', `<package><metadata><title>Cover test</title><creator>Author</creator></metadata><manifest>
    <item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>
    <item id="back" href="Images/Coverback.jpg" media-type="image/jpeg"/>
    ${options.noCover ? '' : '<item id="front" href="Images/Cover.jpg" media-type="image/jpeg"/>'}
    ${options.marked ? '<item id="official" href="Images/official.jpg" properties="cover-image" media-type="image/jpeg"/>' : ''}
    </manifest><spine><itemref idref="text"/></spine>
    ${options.guide ? `<guide><reference type="cover" href="${options.guide}"/></guide>` : ''}</package>`);
  zip.file('OEBPS/text.xhtml', '<html><body><h1>Chapter</h1><p>Readable content for saved progress.</p></body></html>');
  zip.file('OEBPS/Images/Coverback.jpg', 'back-cover');
  if (!options.noCover) zip.file('OEBPS/Images/Cover.jpg', front);
  if (options.marked && !options.missing) zip.file('OEBPS/Images/official.jpg', 'official-cover');
  if (options.page) zip.file('OEBPS/Text/cover.xhtml', options.page);
  return zip.generateAsync({ type: 'nodebuffer' });
}
async function imported(bytes: Buffer) {
  const result = await new InMemoryEpubLibrary().importFromBuffer(bytes);
  if (result.status !== 'imported') throw new Error('expected import');
  return result.book;
}
test('B77 TC1: unmarked Cover.jpg is selected, not Coverback.jpg', async () => {
  expect((await imported(await epub())).coverDataUrl).toBe(dataUrl);
});
test('B77 TC2: official cover takes priority over named cover', async () => {
  expect((await imported(await epub({ marked: true }))).coverDataUrl)
    .toBe(`data:image/jpeg;base64,${Buffer.from('official-cover').toString('base64')}`);
});
test('B77 TC2: declared image MIME and EPUB2 cover metadata remain supported', async () => {
  const zip = await JSZip.loadAsync(await epub());
  zip.file('OEBPS/content.opf', (await zip.file('OEBPS/content.opf')!.async('text'))
    .replace('</metadata>', '<meta name="cover" content="vector"/></metadata>')
    .replace('</manifest>', '<item id="vector" href="Images/art" media-type="image/svg+xml"/></manifest>'));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>';
  zip.file('OEBPS/Images/art', svg);
  expect((await imported(await zip.generateAsync({ type: 'nodebuffer' }))).coverDataUrl)
    .toBe(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
});
test.each(['<img src="../Images/Cover.jpg">', '<svg><image xlink:href="../Images/Cover.jpg"/></svg>'])(
  'B77 TC3: guide cover page resolves %s', async page => {
    // Use a name that cannot be found by the filename fallback.
    const zip = await JSZip.loadAsync(await epub({ guide: 'Text/cover.xhtml', page }));
    zip.file('OEBPS/content.opf', (await zip.file('OEBPS/content.opf')!.async('text')).replace('Images/Cover.jpg', 'Images/frontispiece.jpg'));
    zip.file('OEBPS/Text/cover.xhtml', page.replace('Cover.jpg', 'frontispiece.jpg'));
    zip.remove('OEBPS/Images/Cover.jpg');
    zip.file('OEBPS/Images/frontispiece.jpg', front);
    expect((await imported(await zip.generateAsync({ type: 'nodebuffer' }))).coverDataUrl).toBe(dataUrl);
  });
test('B77 TC4: broken marked cover falls back; unsafe guide and absent front cover remain readable', async () => {
  expect((await imported(await epub({ marked: true, missing: true }))).coverDataUrl).toBe(dataUrl);
  const book = await imported(await epub({ noCover: true, guide: '../../outside.jpg' }));
  expect(book.coverDataUrl).toBeUndefined();
  expect(book.chapters.length).toBeGreaterThan(0);
});
test('B77 TC5/6: backfill missing persisted cover only, preserve all other book data and existing covers', async () => {
  const storageDirectory = await mkdtemp(join(tmpdir(), 'b77-cover-'));
  try {
    const library = new InMemoryEpubLibrary({ storageDirectory });
    await library.importFromBuffer(await epub());
    const path = join(storageDirectory, 'library.json');
    const saved = JSON.parse(await readFile(path, 'utf8'));
    const original = saved.books[0];
    delete original.coverDataUrl;
    original.pinned = true;
    original.shelfStatus = 'finished';
    original.readingState = { view: 'reader', chapterId: original.chapters[0].id, scrollProgress: 0.43 };
    original.lastChapterId = original.chapters[0].id;
    original.chapterRanges = { [original.chapters[0].id]: { start: 2, end: 10 } };
    original.chapterAnnotations = { [original.chapters[0].id]: [{ id: 'a', start: 2, end: 6, text: 'Read', color: 'yellow' }] };
    await writeFile(path, JSON.stringify(saved));
    const [recovered] = await new InMemoryEpubLibrary({ storageDirectory }).listBooks();
    expect(recovered.coverDataUrl).toBe(dataUrl);
    const { coverDataUrl, ...rest } = recovered;
    expect(rest).toEqual(original);
    expect(JSON.parse(await readFile(path, 'utf8')).books[0]).toEqual(recovered);
    expect(await new InMemoryEpubLibrary({ storageDirectory }).listBooks()).toEqual([recovered]);
    recovered.coverDataUrl = 'data:image/jpeg;base64,existing';
    await writeFile(path, JSON.stringify({ ...saved, books: [recovered] }));
    expect((await new InMemoryEpubLibrary({ storageDirectory }).listBooks())[0].coverDataUrl).toBe(recovered.coverDataUrl);
  } finally { await rm(storageDirectory, { recursive: true, force: true }); }
});
