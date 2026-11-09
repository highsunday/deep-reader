import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join, posix } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parse as parseHtml, type DefaultTreeAdapterTypes } from "parse5";
import JSZip from "jszip";
import { epubMathClasses, epubImageWidths, imageWidthFor } from "./epub-presentation";
import type {
  Annotation,
  BookChapter,
  BookReadingState,
  ChapterContent,
  ImportBookResult,
  LibraryBook,
  ReadingRange,
  SaveAnnotationsInput,
  SaveReadingRangeInput,
  SaveReadingStateInput,
  SetShelfStatusInput,
  SetBookPinnedInput
} from "../shared/contracts";
import { ANNOTATION_COLORS, DEFAULT_ANNOTATION_COLOR } from "../shared/contracts";

type XmlRecord = Record<string, unknown>;
type OrderedXmlNode = Record<string, unknown>;

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

interface StoredBook {
  book: LibraryBook;
  bytes: Buffer;
}

interface PersistedLibrary {
  version: 1;
  books: LibraryBook[];
}

const epubParseVersion = 4;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
  trimValues: true
});

const orderedXml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  preserveOrder: true,
  parseTagValue: false,
  textNodeName: "#text",
  trimValues: false
});

function record(value: unknown): XmlRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as XmlRecord
    : {};
}

function array<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attribute(value: XmlRecord, name: string): string {
  const candidate = value[`@_${name}`];
  return typeof candidate === "string" || typeof candidate === "number"
    ? String(candidate)
    : "";
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" ");
  const valueRecord = record(value);
  if ("#text" in valueRecord) return text(valueRecord["#text"]);
  return Object.entries(valueRecord)
    .filter(([key]) => !key.startsWith("@_"))
    .map(([, child]) => text(child))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function archivePath(base: string, href: string): string {
  const raw = href.split("#", 1)[0] ?? "";
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep malformed percent encoding literal; normalization still guards traversal.
  }
  const resolved = posix.normalize(posix.join(base, decoded));
  if (!resolved || posix.isAbsolute(resolved) || resolved.startsWith("../")) {
    throw new Error("The EPUB contains an unsafe archive path.");
  }
  return resolved;
}

async function requiredText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`The EPUB is missing ${path}.`);
  return file.async("text");
}

function chapterId(href: string): string {
  return createHash("sha256").update(href).digest("hex").slice(0, 16);
}

function fragmentFromHref(href: string): string | null {
  const marker = href.indexOf("#");
  if (marker < 0 || marker === href.length - 1) return null;
  const fragment = href.slice(marker + 1);
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

interface NavigationLink {
  title: string;
  href: string;
  depth: number;
  fragment: string | null;
}

function navigationLinks(value: unknown): NavigationLink[] {
  const links: NavigationLink[] = [];
  const visit = (list: unknown, depth: number) => {
    const listRecord = record(list);
    for (const item of array(listRecord.li)) {
      const itemRecord = record(item);
      const anchor = record(array(itemRecord.a)[0]);
      const href = attribute(anchor, "href");
      const title = text(anchor);
      if (href && title) {
        links.push({ title, href, depth, fragment: fragmentFromHref(href) });
      }
      for (const child of array(itemRecord.ol)) visit(child, depth + 1);
    }
  };
  const html = record(record(value).html);
  const body = record(html.body);
  const navigation = array(body.nav).map(record).find((candidate) =>
    attribute(candidate, "type").split(/\s+/).includes("toc")
  ) ?? record(array(body.nav)[0]);
  for (const list of array(navigation.ol)) visit(list, 0);
  return links;
}

function ncxLinks(value: unknown, depth = 0): NavigationLink[] {
  const links: NavigationLink[] = [];
  const valueRecord = record(value);
  for (const point of array(valueRecord.navPoint)) {
    const pointRecord = record(point);
    const href = attribute(record(pointRecord.content), "src");
    const title = text(record(pointRecord.navLabel).text);
    if (href && title) {
      links.push({ title, href, depth, fragment: fragmentFromHref(href) });
    }
    links.push(...ncxLinks(pointRecord, depth + 1));
  }
  return links;
}

const readableTags = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "div", "span", "em",
  "strong", "b", "i", "u", "blockquote", "pre", "code", "ul", "ol",
  "li", "dl", "dt", "dd", "table", "thead", "tbody", "tr", "th", "td",
  "hr", "br", "figure", "figcaption", "sup", "sub", "section", "article"
]);

const discardedTags = new Set([
  "script", "style", "iframe", "object", "embed", "form", "input", "button",
  "select", "textarea", "meta", "link", "base", "svg", "canvas", "audio", "video"
]);

function escapeText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replaceAll('"', "&quot;");
}

function imageMime(path: string): string | undefined {
  return ({
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif"
  } as Record<string, string>)[posix.extname(path).toLowerCase()];
}

function tolerantChapterNodes(source: string): OrderedXmlNode[] {
  const convert = (nodes: DefaultTreeAdapterTypes.ChildNode[]): OrderedXmlNode[] =>
    nodes.flatMap<OrderedXmlNode>((node) => {
      if ("value" in node) return [{ "#text": node.value }];
      if (!("tagName" in node)) return [];
      return [{
        [node.tagName]: convert(node.childNodes),
        ":@": Object.fromEntries(node.attrs.map(({ name, value }) => [`@_${name}`, value]))
      }];
    });
  return convert(parseHtml(source).childNodes);
}

async function sanitizeChapter(
  zip: JSZip,
  chapterPath: string,
  source: string,
  navigationHeadings: ReadonlyMap<string, number> = new Map()
): Promise<string> {
  // Malformed XHTML can either crash the XML parser or silently swallow text.
  // Repair its tree with an inert HTML parser, then use the same allowlist below.
  const parsed = XMLValidator.validate(source) === true
    ? orderedXml.parse(source) as OrderedXmlNode[]
    : tolerantChapterNodes(source);

  const imageWidths: ReturnType<typeof epubImageWidths> = [];
  const readStyles = async (nodes: OrderedXmlNode[]): Promise<void> => {
    for (const node of nodes) {
      const attrs = record(node[":@"]);
      if (Array.isArray(node.link) && String(attrs["@_rel"] ?? "").toLowerCase() === "stylesheet") {
        const href = String(attrs["@_href"] ?? "");
        if (href && !/^(?:[a-z]+:|\/\/|#)/i.test(href)) {
          try {
            const css = zip.file(archivePath(posix.dirname(chapterPath), href));
            if (css) imageWidths.push(...epubImageWidths(await css.async("text")));
          } catch { /* Missing or unsafe publisher styles do not prevent reading. */ }
        }
      }
      for (const [key, children] of Object.entries(node)) {
        if (key !== ":@" && Array.isArray(children)) await readStyles(children as OrderedXmlNode[]);
      }
    }
  };
  await readStyles(parsed);

  const findBody = (nodes: OrderedXmlNode[]): OrderedXmlNode[] | undefined => {
    for (const node of nodes) {
      if (Array.isArray(node.body)) return node.body as OrderedXmlNode[];
      for (const [key, child] of Object.entries(node)) {
        if (key !== ":@" && Array.isArray(child)) {
          const result = findBody(child as OrderedXmlNode[]);
          if (result) return result;
        }
      }
    }
    return undefined;
  };

  const render = async (nodes: OrderedXmlNode[]): Promise<string> => {
    let output = "";
    for (const node of nodes) {
      if (typeof node["#text"] === "string") {
        output += escapeText(node["#text"]);
        continue;
      }
      const entry = Object.entries(node).find(
        ([key, child]) => key !== ":@" && Array.isArray(child)
      );
      if (!entry) continue;
      const [rawName, rawChildren] = entry;
      const name = rawName.toLowerCase();
      if (discardedTags.has(name)) continue;
      const attributes = record(node[":@"]);
      if (name === "img") {
        const sourcePath = String(attributes["@_src"] ?? "");
        if (!sourcePath || /^(?:[a-z]+:|\/\/|#)/i.test(sourcePath)) continue;
        try {
          const assetPath = archivePath(posix.dirname(chapterPath), sourcePath);
          const mime = imageMime(assetPath);
          const asset = mime ? zip.file(assetPath) : null;
          if (!mime || !asset) continue;
          const data = Buffer.from(await asset.async("uint8array")).toString("base64");
          const alt = escapeAttribute(String(attributes["@_alt"] ?? ""));
          // SVG stays in an image document: scripts and external resources are inert.
          const width = imageWidthFor(imageWidths, String(attributes["@_id"] ?? ""),
            String(attributes["@_class"] ?? ""), String(attributes["@_style"] ?? ""));
          output += `<img src="data:${mime};base64,${data}" alt="${alt}"${width ? ` style="width:${width}"` : ""}>`;
        } catch {
          // Missing or unsafe book-local images are omitted.
        }
        continue;
      }
      const children = await render(rawChildren as OrderedXmlNode[]);
      if (!readableTags.has(name)) {
        output += children;
        continue;
      }
      const allowedAttributes: string[] = [];
      if (name === "span" || name === "div") {
        const classes = epubMathClasses(String(attributes["@_class"] ?? ""));
        if (classes) allowedAttributes.push(`class="${classes}"`);
      }
      const id = String(attributes["@_id"] ?? "");
      if (id && !/[\u0000-\u001f\u007f]/.test(id)) {
        allowedAttributes.push(`id="${escapeAttribute(id)}"`);
      }
      // Only EPUB TOC targets confer heading semantics; bold prose remains prose.
      // Keep the original tag/text so rendering, annotations and UTF-16 offsets do not change.
      const headingLevel = navigationHeadings.get(id);
      if (name === "p" && headingLevel && children.replace(/<[^>]*>/g, "").trim()) {
        allowedAttributes.push(`data-reading-heading-level="${headingLevel}"`);
      }
      if (name === "ol" && /^\d+$/.test(String(attributes["@_start"] ?? ""))) {
        allowedAttributes.push(`start="${attributes["@_start"]}"`);
      }
      if (name === "td" || name === "th") {
        for (const attributeName of ["colspan", "rowspan"] as const) {
          const value = String(attributes[`@_${attributeName}`] ?? "");
          if (/^\d+$/.test(value)) {
            allowedAttributes.push(`${attributeName}="${value}"`);
          }
        }
      }
      const opening = `<${name}${allowedAttributes.length ? ` ${allowedAttributes.join(" ")}` : ""}>`;
      output += name === "br" || name === "hr"
        ? opening
        : `${opening}${children}</${name}>`;
    }
    return output;
  };

  return (await render(findBody(parsed) ?? parsed)).trim();
}

async function readPackage(zip: JSZip) {
  const container = record(xml.parse(await requiredText(zip, "META-INF/container.xml"))).container;
  const rootfile = record(array(record(record(container).rootfiles).rootfile)[0]);
  const packagePath = attribute(rootfile, "full-path");
  if (!packagePath) throw new Error("The EPUB container has no package document.");

  const packageDocument = record(
    record(xml.parse(await requiredText(zip, packagePath))).package
  );
  const packageDirectory = posix.dirname(packagePath);
  const manifest = array(record(packageDocument.manifest).item)
    .map(record)
    .map<ManifestItem>((item) => ({
      id: attribute(item, "id"),
      href: attribute(item, "href"),
      mediaType: attribute(item, "media-type"),
      properties: attribute(item, "properties")
    }))
    .filter((item) => item.id && item.href);
  return { packageDocument, packageDirectory, manifest };
}

async function readNavigation(zip: JSZip, packageDocument: XmlRecord, packageDirectory: string, manifest: ManifestItem[]) {
  const spine = record(packageDocument.spine);
  const manifestById = new Map(manifest.map(item => [item.id, item]));
  const navItem = manifest.find((item) =>
    item.properties.split(/\s+/).includes("nav")
  );
  let links: NavigationLink[] = [];
  let linksDirectory = packageDirectory;
  if (navItem) {
    const navPath = archivePath(packageDirectory, navItem.href);
    linksDirectory = posix.dirname(navPath);
    links = navigationLinks(xml.parse(await requiredText(zip, navPath)));
  } else {
    const ncxId = attribute(spine, "toc");
    const ncxItem = manifestById.get(ncxId) ??
      manifest.find((item) => item.mediaType === "application/x-dtbncx+xml");
    if (ncxItem) {
      const ncxPath = archivePath(packageDirectory, ncxItem.href);
      linksDirectory = posix.dirname(ncxPath);
      const ncx = record(xml.parse(await requiredText(zip, ncxPath))).ncx;
      links = ncxLinks(record(ncx).navMap);
    }
  }
  return { links, linksDirectory };
}

// Cover recovery is independent of chapter parsing so existing reading offsets stay intact.
async function readCover(
  zip: JSZip, packageDocument: XmlRecord, packageDirectory: string, manifest: ManifestItem[]
): Promise<string | undefined> {
  const metadata = record(packageDocument.metadata);
  const legacyCoverId = attribute(
    array(metadata.meta).map(record).find(item => attribute(item, "name") === "cover") ?? {}, "content"
  );
  const candidates: { href: string; page?: boolean }[] = [
    ...manifest.filter(item => item.properties.split(/\s+/).includes("cover-image")),
    ...manifest.filter(item => item.id === legacyCoverId)
  ];
  for (const reference of array(record(packageDocument.guide).reference).map(record)) {
    if (attribute(reference, "type").split(/\s+/).includes("cover")) {
      candidates.push({ href: attribute(reference, "href"), page: true });
    }
  }
  candidates.push(...manifest.filter(item => {
    const name = posix.basename(item.href).replace(/\.[^.]+$/, "");
    return imageMime(item.href) && /^(?:cover|front[-_]?cover|cover[-_]?front)$/i.test(name);
  }));
  const declaredImageTypes = new Map<string, string>();
  for (const item of manifest) {
    if (!item.mediaType.startsWith("image/")) continue;
    try { declaredImageTypes.set(archivePath(packageDirectory, item.href), item.mediaType); }
    catch { /* Ignore unsafe manifest paths. */ }
  }
  const imageAt = async (path: string): Promise<string | undefined> => {
    const mime = declaredImageTypes.get(path) ?? imageMime(path);
    const file = zip.file(path);
    if (!mime || !file) return undefined;
    const bytes = await file.async("uint8array");
    return bytes.length ? `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` : undefined;
  };
  for (const candidate of candidates) {
    try {
      const path = archivePath(packageDirectory, candidate.href);
      const direct = await imageAt(path);
      if (direct) return direct;
      if (!candidate.page || !/\.(?:xhtml|html|htm|svg)$/i.test(path)) continue;
      const page = zip.file(path);
      if (!page) continue;
      const sources: string[] = [];
      const visit = (nodes: DefaultTreeAdapterTypes.ChildNode[]) => {
        for (const node of nodes) {
          if (!("tagName" in node)) continue;
          if (node.tagName === "img" || node.tagName === "image") {
            const source = node.attrs.find(attr => attr.name === (node.tagName === "img" ? "src" : "href"))?.value;
            if (source) sources.push(source);
          }
          visit(node.childNodes);
        }
      };
      visit(parseHtml(await page.async("text")).childNodes);
      for (const source of sources) {
        try {
          const image = await imageAt(archivePath(posix.dirname(path), source));
          if (image) return image;
        } catch { /* Ignore unsafe references and try the next local image. */ }
      }
    } catch { /* Missing/unsafe cover assets must not prevent reading the book. */ }
  }
  return undefined;
}

async function parseBook(bytes: Buffer): Promise<LibraryBook> {
  const zip = await JSZip.loadAsync(bytes);
  if ((await requiredText(zip, "mimetype")).trim() !== "application/epub+zip") {
    throw new Error("The selected file is not a standard EPUB.");
  }
  const { packageDocument, packageDirectory, manifest } = await readPackage(zip);
  const metadata = record(packageDocument.metadata);
  const title = text(array(metadata.title)[0]);
  if (!title) throw new Error("The EPUB has no title.");
  const author = text(array(metadata.creator)[0]) || "Unknown author";
  const manifestById = new Map(manifest.map((item) => [item.id, item]));
  const coverDataUrl = await readCover(zip, packageDocument, packageDirectory, manifest);
  const spine = record(packageDocument.spine);
  const spineItems = array(spine.itemref)
    .map(record)
    .map((item) => manifestById.get(attribute(item, "idref")))
    .filter((item): item is ManifestItem => Boolean(item));
  const spineHrefs = spineItems.map((item) => archivePath(packageDirectory, item.href));

  let { links, linksDirectory } = await readNavigation(zip, packageDocument, packageDirectory, manifest);
  if (!links.length) {
    links = spineItems.map((item) => ({
      title: basename(item.href, posix.extname(item.href)).replace(/[-_]+/g, " "),
      href: item.href,
      depth: 0,
      fragment: null
    }));
  }
  const resolvedLinks = links.map((link) => ({
    ...link,
    href: archivePath(linksDirectory, link.href),
    fragment: fragmentFromHref(link.href)
  }));
  const spineIndexByHref = new Map(spineHrefs.map((href, index) => [href, index] as const));
  const rangedHrefs = new Set<string>();
  const seen = new Set<string>();
  const chapters = resolvedLinks.flatMap<BookChapter>((link, order) => {
    const href = link.href;
    const navigationKey = link.depth === 0
      ? href
      : `${href}#${link.fragment ?? `toc-${order}`}`;
    if (seen.has(navigationKey)) return [];
    seen.add(navigationKey);
    const start = spineIndexByHref.get(href);
    let contentHrefs = [href];
    if (start !== undefined && (!rangedHrefs.has(href) || link.depth <= 1)) {
      rangedHrefs.add(href);
      let end = spineHrefs.length;
      for (const nextLink of resolvedLinks.slice(order + 1)) {
        if (link.depth <= 1 && nextLink.depth > 1) continue;
        const next = spineIndexByHref.get(nextLink.href);
        if (next !== undefined && next > start) {
          end = next;
          break;
        }
      }
      contentHrefs = spineHrefs.slice(start, end);
    }
    return [{
      id: chapterId(navigationKey),
      title: link.title,
      href,
      order,
      contentHrefs,
      depth: link.depth,
      fragment: link.fragment
    }];
  });
  if (!chapters.length) throw new Error("The EPUB has no readable chapters.");
  return {
    id: createHash("sha256").update(bytes).digest("hex"),
    epubParseVersion,
    title,
    author,
    pinned: false,
    ...(coverDataUrl ? { coverDataUrl } : {}),
    chapters,
    readingState: { view: "overview", chapterId: null, scrollProgress: 0 },
    chapterRanges: {},
    chapterAnnotations: {}
  };
}

function validAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== "object") return false;
  const annotation = value as Partial<Annotation>;
  return typeof annotation.id === "string" && Boolean(annotation.id.trim()) &&
    Number.isInteger(annotation.start) && Number.isInteger(annotation.end) &&
    (annotation.start ?? -1) >= 0 && (annotation.end ?? 0) > (annotation.start ?? -1) &&
    typeof annotation.text === "string" && Boolean(annotation.text.trim()) &&
    (annotation.color === undefined || ANNOTATION_COLORS.some((color) => color === annotation.color));
}

function normalizedChapterAnnotations(book: LibraryBook): Record<string, Annotation[]> {
  const chapterIds = new Set(book.chapters.map(({ id }) => id));
  const source = book.chapterAnnotations && typeof book.chapterAnnotations === "object"
    ? book.chapterAnnotations
    : {};
  return Object.fromEntries(Object.entries(source).flatMap(([chapterId, values]) => {
    if (!chapterIds.has(chapterId) || !Array.isArray(values)) return [];
    const ids = new Set<string>();
    const annotations = values
      .filter(validAnnotation)
      .map((annotation) => ({
        ...annotation,
        color: annotation.color ?? DEFAULT_ANNOTATION_COLOR
      }))
      .sort((left, right) => left.start - right.start || left.end - right.end)
      .reduce<Annotation[]>((accepted, annotation) => {
        if (ids.has(annotation.id)) return accepted;
        ids.add(annotation.id);
        const previous = accepted.at(-1);
        if (!previous || annotation.start >= previous.end) accepted.push(annotation);
        return accepted;
      }, []);
    return annotations.length ? [[chapterId, annotations]] : [];
  }));
}

function chaptersByHref(chapters: BookChapter[]): Map<string, BookChapter[]> {
  const grouped = new Map<string, BookChapter[]>();
  for (const chapter of chapters) {
    const matches = grouped.get(chapter.href) ?? [];
    matches.push(chapter);
    grouped.set(chapter.href, matches);
  }
  return grouped;
}

function knownChapterId(
  chapters: BookChapter[],
  chapterId: string | null | undefined
): string | null {
  return chapterId && chapters.some(({ id }) => id === chapterId)
    ? chapterId
    : null;
}

function normalizedReadingState(book: LibraryBook): BookReadingState {
  const saved = (book as Partial<LibraryBook>).readingState;
  const savedChapterId = knownChapterId(book.chapters, saved?.chapterId);
  const lastChapterId = knownChapterId(book.chapters, book.lastChapterId);
  const candidateProgress = Number(saved?.scrollProgress);
  return {
    view: saved?.view === "reader" && savedChapterId ? "reader" : "overview",
    chapterId: savedChapterId ?? lastChapterId,
    scrollProgress: Number.isFinite(candidateProgress)
      ? Math.min(1, Math.max(0, candidateProgress))
      : 0
  };
}

function migratedBookState(previous: LibraryBook, reparsed: LibraryBook): LibraryBook {
  const previousById = new Map(previous.chapters.map((chapter) => [chapter.id, chapter]));
  const previousByHref = chaptersByHref(previous.chapters);
  const reparsedByHref = chaptersByHref(reparsed.chapters);
  const previousFor = (chapter: BookChapter): BookChapter | undefined => {
    const exact = previousById.get(chapter.id);
    if (exact) return exact;
    const oldMatches = previousByHref.get(chapter.href) ?? [];
    const newMatches = reparsedByHref.get(chapter.href) ?? [];
    return oldMatches.length === 1 && newMatches.length === 1 ? oldMatches[0] : undefined;
  };
  const chapterRanges: Record<string, ReadingRange> = {};
  const chapterAnnotations: Record<string, Annotation[]> = {};
  for (const chapter of reparsed.chapters) {
    const oldChapter = previousFor(chapter);
    if (!oldChapter) continue;
    const range = previous.chapterRanges[oldChapter.id];
    if (range) chapterRanges[chapter.id] = { ...range };
    const annotations = previous.chapterAnnotations?.[oldChapter.id];
    if (annotations?.length) {
      chapterAnnotations[chapter.id] = annotations.map((annotation) => ({ ...annotation }));
    }
  }
  const previousLastChapter = previous.lastChapterId
    ? previousById.get(previous.lastChapterId)
    : undefined;
  const migratedLastChapter = previousLastChapter
    ? reparsed.chapters.find((chapter) => previousFor(chapter)?.id === previousLastChapter.id)
    : undefined;
  const previousReadingState = normalizedReadingState(previous);
  const previousReadingChapter = previousReadingState.chapterId
    ? previousById.get(previousReadingState.chapterId)
    : undefined;
  const migratedReadingChapter = previousReadingChapter
    ? reparsed.chapters.find((chapter) => previousFor(chapter)?.id === previousReadingChapter.id)
    : undefined;
  const migrated: LibraryBook = {
    ...reparsed,
    shelfStatus: previous.shelfStatus,
    pinned: previous.pinned === true,
    readingState: {
      view: previousReadingState.view === "reader" && migratedReadingChapter
        ? "reader"
        : "overview",
      chapterId: migratedReadingChapter?.id ?? migratedLastChapter?.id ?? null,
      scrollProgress: previousReadingState.scrollProgress
    },
    chapterRanges,
    chapterAnnotations
  };
  if (migratedLastChapter) migrated.lastChapterId = migratedLastChapter.id;
  return migrated;
}

export class InMemoryEpubLibrary {
  readonly #books = new Map<string, StoredBook>();
  readonly #storageDirectory?: string;
  readonly #ready: Promise<void>;
  #persistChain = Promise.resolve();

  constructor(options: { storageDirectory?: string } = {}) {
    this.#storageDirectory = options.storageDirectory;
    this.#ready = this.#load();
  }

  async #load(): Promise<void> {
    if (!this.#storageDirectory) return;
    await mkdir(this.#storageDirectory, { recursive: true });
    let persisted: PersistedLibrary;
    try {
      persisted = JSON.parse(
        await readFile(join(this.#storageDirectory, "library.json"), "utf8")
      ) as PersistedLibrary;
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code === "ENOENT") return;
      throw reason;
    }
    if (persisted.version !== 1 || !Array.isArray(persisted.books)) {
      throw new Error("The saved book library has an unsupported format.");
    }
    let migrated = false;
    for (const savedBook of persisted.books) {
      let book = savedBook;
      const original = JSON.stringify(book);
      if (!book || typeof book.id !== "string" || !Array.isArray(book.chapters) ||
        !book.chapterRanges || typeof book.chapterRanges !== "object") {
        throw new Error("The saved book library is invalid.");
      }
      book.pinned = book.pinned === true;
      book.chapterAnnotations = normalizedChapterAnnotations(book);
      const bytes = await readFile(join(this.#storageDirectory, `${book.id}.epub`));
      if (book.epubParseVersion !== epubParseVersion) {
        book = migratedBookState(book, await parseBook(bytes));
        book.chapterAnnotations = normalizedChapterAnnotations(book);
        migrated = true;
      }
      if (!book.coverDataUrl) {
        // Backfill assets only; do not reparse chapters or migrate reading state.
        const zip = await JSZip.loadAsync(bytes);
        const { packageDocument, packageDirectory, manifest } = await readPackage(zip);
        const cover = await readCover(zip, packageDocument, packageDirectory, manifest);
        if (cover) book.coverDataUrl = cover;
      }
      const readingState = normalizedReadingState(book);
      const lastChapterId = knownChapterId(book.chapters, book.lastChapterId) ??
        readingState.chapterId ?? undefined;
      if (lastChapterId) book.lastChapterId = lastChapterId;
      else delete book.lastChapterId;
      book.readingState = normalizedReadingState(book);
      if (JSON.stringify(book) !== original) migrated = true;
      this.#books.set(book.id, { book, bytes });
    }
    if (migrated) await this.#persist();
  }

  async #persist(): Promise<void> {
    if (!this.#storageDirectory) return;
    const persist = async () => {
      const manifest: PersistedLibrary = {
        version: 1,
        books: [...this.#books.values()].map(({ book }) => structuredClone(book))
      };
      const manifestPath = join(this.#storageDirectory!, "library.json");
      const temporaryPath = `${manifestPath}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(manifest), "utf8");
      await rename(temporaryPath, manifestPath);
    };
    this.#persistChain = this.#persistChain.then(persist, persist);
    await this.#persistChain;
  }

  async listBooks(): Promise<LibraryBook[]> {
    await this.#ready;
    return [...this.#books.values()].map(({ book }) => structuredClone(book));
  }

  async importFromPath(path: string): Promise<ImportBookResult> {
    return this.importFromBuffer(await readFile(path));
  }

  async importFromBuffer(bytes: Buffer): Promise<ImportBookResult> {
    await this.#ready;
    const book = await parseBook(bytes);
    const existing = this.#books.get(book.id);
    if (existing) return { status: "existing", book: structuredClone(existing.book) };
    this.#books.set(book.id, { book, bytes: Buffer.from(bytes) });
    if (this.#storageDirectory) {
      await writeFile(join(this.#storageDirectory, `${book.id}.epub`), bytes);
      await this.#persist();
    }
    return { status: "imported", book: structuredClone(book) };
  }

  async getChapterContent(bookId: string, chapterIdValue: string): Promise<ChapterContent> {
    await this.#ready;
    const stored = this.#books.get(bookId);
    if (!stored) throw new Error("Book not found.");
    const chapter = stored.book.chapters.find(({ id }) => id === chapterIdValue);
    if (!chapter) throw new Error("Chapter not found.");
    const zip = await JSZip.loadAsync(stored.bytes);
    const { packageDocument, packageDirectory, manifest } = await readPackage(zip);
    const { links, linksDirectory } = await readNavigation(zip, packageDocument, packageDirectory, manifest);
    const headingsByHref = new Map<string, Map<string, number>>();
    for (const link of links) {
      if (!link.fragment) continue;
      const href = archivePath(linksDirectory, link.href);
      const headings = headingsByHref.get(href) ?? new Map<string, number>();
      // Repeated TOC links to the same anchor retain the broadest documented level.
      const level = Math.min(6, link.depth + 1);
      headings.set(link.fragment, Math.min(headings.get(link.fragment) ?? level, level));
      headingsByHref.set(href, headings);
    }
    const contentHrefs = chapter.contentHrefs?.length ? chapter.contentHrefs : [chapter.href];
    const contentHtml: string[] = [];
    for (const href of contentHrefs) {
      const file = zip.file(href);
      if (!file) throw new Error("Chapter content is missing.");
      contentHtml.push(await sanitizeChapter(zip, href, await file.async("text"), headingsByHref.get(href)));
    }
    return {
      bookId,
      chapterId: chapter.id,
      title: chapter.title,
      contentHtml: contentHtml.join("\n")
    };
  }

  async saveLastChapter(bookId: string, chapterIdValue: string): Promise<LibraryBook> {
    return this.saveReadingState({
      bookId,
      view: "reader",
      chapterId: chapterIdValue,
      scrollProgress: 0
    });
  }

  async setShelfStatus(input: SetShelfStatusInput): Promise<LibraryBook> {
    await this.#ready;
    if (!["unread", "reading", "finished"].includes(input.status)) throw new Error("Invalid shelf status.");
    const stored = this.#books.get(input.bookId);
    if (!stored) throw new Error("Book not found.");
    const previous = stored.book.shelfStatus;
    stored.book.shelfStatus = input.status;
    try {
      await this.#persist();
    } catch (error) {
      if (stored.book.shelfStatus === input.status) stored.book.shelfStatus = previous;
      throw error;
    }
    return structuredClone(stored.book);
  }

  async setPinned(input: SetBookPinnedInput): Promise<LibraryBook> {
    await this.#ready;
    const stored = this.#books.get(input.bookId);
    if (!stored) throw new Error("Book not found.");
    stored.book.pinned = input.pinned;
    await this.#persist();
    return structuredClone(stored.book);
  }

  async saveReadingState(input: SaveReadingStateInput): Promise<LibraryBook> {
    await this.#ready;
    const stored = this.#books.get(input.bookId);
    if (!stored) throw new Error("Book not found.");
    if (input.view !== "overview" && input.view !== "reader") {
      throw new Error("Invalid reading state.");
    }
    const chapter = input.chapterId
      ? stored.book.chapters.find(({ id }) => id === input.chapterId)
      : undefined;
    if (input.chapterId && !chapter) throw new Error("Chapter not found.");
    const scrollProgress = Number.isFinite(input.scrollProgress)
      ? Math.min(1, Math.max(0, input.scrollProgress))
      : 0;
    const chapterId = chapter?.id ?? stored.book.readingState.chapterId;
    stored.book.readingState = { view: input.view, chapterId, scrollProgress };
    if (chapter) {
      stored.book.lastChapterId = chapter.id;
      if (input.view === "reader" && stored.book.shelfStatus === "unread") stored.book.shelfStatus = "reading";
    }
    await this.#persist();
    return structuredClone(stored.book);
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.#ready;
    const stored = this.#books.get(bookId);
    if (!stored) throw new Error("Book not found.");
    this.#books.delete(bookId);
    try {
      await this.#persist();
      if (this.#storageDirectory) {
        await unlink(join(this.#storageDirectory, `${bookId}.epub`));
      }
    } catch (reason) {
      this.#books.set(bookId, stored);
      await this.#persist().catch(() => undefined);
      throw reason;
    }
  }

  async saveReadingRange(input: SaveReadingRangeInput): Promise<LibraryBook> {
    await this.#ready;
    const stored = this.#books.get(input.bookId);
    if (!stored) throw new Error("Book not found.");
    if (!stored.book.chapters.some(({ id }) => id === input.chapterId)) {
      throw new Error("Chapter not found.");
    }
    const range: ReadingRange = input.range;
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) ||
      range.start < 0 || range.end < range.start) {
      throw new Error("Invalid reading range.");
    }
    stored.book.chapterRanges[input.chapterId] = { ...range };
    await this.#persist();
    return structuredClone(stored.book);
  }

  async saveAnnotations(input: SaveAnnotationsInput): Promise<LibraryBook> {
    await this.#ready;
    const stored = this.#books.get(input.bookId);
    if (!stored) throw new Error("Book not found.");
    if (!stored.book.chapters.some(({ id }) => id === input.chapterId)) {
      throw new Error("Chapter not found.");
    }
    if (!Array.isArray(input.annotations) || input.annotations.some(
      (annotation) => !validAnnotation(annotation)
    )) {
      throw new Error("Invalid annotation.");
    }
    const annotations = input.annotations.map((annotation) => ({
      ...annotation,
      color: annotation.color ?? DEFAULT_ANNOTATION_COLOR
    })).sort(
      (left, right) => left.start - right.start || left.end - right.end
    );
    if (new Set(annotations.map(({ id }) => id)).size !== annotations.length ||
      annotations.some((annotation, index) =>
        index > 0 && annotation.start < annotations[index - 1]!.end
      )) {
      throw new Error("Overlapping or duplicate annotations.");
    }
    if (annotations.length) stored.book.chapterAnnotations[input.chapterId] = annotations;
    else delete stored.book.chapterAnnotations[input.chapterId];
    await this.#persist();
    return structuredClone(stored.book);
  }
}
