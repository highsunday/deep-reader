import { expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerSpacedReviewIpc } from "../src/main/app-ipc";
import { SpacedReviewService } from "../src/main/spaced-review-service";
import { LocalReadingNoteStore } from "../src/main/reading-note-store";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import type { ReviewCard } from "../src/shared/spaced-review";

test("F37 IPC: real enrollment, next, rate and pause keep time and attachment authority in Main", () => {
  const directory = mkdtempSync(join(tmpdir(), "review-ipc-"));
  try {
    const notes = new LocalReadingNoteStore(directory);
    const note = notes.create({ sourceDraftId: "d", title: "Title", content: markdownToReadingNoteDocument("Answer"), bookTitle: "B", chapterTitle: "C" });
    notes.setMemoryImage({ id: note.id, side: "recall", baseRevision: note.revision, attachmentId: "recall" });
    const service = new SpacedReviewService(directory, { notes, now: () => Date.parse("2026-09-14T00:00:00Z"), readImage: () => "data:image/png;base64,AA==" });
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerSpacedReviewIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, service);
    const call = (channel: string, value?: unknown) => handlers.get(`spaced-review:${channel}`)!(null, value);
    expect(call("summary")).toMatchObject({ available: 1 });
    expect(() => call("enroll", { noteId: note.id, dueAt: 0 })).toThrow();
    call("enroll", note.id);
    const card = call("next") as ReviewCard;
    const input = { noteId: note.id, noteRevision: card.note.revision, scheduleVersion: card.scheduleVersion, rating: "good", operationId: "operation" };
    for (const extra of [{ dueAt: 0 }, { now: 0 }, { path: "/private/file" }, { rating: "unknown" }, { noteRevision: -1 }]) {
      expect(() => call("rate", { ...input, ...extra })).toThrow();
    }
    expect(call("summary")).toMatchObject({ newCards: 1 });
    const result = call("rate", input);
    expect(call("rate", input)).toEqual(result);
    expect(call("details", note.id)).toMatchObject({ totalReviews: 1, lastRating: "good",
      history: [{ operationId: "operation", rating: "good" }] });
    expect(() => call("details", { noteId: note.id })).toThrow();
    expect(() => call("details", "unknown-note")).toThrow(/not found/);
    expect(call("summary")).toMatchObject({ available: 0 });
    expect(() => call("pause", { noteId: note.id, paused: "yes" })).toThrow();
    call("pause", { noteId: note.id, paused: true });
    expect(call("status", note.id)).toMatchObject({ paused: true });
    expect(() => call("image-failed", { noteId: note.id, path: "/tmp/image" })).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("F38 settings IPC validates exact fields, persists preferences and changes the real queue", () => {
  const directory = mkdtempSync(join(tmpdir(), "review-settings-ipc-"));
  try {
    const notes = new LocalReadingNoteStore(directory);
    notes.create({ sourceDraftId: "d", title: "Title", content: markdownToReadingNoteDocument("Answer"), bookTitle: "B", chapterTitle: "C" });
    const service = new SpacedReviewService(directory, { notes, readImage: () => "" });
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerSpacedReviewIpc({ handle: (channel, fn) => handlers.set(channel, fn) }, service);
    const call = (channel: string, value?: unknown) => handlers.get(`spaced-review:${channel}`)!(null, value);
    expect(call("settings")).toEqual({ dailyNewLimit: 10, dailyDueLimit: 50 });
    for (const input of [null, {}, { dailyNewLimit: 1 }, { dailyNewLimit: "1", dailyDueLimit: 50 },
      { dailyNewLimit: 1, dailyDueLimit: 50, now: 0 }, { dailyNewLimit: 1, dailyDueLimit: 1000 }]) {
      expect(() => call("save-settings", input)).toThrow();
    }
    call("save-settings", { dailyNewLimit: 0, dailyDueLimit: 999 });
    expect(call("summary")).toMatchObject({ available: 0, backlog: 1 });
    expect(call("next")).toBeNull();
    expect(new SpacedReviewService(directory, { notes, readImage: () => "" }).settings()).toEqual({ dailyNewLimit: 0, dailyDueLimit: 999 });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
