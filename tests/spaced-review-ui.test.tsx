// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { ReadingNoteList } from "../src/renderer/ReadingNoteLibrary";
import { AccountSettings, BookShelf } from "../src/renderer/App";

import { SpacedReviewWorkspace } from "../src/renderer/SpacedReviewWorkspace";
import { ReadingNoteReviewControl } from "../src/renderer/ReadingNoteReviewControl";
import { ReadingNoteReviewSchedule } from "../src/renderer/ReadingNoteReviewSchedule";
import { useReviewSummary } from "../src/renderer/use-review-summary";
import type { ReaderDesktopApi, ReadingNote } from "../src/shared/contracts";
import type { ReviewCard, ReviewSummary, SpacedReviewApi } from "../src/shared/spaced-review";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import userEvent from "@testing-library/user-event";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) });
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  globalThis.IntersectionObserver = class { readonly root = null; readonly rootMargin = ""; readonly thresholds = []; observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
const note: ReadingNote = { id: "n1", sourceDraftId: "d1", title: "Answer title", revision: 2, createdAt: 1, updatedAt: 2,
  bookTitle: "Book", chapterTitle: "Chapter", content: markdownToReadingNoteDocument("The correction arrives too late.\n\n| Cause | Effect |\n| --- | --- |\n| Delay | Overshoot |"),
  memoryImages: { recall: { attachmentId: "recall-1", basedOnRevision: 1 }, understand: { attachmentId: "front-1", basedOnRevision: 1 } } };
note.content.blocks.push({ id: "table-1", type: "table", props: {}, children: [], content: {
  type: "tableContent", columnWidths: [null, null], rows: [{ cells: [[{ type: "text", text: "Delay", styles: {} }], [{ type: "text", text: "Overshoot", styles: {} }]] }]
} });
const summary: ReviewSummary = {
  daily: { dailyNewLimit: 10, dailyDueLimit: 50, startedNew: 3, completedDue: 12 },
  learning: 0, backlog: 2, refreshAt: Date.now() + 60_000,
  progress: { solid: 18, building: 24, delta30Days: 6, recallRate: 82, recallReviews: 50, historyIncomplete: false,
    daily: [{ date: "2026-09-21", solid: 12 }, { date: "2026-09-22", solid: 18 }] },
  activity: { completedReviews: 15, activeDays: 1, daily: [{ date: "2026-09-22", newCompleted: 3, dueCompleted: 12 }] },
  available: 2, newCards: 2, due: 0, enrolled: 2, paused: 0, unavailable: 0, nextDueAt: null };
function fixture() {
  let listener = () => {};
  const first: ReviewCard = { note, scheduleVersion: 1, recallAttachmentId: "recall-1", recallUrl: "data:image/png;base64,AA==",
    intervals: { again: Date.now() + 60_000, hard: Date.now() + 300_000, good: Date.now() + 600_000, easy: Date.now() + 86_400_000 } };
  const second: ReviewCard = { ...first, note: { ...note, id: "n2", title: "Second answer", memoryImages: { recall: note.memoryImages!.recall } }, recallAttachmentId: "recall-2" };
  const review = {
    settings: vi.fn(async () => ({ dailyNewLimit: 10, dailyDueLimit: 50 })),
    saveSettings: vi.fn(async (input: import("../src/shared/spaced-review").ReviewSettings) => input),
    summary: vi.fn(async () => summary), status: vi.fn(async () => ({ enrolled: false, paused: false, eligible: true, dueAt: null })),
    details: vi.fn(async (_noteId: string) => ({ enrolled: true, paused: false, eligible: true, dueAt: null,
      lastReviewedAt: null, lastRating: null, totalReviews: 0, history: [] } as import("../src/shared/spaced-review").NoteReviewDetails)),
    enroll: vi.fn(async () => ({ enrolled: true, paused: false, eligible: true, dueAt: null })),
    setPaused: vi.fn(async (_id: string, paused: boolean) => ({ enrolled: true, paused, eligible: true, dueAt: null })),
    next: vi.fn<() => Promise<ReviewCard | null>>().mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValue(null),
    rate: vi.fn(async (input) => ({ operationId: input.operationId, noteId: input.noteId, dueAt: Date.now() + 600_000 })),
    imageFailed: vi.fn(async () => {}), retryImages: vi.fn(async () => {}), onChanged: vi.fn((fn: () => void) => { listener = fn; return () => {}; }) } satisfies SpacedReviewApi;
  const api = { review, attachments: { readDataUrl: vi.fn(async () => "data:image/png;base64,AQ==") } } as unknown as ReaderDesktopApi["readingNotes"];
  const refresh = vi.fn(async () => {}); const onNotes = vi.fn();
  const props = { api, summary, summaryError: "", refresh, onNotes };
  return { review, api, props, first, second, emit: () => listener() };
}
async function reveal() {
  await waitFor(() => expect(screen.queryByAltText("Recall image")).not.toBeNull());
  fireEvent.load(screen.getByAltText("Recall image"));
  fireEvent.click(screen.getAllByRole("button", { name: "Show answer" }).at(-1)!);
  await waitFor(() => expect(screen.queryByRole("button", { name: /^Good/ })).not.toBeNull());
}

test("F37 review navigation displays the same available count and opens review", () => {
  const onModeChange = vi.fn();
  const props = { books: [], onSelect: vi.fn(), onModeChange, reviewCount: 12, reviewEnabled: true };
  render(<BookShelf {...props} />);
  const button = screen.getByRole("button", { name: /^Review/ });
  expect(button.textContent).toContain("12");
  fireEvent.click(button);
  expect(onModeChange).toHaveBeenCalledWith("spaced-review");
});

test("F37 TC4/13: back hides answers; flipping reveals rich content and ratings; next card always starts on back", async () => {
  const f = fixture(); render(<SpacedReviewWorkspace {...f.props} />);
  expect(f.review.next).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start review" }));
  await screen.findByAltText("Recall image");
  expect(screen.queryByText(note.title)).toBeNull();
  expect(screen.queryByText("The correction arrives too late.")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Good/ })).toBeNull();
  expect(f.api.attachments.readDataUrl).not.toHaveBeenCalled();
  await reveal();
  expect(screen.getByText(note.title)).toBeTruthy();
  expect(screen.getByText("The correction arrives too late.")).toBeTruthy();
  expect(screen.getByRole("table")).toBeTruthy();
  await screen.findByAltText("Understanding image");
  expect(screen.getByRole("textbox").getAttribute("contenteditable")).toBe("false");
  expect(f.review.rate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Back to recall" }));
  expect(screen.queryByText(note.title)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
  await waitFor(() => expect(f.review.next).toHaveBeenCalledTimes(2));
  expect(f.review.rate).toHaveBeenCalledWith(expect.objectContaining({ noteId: "n1", noteRevision: 2, scheduleVersion: 1, rating: "good" }));
  expect(screen.queryByText("Second answer")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Good/ })).toBeNull();
  await reveal();
  expect(screen.getByText("Second answer")).toBeTruthy();
  expect(screen.queryByAltText("Understanding image")).toBeNull();
});

test("F37 TC10: rating failure preserves face and rating; retry uses the same operation without double submission", async () => {
  const f = fixture();
  f.review.rate.mockRejectedValueOnce(new Error("Disk full"));
  render(<SpacedReviewWorkspace {...f.props} />);
  fireEvent.click(screen.getByRole("button", { name: "Start review" })); await reveal();
  fireEvent.click(screen.getByRole("button", { name: /^Hard/ }));
  await screen.findByText("Disk full");
  expect(screen.getByText(note.title)).toBeTruthy();
  expect(f.review.next).toHaveBeenCalledTimes(1);
  const input = f.review.rate.mock.calls[0][0];
  const retry = screen.getByRole("button", { name: "Retry saving rating" });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() => expect(f.review.next).toHaveBeenCalledTimes(2));
  expect(f.review.rate).toHaveBeenCalledTimes(2);
  expect(f.review.rate.mock.calls[1][0]).toEqual(input);
});

test("F37 TC6/7: leaving an ungraded answer saves nothing and starts again at back", async () => {
  const f = fixture(); render(<SpacedReviewWorkspace {...f.props} />);
  fireEvent.click(screen.getByRole("button", { name: "Start review" })); await reveal();
  fireEvent.click(screen.getByRole("button", { name: "Leave review" }));
  expect(f.review.rate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start review" }));
  await screen.findByAltText("Recall image");
  expect(screen.queryByText("Second answer")).toBeNull();
});

test.each([false, true])("F37 TC18: missing image or decoding failure (%s) shows title and permits reveal and rating", async (decodeFailure) => {
  const f = fixture();
  if (!decodeFailure) f.review.next.mockReset().mockResolvedValueOnce({ ...f.first, recallUrl: undefined, recallAttachmentId: undefined }).mockResolvedValue(null);
  render(<SpacedReviewWorkspace {...f.props} />);
  fireEvent.click(screen.getByRole("button", { name: "Start review" }));
  if (decodeFailure) fireEvent.error(await screen.findByAltText("Recall image"));
  await screen.findByText(note.title);
  expect(screen.queryByText("The correction arrives too late.")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Good/ })).toBeNull();
  fireEvent.click(screen.getAllByRole("button", { name: "Show answer" }).at(-1)!);
  await screen.findByText("The correction arrives too late.");
  fireEvent.click(screen.getByRole("button", { name: /^Good/ }));
  await waitFor(() => expect(f.review.rate).toHaveBeenCalledOnce());
});

test("F37 TC1/2/8: note menu joins, pauses and resumes without needing an understanding image", async () => {
  const f = fixture(); render(<ReadingNoteReviewControl api={f.review} note={note} />);
  const join = await screen.findByRole("switch", { name: "Add to review" });
  await waitFor(() => expect((join as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(join);
  fireEvent.click(await screen.findByRole("switch", { name: "Pause review" }));
  fireEvent.click(await screen.findByRole("switch", { name: "Resume review" }));
  await screen.findByRole("switch", { name: "Pause review" });
  expect(f.review.enroll).toHaveBeenCalledWith(note.id);
  expect(f.review.setPaused.mock.calls).toEqual([[note.id, true], [note.id, false]]);
});

test("F37 TC17: image-free note is enabled and can pause or resume", async () => {
  const f = fixture();
  f.review.status.mockResolvedValue({ enrolled: true, paused: false, eligible: true, dueAt: null });
  render(<ReadingNoteReviewControl api={f.review} note={{ ...note, memoryImages: undefined }} />);
  fireEvent.click(await screen.findByRole("switch", { name: "Pause review" }));
  fireEvent.click(await screen.findByRole("switch", { name: "Resume review" }));
  await screen.findByRole("switch", { name: "Pause review" });
  expect(f.review.setPaused.mock.calls).toEqual([[note.id, true], [note.id, false]]);
});

test("F37 TC14: empty, waiting and failed summary states remain distinct", async () => {
  const f = fixture();
  const view = render(<SpacedReviewWorkspace {...f.props} summary={{ ...summary, available: 0, enrolled: 0, newCards: 0 }} />);
  expect(screen.getByText(/Saved reading notes/)).toBeTruthy();
  view.rerender(<SpacedReviewWorkspace {...f.props} summary={{ ...summary, available: 0, backlog: 0, newCards: 0, nextDueAt: Date.now() + 3600_000, paused: 1, unavailable: 1 }} />);
  expect(screen.getByText(/Next review/)).toBeTruthy();
  view.rerender(<SpacedReviewWorkspace {...f.props} summary={undefined} summaryError="讀取失敗" />);
  expect(screen.getByRole("alert").textContent).toContain("讀取失敗");
  expect(screen.queryByText("No cards are ready to review")).toBeNull();
});

test("F37 TC5: after the last rating, completion is shown with the next due time", async () => {
  const f = fixture(); f.review.next.mockReset().mockResolvedValueOnce(f.first).mockResolvedValue(null);
  const view = render(<SpacedReviewWorkspace {...f.props} />);
  fireEvent.click(screen.getByRole("button", { name: "Start review" })); await reveal();
  fireEvent.click(screen.getByRole("button", { name: /^Easy/ }));
  await waitFor(() => expect(f.review.next).toHaveBeenCalledTimes(2));
  view.rerender(<SpacedReviewWorkspace {...f.props} summary={{ ...summary, available: 0, backlog: 0, newCards: 0, nextDueAt: Date.now() + 600_000 }} />);
  await screen.findByText("All currently available reviews are complete");
  expect(screen.getByText("1 rating saved this session")).toBeTruthy();
});

test("F37 TC9: keyboard can reveal and rate", async () => {
  const user = userEvent.setup(); const f = fixture(); render(<SpacedReviewWorkspace {...f.props} />);
  await user.click(screen.getByRole("button", { name: "Start review" }));
  fireEvent.load(await screen.findByAltText("Recall image"));
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Show answer"));
  await user.keyboard("{Enter}");
  const rate = screen.getByRole("button", { name: /^Good/ }); rate.focus(); await user.keyboard("{Enter}");
  await waitFor(() => expect(f.review.rate).toHaveBeenCalledOnce());
});

test("F37 TC2: summary refreshes after a change and focus; stale responses cannot replace newer counts", async () => {
  const f = fixture();
  function Harness() { const state = useReviewSummary(f.review); return <p>{state.error || state.summary?.available || "loading"}</p>; }
  render(<Harness />); await screen.findByText("2");
  let resolve!: (value: ReviewSummary) => void;
  f.review.summary.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  f.emit();
  f.review.summary.mockResolvedValue({ ...summary, available: 9 });
  fireEvent.focus(window); await screen.findByText("9");
  await act(async () => resolve({ ...summary, available: 3 }));
  await waitFor(() => expect(screen.queryByText("3")).toBeNull());
});

test("F37 TC6: reaching the precise due time automatically refreshes the available count", async () => {
  vi.useFakeTimers();
  const f = fixture(); const now = Date.now();
  f.review.summary.mockResolvedValueOnce({ ...summary, available: 0, nextDueAt: now + 1000 })
    .mockResolvedValue({ ...summary, available: 1, due: 1, nextDueAt: null });
  function Harness() { const state = useReviewSummary(f.review); return <p>可複習：{state.summary?.available ?? "loading"}</p>; }
  await act(async () => { render(<Harness />); });
  expect(screen.getByText("可複習：0")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(999); });
  expect(f.review.summary).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(22); });
  expect(screen.getByText("可複習：1")).toBeTruthy();
});


test("F37 library cards show enrollment status and update after review changes", async () => {
  const f = fixture();
  const onOpen = vi.fn();
  render(<ReadingNoteList view="active" notes={[note]} mutating={false} onOpen={onOpen} onRestore={vi.fn()} reviewApi={f.review} />);
  await screen.findByRole("img", { name: "Not enrolled" });
  f.review.status.mockResolvedValue({ enrolled: true, paused: false, eligible: true, dueAt: null });
  await act(async () => f.emit());
  await screen.findByRole("img", { name: "Enrolled" });
  f.review.status.mockResolvedValue({ enrolled: true, paused: true, eligible: true, dueAt: null });
  await act(async () => f.emit());
  await screen.findByRole("img", { name: "Paused" });
  expect(onOpen).not.toHaveBeenCalled();
  const lamp = screen.getByRole("img", { name: "Paused" });
  expect(lamp.closest("button")).toBeNull();
  expect(lamp.parentElement?.className).toBe("reading-note-card-container");
  expect(screen.queryByText("Paused")).toBeNull();
  expect(screen.queryByRole("switch")).toBeNull();
});

test("F37 direct toggle retains enrollment on failed pause and has no dropdown", async () => {
  const f = fixture();
  f.review.status.mockResolvedValue({ enrolled: true, paused: false, eligible: true, dueAt: null });
  f.review.setPaused.mockRejectedValueOnce(new Error("保存失敗"));
  const { container } = render(<ReadingNoteReviewControl api={f.review} note={note} />);
  const toggle = await screen.findByRole("switch", { name: "Pause review" });
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector("details")).toBeNull();
  fireEvent.click(toggle);
  await screen.findByText("保存失敗");
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

test("F37 library status failure is never shown as not enrolled", async () => {
  const f = fixture(); f.review.status.mockRejectedValue(new Error("Offline"));
  render(<ReadingNoteReviewControl api={f.review} note={note} displayOnly />);
  await screen.findByRole("img", { name: "Review status unavailable" });
  expect(screen.queryByText("Not enrolled")).toBeNull();
});

test("note schedule shows saved summary, expands history, and refreshes after a review change", async () => {
  const f = fixture(); const user = userEvent.setup();
  const reviewedAt = Date.parse("2026-09-12T08:44:00Z");
  const dueAt = Date.parse("2026-09-17T08:44:00Z");
  f.review.details.mockResolvedValue({ enrolled: true, paused: false, eligible: true, dueAt,
    lastReviewedAt: reviewedAt, lastRating: "easy", totalReviews: 1,
    history: [{ operationId: "one", reviewedAt, dueAt, rating: "easy" }] });
  const { container } = render(<ReadingNoteReviewSchedule api={f.review} noteId={note.id} />);
  await screen.findByText("Scheduled");
  expect(container.querySelector('time')?.dateTime).toBe(new Date(reviewedAt).toISOString());
  expect(screen.getByText("1")).toBeTruthy();
  expect(container.querySelector("details")?.open).toBe(false);
  await user.click(screen.getByText("View review history"));
  expect(container.querySelector("details")?.open).toBe(true);
  expect(screen.getByRole("table").textContent).toContain("Easy");
  f.review.details.mockResolvedValue({ enrolled: true, paused: true, eligible: true, dueAt,
    lastReviewedAt: reviewedAt, lastRating: "easy", totalReviews: 1,
    history: [{ operationId: "one", reviewedAt, dueAt, rating: "easy" }] });
  await act(async () => f.emit());
  await screen.findByText("Paused");
  expect(screen.getByText("Previously due")).toBeTruthy();
  expect(screen.getByRole("table")).toBeTruthy();
});

test("note schedule distinguishes new notes from failures, retries, and ignores stale responses", async () => {
  const f = fixture();
  f.review.details.mockRejectedValueOnce(new Error("Disk unavailable"));
  const view = render(<ReadingNoteReviewSchedule api={f.review} noteId={note.id} />);
  await screen.findByText("Disk unavailable");
  expect(screen.queryByText("0")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Not reviewed yet");
  expect(screen.getByText("Ready now")).toBeTruthy();
  const empty = await f.review.details(note.id);
  let resolve!: (value: typeof empty) => void;
  f.review.details.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => f.emit());
  view.rerender(<ReadingNoteReviewSchedule api={f.review} noteId="other-note" />);
  await waitFor(() => expect(f.review.details).toHaveBeenLastCalledWith("other-note"));
  await act(async () => resolve({ ...empty, paused: true, totalReviews: 99 }));
  expect(screen.queryByText("99")).toBeNull();
  expect(screen.getByText("Not reviewed yet")).toBeTruthy();
});

test("clicking the understanding image returns to recall without rating and supports keyboard activation", async () => {
  const f = fixture(); const user = userEvent.setup();
  render(<SpacedReviewWorkspace {...f.props} />);
  await user.click(screen.getByRole("button", { name: "Start review" }));
  await reveal();
  const image = await screen.findByAltText("Understanding image");
  expect(screen.queryByRole("button", { name: "Enlarge understanding image" })).toBeNull();
  fireEvent.click(image);
  expect(screen.getByRole("article", { name: "Recall side" })).toBeTruthy();
  expect(screen.queryByAltText("Understanding image")).toBeNull();
  expect(screen.getByRole("button", { name: /^Good/ })).toBeTruthy();
  await reveal();
  const flip = await screen.findByRole("button", { name: "Click image to return to recall" });
  flip.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("article", { name: "Recall side" })).toBeTruthy();
  expect(f.review.rate).not.toHaveBeenCalled();
  expect(f.review.next).toHaveBeenCalledTimes(1);
});


test("F38 TC15: home displays daily volume, memory results, trend, activity and settings entry", () => {
  const f = fixture(); const onSettings = vi.fn();
  render(<SpacedReviewWorkspace {...f.props} onSettings={onSettings} />);
  expect(screen.getByRole("region", { name: "Today's progress" }).textContent).toContain("3");
  expect(screen.getByRole("region", { name: "Learning progress" }).textContent).toContain("18");
  expect(screen.getByRole("img", { name: /90-day solid recall trend/ }).closest("details")).toBeNull();
  expect(screen.queryByText("View daily trend data")).toBeNull();
  expect(screen.queryByText("Queue details")).toBeNull();
  expect(screen.getByRole("img", { name: /90-day solid recall trend/ })).toBeTruthy();
  expect(screen.getByRole("region", { name: "30-day review activity" }).textContent).toContain("15");
  fireEvent.click(screen.getByRole("button", { name: "Adjust daily limits" }));
  expect(onSettings).toHaveBeenCalledOnce();
});

test("F38 TC1/2/15/17: settings tab validates, retries save failures, and supports keyboard navigation", async () => {
  const f = fixture();
  render(<AccountSettings snapshot={{ connection: "ready" } as never} review={f.review} onReconnect={() => {}} onClose={() => {}} />);
  fireEvent.keyDown(screen.getByRole("tab", { name: "Account" }), { key: "End" });
  const tab = screen.getByRole("tab", { name: "Spaced Review" });
  expect(document.activeElement).toBe(tab);
  const newLimit = await screen.findByLabelText("Daily new-card limit");
  await waitFor(() => expect((newLimit as HTMLInputElement).value).toBe("10"));
  fireEvent.change(newLimit, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Save study limits" }));
  expect(f.review.saveSettings).not.toHaveBeenCalled();
  fireEvent.change(newLimit, { target: { value: "20" } });
  f.review.saveSettings.mockRejectedValueOnce(new Error("Disk full"));
  fireEvent.click(screen.getByRole("button", { name: "Save study limits" }));
  await screen.findByText("Disk full");
  fireEvent.click(screen.getByRole("button", { name: "Save study limits" }));
  await screen.findByText("Daily study limits saved.");
  expect(f.review.saveSettings).toHaveBeenLastCalledWith({ dailyNewLimit: 20, dailyDueLimit: 50 });
});

test("F38 TC16: refresh occurs at midnight without a next due card", async () => {
  vi.useFakeTimers();
  const f = fixture();
  f.review.summary.mockResolvedValue({ ...summary, available: 0, nextDueAt: null, refreshAt: Date.now() + 1000 });
  function Summary() { useReviewSummary(f.review); return null; }
  render(<Summary />);
  await act(async () => {});
  expect(f.review.summary).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
  expect(f.review.summary).toHaveBeenCalledTimes(2);
});

test("F38 TC15: limits, paused categories, unknown history and empty recall data are explicit", () => {
  const f = fixture();
  const view = render(<SpacedReviewWorkspace {...f.props} summary={{ ...summary, available: 0,
    daily: { ...summary.daily, dailyNewLimit: 0, dailyDueLimit: 0 },
    progress: { ...summary.progress, recallRate: null, historyIncomplete: true, delta30Days: null,
      daily: [{ date: "2026-09-21", solid: null }, { date: "2026-09-22", solid: 0 }] } }} />);
  expect(screen.getByText("Daily limits reached or reviews paused")).toBeTruthy();
  expect(screen.getByText("No follow-up reviews yet")).toBeTruthy();
  expect(screen.getByText(/Some older records could not be verified/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Start review" })).toBeNull();
  view.rerender(<SpacedReviewWorkspace {...f.props} summary={{ ...summary, enrolled: 0, available: 0, backlog: 0 }} />);
  expect(screen.getByText("Start collecting ideas worth remembering")).toBeTruthy();
});

function voiceFixture(answered = true) {
  const f = fixture();
  let listener: (s: import("../src/shared/review-voice").ReviewVoiceSnapshot) => void = () => {};
  let discussionId = "";
  const result: import("../src/shared/review-voice").VoiceReviewAssessment = {
    suggestedRecall: "again", suggestedUnderstanding: "understood", recallReason: "Needed help at first.",
    understandingReason: "Explained the core after discussion.", summary: "Delays explain the overshoot."
  };
  const track = { enabled: true, stop: vi.fn() };
  const pc = { connectionState: "new", onconnectionstatechange: null as (() => void) | null, ontrack: null,
    addTrack: vi.fn(), createDataChannel: () => ({ close: vi.fn() }), createOffer: async () => ({ type: "offer", sdp: "v=0\r\nm=audio 9\r\n" }),
    setLocalDescription: async () => {}, setRemoteDescription: async () => { pc.connectionState = "connected"; pc.onconnectionstatechange?.(); }, close: vi.fn() };
  vi.stubGlobal("RTCPeerConnection", function() { return pc; });
  vi.stubGlobal("Audio", function() { return { play: async () => {}, pause() {}, remove() {}, srcObject: null }; });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getAudioTracks: () => [track], getTracks: () => [track] })) } });
  const voice: import("../src/shared/review-voice").ReviewVoiceApi = {
    start: vi.fn(async input => {
      discussionId = input.context.discussionId;
      listener({ discussionId, voice: { phase: "active", sessionId: input.sessionId }, hasAnswer: answered, assessing: false });
      return { sessionId: input.sessionId, sdp: "v=0\r\nm=audio 10\r\n" };
    }), stop: vi.fn(async () => {}), assess: vi.fn(async () => result), discard: vi.fn(async () => {}),
    onChanged: fn => { listener = fn; return () => {}; }
  };
  (f.review as SpacedReviewApi).voice = voice;
  return { ...f, voice, track, result };
}
async function beginVoice(f: ReturnType<typeof voiceFixture>, strict = false) {
  const view = render(strict ? <StrictMode><SpacedReviewWorkspace {...f.props} /></StrictMode> : <SpacedReviewWorkspace {...f.props} />);
  fireEvent.click(screen.getByRole("button", { name: "Start review" }));
  fireEvent.load(await screen.findByAltText("Recall image"));
  fireEvent.click(screen.getByRole("button", { name: "Talk to AI" }));
  await screen.findByRole("button", { name: "Mute" });
  return view;
}
test("F42 TC1/3/8: voice hides answer, allows both corrections, confirms once and releases media", async () => {
  const f = voiceFixture();
  try {
    await beginVoice(f);
    expect(screen.queryByText(note.title)).toBeNull();
    expect((screen.getByRole("button", { name: "Show answer" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Mute" })); expect(f.track.enabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Finish discussion" }));
    await screen.findByRole("group", { name: "Initial recall" });
    expect(f.review.rate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Hard" }));
    fireEvent.change(screen.getByLabelText("Understanding after discussion"), { target: { value: "partial" } });
    fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
    await waitFor(() => expect(f.review.rate).toHaveBeenCalledOnce());
    expect(f.review.rate.mock.calls[0][0]).toMatchObject({ rating: "hard", voiceReview: { ...f.result, understanding: "partial" } });
    expect(f.track.stop).toHaveBeenCalled(); await waitFor(() => expect(f.voice.discard).toHaveBeenCalled());
  } finally { cleanup(); vi.unstubAllGlobals(); }
});
test("F42 TC5: failed voice assessment save can retry before revealing the note", async () => {
  const f = voiceFixture(); f.review.rate.mockRejectedValueOnce(new Error("Disk full"));
  try {
    await beginVoice(f);
    fireEvent.click(screen.getByRole("button", { name: "Finish discussion" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save & next" }));
    await screen.findByText("Disk full");
    const input = f.review.rate.mock.calls[0][0];
    fireEvent.click(screen.getByRole("button", { name: "Retry saving rating" }));
    await waitFor(() => expect(f.review.rate).toHaveBeenCalledTimes(2));
    expect(f.review.rate.mock.calls[1][0]).toEqual(input);
  } finally { cleanup(); vi.unstubAllGlobals(); }
});
test("F42 TC8: leaving voice review releases microphone without a rating", async () => {
  const f = voiceFixture();
  try {
    const view = await beginVoice(f);
    view.unmount();
    await waitFor(() => expect(f.voice.discard).toHaveBeenCalled());
    expect(f.track.stop).toHaveBeenCalled(); expect(f.review.rate).not.toHaveBeenCalled();
  } finally { cleanup(); vi.unstubAllGlobals(); }
});

test("F42 TC4: history shows initial and final understanding without transcript", async () => {
  const f = fixture();
  f.review.details.mockResolvedValue({ enrolled: true, paused: false, eligible: true, dueAt: Date.now(), totalReviews: 1,
    lastReviewedAt: Date.now(), lastRating: "hard", history: [{ operationId: "v1", reviewedAt: Date.now(), dueAt: Date.now(), rating: "hard",
      voiceReview: { suggestedRecall: "again", suggestedUnderstanding: "understood", understanding: "partial",
        recallReason: "Needed help initially", understandingReason: "Restated after discussion", summary: "Core relation clarified" } }] });
  render(<ReadingNoteReviewSchedule api={f.review} noteId={note.id} />);
  await screen.findByText("Voice review result");
  expect(screen.getByText("Initial recall: Hard · AI: Again")).toBeTruthy();
  expect(screen.getByText("After discussion: Partly understood · AI: Core concept understood")).toBeTruthy();
  expect(screen.getByText("Core relation clarified")).toBeTruthy();
});
test("F42 TC7: insufficient AI recall evidence requires the reader to choose a rating", async () => {
  const f = voiceFixture(); f.result.suggestedRecall = null; f.result.suggestedUnderstanding = "unassessed";
  try {
    await beginVoice(f); fireEvent.click(screen.getByRole("button", { name: "Finish discussion" }));
    await screen.findByRole("button", { name: "Continue talking" });
    expect(screen.queryByRole("button", { name: "Save & next" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Rate myself" }));
    const confirm = screen.getByRole("button", { name: "Save & next" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  } finally { cleanup(); vi.unstubAllGlobals(); }
});

test("F42 1.1: one click starts voice once; one finish assesses; details start collapsed", async () => {
  const f = voiceFixture();
  try {
    await beginVoice(f);
    expect(f.voice.start).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "End voice" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Finish discussion" }));
    const details = await screen.findByText("Assessment details");
    expect(details.closest("details")!.open).toBe(false);
    expect(f.voice.stop).toHaveBeenCalledTimes(1);
    expect(f.voice.assess).toHaveBeenCalledTimes(1);
    expect(f.review.rate).not.toHaveBeenCalled();
  } finally { cleanup(); vi.unstubAllGlobals(); }
});
test("F42 1.1: manual initial recall correction survives continued discussion", async () => {
  const f = voiceFixture();
  try {
    await beginVoice(f); fireEvent.click(screen.getByRole("button", { name: "Finish discussion" }));
    fireEvent.click(await screen.findByRole("button", { name: "Hard" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep talking" }));
    await screen.findByRole("button", { name: "Mute" });
    fireEvent.click(screen.getByRole("button", { name: "Finish discussion" }));
    const hard = await screen.findByRole("button", { name: "Hard" });
    expect(hard.getAttribute("aria-pressed")).toBe("true");
  } finally { cleanup(); vi.unstubAllGlobals(); }
});

test("F42 1.1: ending an empty discussion gives a next step without an assessment request", async () => {
  const f = voiceFixture(false);
  try {
    await beginVoice(f); fireEvent.click(screen.getByRole("button", { name: "Finish discussion" }));
    await screen.findByRole("button", { name: "Continue talking" });
    expect(f.voice.assess).not.toHaveBeenCalled(); expect(f.review.rate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(f.track.stop).toHaveBeenCalled();
  } finally { cleanup(); vi.unstubAllGlobals(); }
});
test("F42 1.1: StrictMode does not duplicate an explicitly requested microphone session", async () => {
  const f = voiceFixture();
  try {
    const view = await beginVoice(f, true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(f.voice.start).toHaveBeenCalledTimes(1);
    view.unmount(); expect(f.track.stop).toHaveBeenCalled();
  } finally { cleanup(); vi.unstubAllGlobals(); }
});
test("F42 1.1: a rejected microphone request can retry without reopening the panel", async () => {
  const f = voiceFixture();
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
  try {
    render(<SpacedReviewWorkspace {...f.props} />);
    fireEvent.click(screen.getByRole("button", { name: "Start review" })); fireEvent.load(await screen.findByAltText("Recall image"));
    fireEvent.click(screen.getByRole("button", { name: "Talk to AI" }));
    await screen.findByRole("alert");
    expect(f.voice.start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByRole("button", { name: "Mute" });
    expect(f.voice.start).toHaveBeenCalledTimes(1);
  } finally { cleanup(); vi.unstubAllGlobals(); }
});
