import { createEmptyCard, fsrs, Rating, type Card } from "ts-fsrs";
import type { RateReviewInput, ReviewProgress, ReviewActivity } from "../shared/spaced-review";

export const scheduler = fsrs({ request_retention: 0.9 });
export const schedulerVersion = "ts-fsrs@5.4.1/retention-0.9/default";
export const ratings = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy } as const;
export interface ReviewEntry { noteId: string; enrolledAt: number; paused: boolean; version: number; card: Card | null }
export interface ReviewEvent extends RateReviewInput { reviewedAt: number; dueAt: number; card?: Card; schedulerVersion?: string }
export function dayKey(time: number) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function midnightAfter(time: number) {
  const date = new Date(time); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + 1); return date.getTime();
}
function dayOffset(time: number, offset: number) {
  const date = new Date(time); date.setDate(date.getDate() + offset); return date.getTime();
}
function sameCard(a: Card | null, b: Card | null) {
  if (!a || !b) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(key => {
    const left = a[key as keyof Card], right = b[key as keyof Card];
    return left instanceof Date && right instanceof Date ? left.getTime() === right.getTime() : left === right;
  });
}
export interface LearningState { completedNew: boolean; learningKind: "new" | "due" | null }
export function reviewDaily(entries: ReviewEntry[], events: ReviewEvent[], now: number) {
  const active = new Set(entries.map(entry => entry.noteId));
  // Stable sort preserves the persisted order when timestamps are equal.
  const rows = events.filter(event => active.has(event.noteId) && event.reviewedAt <= now)
    .sort((a, b) => a.reviewedAt - b.reviewedAt);
  const states = new Map<string, LearningState>();
  const byNote = new Map<string, ReviewEvent[]>();
  const daily = Array.from({ length: 30 }, (_, i) => ({ date: dayKey(dayOffset(now, i - 29)), newCompleted: 0, dueCompleted: 0 }));
  const days = new Map(daily.map(day => [day.date, day]));
  let startedNew = 0, completedDue = 0, recallReviews = 0, successful = 0;
  for (const event of rows) {
    const date = dayKey(event.reviewedAt);
    const previous = byNote.get(event.noteId) ?? [];
    if (!previous.length && date === dayKey(now)) startedNew++;
    if (previous.length && days.has(date)) { recallReviews++; if (["good", "easy"].includes(event.rating)) successful++; }
    previous.push(event); byNote.set(event.noteId, previous);
    const state = states.get(event.noteId) ?? { completedNew: false, learningKind: null };
    const kind = state.completedNew ? "due" : "new";
    if (dayKey(event.dueAt) > date) {
      state.completedNew = true; state.learningKind = null;
      const day = days.get(date);
      if (day) { if (kind === "new") day.newCompleted++; else day.dueCompleted++; }
      if (kind === "due" && date === dayKey(now)) completedDue++;
    } else state.learningKind = kind;
    states.set(event.noteId, state);
  }
  const activity: ReviewActivity = { daily, completedReviews: daily.reduce((sum, day) => sum + day.newCompleted + day.dueCompleted, 0),
    activeDays: daily.filter(day => day.newCompleted + day.dueCompleted > 0).length };
  return { states, byNote, startedNew, completedDue, activity, recallReviews,
    recallRate: recallReviews ? Math.round(successful / recallReviews * 100) : null };
}

export function memoryProgress(entries: ReviewEntry[], info: ReturnType<typeof reviewDaily>, now: number): ReviewProgress {
  const histories = entries.map(entry => {
    const events = info.byNote.get(entry.noteId) ?? [];
    let previous: Card | null = null, valid = true;
    const snapshots = events.map(event => {
      if (event.card) { previous = event.card; return event.card; }
      try {
        const replay = scheduler.next(previous ?? createEmptyCard(new Date(event.reviewedAt)), new Date(event.reviewedAt), ratings[event.rating]).card;
        if (replay.due.getTime() !== event.dueAt) valid = false;
        previous = replay; return replay;
      } catch { valid = false; return null; }
    });
    if (!sameCard(previous, entry.card)) valid = false;
    return { entry, events, snapshots: snapshots.map((card, i) => events[i].card ?? (valid ? card : null)) };
  });
  function countAt(at: number, current = false): number | null {
    let count = 0, unknown = false;
    for (const history of histories) {
      const last = history.events.findLastIndex(event => event.reviewedAt <= at);
      if (last < 0) continue;
      const event = history.events[last];
      const card = current ? history.entry.card : history.snapshots[last];
      if (!card) { unknown = true; continue; }
      const successes = new Set(history.events.slice(0, last + 1).filter(event => ["good", "easy"].includes(event.rating)).map(event => dayKey(event.reviewedAt)));
      if (["good", "easy"].includes(event.rating) && successes.size >= 2 && card.stability >= 30 &&
          scheduler.get_retrievability(card, new Date(at), false) >= .85) count++;
    }
    return unknown ? null : count;
  }
  const solid = countAt(now, true) ?? 0;
  const comparison = countAt(dayOffset(now, -30));
  const daily = Array.from({ length: 90 }, (_, i) => {
    const date = dayOffset(now, i - 89);
    return { date: dayKey(date), solid: i === 89 ? solid : countAt(midnightAfter(date) - 1) };
  });
  return { solid, building: Math.max(0, info.byNote.size - solid), delta30Days: comparison === null ? null : solid - comparison,
    recallRate: info.recallRate, recallReviews: info.recallReviews, daily,
    historyIncomplete: histories.some(history => history.snapshots.some(card => !card)) };
}
