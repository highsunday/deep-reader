import { expect, test } from "vitest";
import { createEmptyCard } from "ts-fsrs";
import { dayKey, midnightAfter, memoryProgress, reviewDaily, type ReviewEntry, type ReviewEvent } from "../src/main/review-progress";

const now = new Date(2026, 8, 22, 12).getTime();
const day = 86400_000;
function fixture() {
  const events: ReviewEvent[] = [now - 2 * day, now - day].map((time, index) => {
    const card = { ...createEmptyCard(new Date(time)), last_review: new Date(time), stability: 40, difficulty: 3, reps: index + 1,
      due: new Date(time + 30 * day), state: 2 };
    return { noteId: "n", operationId: String(index), noteRevision: 1, scheduleVersion: index + 1, rating: "good",
      reviewedAt: time, dueAt: card.due.getTime(), card, schedulerVersion: "test-fixture" };
  });
  const entries: ReviewEntry[] = [{ noteId: "n", enrolledAt: now - 3 * day, paused: false, version: 3, card: events[1].card! }];
  return { entries, events, result: (at = now) => memoryProgress(entries, reviewDaily(entries, events, at), at) };
}

test("F38 TC11: solid requires successful ratings on two days, stability 30 and retrievability .85", () => {
  const f = fixture();
  expect(f.result()).toMatchObject({ solid: 1, building: 0, delta30Days: 1, recallRate: 100, recallReviews: 1 });
  expect(f.result().daily).toHaveLength(90);
  expect(f.result().daily[0].solid).toBe(0);
  expect(f.result().daily.at(-2)?.solid).toBe(1);
  expect(f.result(now + 120 * day).solid).toBe(0);
  f.events[1].rating = "hard"; expect(f.result().solid).toBe(0);
  f.events[1].rating = "good";
  f.events[1].card!.stability = 29; expect(f.result().solid).toBe(0);
  f.events[1].card!.stability = 30; expect(f.result().solid).toBe(1);
  f.events[0].reviewedAt = f.events[1].reviewedAt - 1000; expect(f.result().solid).toBe(0);
});

test("F38 TC12/13: activity and recall success are separate; no later events leak into earlier evaluations", () => {
  const f = fixture();
  expect(reviewDaily(f.entries, f.events, now - 1.5 * day)).toMatchObject({ recallRate: null, recallReviews: 0 });
  f.events[1].rating = "hard";
  const daily = reviewDaily(f.entries, f.events, now);
  expect(daily).toMatchObject({ recallRate: 0, recallReviews: 1, activity: { activeDays: 2, completedReviews: 2 } });
  expect(daily.activity.daily.at(-2)).toMatchObject({ newCompleted: 0, dueCompleted: 1 });
  expect(daily.activity.daily.at(-3)).toMatchObject({ newCompleted: 1, dueCompleted: 0 });
});

test("F38 TC14: unverified legacy history is unknown, while current saved card remains usable", () => {
  const f = fixture();
  f.events.forEach(event => { delete event.card; delete event.schedulerVersion; });
  expect(f.result()).toMatchObject({ solid: 1, historyIncomplete: true });
  expect(f.result().daily.at(-2)?.solid).toBeNull();
  expect(f.result().daily.at(-4)?.solid).toBe(0);
  expect(f.result().daily.at(-1)?.solid).toBe(1);
});

test("F38 TC7: local dates and midnight boundaries use calendar days", () => {
  expect(dayKey(new Date(2026, 8, 22, 23, 59).getTime())).toBe("2026-09-22");
  expect(midnightAfter(new Date(2026, 8, 22, 23, 59).getTime())).toBe(new Date(2026, 8, 23).getTime());
});
