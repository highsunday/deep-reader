import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";
import { SpacedReviewService } from "../src/main/spaced-review-service";
import { LocalReadingNoteStore } from "../src/main/reading-note-store";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import type { RateReviewInput, ReviewRating } from "../src/shared/spaced-review";

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })));
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "reading-review-")); directories.push(directory);
  let now = Date.parse("2026-09-14T15:59:00Z");
  const notes = new LocalReadingNoteStore(directory, { now: () => now });
  const missing = new Set<string>();
  let failSave = false;
  const options = { notes, now: () => now,
    readImage: (id: string) => { if (missing.has(id)) throw new Error("missing"); return "data:image/png;base64,AA=="; },
    persist: (path: string, data: string) => { if (failSave) throw new Error("Disk full"); writeFileSync(path, data); } };
  const review = new SpacedReviewService(directory, options);
  function note(side?: "recall" | "understand") {
    let saved = notes.create({ sourceDraftId: `draft-${Math.random()}`, title: "Core concept", content: markdownToReadingNoteDocument("Answer"), bookTitle: "Book", chapterTitle: "Chapter" });
    if (side) saved = notes.setMemoryImage({ id: saved.id, baseRevision: saved.revision, side, attachmentId: `image-${saved.id}` });
    return saved;
  }
  function input(rating: ReviewRating = "good"): RateReviewInput {
    const card = review.next()!;
    return { noteId: card.note.id, noteRevision: card.note.revision, scheduleVersion: card.scheduleVersion, rating, operationId: `op-${Math.random()}` };
  }
  return { directory, notes, review, note, input, missing, options,
    time: () => now, setTime: (value: number) => { now = value; }, fail: (value: boolean) => { failSave = value; },
    disk: () => JSON.parse(readFileSync(join(directory, "spaced-review.json"), "utf8")) };
}

test("F37 TC17: all saved notes enroll automatically; manual pause survives restart", () => {
  const f = fixture(); const plain = f.note(); f.note("understand"); const back = f.note("recall");
  expect(f.review.summary()).toMatchObject({ available: 3, newCards: 3, enrolled: 3 });
  expect(f.review.status(plain.id)).toMatchObject({ enrolled: true, eligible: true });
  expect(() => f.review.enroll("draft")).toThrow();
  f.review.setPaused(back.id, true); f.review.enroll(back.id);
  const restarted = new SpacedReviewService(f.directory, f.options);
  expect(restarted.summary()).toMatchObject({ available: 2, paused: 1 });
  restarted.setPaused(back.id, false);
  expect(restarted.summary().available).toBe(3);
  f.notes.trash(back.id);
  expect(() => restarted.enroll(back.id)).toThrow(/Trash/);
});

test("F37 TC19: automatic enrollment retries an atomic failed save without duplicates", () => {
  const f = fixture(); f.note(); f.fail(true);
  expect(() => f.review.summary()).toThrow("Disk full");
  f.fail(false);
  expect(f.review.summary().available).toBe(1);
  expect(f.review.summary().enrolled).toBe(1);
  expect(f.disk().entries).toHaveLength(1);
});

test("F37 TC18: title-only cards can be rated and keep their schedule when paused", () => {
  const f = fixture(); const note = f.note();
  expect(f.review.next()).toMatchObject({ note: { title: note.title }, recallUrl: undefined });
  const due = f.review.rate(f.input()).dueAt;
  f.review.setPaused(note.id, true);
  const restarted = new SpacedReviewService(f.directory, f.options);
  restarted.setPaused(note.id, false);
  expect(restarted.status(note.id)).toMatchObject({ dueAt: due, paused: false });
  expect(restarted.summary().available).toBe(0);
});

test.each(["again", "hard", "good", "easy"] as const)("F37 TC5-7: %s matches FSRS for new and existing cards and survives restart", rating => {
  const f = fixture(); const note = f.note("recall"); f.review.enroll(note.id);
  const card = f.review.next()!; const before = readFileSync(join(f.directory, "spaced-review.json"), "utf8");
  f.review.next();
  expect(readFileSync(join(f.directory, "spaced-review.json"), "utf8")).toBe(before);
  const result = f.review.rate(f.input(rating));
  const expected = fsrs({ request_retention: 0.9 }).next(createEmptyCard(new Date(f.time())), new Date(f.time()),
    ({ again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const)[rating]);
  expect(result.dueAt).toBe(expected.card.due.getTime());
  expect(card.intervals[rating]).toBe(result.dueAt);
  expect(f.review.summary().available).toBe(0);
  const restarted = new SpacedReviewService(f.directory, f.options);
  expect(restarted.summary().nextDueAt).toBe(result.dueAt);
  f.setTime(result.dueAt - 1); expect(restarted.next()).toBeNull();
  f.setTime(result.dueAt); expect(restarted.summary().due).toBe(1);
  const next = restarted.next()!;
  const again = restarted.rate({ ...f.input(rating), scheduleVersion: next.scheduleVersion });
  expect(again.dueAt).toBe(fsrs({ request_retention: 0.9 }).next(expected.card, new Date(f.time()),
    ({ again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const)[rating]).card.due.getTime());
  expect(f.disk().events).toHaveLength(2);
});

test("F37 TC3: 8 due and 5 new cards including a missing image count as 13; due cards precede new ones", () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) { f.review.enroll(f.note("recall").id); f.review.rate(f.input()); }
  const when = f.review.summary().nextDueAt!;
  for (let i = 0; i < 4; i++) f.review.enroll(f.note("recall").id);
  const paused = f.note("recall"); f.review.enroll(paused.id); f.review.setPaused(paused.id, true);
  const missing = f.note("recall"); f.review.enroll(missing.id); f.missing.add(`image-${missing.id}`);
  f.setTime(when);
  expect(f.review.summary()).toMatchObject({ available: 13, due: 8, newCards: 5, paused: 1, unavailable: 0 });
  expect(f.review.next()?.scheduleVersion).toBe(2);
});

test("F37 TC8-9: image removal, pause, trash, edits, restore and permanent deletion preserve the appropriate state", () => {
  const f = fixture(); let note = f.note("recall"); f.review.enroll(note.id);
  const due = f.review.rate(f.input()).dueAt;
  f.notes.update({ id: note.id, baseRevision: note.revision, title: "Updated", content: note.content });
  expect(f.review.status(note.id).dueAt).toBe(due);
  f.review.setPaused(note.id, true);
  note = f.notes.removeMemoryImage({ id: note.id, baseRevision: f.notes.get(note.id)!.revision, side: "recall" });
  expect(f.review.summary().available).toBe(0);
  note = f.notes.setMemoryImage({ id: note.id, baseRevision: note.revision, side: "recall", attachmentId: "new-image" });
  f.notes.trash(note.id); f.notes.restore(note.id);
  expect(f.review.status(note.id)).toMatchObject({ paused: true, dueAt: due });
  f.review.setPaused(note.id, false); f.setTime(due);
  expect(f.review.next()?.note.title).toBe("Updated");
  f.notes.trash(note.id); f.notes.emptyTrash(); f.review.prune();
  expect(f.disk()).toMatchObject({ entries: [], events: [] });
});

test("F37 TC10: a failed write rolls back memory; retries and lost replies cannot apply a rating twice", () => {
  const f = fixture(); f.review.enroll(f.note("recall").id); const input = f.input();
  f.fail(true); expect(() => f.review.rate(input)).toThrow("Disk full");
  expect(f.review.summary().newCards).toBe(1); expect(f.disk().events).toHaveLength(0);
  f.fail(false); const result = f.review.rate(input);
  const restarted = new SpacedReviewService(f.directory, f.options);
  expect(restarted.rate(input)).toEqual(result); expect(f.disk().events).toHaveLength(1);
  expect(() => restarted.rate({ ...input, rating: "easy" })).toThrow(/rating ID/);
  expect(() => restarted.rate({ ...input, operationId: "new-op" })).toThrow(/changed/);
});

test.each(["edit", "pause", "image", "trash"])("F37 TC11: stale %s while a card is open rejects the rating", action => {
  const f = fixture(); const note = f.note("recall"); f.review.enroll(note.id); const input = f.input();
  if (action === "edit") f.notes.update({ id: note.id, baseRevision: note.revision, title: "Changed", content: note.content });
  if (action === "pause") { f.review.setPaused(note.id, true); f.review.setPaused(note.id, false); }
  if (action === "image") f.notes.removeMemoryImage({ id: note.id, baseRevision: f.notes.get(note.id)!.revision, side: "recall" });
  if (action === "trash") f.notes.trash(note.id);
  expect(() => f.review.rate(input)).toThrow(/changed/); expect(f.disk().events).toHaveLength(0);
});

test("F37 TC12-14: missing and undecodable images fall back to title; retry and replacement recover", () => {
  const f = fixture(); const note = f.note("recall"); const attachment = `image-${note.id}`;
  f.missing.add(attachment); expect(f.review.next()?.recallUrl).toBeUndefined();
  f.missing.clear(); f.review.enroll(note.id);
  f.review.imageFailed(note.id, "old-image"); expect(f.review.summary().available).toBe(1);
  f.review.imageFailed(note.id, attachment); expect(f.review.summary()).toMatchObject({ unavailable: 0, paused: 0, available: 1 });
  f.review.retryImages(); expect(f.review.summary().available).toBe(1);
  f.review.imageFailed(note.id, attachment);
  f.notes.setMemoryImage({ id: note.id, baseRevision: note.revision, side: "recall", attachmentId: "replacement" });
  expect(f.review.summary().available).toBe(1);
});

test("F37 malformed persistent state is rejected without overwriting it", () => {
  const f = fixture(); f.review.enroll(f.note("recall").id);
  const path = join(f.directory, "spaced-review.json"); writeFileSync(path, '{"version":99}');
  expect(() => new SpacedReviewService(f.directory, f.options)).toThrow(/Invalid saved/);
  expect(readFileSync(path, "utf8")).toBe('{"version":99}');
});

test("F37 TC1: an unassigned legacy image cannot silently become the recall cue", () => {
  const f = fixture(); const note = f.note();
  f.notes.setMemoryImage({ id: note.id, baseRevision: note.revision, attachmentId: "legacy-unknown" });
  expect(f.review.next()?.recallUrl).toBeUndefined();
  expect(f.review.summary().available).toBe(1);
});

test("F37 summary checks image availability without loading every card's image payload", () => {
  const f = fixture(); const note = f.note("recall");
  let reads = 0;
  const review = new SpacedReviewService(f.directory, { ...f.options, isImageAvailable: () => true,
    readImage: () => { reads++; return "data:image/png;base64,AA=="; } });
  review.enroll(note.id); review.summary(); review.summary();
  expect(reads).toBe(0);
  expect(review.next()?.recallAttachmentId).toBe(`image-${note.id}`);
  expect(reads).toBe(1);
});


test("F37 TC17/19: existing state is retained while previously unregistered notes are added", () => {
  const f = fixture(); const old = f.note();
  f.review.enroll(old.id); const due = f.review.rate(f.input()).dueAt;
  f.review.setPaused(old.id, true);
  const saved = f.disk(); const fresh = f.note(); const trashed = f.note(); f.notes.trash(trashed.id);
  const restarted = new SpacedReviewService(f.directory, f.options);
  expect(restarted.summary()).toMatchObject({ enrolled: 2, available: 1, paused: 1 });
  expect(f.disk().entries.find((e: { noteId: string }) => e.noteId === old.id)).toEqual(saved.entries[0]);
  expect(f.disk().events).toEqual(saved.events);
  expect(restarted.status(old.id)).toMatchObject({ paused: true, dueAt: due });
  expect(restarted.next()?.note.id).toBe(fresh.id);
  f.notes.restore(trashed.id);
  expect(restarted.summary().available).toBe(2);
});

test("review details derive an isolated, newest-first history from saved ratings and survive restart", () => {
  const f = fixture(); const note = f.note();
  expect(f.review.details(note.id)).toMatchObject({ totalReviews: 0, lastReviewedAt: null, lastRating: null, history: [], dueAt: null });
  const input = f.input("hard");
  f.fail(true);
  expect(() => f.review.rate(input)).toThrow("Disk full");
  expect(f.review.details(note.id).totalReviews).toBe(0);
  f.fail(false);
  const reviewedAt = f.time();
  const first = f.review.rate(input);
  f.review.rate(input);
  expect(f.review.details(note.id).totalReviews).toBe(1);
  f.setTime(first.dueAt);
  const secondInput = f.input("easy");
  const second = f.review.rate(secondInput);
  const other = f.note(); f.review.rate(f.input());
  const details = f.review.details(note.id);
  expect(details).toMatchObject({ totalReviews: 2, lastReviewedAt: first.dueAt, lastRating: "easy", dueAt: second.dueAt,
    history: [
      { operationId: secondInput.operationId, rating: "easy", reviewedAt: first.dueAt, dueAt: second.dueAt },
      { operationId: input.operationId, rating: "hard", reviewedAt, dueAt: first.dueAt }
    ] });
  expect(f.review.details(other.id).totalReviews).toBe(1);
  details.history[0].rating = "again";
  expect(f.review.details(note.id).lastRating).toBe("easy");
  f.review.setPaused(note.id, true);
  f.notes.trash(note.id);
  const restarted = new SpacedReviewService(f.directory, f.options);
  expect(restarted.details(note.id)).toMatchObject({ paused: true, eligible: false, totalReviews: 2, lastRating: "easy", dueAt: second.dueAt });
  expect(() => restarted.details("missing")).toThrow(/not found/);
});

test("F38 TC1/2/3/4/7/9: daily introductions persist, validate, and never block existing new learning", () => {
  const f = fixture(); f.setTime(new Date(2026, 8, 22, 12).getTime());
  for (let i = 0; i < 4; i++) f.note();
  expect(f.review.settings()).toEqual({ dailyNewLimit: 10, dailyDueLimit: 50 });
  for (const value of [-1, 1.5, 1000, "2", null, NaN]) {
    expect(() => f.review.saveSettings({ dailyNewLimit: value, dailyDueLimit: 50 })).toThrow();
  }
  f.review.saveSettings({ dailyNewLimit: 2, dailyDueLimit: 1 });
  const input = f.input("again");
  f.fail(true); expect(() => f.review.rate(input)).toThrow("Disk full"); f.fail(false);
  expect(f.review.summary().daily.startedNew).toBe(0);
  const first = f.review.rate(input); f.review.rate(input);
  f.review.rate(f.input("easy"));
  expect(f.review.summary()).toMatchObject({ available: 0, backlog: 2, daily: { startedNew: 2, completedDue: 0 } });
  f.review.saveSettings({ dailyNewLimit: 0, dailyDueLimit: 0 });
  f.setTime(first.dueAt);
  expect(f.review.summary()).toMatchObject({ available: 1, learning: 1 });
  const restarted = new SpacedReviewService(f.directory, f.options);
  expect(restarted.settings()).toEqual({ dailyNewLimit: 0, dailyDueLimit: 0 });
  expect(restarted.summary().daily.startedNew).toBe(2);
  f.setTime(new Date(2026, 8, 23, 12).getTime());
  expect(restarted.summary().daily.startedNew).toBe(0);
  expect(restarted.next()?.note.id).toBe(input.noteId);
  restarted.rate({ noteId: input.noteId, noteRevision: restarted.next()!.note.revision,
    scheduleVersion: restarted.next()!.scheduleVersion, rating: "easy", operationId: "finish-new" });
  expect(restarted.summary().daily.completedDue).toBe(0);
});

test("F38 TC5/6/8: due completion is separate; learning precedes introductions and zero pauses due learning", () => {
  const f = fixture(); f.setTime(new Date(2026, 8, 22, 12).getTime());
  f.note(); f.note();
  const a = f.review.rate(f.input("easy")); const b = f.review.rate(f.input("easy"));
  f.setTime(Math.max(a.dueAt, b.dueAt));
  f.review.saveSettings({ dailyNewLimit: 0, dailyDueLimit: 1 });
  const retry = f.review.rate(f.input("again"));
  expect(f.review.summary().daily.completedDue).toBe(0);
  f.setTime(retry.dueAt);
  expect(f.review.next()?.note.id).toBe(retry.noteId);
  f.review.saveSettings({ dailyNewLimit: 0, dailyDueLimit: 0 });
  expect(f.review.next()).toBeNull();
  f.review.saveSettings({ dailyNewLimit: 0, dailyDueLimit: 1 });
  f.review.rate(f.input("easy"));
  expect(f.review.summary()).toMatchObject({ available: 0, daily: { completedDue: 1 } });
  f.review.saveSettings({ dailyNewLimit: 0, dailyDueLimit: 2 });
  const stale = f.input("easy");
  f.review.saveSettings({ dailyNewLimit: 0, dailyDueLimit: 1 });
  expect(() => f.review.rate(stale)).toThrow();
});

test("F38 TC12/13/14: activity uses completed rounds; legacy replay verifies history without mutating it", () => {
  const f = fixture(); f.setTime(new Date(2026, 8, 22, 12).getTime()); f.note();
  const retry = f.review.rate(f.input("again"));
  expect(f.review.summary().activity.completedReviews).toBe(0);
  expect(f.review.summary().progress.recallRate).toBeNull();
  f.setTime(retry.dueAt); f.review.rate(f.input("easy"));
  expect(f.review.summary().activity).toMatchObject({ completedReviews: 1, activeDays: 1 });
  expect(f.review.summary().progress).toMatchObject({ recallRate: 100, recallReviews: 1 });
  const saved = f.disk();
  saved.events.forEach((event: Record<string, unknown>) => { delete event.card; delete event.schedulerVersion; });
  writeFileSync(join(f.directory, "spaced-review.json"), JSON.stringify(saved));
  const legacy = new SpacedReviewService(f.directory, f.options);
  expect(legacy.summary().progress.daily.every(day => day.solid !== null)).toBe(true);
  expect(f.disk()).toEqual(saved);
  saved.events[0].dueAt += 1;
  writeFileSync(join(f.directory, "spaced-review.json"), JSON.stringify(saved));
  const unknown = new SpacedReviewService(f.directory, f.options);
  expect(unknown.summary().progress.historyIncomplete).toBe(true);
  expect(unknown.summary().progress.solid).toBe(0);
  expect(f.disk()).toEqual(saved);
});

test("F38 TC7/10: settings failures, lowered limits, pause, trash and restore preserve true daily history", () => {
  const f = fixture(); f.setTime(new Date(2026, 8, 22, 12).getTime()); const note = f.note();
  f.review.rate(f.input("easy"));
  f.review.saveSettings({ dailyNewLimit: 0, dailyDueLimit: 0 });
  expect(f.review.summary().daily).toMatchObject({ startedNew: 1, dailyNewLimit: 0 });
  const before = f.disk(); f.fail(true);
  expect(() => f.review.saveSettings({ dailyNewLimit: 20, dailyDueLimit: 20 })).toThrow("Disk full");
  expect(f.review.settings().dailyNewLimit).toBe(0); expect(f.disk()).toEqual(before); f.fail(false);
  f.review.setPaused(note.id, true);
  expect(f.review.summary().daily.startedNew).toBe(0);
  expect(f.review.summary().activity.completedReviews).toBe(0);
  f.review.setPaused(note.id, false); expect(f.review.summary().daily.startedNew).toBe(1);
  f.notes.trash(note.id); expect(f.review.summary().progress.building).toBe(0);
  f.notes.restore(note.id); expect(f.review.summary().progress.building).toBe(1);
  f.notes.trash(note.id); f.notes.emptyTrash();
  expect(f.review.summary().activity.completedReviews).toBe(0);
  expect(f.disk().events).toEqual([]);
});

test("F38 TC7/13/16: local midnight completes a short round and resets daily quota without future due cards", () => {
  const f = fixture(); f.setTime(new Date(2026, 8, 22, 23, 59, 50).getTime()); f.note();
  const result = f.review.rate(f.input("again"));
  expect(result.dueAt - f.time()).toBeLessThan(24 * 3600_000);
  expect(f.review.summary().activity.completedReviews).toBe(1);
  expect(f.review.summary().daily.startedNew).toBe(1);
  f.setTime(new Date(2026, 8, 23, 0, 1).getTime());
  expect(f.review.summary().daily.startedNew).toBe(0);
  f.review.saveSettings({ dailyNewLimit: 0, dailyDueLimit: 0 });
  expect(f.review.next()).toBeNull();
  expect(f.review.summary().refreshAt).toBeGreaterThan(f.time());
});

test("F42 TC2/3/4/5: voice assessment persists separately, only initial recall schedules, retries remain atomic", () => {
  const f = fixture(); f.note();
  const voiceReview = {
    suggestedRecall: "again", suggestedUnderstanding: "understood", understanding: "partial",
    recallReason: "Needed a hint initially.", understandingReason: "Explained the core after discussion.",
    summary: "Clarified the delay and its effect."
  };
  const input = { ...f.input("hard"), voiceReview };
  f.fail(true);
  expect(() => f.review.rate(input as any)).toThrow("Disk full");
  f.fail(false);
  const result = f.review.rate(input as any);
  expect(f.review.rate(structuredClone(input) as any)).toEqual(result);
  expect(() => f.review.rate({ ...input, voiceReview: { ...voiceReview, understanding: "understood" } } as any)).toThrow(/already used/);
  const restarted = new SpacedReviewService(f.directory, f.options);
  expect(restarted.details(input.noteId).history[0]).toMatchObject({ rating: "hard", voiceReview });
  expect(f.disk().events).toHaveLength(1);
  expect(f.disk().events[0].rating).toBe("hard");
  expect(() => restarted.rate({ ...input, operationId: "invalid", voiceReview: { ...voiceReview, transcript: "private" } } as any)).toThrow();
});

test("F42 TC9: voice source validates current note, schedule, trash and pause", () => {
  const f = fixture(); const note = f.note();
  const input = f.input();
  expect(f.review.validateVoiceSource(input).id).toBe(note.id);
  expect(() => f.review.validateVoiceSource({ ...input, noteRevision: input.noteRevision + 1 })).toThrow(/changed/);
  expect(() => f.review.validateVoiceSource({ ...input, scheduleVersion: input.scheduleVersion + 1 })).toThrow(/changed/);
  f.review.setPaused(note.id, true);
  expect(() => f.review.validateVoiceSource(input)).toThrow(/changed/);
  f.review.setPaused(note.id, false);
  const fresh = f.input();
  f.notes.trash(note.id);
  expect(() => f.review.validateVoiceSource(fresh)).toThrow(/changed/);
});
