import { parseAssessment, type SavedVoiceReview } from "../shared/review-voice";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createEmptyCard, type Card } from "ts-fsrs";
import { scheduler, schedulerVersion, ratings, reviewDaily, memoryProgress, midnightAfter, type ReviewEntry as Entry, type ReviewEvent as Event } from "./review-progress";
import type { ReadingNote } from "../shared/contracts";
import { legacyImageSide, readingNoteImage } from "../shared/reading-note-images";
import { DEFAULT_REVIEW_SETTINGS, type ReviewSettings, REVIEW_RATINGS, type NoteReviewDetails, type NoteReviewStatus, type RateReviewInput, type ReviewCard,
  type ReviewRating, type ReviewResult, type ReviewSummary } from "../shared/spaced-review";

interface State { version: 1; entries: Entry[]; events: Event[]; settings: ReviewSettings }
export function validateReviewSettings(value: unknown): ReviewSettings {
  if (!object(value) || Object.keys(value).sort().join() !== "dailyDueLimit,dailyNewLimit" ||
      !integer(value.dailyNewLimit) || value.dailyNewLimit > 999 || !integer(value.dailyDueLimit) || value.dailyDueLimit > 999) {
    throw new Error("Daily limits must be whole numbers from 0 to 999.");
  }
  return { dailyNewLimit: value.dailyNewLimit, dailyDueLimit: value.dailyDueLimit };
}
interface Options {
  notes: { get(id: string): ReadingNote | undefined; list(): ReadingNote[] };
  readImage(id: string): string;
  isImageAvailable?(id: string): boolean;
  now?(): number;
  onChanged?(): void;
  /** Injectable persistence boundary for failure/restart tests. */
  persist?(path: string, data: string): void;
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function recallImage(note: ReadingNote | undefined) {
  if (!note) return undefined;
  // General browsing preserves unknown legacy images. Review cues must not guess their purpose.
  if (!note.memoryImages?.recall && note.memoryImage && legacyImageSide(note.memoryImage) !== "recall") return undefined;
  return readingNoteImage(note, "recall");
}
function id(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("Invalid review identifier.");
}
export function validateRating(value: unknown): RateReviewInput {
  if (!object(value) || Object.keys(value).sort().join() !==
      ["noteId", "noteRevision", "scheduleVersion", "rating", "operationId", ...(value.voiceReview === undefined ? [] : ["voiceReview"])].sort().join() ||
      !integer(value.noteRevision) || value.noteRevision < 1 || !integer(value.scheduleVersion) ||
      value.scheduleVersion < 1 || !REVIEW_RATINGS.includes(value.rating as ReviewRating)) {
    throw new Error("Invalid review rating.");
  }
  id(value.noteId); id(value.operationId);
  return { ...value, ...(value.voiceReview === undefined ? {} : { voiceReview: parseAssessment(value.voiceReview, true) as SavedVoiceReview }) } as unknown as RateReviewInput;
}
function parseCard(value: unknown): Card | null {
  if (value === null) return null;
  if (!object(value)) throw new Error("Invalid saved review card.");
  if (typeof value.due !== "string" || (value.last_review !== undefined && typeof value.last_review !== "string")) {
    throw new Error("Invalid saved review dates.");
  }
  const due = new Date(value.due as string);
  const last = value.last_review === undefined ? undefined : new Date(value.last_review as string);
  for (const key of ["stability", "difficulty", "elapsed_days", "scheduled_days", "reps", "lapses", "learning_steps", "state"]) {
    if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || Number(value[key]) < 0) throw new Error("Invalid saved review card.");
  }
  if (!Number.isFinite(due.getTime()) || (last && !Number.isFinite(last.getTime())) ||
      ![0, 1, 2, 3].includes(Number(value.state))) throw new Error("Invalid saved review dates.");
  return { ...value, due, ...(last ? { last_review: last } : {}) } as unknown as Card;
}
function parseState(value: unknown): State {
  if (!object(value) || value.version !== 1 || !Array.isArray(value.entries) || !Array.isArray(value.events)) {
    throw new Error("Invalid saved review data. Your file has not been overwritten.");
  }
  const entries = value.entries.map((entry): Entry => {
    if (!object(entry) || !integer(entry.enrolledAt) || !integer(entry.version) || entry.version < 1 || typeof entry.paused !== "boolean") {
      throw new Error("Invalid saved review entry.");
    }
    id(entry.noteId);
    return { noteId: entry.noteId, enrolledAt: entry.enrolledAt, version: entry.version, paused: entry.paused, card: parseCard(entry.card) };
  });
  const events = value.events.map((event): Event => {
    if (!object(event) || !integer(event.reviewedAt) || !integer(event.dueAt)) throw new Error("Invalid saved review event.");
    const { reviewedAt, dueAt, card, schedulerVersion: version, ...input } = event;
    if ((card === undefined) !== (version === undefined) || (version !== undefined && typeof version !== "string")) throw new Error("Invalid saved review snapshot.");
    const snapshot = card === undefined ? undefined : parseCard(card);
    if (snapshot === null || (snapshot && snapshot.due.getTime() !== dueAt)) throw new Error("Invalid saved review snapshot.");
    return { ...validateRating(input), reviewedAt, dueAt, ...(snapshot ? { card: snapshot, schedulerVersion: version as string } : {}) };
  });
  if (new Set(entries.map(e => e.noteId)).size !== entries.length ||
      new Set(events.map(e => e.operationId)).size !== events.length ||
      events.some(e => !entries.some(entry => entry.noteId === e.noteId))) throw new Error("Invalid duplicate or orphan review data.");
  return { version: 1, entries, events, settings: value.settings === undefined ? { ...DEFAULT_REVIEW_SETTINGS } : validateReviewSettings(value.settings) };
}

export class SpacedReviewService {
  private state: State;
  private path: string;
  private now: () => number;
  private failedImages = new Set<string>();
  constructor(private directory: string, private options: Options) {
    this.path = join(directory, "spaced-review.json");
    this.now = options.now ?? Date.now;
    try { this.state = parseState(JSON.parse(readFileSync(this.path, "utf8"))); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
      this.state = { version: 1, entries: [], events: [], settings: { ...DEFAULT_REVIEW_SETTINGS } };
    }
    this.prune();
  }
  private save(next: State) {
    mkdirSync(this.directory, { recursive: true });
    const data = JSON.stringify(next, null, 2) + "\n";
    if (this.options.persist) this.options.persist(this.path, data);
    else {
      writeFileSync(this.path + ".tmp", data, { encoding: "utf8", mode: 0o600 });
      renameSync(this.path + ".tmp", this.path);
    }
    this.state = next;
    this.changed();
  }
  changed() { this.options.onChanged?.(); }
  prune() {
    const entries = this.state.entries.filter(e => this.options.notes.get(e.noteId));
    if (entries.length !== this.state.entries.length) this.save({ ...this.state, entries,
      events: this.state.events.filter(event => entries.some(e => e.noteId === event.noteId)) });
  }
  private ensureEntries(notes: ReadingNote[]) {
    const known = new Set(this.state.entries.map(entry => entry.noteId));
    const added: Entry[] = notes.filter(note => note.trashedAt === undefined && !known.has(note.id))
      .map(note => ({ noteId: note.id, enrolledAt: note.createdAt, paused: false, version: 1, card: null }));
    if (added.length) this.save({ ...this.state, entries: [...this.state.entries, ...added] });
  }
  private imageAvailable(note: ReadingNote): boolean {
    const attachmentId = recallImage(note)?.attachmentId;
    if (!attachmentId || this.failedImages.has(attachmentId)) return false;
    try { return this.options.isImageAvailable ? this.options.isImageAvailable(attachmentId) : Boolean(this.options.readImage(attachmentId)); }
    catch { return false; }
  }
  status(noteId: string): NoteReviewStatus {
    id(noteId);
    const note = this.options.notes.get(noteId);
    if (note) this.ensureEntries([note]);
    const entry = this.state.entries.find(e => e.noteId === noteId);
    const reason = !note ? "Reading note not found." : note.trashedAt !== undefined ? "Notes in Trash cannot be reviewed." : undefined;
    return { enrolled: Boolean(entry), paused: entry?.paused ?? false, eligible: !reason, reason,
      dueAt: entry?.card?.due.getTime() ?? null };
  }
  details(noteId: string): NoteReviewDetails {
    const status = this.status(noteId);
    if (!this.options.notes.get(noteId)) throw new Error("Reading note not found.");
    const history = this.state.events.filter(event => event.noteId === noteId).reverse()
      .sort((a, b) => b.reviewedAt - a.reviewedAt)
      .map(({ operationId, reviewedAt, rating, dueAt, voiceReview }) => ({ operationId, reviewedAt, rating, dueAt, ...(voiceReview ? { voiceReview: structuredClone(voiceReview) } : {}) }));
    return { ...status, lastReviewedAt: history[0]?.reviewedAt ?? null,
      lastRating: history[0]?.rating ?? null, totalReviews: history.length, history };
  }
  enroll(noteId: string): NoteReviewStatus {
    const status = this.status(noteId);
    if (!status.eligible) throw new Error(status.reason);
    if (!status.enrolled) this.save({ ...this.state, entries: [...this.state.entries,
      { noteId, enrolledAt: this.now(), paused: false, version: 1, card: null }] });
    return this.status(noteId);
  }
  setPaused(noteId: string, paused: boolean): NoteReviewStatus {
    id(noteId);
    if (typeof paused !== "boolean") throw new Error("Invalid review pause state.");
    const note = this.options.notes.get(noteId);
    if (note) this.ensureEntries([note]);
    const entry = this.state.entries.find(e => e.noteId === noteId);
    if (!entry || !note || note.trashedAt !== undefined) throw new Error("Review card not found or unavailable.");
    if (!paused && !this.status(noteId).eligible) throw new Error(this.status(noteId).reason);
    if (entry.paused !== paused) this.save({ ...this.state, entries: this.state.entries.map(e =>
      e === entry ? { ...e, paused, version: e.version + 1 } : e) });
    return this.status(noteId);
  }
  settings(): ReviewSettings { return { ...this.state.settings }; }
  saveSettings(value: unknown): ReviewSettings {
    const settings = validateReviewSettings(value);
    this.save({ ...this.state, settings });
    return this.settings();
  }
  private selection(now: number) {
    const eligible = this.state.entries.filter(e => !e.paused && this.status(e.noteId).eligible);
    const info = reviewDaily(eligible, this.state.events, now);
    const ready = eligible.filter(e => !e.card || e.card.due.getTime() <= now)
      .sort((a, b) => (a.card?.due.getTime() ?? a.enrolledAt) - (b.card?.due.getTime() ?? b.enrolledAt) || a.noteId.localeCompare(b.noteId));
    const { dailyNewLimit, dailyDueLimit } = this.state.settings;
    const learning = ready.filter(e => info.states.get(e.noteId)?.learningKind &&
      (info.states.get(e.noteId)?.learningKind === "new" || dailyDueLimit > 0));
    const due = ready.filter(e => e.card && !info.states.get(e.noteId)?.learningKind)
      .slice(0, Math.max(0, dailyDueLimit - info.completedDue));
    const newCards = ready.filter(e => !e.card).slice(0, Math.max(0, dailyNewLimit - info.startedNew));
    return { eligible, info, ready, learning, due, newCards, queue: [...learning, ...due, ...newCards] };
  }
  summary(): ReviewSummary {
    this.prune();
    this.ensureEntries(this.options.notes.list());
    const now = this.now();
    const selected = this.selection(now);
    const future = selected.eligible.flatMap(e => e.card && e.card.due.getTime() > now ? [e.card.due.getTime()] : []);
    const nextDueAt = future.length ? Math.min(...future) : null;
    return { available: selected.queue.length, due: selected.due.length, newCards: selected.newCards.length,
      learning: selected.learning.length, backlog: selected.ready.length,
      daily: { ...this.settings(), startedNew: selected.info.startedNew, completedDue: selected.info.completedDue },
      activity: selected.info.activity, progress: memoryProgress(selected.eligible, selected.info, now),
      refreshAt: Math.min(midnightAfter(now), nextDueAt ?? Infinity, now + 60_000),
      enrolled: this.state.entries.length,
      paused: this.state.entries.filter(e => e.paused).length,
      unavailable: this.state.entries.filter(e => !e.paused && !this.status(e.noteId).eligible).length,
      nextDueAt };
  }
  next(): ReviewCard | null {
    this.prune();
    this.ensureEntries(this.options.notes.list());
    const now = this.now();
    const entry = this.selection(now).queue[0];
    if (!entry) return null;
    const note = this.options.notes.get(entry.noteId)!;
    const attachmentId = recallImage(note)?.attachmentId;
    let recallUrl: string | undefined;
    if (attachmentId && this.imageAvailable(note)) {
      try { recallUrl = this.options.readImage(attachmentId) || undefined; }
      catch { this.failedImages.add(attachmentId); }
    }
    const intervals = Object.fromEntries(REVIEW_RATINGS.map(rating => [rating,
      scheduler.next(entry.card ?? createEmptyCard(new Date(now)), new Date(now), ratings[rating]).card.due.getTime()
    ])) as Record<ReviewRating, number>;
    return { note, scheduleVersion: entry.version, recallAttachmentId: recallUrl ? attachmentId : undefined, recallUrl, intervals };
  }
  validateVoiceSource(input: { noteId: string; noteRevision: number; scheduleVersion: number }): ReadingNote {
    this.ensureEntries(this.options.notes.list());
    const note = this.options.notes.get(input.noteId);
    const entry = this.state.entries.find(e => e.noteId === input.noteId);
    if (!note || note.revision !== input.noteRevision || entry?.version !== input.scheduleVersion ||
        !this.selection(this.now()).queue.some(e => e.noteId === input.noteId)) {
      throw new Error("The card or schedule changed. Reload the card and recall it again.");
    }
    return note;
  }
  rate(value: RateReviewInput): ReviewResult {
    const input = validateRating(value);
    const existing = this.state.events.find(e => e.operationId === input.operationId);
    if (existing) {
      if (["noteId", "noteRevision", "scheduleVersion", "rating"].some(key =>
        existing[key as keyof RateReviewInput] !== input[key as keyof RateReviewInput]) || JSON.stringify(existing.voiceReview) !== JSON.stringify(input.voiceReview)) throw new Error("This rating ID is already used by another operation.");
      return { operationId: existing.operationId, noteId: existing.noteId, dueAt: existing.dueAt };
    }
    const note = this.options.notes.get(input.noteId);
    const entry = this.state.entries.find(e => e.noteId === input.noteId);
    const now = this.now();
    if (!note || !entry || entry.paused || !this.status(input.noteId).eligible ||
      note.revision !== input.noteRevision || entry.version !== input.scheduleVersion ||
      (entry.card && entry.card.due.getTime() > now) || !this.selection(now).queue.some(e => e.noteId === input.noteId)) throw new Error("The card, schedule, or daily limits have changed. Reload the card and recall it again.");
    const card = scheduler.next(entry.card ?? createEmptyCard(new Date(now)), new Date(now), ratings[input.rating]).card;
    const event = { ...input, reviewedAt: now, dueAt: card.due.getTime(), card, schedulerVersion };
    this.save({ ...this.state, entries: this.state.entries.map(e => e === entry ? { ...e, version: e.version + 1, card } : e),
      events: [...this.state.events, event] });
    return { operationId: input.operationId, noteId: input.noteId, dueAt: event.dueAt };
  }
  imageFailed(noteId: string, attachmentId: string) {
    id(noteId); id(attachmentId);
    if (recallImage(this.options.notes.get(noteId))?.attachmentId !== attachmentId) return;
    this.failedImages.add(attachmentId);
    this.changed();
  }
  retryImages() { this.failedImages.clear(); this.changed(); }
}
