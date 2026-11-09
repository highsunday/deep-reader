// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReaderDesktopApi, ReadingNoteMemoryImageSnapshot } from "../src/shared/contracts";
import { MemoryImageGenerationProgress, updateGenerationBatch } from "../src/renderer/MemoryImageGenerationProgress";

import { ReadingNoteLibrary } from "../src/renderer/ReadingNoteLibrary";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";

afterEach(() => cleanup());

test("restores active image jobs after the renderer reloads", async () => {
  const memoryImage = {
    listActive: vi.fn(async () => [
      { noteId: "note-1", phase: "generating" as const, available: true, status: "Generating." },
      { noteId: "note-2", phase: "generating" as const, available: true, status: "Generating." }
    ]),
    onStateChanged: vi.fn(() => () => undefined)
  } as unknown as NonNullable<ReaderDesktopApi["readingNotes"]["memoryImage"]>;

  render(<MemoryImageGenerationProgress memoryImage={memoryImage} />);

  await waitFor(() => expect(screen.getByLabelText("2 active")).toBeTruthy());
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("0");
  expect(memoryImage.listActive).toHaveBeenCalledTimes(1);
});

test("overlapping image jobs share one counted progress batch and reset afterward", () => {
  let listener: ((snapshot: ReadingNoteMemoryImageSnapshot) => void) | undefined;
  const memoryImage = {
    listActive: vi.fn(async () => []),
    onStateChanged: vi.fn((next) => { listener = next; return () => undefined; })
  } as unknown as NonNullable<ReaderDesktopApi["readingNotes"]["memoryImage"]>;
  render(<MemoryImageGenerationProgress memoryImage={memoryImage} />);

  act(() => {
    for (const noteId of ["note-1", "note-2", "note-3"]) {
      listener?.({ noteId, phase: "generating", available: true, status: "Generating." });
    }
  });
  let progress = screen.getByRole("progressbar");
  expect(progress.getAttribute("max")).toBe("3");
  expect(progress.getAttribute("value")).toBe("0");
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("0");
  expect(screen.getByLabelText("3 active")).toBeTruthy();
  expect(document.querySelector(".memory-image-generation-progress")).not.toBeNull();

  act(() => listener?.({ noteId: "note-1", phase: "ready", available: true, status: "Generated." }));
  progress = screen.getByRole("progressbar");
  expect(progress.getAttribute("value")).toBe("1");
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("1");
  expect(screen.getByLabelText("2 active")).toBeTruthy();

  act(() => listener?.({ noteId: "note-2", phase: "error", available: true, status: "Stopped." }));
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("2");
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("2");
  expect(screen.getByLabelText("1 active")).toBeTruthy();

  act(() => listener?.({ noteId: "note-3", phase: "ready", available: true, status: "Generated." }));
  expect(screen.queryByRole("progressbar")).toBeNull();

  act(() => listener?.({ noteId: "note-4", phase: "generating", available: true, status: "Generating." }));
  expect(screen.getByRole("progressbar").getAttribute("max")).toBe("1");
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("0");
});


test("F28 text preparation is not counted as image generation", () => {
  const batch = { activeImageKeys: new Set<string>(), total: 0, completed: 0 };
  expect(updateGenerationBatch(batch, { noteId: "note-1", phase: "preparing", available: true, status: "Preparing text draft" })).toBe(batch);
});

test("a two-sided batch counts each pending visual in progress", () => {
  const batch = { activeImageKeys: new Set<string>(), total: 0, completed: 0 };
  const next = updateGenerationBatch(batch, {
    noteId: "note-1", side: "understand", phase: "generating", available: true, status: "Generating front.",
    batch: { sides: ["understand", "recall"], completed: [], phase: "running" }
  });
  expect(next.total).toBe(2);
  expect(next.activeImageKeys.size).toBe(2);
  const frontDone = updateGenerationBatch(next, {
    noteId: "note-1", side: "understand", phase: "ready", available: true, status: "Front ready.",
    batch: { sides: ["understand", "recall"], completed: [], phase: "running" }
  });
  expect(frontDone.total).toBe(2);
  expect(frontDone.completed).toBe(1);
  expect(frontDone.activeImageKeys.size).toBe(1);
});

// B33 exercises the real Library mount/unmount boundary used by page navigation.

function libraryHarness(listActive: () => Promise<ReadingNoteMemoryImageSnapshot[]>) {
  const note = {
    id: "note-1", sourceDraftId: "draft-1", title: "Feedback",
    content: markdownToReadingNoteDocument("Delayed correction."),
    bookTitle: "Systems", chapterTitle: "Loops", createdAt: 1, updatedAt: 1, revision: 1
  };
  const listeners = new Set<(snapshot: ReadingNoteMemoryImageSnapshot) => void>();
  const api = {
    list: vi.fn(async () => [note, { ...note, id: "note-2", title: "Idle note" }]),
    listPage: vi.fn(async () => ({ items: [note, { ...note, id: "note-2", title: "Idle note" }] })),
    activeBookTitles: vi.fn(async () => [note.bookTitle]),
    get: vi.fn(async () => note),
    counts: vi.fn(async () => ({ active: 2, trashed: 0 })),
    attachments: { readDataUrl: vi.fn(async () => "data:image/png;base64,AA==") },
    memoryImage: {
      listActive: vi.fn(listActive),
      onStateChanged: vi.fn((listener: (snapshot: ReadingNoteMemoryImageSnapshot) => void) => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      })
    }
  } as unknown as ReaderDesktopApi["readingNotes"];
  return {
    api, listeners,
    page: <ReadingNoteLibrary api={api} onReturnToBooks={() => undefined} />,
    emit: (phase: ReadingNoteMemoryImageSnapshot["phase"]) => act(() => {
      listeners.forEach((listener) => listener({ noteId: note.id, phase, available: true, status: phase }));
    })
  };
}

const activeImage: ReadingNoteMemoryImageSnapshot = {
  noteId: "note-1", phase: "generating", available: true, status: "Generating."
};

test.each(["ready", "error"] as const)("B33 restores card progress after navigation and clears on %s", async (phase) => {
  const harness = libraryHarness(async () => [activeImage]);
  const first = render(harness.page);
  await screen.findByText("Feedback");
  harness.emit("generating");
  expect(screen.getByLabelText("產圖中")).toBeTruthy();
  first.unmount();
  expect(harness.listeners.size).toBe(0);
  render(harness.page);
  await waitFor(() => expect(screen.getByLabelText("產圖中")).toBeTruthy());
  expect(screen.getByRole("button", { name: /Idle note/ }).getAttribute("aria-busy")).toBe("false");
  harness.emit(phase);
  expect(screen.queryByLabelText("產圖中")).toBeNull();
});

test.each(["ready", "generating"] as const)("B33 prefers live %s over a delayed active-job query", async (phase) => {
  let resolve!: (snapshots: ReadingNoteMemoryImageSnapshot[]) => void;
  const harness = libraryHarness(() => new Promise((done) => { resolve = done; }));
  render(harness.page);
  await screen.findByText("Feedback");
  expect(harness.api.memoryImage!.listActive).toHaveBeenCalledOnce();
  harness.emit(phase);
  await act(async () => resolve(phase === "ready" ? [activeImage] : []));
  expect(Boolean(screen.queryByLabelText("產圖中"))).toBe(phase === "generating");
});

test("B33 keeps receiving live progress if the active-job query fails", async () => {
  const harness = libraryHarness(async () => { throw new Error("Unavailable"); });
  render(harness.page);
  await screen.findByText("Feedback");
  expect(harness.api.memoryImage!.listActive).toHaveBeenCalledOnce();
  harness.emit("generating");
  expect(screen.getByLabelText("產圖中")).toBeTruthy();
});

test("B33 ignores an old page query after navigating back", async () => {
  let resolve!: (snapshots: ReadingNoteMemoryImageSnapshot[]) => void;
  let calls = 0;
  const harness = libraryHarness(() => ++calls === 1 ? new Promise((done) => { resolve = done; }) : Promise.resolve([]));
  const first = render(harness.page);
  await screen.findByText("Feedback");
  expect(harness.api.memoryImage!.listActive).toHaveBeenCalledOnce();
  first.unmount();
  render(harness.page);
  await screen.findByText("Feedback");
  await act(async () => resolve([activeImage]));
  expect(screen.queryByLabelText("產圖中")).toBeNull();
  expect(harness.listeners.size).toBe(1);
});

// F39 v0.3: expandable activity and completed-note sidebar navigation.
function notificationHarness(listActive: () => Promise<ReadingNoteMemoryImageSnapshot[]> = async () => []) {
  const listeners = new Set<(snapshot: ReadingNoteMemoryImageSnapshot) => void>();
  const notes = new Map<string, import('../src/shared/contracts').ReadingNote>();
  const onView = vi.fn();
  const api = {
    get: vi.fn(async (id: string) => notes.get(id)),
    attachments: { readDataUrl: vi.fn(async () => 'data:image/png;base64,AA==') },
    memoryImage: { listActive: vi.fn(listActive), stop: vi.fn(),
      onStateChanged: vi.fn((listener: (snapshot: ReadingNoteMemoryImageSnapshot) => void) => {
        listeners.add(listener); return () => { listeners.delete(listener); };
      }) }
  } as unknown as ReaderDesktopApi['readingNotes'];
  const emit = (snapshot: ReadingNoteMemoryImageSnapshot) => act(() => { for (const listener of listeners) listener(snapshot); });
  const done = (id: string, side: 'recall' | 'understand' = 'understand') => {
    const note = { id, sourceDraftId: id, title: `Note ${id}`, content: markdownToReadingNoteDocument('Concept'),
      bookTitle: 'Book', chapterTitle: 'Chapter', createdAt: 1, updatedAt: 2, revision: 2,
      memoryImages: { [side]: { attachmentId: `${id}-${side}`, basedOnRevision: 1 } } };
    notes.set(id, note);
    return { noteId: id, side, phase: 'ready' as const, available: true, status: 'Saved', note, completion: { sides: [side] } };
  };
  render(<MemoryImageGenerationProgress memoryImage={api.memoryImage} api={api} onView={onView} />);
  const expand = () => fireEvent.click(screen.getByRole('button', { name: 'Expand image activity' }));
  const open = (id: string) => fireEvent.click(screen.getByRole('button', { name: `View images for Note ${id}` }));
  return { api, emit, done, notes, onView, expand, open };
}
const activeJob = { noteId: 'working', side: 'recall' as const, phase: 'generating' as const, available: true, status: 'Working' };

test('F39 v0.3: generating-only activity can expand and collapse with zero completed', () => {
  const h = notificationHarness(); h.emit(activeJob);
  expect(screen.getByText('0 completed')).toBeTruthy();
  h.expand();
  expect(screen.getByText('Images will appear here when ready.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse image activity' }));
  expect(screen.queryByRole('region', { name: 'Completed images' })).toBeNull();
  expect(screen.getByLabelText('1 active')).toBeTruthy();
});

test('F39 TC1/2: single result opens the sidebar on the saved side, retains history, never opens a modal', async () => {
  const h = notificationHarness(); h.emit(activeJob); const done = h.done('done'); h.emit(done);
  expect(document.querySelectorAll('.memory-image-generation-progress')).toHaveLength(1);
  h.expand(); h.open('done');
  await waitFor(() => expect(h.onView).toHaveBeenCalledWith(done.note, 'understand'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('1 completed')).toBeTruthy();
  h.expand(); expect(screen.getByText(/Viewed/)).toBeTruthy(); h.open('done');
  await waitFor(() => expect(h.onView).toHaveBeenCalledTimes(2));
  expect(screen.getByLabelText('1 active')).toBeTruthy();
});

test('F39 TC3: notes aggregate, dismiss individually, and duplicate events never restore dismissed items', async () => {
  const h = notificationHarness(); const a = h.done('a'), b = h.done('b');
  h.emit(a); h.emit(b); h.emit(a); expect(screen.getByText('2 completed')).toBeTruthy();
  h.expand(); fireEvent.click(screen.getByRole('button', { name: 'Dismiss Note b notification' }));
  expect(screen.getByText('1 completed')).toBeTruthy(); h.open('a');
  await waitFor(() => expect(h.onView).toHaveBeenCalledWith(a.note, 'understand'));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss image notifications' }));
  h.emit(a); h.emit(b); expect(document.querySelector('.memory-image-generation-progress')).toBeNull();
});

test('F39 TC4: active jobs disable dismissal but allow collapse; closing unlocks when every job ends', () => {
  const h = notificationHarness(); h.emit(activeJob); h.emit({ ...activeJob, noteId: 'second' });
  h.emit(h.done('finished'));
  const dismiss = screen.getByRole('button', { name: 'Dismiss image notifications' }) as HTMLButtonElement;
  expect(dismiss.disabled).toBe(true); fireEvent.click(dismiss);
  expect(screen.getByText('1 completed')).toBeTruthy(); expect(screen.getByLabelText('2 active')).toBeTruthy();
  h.expand(); fireEvent.click(screen.getByRole('button', { name: 'Collapse image activity' }));
  expect(screen.queryByRole('region', { name: 'Completed images' })).toBeNull();
  h.emit(h.done('working', 'recall')); expect(dismiss.disabled).toBe(true);
  h.emit({ ...activeJob, noteId: 'second', phase: 'error', status: 'Failed' });
  expect(dismiss.disabled).toBe(false); fireEvent.click(dismiss);
  expect(document.querySelector('.memory-image-generation-progress')).toBeNull();
  expect(h.api.memoryImage!.stop).not.toHaveBeenCalled();
});

test('F39 TC5/6: running batches wait; partial persisted results are labelled', () => {
  const h = notificationHarness(); const done = h.done('a'); const { completion: _, ...plain } = done;
  h.emit(plain); expect(screen.queryByText('1 completed')).toBeNull();
  h.emit({ ...done, batch: { sides: ['understand','recall'], completed: [], phase: 'running' } });
  expect(screen.getByText('0 completed')).toBeTruthy();
  h.emit({ ...done, phase: 'error', batch: { sides: ['understand','recall'], completed: ['understand'], phase: 'error' } });
  h.expand(); expect(screen.getByText(/Partially completed/)).toBeTruthy();
});

test('F39 TC7: late active lookup cannot resurrect a completed job', async () => {
  let resolve!: (value: ReadingNoteMemoryImageSnapshot[]) => void;
  const h = notificationHarness(() => new Promise(r => { resolve = r; })); h.emit(h.done('a'));
  await act(async () => resolve([{ ...activeJob, noteId: 'a' }]));
  expect(screen.queryByRole('progressbar')).toBeNull(); expect(screen.getByText('1 completed')).toBeTruthy();
});

test.each(['deleted','trashed','removed','read-error','attachment-error'])('F39 TC8: %s retains a retryable result without sidebar navigation', async reason => {
  const h = notificationHarness(); h.emit(h.done('a'));
  if (reason === 'deleted') h.notes.delete('a');
  if (reason === 'trashed') h.notes.get('a')!.trashedAt = 3;
  if (reason === 'removed') h.notes.get('a')!.memoryImages = {};
  if (reason === 'read-error') vi.mocked(h.api.get).mockRejectedValueOnce(new Error('Offline'));
  if (reason === 'attachment-error') vi.mocked(h.api.attachments.readDataUrl).mockRejectedValue(new Error('Missing image'));
  h.expand(); h.open('a'); expect(await screen.findByRole('alert')).toBeTruthy();
  expect(h.onView).not.toHaveBeenCalled(); expect(screen.getByText('1 completed')).toBeTruthy();
});

test('F39 TC3: same-note sides merge and sidebar starts with recall for a pair', async () => {
  const h = notificationHarness(); const a = h.done('a'); h.emit(a); const recall = h.done('a', 'recall');
  recall.note.memoryImages = { ...a.note.memoryImages, ...recall.note.memoryImages }; h.emit(recall);
  expect(screen.getByText('1 completed')).toBeTruthy(); h.expand(); h.open('a');
  await waitFor(() => expect(h.onView).toHaveBeenCalledWith(recall.note, 'recall'));
});

test('F39 TC3: Escape and outside pointer collapse without losing results', () => {
  const h = notificationHarness(); h.emit(h.done('a')); h.expand();
  fireEvent.keyDown(screen.getByRole('button', { name: 'View images for Note a' }), { key: 'Escape' });
  const trigger = screen.getByRole('button', { name: 'Expand image activity' }); expect(document.activeElement).toBe(trigger);
  h.expand(); fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('region', { name: 'Completed images' })).toBeNull(); expect(screen.getByText('1 completed')).toBeTruthy();
});

test('F39 TC4/8: dismissal invalidates a pending sidebar open; new saved image can notify', async () => {
  const h = notificationHarness(); const done = h.done('a'); h.emit(done);
  let resolve!: (note: typeof done.note) => void;
  vi.mocked(h.api.get).mockImplementationOnce(() => new Promise(r => { resolve = r; })); h.expand(); h.open('a');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss image notifications' }));
  await act(async () => resolve(done.note)); expect(h.onView).not.toHaveBeenCalled();
  h.emit(done); expect(document.querySelector('.memory-image-generation-progress')).toBeNull();
  const fresh = h.done('a'); fresh.note.memoryImages.understand!.attachmentId = 'new-image'; h.emit(fresh);
  expect(screen.getByText('1 completed')).toBeTruthy();
});

test('F39 thumbnails load the completed side and keep the row clickable', async () => {
  const h = notificationHarness(); h.emit(h.done('a', 'recall'));
  expect(h.api.attachments.readDataUrl).not.toHaveBeenCalled(); h.expand();
  const row = screen.getByRole('button', { name: 'View images for Note a' });
  await waitFor(() => expect(row.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA=='));
  expect(h.api.attachments.readDataUrl).toHaveBeenCalledWith('a-recall');
  fireEvent.click(row.querySelector('img')!);
  await waitFor(() => expect(h.onView).toHaveBeenCalledWith(h.notes.get('a'), 'recall'));
});

test('F39 thumbnail read or image decoding errors fall back without hiding the result', async () => {
  const h = notificationHarness(); h.emit(h.done('a'));
  vi.mocked(h.api.attachments.readDataUrl).mockRejectedValueOnce(new Error('Missing thumbnail'));
  h.expand();
  await waitFor(() => expect(h.api.attachments.readDataUrl).toHaveBeenCalled());
  const row = screen.getByRole('button', { name: 'View images for Note a' });
  expect(row.querySelector('img')).toBeNull(); expect(row.querySelector('svg')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Collapse image activity' })); h.expand();
  await waitFor(() => expect(row.isConnected).toBe(false));
  const nextRow = screen.getByRole('button', { name: 'View images for Note a' });
  await waitFor(() => expect(nextRow.querySelector('img')).toBeTruthy());
  fireEvent.error(nextRow.querySelector('img')!);
  expect(nextRow.querySelector('img')).toBeNull(); expect(nextRow.querySelector('svg')).toBeTruthy();
});

test('F39 replaced thumbnail ignores an old attachment response', async () => {
  const h = notificationHarness(); h.emit(h.done('a'));
  let resolve!: (url: string) => void;
  vi.mocked(h.api.attachments.readDataUrl).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  h.expand(); const fresh = h.done('a'); fresh.note.memoryImages.understand!.attachmentId = 'new-image'; h.emit(fresh);
  const row = screen.getByRole('button', { name: 'View images for Note a' });
  await waitFor(() => expect(row.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA=='));
  await act(async () => resolve('data:image/png;base64,OLD'));
  expect(row.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AA==');
});


test('B49 background failure stays visible until dismissed or retried', () => {
  const h = notificationHarness();
  h.emit(activeJob);
  h.emit({ ...activeJob, phase: 'error', status: 'Timed out waiting for the memory image.' });
  expect(screen.getByRole('alert').textContent).toContain('Timed out waiting');
  expect(screen.queryByRole('progressbar')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss image notifications' }));
  expect(screen.queryByRole('alert')).toBeNull();
  h.emit(activeJob);
  h.emit({ ...activeJob, phase: 'error', status: 'Image service unavailable.' });
  expect(screen.getByRole('alert').textContent).toContain('Image service unavailable');
  h.emit(activeJob);
  expect(screen.queryByRole('alert')).toBeNull();
  h.emit(h.done(activeJob.noteId, 'recall'));
  expect(screen.getByText('1 completed')).toBeTruthy();
});

test('B49 draft errors alone do not create global image notifications', () => {
  const h = notificationHarness();
  h.emit({ ...activeJob, phase: 'preparing' });
  h.emit({ ...activeJob, phase: 'error', status: 'Invalid draft.' });
  expect(screen.queryByLabelText('Memory image activity')).toBeNull();
});
