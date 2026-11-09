import { isMemoryImageSide, legacyImageSide, readingNoteImage } from "../shared/reading-note-images";
import type { MemoryImageSide } from "../shared/contracts";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ChangeReadingNoteTagsInput,
  ReadingNoteTag,
  CreateReadingNoteInput,
  ReadingNote,
  ReadingNoteCounts,
  ReadingNoteListInput,
  ReadingNotePageInput,
  ReadingNotePage,
  ReadingNoteMemoryImageRecipe,
  RemoveReadingNoteMemoryImageInput,
  SetReadingNoteMemoryImageInput,
  UpdateReadingNoteInput
} from "../shared/contracts";
import {
  markdownToReadingNoteDocument,
  parseReadingNoteDocument
} from "../shared/reading-note-document";

import type { ChangeBookTagInput } from "../shared/contracts";

interface ReadingNoteState {
  bookTags: Record<string, string[]>;
  version: 8;
  tags: ReadingNoteTag[];
  notes: ReadingNote[];
}

export interface ReadingNoteStore {
  create(input: CreateReadingNoteInput): ReadingNote;
  update(input: UpdateReadingNoteInput): ReadingNote;
  setMemoryImage(input: SetReadingNoteMemoryImageInput): ReadingNote;
  removeMemoryImage(input: RemoveReadingNoteMemoryImageInput): ReadingNote;
  list(input?: ReadingNoteListInput): ReadingNote[];
  listPage(input: ReadingNotePageInput): ReadingNotePage;
  activeBookTitles(): string[];
  get(noteId: string): ReadingNote | undefined;
  counts(): ReadingNoteCounts;
  trash(noteId: string): ReadingNote;
  restore(noteId: string): ReadingNote;
  emptyTrash(): number;
  trashedIds(): string[];
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function promptSnapshot(value: unknown): ReadingNoteMemoryImageRecipe["purpose"] {
  if (!object(value) || !requiredText(value.name) || !requiredText(value.prompt) ||
    (value.id !== undefined && !requiredText(value.id))) {
    throw new Error("Invalid local reading-note data.");
  }
  return {
    ...(typeof value.id === "string" ? { id: value.id.trim() } : {}),
    name: value.name.trim(),
    prompt: value.prompt.trim()
  };
}

function memoryImageRecipe(value: unknown): ReadingNoteMemoryImageRecipe | undefined {
  if (value === undefined) return undefined;
  if (!object(value) || !Array.isArray(value.adjustments) ||
    value.adjustments.some((item) => typeof item !== "string" || !item.trim()) ||
    (value.extraInstruction !== undefined && typeof value.extraInstruction !== "string")) {
    throw new Error("Invalid local reading-note data.");
  }
  return {
    purpose: promptSnapshot(value.purpose),
    style: promptSnapshot(value.style),
    ...(typeof value.extraInstruction === "string" && value.extraInstruction.trim()
      ? { extraInstruction: value.extraInstruction.trim() }
      : {}),
    adjustments: value.adjustments.map((item) => String(item).trim())
  };
}

function parseMemoryImage(value: unknown): ReadingNote["memoryImage"] {
  if (value === undefined) return undefined;
  if (!object(value) || !requiredText(value.attachmentId) ||
    !Number.isInteger(value.basedOnRevision) || Number(value.basedOnRevision) < 1 ||
    (value.revisedPrompt !== undefined && typeof value.revisedPrompt !== "string")) {
    throw new Error("Invalid local reading-note data.");
  }
  const recipe = memoryImageRecipe(value.recipe);
  return {
    attachmentId: String(value.attachmentId).trim(),
    basedOnRevision: Number(value.basedOnRevision),
    ...(typeof value.revisedPrompt === "string" && value.revisedPrompt.trim()
      ? { revisedPrompt: value.revisedPrompt.trim() }
      : {}),
    ...(recipe ? { recipe } : {})
  };
}

function parseNote(value: unknown): ReadingNote {
  if (!object(value) || !requiredText(value.id) || !requiredText(value.sourceDraftId) ||
    !requiredText(value.bookTitle) || !requiredText(value.chapterTitle) || !timestamp(value.createdAt) ||
    (value.updatedAt !== undefined && !timestamp(value.updatedAt)) ||
    (value.trashedAt !== undefined && !timestamp(value.trashedAt))) {
    throw new Error("Invalid local reading-note data.");
  }
  if (value.tagIds !== undefined && (!Array.isArray(value.tagIds) || value.tagIds.some(id => !requiredText(id)))) throw new Error("Invalid reading-note tags.");
  for (const key of ["bookId", "chapterId"]) {
    if (value[key] !== undefined && !requiredText(value[key])) throw new Error("Invalid reading-note source identity.");
  }
  const legacyPrompt = requiredText(value.prompt) ? value.prompt : undefined;
  const legacy = legacyPrompt !== undefined && typeof value.content === "string";
  const title = legacy
    ? legacyPrompt
    : typeof value.title === "string"
      ? value.title.trim() || "Untitled"
      : undefined;
  if (!title) throw new Error("Invalid local reading-note data.");
  let content;
  try {
    content = legacy
      ? markdownToReadingNoteDocument(value.content as string)
      : parseReadingNoteDocument(value.content);
  } catch {
    if (!legacy || typeof value.content !== "string") throw new Error("Invalid local reading-note data.");
    content = markdownToReadingNoteDocument(String(value.content));
  }
  const revision = legacy
    ? 1
    : typeof value.revision === "number" && Number.isInteger(value.revision) && value.revision > 0
      ? value.revision
      : undefined;
  if (!revision) throw new Error("Invalid local reading-note data.");
  const memoryImage = parseMemoryImage(value.memoryImage);
  if (value.memoryImages !== undefined && (!object(value.memoryImages) || Object.keys(value.memoryImages).some(key => !isMemoryImageSide(key)))) throw new Error("Invalid local reading-note images.");
  const images = object(value.memoryImages) ? value.memoryImages : {};
  const recall = parseMemoryImage(images.recall);
  const understand = parseMemoryImage(images.understand);
  return {
    ...(Array.isArray(value.tagIds) ? { tagIds: [...new Set(value.tagIds as string[])] } : {}),
    id: value.id.trim(),
    sourceDraftId: value.sourceDraftId.trim(),
    ...(requiredText(value.bookId) ? { bookId: value.bookId.trim() } : {}),
    ...(requiredText(value.chapterId) ? { chapterId: value.chapterId.trim() } : {}),
    title,
    content,
    bookTitle: value.bookTitle.trim(),
    chapterTitle: value.chapterTitle.trim(),
    createdAt: value.createdAt,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : value.createdAt,
    revision,
    ...(memoryImage ? { memoryImage } : {}),
    ...(recall || understand ? { memoryImages: { ...(recall ? { recall } : {}), ...(understand ? { understand } : {}) } } : {}),
    ...(typeof value.trashedAt === "number" ? { trashedAt: value.trashedAt } : {})
  };
}

function parseState(value: unknown): ReadingNoteState {
  if (!object(value) || ![1, 2, 3, 4, 5, 6, 7, 8].includes(value.version as number) || !Array.isArray(value.notes)) {
    throw new Error("Invalid local reading-note data.");
  }
  const notes = value.notes.map(parseNote).map(note => {
    const side = note.memoryImage && legacyImageSide(note.memoryImage);
    if (Number(value.version) >= 7 || !side || note.memoryImages?.[side]) return note;
    const { memoryImage, ...rest } = note;
    return { ...rest, memoryImages: { ...note.memoryImages, [side]: memoryImage } };
  });
  if (new Set(notes.map(({ id }) => id)).size !== notes.length ||
    new Set(notes.map(({ sourceDraftId }) => sourceDraftId)).size !== notes.length) {
    throw new Error("Invalid local reading-note data.");
  }
  const tags: ReadingNoteTag[] = value.version === 8 ? parseTags(value.tags) : [];
  const ids = new Set(tags.map(tag => tag.id));
  if (notes.some(note => note.tagIds?.some(id => !ids.has(id)))) throw new Error("Invalid reading-note tag reference.");
  const bookTags = value.bookTags === undefined ? {} : value.bookTags;
  if (!object(bookTags) || Object.entries(bookTags).some(([bookId, tags]) =>
    !requiredText(bookId) || !Array.isArray(tags) || tags.some(id => !ids.has(id)))) {
    throw new Error("Invalid reading-note book tags.");
  }
  return { version: 8, notes, tags, bookTags: bookTags as Record<string, string[]> };
}

function tagName(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) throw new Error("Tag names must contain 1–80 characters.");
  return value.trim();
}
function parseTags(value: unknown): ReadingNoteTag[] {
  if (!Array.isArray(value)) throw new Error("Invalid reading-note tags.");
  const tags = value.map(tag => {
    if (!object(tag) || !requiredText(tag.id)) throw new Error("Invalid reading-note tag.");
    return { id: tag.id, name: tagName(tag.name) };
  });
  if (new Set(tags.map(t => t.id)).size !== tags.length || new Set(tags.map(t => t.name.toLowerCase())).size !== tags.length) throw new Error("Duplicate reading-note tags.");
  return tags;
}

export class LocalReadingNoteStore implements ReadingNoteStore {
  readonly #directory: string;
  readonly #path: string;
  readonly #createId: () => string;
  readonly #now: () => number;
  #notes: ReadingNote[];
  #tags: ReadingNoteTag[] = [];
  #bookTags: Map<string, string[]>;
  #generation = 0;
  #queryCache?: { key: string; generation: number; notes: ReadingNote[] };

  constructor(directory: string, options: { createId?(): string; now?(): number } = {}) {
    this.#directory = directory;
    this.#path = join(directory, "reading-notes.json");
    this.#createId = options.createId ?? randomUUID;
    this.#now = options.now ?? Date.now;
    const state = this.#load();
    this.#notes = state.notes;
    this.#tags = state.tags;
    this.#bookTags = new Map(Object.entries(state.bookTags));
  }

  bookTags(): Record<string, string[]> {
    return structuredClone(Object.fromEntries(this.#bookTags));
  }

  changeBookTag(input: ChangeBookTagInput): string[] {
    if (!object(input) || !requiredText(input.bookId) || !this.#tags.some(tag => tag.id === input.tagId) ||
      !["add", "remove"].includes(input.action)) throw new Error("Invalid book tag change.");
    const previous = this.#bookTags.get(input.bookId);
    const ids = new Set(previous);
    if (input.action === "add") ids.add(input.tagId);
    else ids.delete(input.tagId);
    if (ids.size === (previous?.length ?? 0)) return [...ids];
    if (ids.size) this.#bookTags.set(input.bookId, [...ids]);
    else this.#bookTags.delete(input.bookId);
    try { this.#save(); } catch (cause) {
      if (previous) this.#bookTags.set(input.bookId, previous);
      else this.#bookTags.delete(input.bookId);
      throw cause;
    }
    return [...ids];
  }

  list(input?: ReadingNoteListInput): ReadingNote[] {
    if (!input) return structuredClone(this.#notes);
    return structuredClone(this.#matching(input));
  }

  listPage(input: ReadingNotePageInput): ReadingNotePage {
    const { cursor, ...query } = input;
    const queryKey = JSON.stringify(query);
    let offset = 0;
    if (cursor !== undefined) {
      try {
        const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (!object(decoded) || decoded.query !== queryKey || decoded.generation !== this.#generation ||
          !Number.isSafeInteger(decoded.offset) || Number(decoded.offset) < 1) throw new Error();
        offset = Number(decoded.offset);
      } catch {
        throw new Error("Invalid or expired reading-note cursor.");
      }
    }
    const matching = this.#matching(query);
    const end = Math.min(offset + 50, matching.length);
    const items = matching.slice(offset, end).map(({ content: _content, sourceDraftId: _sourceDraftId, ...summary }) =>
      structuredClone(summary));
    return {
      items,
      ...(end < matching.length ? { nextCursor: Buffer.from(JSON.stringify({
        query: queryKey, generation: this.#generation, offset: end
      })).toString("base64url") } : {})
    };
  }

  listTags(): ReadingNoteTag[] {
    return structuredClone(this.#tags).sort((a, b) => a.name.localeCompare(b.name));
  }

  createTag(value: unknown): ReadingNoteTag {
    const name = tagName(value);
    const existing = this.#tags.find(tag => tag.name.toLowerCase() === name.toLowerCase());
    if (existing) return structuredClone(existing);
    const tag = { id: randomUUID(), name };
    const previous = this.#tags;
    this.#tags = [...previous, tag];
    try { this.#save(); } catch (error) { this.#tags = previous; throw error; }
    return structuredClone(tag);
  }

  renameTag(input: { id: string; name: string }): ReadingNoteTag {
    if (!object(input) || !requiredText(input.id)) throw new Error("Invalid tag.");
    const name = tagName(input.name);
    if (!this.#tags.some(tag => tag.id === input.id)) throw new Error("Tag not found.");
    if (this.#tags.some(tag => tag.id !== input.id && tag.name.toLowerCase() === name.toLowerCase())) throw new Error("A tag with this name already exists.");
    const renamed = { id: input.id, name };
    const previous = this.#tags;
    this.#tags = previous.map(tag => tag.id === input.id ? renamed : tag);
    try { this.#save(); } catch (error) { this.#tags = previous; throw error; }
    return structuredClone(renamed);
  }

  matchingIds(query: ReadingNoteListInput): string[] {
    return this.#matching(query).map(note => note.id);
  }

  changeTags(input: ChangeReadingNoteTagsInput): number {
    if (!object(input) || !Array.isArray(input.noteIds) || input.noteIds.some(id => !requiredText(id)) ||
      !requiredText(input.tagId) || !["add", "remove"].includes(input.action)) throw new Error("Invalid tag change.");
    if (!this.#tags.some(tag => tag.id === input.tagId)) throw new Error("Tag not found.");
    const ids = new Set(input.noteIds);
    const targets = this.#notes.filter(note => ids.has(note.id));
    if (targets.length !== ids.size || targets.some(note => note.trashedAt !== undefined)) throw new Error("Some selected notes are missing or in Trash. Select them again.");
    const previous = this.#notes;
    this.#notes = previous.map(note => {
      if (!ids.has(note.id)) return note;
      const tags = new Set(note.tagIds ?? []);
      if (input.action === "add") tags.add(input.tagId); else tags.delete(input.tagId);
      return { ...note, tagIds: [...tags] };
    });
    try { this.#save(); } catch (error) { this.#notes = previous; throw error; }
    return ids.size;
  }

  activeBookTitles(): string[] {
    return [...new Set(this.#notes.filter(note => note.trashedAt === undefined).map(note => note.bookTitle))]
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
  }

  #matching(input: ReadingNoteListInput): ReadingNote[] {
    const key = JSON.stringify(input);
    if (this.#queryCache?.key === key && this.#queryCache.generation === this.#generation) {
      return this.#queryCache.notes;
    }
    if (input.tagIds !== undefined && (!Array.isArray(input.tagIds) || input.tagIds.some(id => !requiredText(id)))) throw new Error("Invalid tag filter.");
    const search = input.search?.trim().toLocaleLowerCase();
    const notes = this.#notes.filter((note) => {
      const matchesStatus = input.status === "trashed" ? note.trashedAt !== undefined : note.trashedAt === undefined;
      return matchesStatus && (!input.tagIds?.length || input.tagIds.some(id => note.tagIds?.includes(id))) && (!search || note.title.toLocaleLowerCase().includes(search)) &&
        (!input.bookTitle || note.bookTitle === input.bookTitle) &&
        (!input.chapterTitle || note.chapterTitle === input.chapterTitle);
    });
    notes.sort((left, right) => {
      if (input.status === "trashed") {
        return (right.trashedAt ?? 0) - (left.trashedAt ?? 0) || left.id.localeCompare(right.id);
      }
      if (input.sort === "alphabetical") {
        return left.title.localeCompare(right.title, undefined, { sensitivity: "base" }) ||
          right.createdAt - left.createdAt || left.id.localeCompare(right.id);
      }
      return right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
    });
    this.#queryCache = { key, generation: this.#generation, notes };
    return notes;
  }

  get(noteId: string): ReadingNote | undefined {
    const note = this.#notes.find(({ id }) => id === noteId);
    return note ? structuredClone(note) : undefined;
  }

  counts(): ReadingNoteCounts {
    const trashed = this.#notes.filter(({ trashedAt }) => trashedAt !== undefined).length;
    return { active: this.#notes.length - trashed, trashed };
  }

  trashedIds(): string[] {
    return this.#notes.filter(({ trashedAt }) => trashedAt !== undefined).map(({ id }) => id);
  }

  create(input: CreateReadingNoteInput): ReadingNote {
    const timestampNow = this.#now();
    const validated = parseNote({
      tagIds: input.bookId ? this.#bookTags.get(input.bookId) : undefined,
      id: input.id ?? this.#createId(),
      sourceDraftId: input.sourceDraftId,
      bookId: input.bookId,
      chapterId: input.chapterId,
      title: input.title,
      content: input.content,
      bookTitle: input.bookTitle,
      chapterTitle: input.chapterTitle,
      createdAt: timestampNow,
      updatedAt: timestampNow,
      revision: 1
    });
    if (this.#notes.some(({ sourceDraftId }) => sourceDraftId === validated.sourceDraftId)) {
      throw new Error("This reading-note draft has already been submitted.");
    }
    const previous = this.#notes;
    this.#notes = [...this.#notes, validated];
    try { this.#save(); } catch (error) { this.#notes = previous; throw error; }
    return structuredClone(validated);
  }

  update(input: UpdateReadingNoteInput): ReadingNote {
    if (!requiredText(input.id) || typeof input.title !== "string" ||
      !Number.isInteger(input.baseRevision) || input.baseRevision < 1) {
      throw new Error("Invalid reading-note update.");
    }
    const content = parseReadingNoteDocument(input.content);
    return this.#mutate(input.id.trim(), (note) => {
      if (note.trashedAt !== undefined) throw new Error("Only active reading notes can be edited.");
      if (note.revision !== input.baseRevision) {
        throw new Error("This reading note changed. Reopen it and try again.");
      }
      return {
        ...note,
        title: input.title.trim() || "Untitled",
        content,
        updatedAt: this.#now(),
        revision: note.revision + 1
      };
    });
  }

  setMemoryImage(input: SetReadingNoteMemoryImageInput): ReadingNote {
    if (!requiredText(input.id) || !requiredText(input.attachmentId) ||
      !Number.isInteger(input.baseRevision) || input.baseRevision < 1 ||
      (input.revisedPrompt !== undefined && typeof input.revisedPrompt !== "string")) {
      throw new Error("Invalid reading-note memory image update.");
    }
    if (input.side !== undefined && !isMemoryImageSide(input.side)) throw new Error("Invalid memory-image side.");
    const recipe = memoryImageRecipe(input.recipe);
    return this.#mutate(input.id.trim(), (note) => {
      if (note.trashedAt !== undefined) throw new Error("Only active reading notes can generate a memory image.");
      if (note.revision !== input.baseRevision) {
        throw new Error("This reading note changed. Generate again from the latest version.");
      }
      const image = {
          attachmentId: input.attachmentId.trim(),
          basedOnRevision: input.baseRevision,
          ...(input.revisedPrompt?.trim() ? { revisedPrompt: input.revisedPrompt.trim() } : {}),
          ...(recipe ? { recipe } : {})
      };
      return {
        ...note,
        ...(input.side ? { memoryImages: { ...note.memoryImages, [input.side]: image } } : { memoryImage: image }),
        updatedAt: this.#now(),
        revision: note.revision + 1
      };
    });
  }

  removeMemoryImage(input: RemoveReadingNoteMemoryImageInput): ReadingNote {
    if (!requiredText(input.id) || !Number.isInteger(input.baseRevision) || input.baseRevision < 1) {
      throw new Error("Invalid reading-note memory image removal.");
    }
    if (input.side !== undefined && !isMemoryImageSide(input.side)) throw new Error("Invalid memory-image side.");
    return this.#mutate(input.id.trim(), (note) => {
      if (note.trashedAt !== undefined) throw new Error("Only active reading notes can remove a memory image.");
      if (note.revision !== input.baseRevision) {
        throw new Error("This reading note changed. Reopen it and try again.");
      }
      if (!readingNoteImage(note, input.side)) throw new Error("This reading note has no memory image.");
      const withoutMemoryImage = { ...note, memoryImages: { ...note.memoryImages } };
      if (input.side) {
        delete withoutMemoryImage.memoryImages[input.side];
        if (note.memoryImage && (legacyImageSide(note.memoryImage) ?? "recall") === input.side) delete withoutMemoryImage.memoryImage;
      } else delete withoutMemoryImage.memoryImage;
      return {
        ...withoutMemoryImage,
        updatedAt: this.#now(),
        revision: note.revision + 1
      };
    });
  }

  assignMemoryImage(input: { id: string; baseRevision: number; side: MemoryImageSide }): ReadingNote {
    if (!isMemoryImageSide(input.side)) throw new Error("Invalid memory-image side.");
    return this.#mutate(input.id, note => {
      if (note.trashedAt !== undefined || note.revision !== input.baseRevision) throw new Error("This reading note changed or is in Trash.");
      if (!note.memoryImage || note.memoryImages?.[input.side]) throw new Error("Choose an empty side for the existing image.");
      const { memoryImage, ...rest } = note;
      return { ...rest, memoryImages: { ...note.memoryImages, [input.side]: memoryImage }, revision: note.revision + 1, updatedAt: this.#now() };
    });
  }

  trash(noteId: string): ReadingNote {
    return this.#mutate(noteId, (note) => {
      if (note.trashedAt !== undefined) throw new Error("This reading note is already in Trash.");
      return { ...note, trashedAt: this.#now(), revision: note.revision + 1 };
    });
  }

  restore(noteId: string): ReadingNote {
    return this.#mutate(noteId, (note) => {
      if (note.trashedAt === undefined) throw new Error("This reading note is not in Trash.");
      const { trashedAt: _trashedAt, ...restored } = note;
      return { ...restored, updatedAt: this.#now(), revision: note.revision + 1 };
    });
  }

  emptyTrash(): number {
    const previous = this.#notes;
    const active = this.#notes.filter(({ trashedAt }) => trashedAt === undefined);
    const removed = this.#notes.length - active.length;
    if (!removed) return 0;
    this.#notes = active;
    try { this.#save(); } catch (error) { this.#notes = previous; throw error; }
    return removed;
  }

  #mutate(noteId: string, update: (note: ReadingNote) => ReadingNote): ReadingNote {
    const index = this.#notes.findIndex(({ id }) => id === noteId);
    if (index < 0) throw new Error("Reading note not found.");
    const changed = parseNote(update(this.#notes[index]!));
    const previous = this.#notes;
    this.#notes = this.#notes.map((note, noteIndex) => noteIndex === index ? changed : note);
    try { this.#save(); } catch (error) { this.#notes = previous; throw error; }
    return structuredClone(changed);
  }

  #load(): ReadingNoteState {
    try { return parseState(JSON.parse(readFileSync(this.#path, "utf8"))); }
    catch (error) {
      if (object(error) && error.code === "ENOENT") return { version: 8, notes: [], tags: [], bookTags: {} };
      if (error instanceof Error && error.message.includes("reading-note")) throw error;
      throw new Error("Unable to load local reading notes.", { cause: error });
    }
  }

  #save(): void {
    const state = parseState({ version: 8, notes: this.#notes, tags: this.#tags, bookTags: Object.fromEntries(this.#bookTags) });
    mkdirSync(this.#directory, { recursive: true });
    const temporaryPath = `${this.#path}.next`;
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, this.#path);
    this.#generation += 1;
  }
}
