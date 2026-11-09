// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CardNoteUploadPanel, CardNoteUploadProvider } from "../src/renderer/CardNoteUploadPanel";
import type { CardNoteUploadBatch } from "../src/shared/card-note-upload";
beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }
  } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const batch: CardNoteUploadBatch = { id: "b", baseUrl: "http://127.0.0.1:8787", running: false, items: [{ noteId: "a", title: "A", submissionId: "s", status: "created", url: "http://127.0.0.1:8787/notes/saved" }, { noteId: "b", title: "B", submissionId: "s2", status: "duplicate_title", url: "http://127.0.0.1:8787/notes/existing" }] };
test("TC5 uploads selected IDs, prevents duplicate clicks, displays each result and server links", async () => {
  const api = { get: vi.fn(async () => undefined), start: vi.fn(async () => batch), retry: vi.fn(async () => batch) };
  render(<CardNoteUploadPanel api={api} noteIds={["a", "b"]} />);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: "Upload 2 notes to card pool" }));
  fireEvent.click(screen.getByRole("button", { name: "Upload 2 notes to card pool" }));
  fireEvent.click(await screen.findByRole("button", { name: "Expand upload activity" }));
  await screen.findByText("Saved");
  expect(api.start).toHaveBeenCalledExactlyOnceWith(["a", "b"]);
  expect(screen.getByText("Title already exists — not added")).toBeTruthy();
  expect(screen.getAllByText("Open card pool note ↗")[1]!.getAttribute("href")).toBe(batch.items[1]!.url);
});
test("TC5 restores unfinished progress, blocks new batches, and retries without rereading IDs", async () => {
  const unfinished = { ...batch, items: [{ ...batch.items[0]!, status: "uncertain" as const, url: undefined }] };
  const api = { get: vi.fn(async () => unfinished), start: vi.fn(async () => batch), retry: vi.fn(async () => batch) };
  render(<CardNoteUploadPanel api={api} noteIds={["new"]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Expand upload activity" }));
  await screen.findByText("Result not confirmed — may already be saved");
  expect((screen.getByRole("button", { name: "Upload 1 notes to card pool" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Retry unfinished uploads"));
  await screen.findByText("Saved"); expect(api.retry).toHaveBeenCalledTimes(1); expect(api.start).not.toHaveBeenCalled();
});

test("TC5 initial progress must be read before new uploads, start errors remain visible", async () => {
  const api = { get: vi.fn(async () => undefined), start: vi.fn(async () => { throw new Error("Finish the current batch"); }), retry: vi.fn(async () => batch) };
  render(<CardNoteUploadPanel api={api} noteIds={["a"]} />);
  expect((screen.getByRole("button", { name: "Upload 1 notes to card pool" }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect((screen.getByRole("button", { name: "Upload 1 notes to card pool" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Upload 1 notes to card pool" }));
  await screen.findByText("Finish the current batch");
  await new Promise(resolve => setTimeout(resolve, 850));
  expect(screen.getByText("Finish the current batch")).toBeTruthy();
});

test("F62 TC1/TC2 shared upload activity collapses and protects active progress", async () => {
  const current = { ...batch, running: true, items: [batch.items[0]!, { ...batch.items[1]!, status: 'uploading' as const }] };
  const api = { get: vi.fn(async () => current), start: vi.fn(async () => current), retry: vi.fn(async () => current) };
  render(<CardNoteUploadPanel api={api} noteIds={[]} />);
  const expand = await screen.findByRole('button', { name: 'Expand upload activity' });
  expect(expand.className).toBe('memory-image-activity-toggle');
  expect((screen.getByRole('button', { name: 'Dismiss upload notifications' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole('progressbar', { name: 'Finished uploads' }).getAttribute('value')).toBe('1');
  expect(screen.queryByText('Open card pool note ↗')).toBeNull();
  fireEvent.click(expand);
  expect(screen.getAllByText('Open card pool note ↗')).toHaveLength(2);
  fireEvent.keyDown(expand, { key: 'Escape' });
  expect(screen.queryByText('Open card pool note ↗')).toBeNull();
  fireEvent.click(expand);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByText('Open card pool note ↗')).toBeNull();
});

test("F62 TC3 dismissal survives polling, new batches return", async () => {
  let current = batch;
  const api = { get: vi.fn(async () => current), start: vi.fn(async () => current), retry: vi.fn(async () => current) };
  render(<CardNoteUploadPanel api={api} noteIds={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss upload notifications' }));
  await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(1), { timeout: 1600 });
  expect(screen.queryByRole('button', { name: 'Expand upload activity' })).toBeNull();
  current = { ...batch, id: 'new' };
  expect(await screen.findByRole('button', { name: 'Expand upload activity' }, { timeout: 1600 })).toBeTruthy();
});


test("F62 TC5 global activity shares action errors and survives library unmount", async () => {
  const api = { get: vi.fn(async () => batch), start: vi.fn(async () => { throw new Error('Upload failed'); }), retry: vi.fn(async () => batch) };
  function View({ library }: { library: boolean }) {
    return <CardNoteUploadProvider api={api}>
      {library ? <CardNoteUploadPanel api={api} noteIds={['a']} actionOnly /> : null}
      <div className="generation-activity-stack"><CardNoteUploadPanel api={api} noteIds={[]} /></div>
    </CardNoteUploadProvider>;
  }
  const view = render(<View library />);
  const action = screen.getByRole('button', { name: 'Upload 1 notes to card pool' });
  await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false));
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(screen.getAllByLabelText('Card pool uploads')).toHaveLength(1);
  fireEvent.click(action);
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Upload failed');
  view.rerender(<View library={false} />);
  expect(screen.getByRole('alert').textContent).toBe('Upload failed');
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss upload notifications' }));
  expect(screen.queryByLabelText('Card pool uploads')).toBeNull();
});


test("F62 TC3 dismissed upload stays hidden after a renderer refresh, but new batches appear", async () => {
  let current = batch;
  const api = { get: vi.fn(async () => current), start: vi.fn(async () => current), retry: vi.fn(async () => current) };
  const view = render(<CardNoteUploadPanel api={api} noteIds={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss upload notifications' }));
  view.unmount();
  render(<CardNoteUploadPanel api={api} noteIds={['a']} />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Upload 1 notes to card pool' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByLabelText('Card pool uploads')).toBeNull();
  current = { ...batch, id: 'after-refresh' };
  expect(await screen.findByLabelText('Card pool uploads', {}, { timeout: 1600 })).toBeTruthy();
});


test("F62 TC2 a previously dismissed batch stays visible while running", async () => {
  window.localStorage.setItem('deep-reading.card-pool.dismissed-batch', batch.id);
  const current = { ...batch, running: true, items: [{ ...batch.items[0]!, status: 'uploading' as const }] };
  const api = { get: vi.fn(async () => current), start: vi.fn(async () => current), retry: vi.fn(async () => current) };
  render(<CardNoteUploadPanel api={api} noteIds={[]} />);
  const dismiss = await screen.findByRole('button', { name: 'Dismiss upload notifications' });
  expect((dismiss as HTMLButtonElement).disabled).toBe(true);
});

test("F62 TC3 storage failure still permits dismissal in the current view", async () => {
  vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  const api = { get: vi.fn(async () => batch), start: vi.fn(async () => batch), retry: vi.fn(async () => batch) };
  render(<CardNoteUploadPanel api={api} noteIds={[]} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dismiss upload notifications' }));
  expect(screen.queryByLabelText('Card pool uploads')).toBeNull();
});
