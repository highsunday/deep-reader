import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { emptyScratchpadContent, parseScratchpadKey, parseScratchpadSave, type ChapterScratchpad, type ChapterScratchpadKey, type SaveChapterScratchpad } from "../shared/chapter-scratchpad";
import { parseReadingNoteDocument, readingNoteDocumentAttachmentIds } from "../shared/reading-note-document";
import type { LocalReadingNoteAttachmentStore } from "./reading-note-attachment-store";

export class LocalChapterScratchpadStore {
  constructor(private readonly directory: string, private readonly attachments?: LocalReadingNoteAttachmentStore) {}

  private id(key: ChapterScratchpadKey) {
    return `scratchpad-${createHash("sha256").update(JSON.stringify([key.bookId, key.chapterId])).digest("hex")}`;
  }
  get(input: ChapterScratchpadKey): ChapterScratchpad {
    const key = parseScratchpadKey(input);
    let value;
    try { value = JSON.parse(readFileSync(join(this.directory, `${this.id(key)}.json`), "utf8")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...key, content: emptyScratchpadContent(), revision: 0, updatedAt: 0 };
      throw new Error("Unable to load chapter scratchpad.", { cause: error });
    }
    if (value.version !== 1 || value.bookId !== key.bookId || value.chapterId !== key.chapterId ||
      !Number.isSafeInteger(value.revision) || value.revision < 1 || !Number.isFinite(value.updatedAt)) {
      throw new Error("Invalid saved chapter scratchpad.");
    }
    return { ...key, content: parseReadingNoteDocument(value.content), revision: value.revision, updatedAt: value.updatedAt };
  }
  save(value: SaveChapterScratchpad): ChapterScratchpad {
    const input = parseScratchpadSave(value);
    const previous = this.get(input);
    if (input.baseRevision !== previous.revision) throw new Error("This scratchpad changed elsewhere. Your draft is retained; retry to save your version.");
    const id = this.id(input);
    const content = this.attachments?.prepareDocument(id, input.content) ?? input.content;
    const next: ChapterScratchpad = { bookId: input.bookId, chapterId: input.chapterId, content, revision: previous.revision + 1, updatedAt: Date.now() };
    mkdirSync(this.directory, { recursive: true });
    const path = join(this.directory, `${id}.json`);
    writeFileSync(`${path}.next`, JSON.stringify({ version: 1, ...next }), { encoding: "utf8", mode: 0o600 });
    renameSync(`${path}.next`, path);
    this.attachments?.reconcile(id, readingNoteDocumentAttachmentIds(content));
    return next;
  }
  /** False postpones GC when unreadable data makes attachment ownership uncertain. */
  reconcileAttachments(): boolean {
    let files: string[];
    try { files = readdirSync(this.directory); }
    catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
    let complete = true;
    for (const file of files.filter(name => /^scratchpad-[a-f0-9]{64}\.json$/.test(name))) {
      try {
        const key = parseScratchpadKey(JSON.parse(readFileSync(join(this.directory, file), "utf8")));
        const note = this.get(key);
        this.attachments?.reconcile(this.id(key), readingNoteDocumentAttachmentIds(note.content));
      } catch { complete = false; /* The chapter's load endpoint reports the error without blocking the reader. */ }
    }
    return complete;
  }
}
