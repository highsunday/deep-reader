// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ReaderDesktopApi, ReadingNote } from '../src/shared/contracts';
import type { Whiteboard, WhiteboardsApi } from '../src/shared/whiteboard';
import type { WhiteboardWorkspace } from '../src/renderer/WhiteboardWorkspace';
import { markdownToReadingNoteDocument } from '../src/shared/reading-note-document';
const loaders = import.meta.glob('../src/renderer/WhiteboardWorkspace.tsx');
afterEach(cleanup);
vi.mock('../src/renderer/ReadingNoteEditorDialog', () => ({ ReadingNoteEditorDialog: ({ note, onClose, onSaved }: { note: ReadingNote; onClose(): void; onSaved(n: ReadingNote): void }) => <section role="dialog" aria-label="Detailed note"><h2>{note.title}</h2><button onClick={() => onSaved({ ...note, title: 'Updated note', revision: note.revision + 1 })}>Save test edit</button><button onClick={onClose}>Close detail</button></section> }));
function fixture() {
  const board: Whiteboard = { id: 'b', title: 'Systems', revision: 1, createdAt: 1, updatedAt: 1, notes: [], texts: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const notes: ReadingNote[] = ['Feedback', 'Delay'].map((title, i) => ({ id: `n${i}`, sourceDraftId: `d${i}`, title, content: markdownToReadingNoteDocument('Content'), bookTitle: i ? 'Second book' : 'Systems book', chapterTitle: 'One', createdAt: 1, updatedAt: 1, revision: 1 }));
  let saved = board;
  const api: WhiteboardsApi = { list: vi.fn(async () => [saved]), get: vi.fn(async () => saved), create: vi.fn(async title => ({ ...board, id: 'new', title })), save: vi.fn(async input => { saved = { ...saved, ...input, revision: input.baseRevision + 1 }; return saved; }), remove: vi.fn(async () => {}) };
  const notesApi = { list: vi.fn(async ({ status }) => status === 'trashed' ? [] : notes), get: vi.fn(async id => notes.find(n => n.id === id)), attachments: { readDataUrl: vi.fn(async () => '') } } as unknown as ReaderDesktopApi['readingNotes'];
  return { api, notesApi, notes, board };
}
async function mount(f = fixture()) {
  const loader = loaders['../src/renderer/WhiteboardWorkspace.tsx']; expect(loader, 'F43 needs the whiteboard workspace').toBeTypeOf('function');
  const { WhiteboardWorkspace: Workspace } = await loader() as { WhiteboardWorkspace: typeof WhiteboardWorkspace };
  render(<Workspace api={f.api} notesApi={f.notesApi} />);
  await screen.findByRole('button', { name: 'Open Systems' });
  return f;
}
async function openBoardForAdding() {
  fireEvent.click(screen.getByRole('button', { name: 'Open Systems' }));
  fireEvent.click(await screen.findByRole('button', { name: '未加入白板' }));
}
test('TC1–4: board management and right sidebar search/add/repeated add', async () => {
  const f = await mount();
  await openBoardForAdding();
  const sidebar = await screen.findByRole('complementary', { name: 'Add reading notes' });
  const navigation = screen.getByRole('navigation', { name: 'Whiteboard navigation' });
  expect(within(navigation).getByRole('button', { name: 'All whiteboards' }).textContent).toBe('所有白板');
  expect(within(navigation).getByRole('textbox', { name: 'Whiteboard name' }).getAttribute('value')).toBe('Systems');
  expect(within(screen.getByRole('group', { name: 'Whiteboard tools' })).queryByRole('button', { name: 'All whiteboards' })).toBeNull();
  fireEvent.change(within(sidebar).getByRole('searchbox'), { target: { value: ' FEED ' } });
  const add = await within(sidebar).findByRole('button', { name: 'Add Feedback' }); fireEvent.click(add);
  expect(await screen.findByRole('group', { name: 'Card: Feedback' })).toBeTruthy();
  expect(within(sidebar).getByRole('searchbox').getAttribute('value')).toBe(' FEED ');
  fireEvent.click(within(sidebar).getByRole('button', { name: '目前白板' }));
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Locate Feedback' }));
  expect(screen.getAllByRole('group', { name: 'Card: Feedback' })).toHaveLength(1);
  expect(screen.getByLabelText('Zoom level').textContent).toBe('150%');
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(screen.getByLabelText('Zoom level').textContent).toBe('180%');
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Locate Feedback' }));
  expect(screen.getByLabelText('Zoom level').textContent).toBe('150%');
  fireEvent.click(screen.getByRole('button', { name: 'All whiteboards' }));
  await screen.findByRole('button', { name: 'Open Systems' }); expect(f.api.save).toHaveBeenCalled();
  expect(vi.mocked(f.api.save).mock.calls.at(-1)![0].viewport).toEqual({ x: -200, y: -150, zoom: 1.5 });
});
test('TC5,10,11: flip, enlarge current face, details, updated note and remove placement', async () => {
  await mount(); await openBoardForAdding();
  fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' }));
  const card = screen.getByRole('group', { name: 'Card: Feedback' });
  fireEvent.click(within(card).getByRole('button', { name: 'Flip card' })); expect(card.getAttribute('data-side')).toBe('understand');
  expect(within(card).getByRole('button', { name: 'Flip card' }).getAttribute('title')).toBe('Show back image');
  fireEvent.click(within(card).getByRole('button', { name: 'Flip card' })); expect(card.getAttribute('data-side')).toBe('recall');
  fireEvent.click(within(card).getByRole('button', { name: 'Flip card' })); expect(card.getAttribute('data-side')).toBe('understand');
  fireEvent.click(within(card).getByRole('button', { name: 'Enlarge image' }));
  const image = await screen.findByRole('dialog', { name: 'Enlarged image: Feedback' }); expect(within(image).getByText('No front image yet')).toBeTruthy();
  fireEvent.click(within(image).getByRole('button', { name: 'Close image' }));
  fireEvent.click(within(card).getByRole('button', { name: 'View detailed note' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save test edit' })); fireEvent.click(screen.getByRole('button', { name: 'Close detail' }));
  const updated = await screen.findByRole('group', { name: 'Card: Updated note' });
  fireEvent.click(within(updated).getByRole('button', { name: 'Remove from whiteboard' })); expect(screen.queryByRole('group', { name: 'Card: Updated note' })).toBeNull();
});
test('TC7,9: create and label relationship, add plain text and delete only target element', async () => {
  const f = await mount(); await openBoardForAdding();
  fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' })); fireEvent.click(screen.getByRole('button', { name: 'Add Delay' }));
  const a = screen.getByRole('group', { name: 'Card: Feedback' }), b = screen.getByRole('group', { name: 'Card: Delay' });
  fireEvent.click(within(a).getByRole('button', { name: 'Connect card: right' })); fireEvent.click(within(b).getByRole('button', { name: 'Connect card: right' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Connection label' }), { target: { value: 'causes' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Arrow' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Whiteboard text' }), { target: { value: '<b>Reason</b>\nSecond line' } });
  fireEvent.click(screen.getByRole('button', { name: 'All whiteboards' }));
  await waitFor(() => expect(f.api.save).toHaveBeenCalled());
  const saved = vi.mocked(f.api.save).mock.calls.at(-1)![0]; expect(saved.edges[0]).toMatchObject({ label: 'causes', arrow: true }); expect(saved.texts[0].text).toContain('<b>');
});
test('TC14: failed save retains board and navigation asks to retry or discard', async () => {
  const f = fixture(); vi.mocked(f.api.save).mockRejectedValue(new Error('Disk full'));
  await mount(f); await openBoardForAdding(); fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' }));
  fireEvent.click(screen.getByRole('button', { name: 'All whiteboards' }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Unsaved whiteboard' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' })); expect(screen.getByRole('group', { name: 'Card: Feedback' })).toBeTruthy();
  await act(async () => {});
});
test('TC2,3: create a named board, rename, search and cancel/confirm deletion', async () => {
  const f = await mount();
  fireEvent.change(screen.getByRole('textbox', { name: 'New whiteboard name' }), { target: { value: 'New board' } });
  fireEvent.click(screen.getByRole('button', { name: /New whiteboard/ }));
  const name = await screen.findByRole('textbox', { name: 'Whiteboard name' });
  fireEvent.change(name, { target: { value: 'Renamed board' } });
  fireEvent.click(screen.getByRole('button', { name: 'All whiteboards' }));
  await screen.findByRole('button', { name: 'Open Renamed board' });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search whiteboards' }), { target: { value: 'missing' } });
  expect(screen.getByText('No matching whiteboards')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  fireEvent.click(screen.getByRole('button', { name: 'Delete Renamed board' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(f.api.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Renamed board' })); fireEvent.click(screen.getByRole('button', { name: 'Delete whiteboard' }));
  await waitFor(() => expect(f.api.remove).toHaveBeenCalledWith('new'));
});
test('TC4,12: book filter and trash/deletion placeholders restore without moving placements', async () => {
  const f = await mount(); await openBoardForAdding();
  fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' }));
  const before = screen.getByRole('group', { name: 'Card: Feedback' }).getAttribute('style');
  fireEvent.focus(screen.getByRole('combobox', { name: 'Book' }));
  fireEvent.click(screen.getByRole('option', { name: 'Second book' })); expect(screen.queryByRole('button', { name: 'Locate Feedback' })).toBeNull();
  const trashed = { ...f.notes[0], trashedAt: 3 };
  vi.mocked(f.notesApi.list).mockImplementation(async ({ status }) => status === 'trashed' ? [trashed] : [f.notes[1]]);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh notes' }));
  const placeholder = await screen.findByRole('group', { name: 'Card: Note in Trash' }); expect(placeholder.getAttribute('style')).toBe(before);
  vi.mocked(f.notesApi.list).mockImplementation(async ({ status }) => status === 'trashed' ? [] : f.notes);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh notes' })); expect((await screen.findByRole('group', { name: 'Card: Feedback' })).getAttribute('style')).toBe(before);
  vi.mocked(f.notesApi.list).mockImplementation(async ({ status }) => status === 'trashed' ? [] : [f.notes[1]]);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh notes' })); await screen.findByRole('group', { name: 'Card: Note deleted' });
  expect(f.notesApi.attachments.readDataUrl).not.toHaveBeenCalled();
});
test('TC1,4: load errors allow retry and sidebar clear filters recovers empty results', async () => {
  const f = fixture(); vi.mocked(f.notesApi.list).mockRejectedValueOnce(new Error('read failed'));
  await mount(f); await openBoardForAdding();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry notes' }));
  await screen.findByRole('button', { name: 'Add Feedback' });
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), { target: { value: 'unknown' } });
  expect(screen.getByText('No matching notes')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); expect(screen.getByRole('button', { name: 'Add Feedback' })).toBeTruthy();
});
test('TC6,9: drag respects zoom; typing Delete in text never removes its element', async () => {
  const Original = window.PointerEvent;
  window.PointerEvent = window.MouseEvent as unknown as typeof PointerEvent;
  try {
    const f = await mount(); await openBoardForAdding();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    const card = screen.getByRole('group', { name: 'Card: Feedback' }); const originalX = parseFloat(card.style.left);
    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 220, clientY: 100 }); fireEvent.pointerUp(window, { clientX: 220, clientY: 100 });
    expect(parseFloat(card.style.left)).toBeCloseTo(originalX + 100);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(card.getAttribute('data-side')).toBe('recall');
    fireEvent.click(screen.getByRole('button', { name: 'Add text' })); const text = screen.getByRole('textbox', { name: 'Whiteboard text' });
    fireEvent.change(text, { target: { value: 'A thought' } }); fireEvent.keyDown(text, { key: 'Delete' }); expect(screen.getByRole('textbox', { name: 'Whiteboard text' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All whiteboards' })); await waitFor(() => expect(f.api.save).toHaveBeenCalled());
  } finally { window.PointerEvent = Original; }
});
test('TC5: card images follow the current face and lightbox preserves that face', async () => {
  const f = fixture(); f.notes[0].memoryImages = { recall: { attachmentId: 'recall.png', basedOnRevision: 1 }, understand: { attachmentId: 'understand.png', basedOnRevision: 1 } };
  vi.mocked(f.notesApi.attachments.readDataUrl).mockImplementation(async id => `data:image/png;base64,${id}`);
  await mount(f); await openBoardForAdding(); fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' }));
  const card = screen.getByRole('group', { name: 'Card: Feedback' });
  expect((await within(card).findByRole('img', { name: 'Recall image for Feedback' })).getAttribute('src')).toContain('recall.png');
  fireEvent.click(within(card).getByRole('img', { name: 'Recall image for Feedback' }));
  expect((await within(card).findByRole('img', { name: 'Understanding image for Feedback' })).getAttribute('src')).toContain('understand.png');
  fireEvent.click(within(card).getByRole('img', { name: 'Understanding image for Feedback' }));
  expect((await within(card).findByRole('img', { name: 'Recall image for Feedback' })).getAttribute('src')).toContain('recall.png');
  fireEvent.click(within(card).getByRole('button', { name: 'Flip card' }));
  fireEvent.click(within(card).getByRole('button', { name: 'Enlarge image' }));
  const dialog = await screen.findByRole('dialog', { name: 'Enlarged image: Feedback' });
  expect((await within(dialog).findByRole('img', { name: 'Understanding image: Feedback' })).getAttribute('src')).toContain('understand.png');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Flip to back image' }));
  expect((await within(dialog).findByRole('img', { name: 'Recall image: Feedback' })).getAttribute('src')).toContain('recall.png');
});
test('TC6: wheel pans, control-wheel zooms without browser defaults, text wheel stays local', async () => {
  const f = await mount(); await openBoardForAdding();
  const canvas = await screen.findByRole('region', { name: 'Whiteboard canvas' });
  const pan = new WheelEvent('wheel', { deltaY: 60, bubbles: true, cancelable: true }); fireEvent(canvas, pan); expect(pan.defaultPrevented).toBe(true);
  const zoom = new WheelEvent('wheel', { deltaY: -30, ctrlKey: true, clientX: 300, clientY: 200, bubbles: true, cancelable: true }); fireEvent(canvas, zoom); expect(zoom.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Add text' }));
  const textScroll = new WheelEvent('wheel', { deltaY: 30, bubbles: true, cancelable: true }); fireEvent(screen.getByRole('textbox', { name: 'Whiteboard text' }), textScroll); expect(textScroll.defaultPrevented).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'All whiteboards' })); await waitFor(() => expect(f.api.save).toHaveBeenCalled());
  expect(vi.mocked(f.api.save).mock.calls.at(-1)![0].viewport.zoom).toBeGreaterThan(1);
});

test('TC6: card surface drags directly while action buttons never move the card', async () => {
  const Original = window.PointerEvent;
  window.PointerEvent = window.MouseEvent as unknown as typeof PointerEvent;
  try {
    await mount(); await openBoardForAdding();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' }));
    const card = screen.getByRole('group', { name: 'Card: Feedback' });
    for (const target of [card, card.querySelector('.wb-card-image')!, card.querySelector('.reading-note-card-visual')!]) {
      const x = parseFloat(card.style.left);
      fireEvent.pointerDown(target, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(window, { clientX: 160, clientY: 120 });
      fireEvent.pointerUp(window, { clientX: 160, clientY: 120 });
      fireEvent.click(target);
      expect(parseFloat(card.style.left)).toBeCloseTo(x + 60);
      expect(card.getAttribute('data-side')).toBe('recall');
    }
    const image = card.querySelector('.wb-card-image')!;
    const beforeClick = card.getAttribute('style');
    fireEvent.pointerDown(image, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
    fireEvent.click(image);
    expect(card.getAttribute('data-side')).toBe('understand');
    expect(card.getAttribute('style')).toBe(beforeClick);
    fireEvent.click(within(card).getByRole('button', { name: 'Flip card' }));
    fireEvent.pointerDown(image, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerCancel(window);
    fireEvent.click(image);
    expect(card.getAttribute('data-side')).toBe('recall');
    fireEvent.keyDown(image, { key: 'Enter' });
    expect(card.getAttribute('data-side')).toBe('understand');
    fireEvent.keyDown(image, { key: ' ' });
    expect(card.getAttribute('data-side')).toBe('recall');
    for (const name of ['Flip card', 'Enlarge image', 'View detailed note', 'Remove from whiteboard', 'Connect card: right']) {
      const before = card.getAttribute('style');
      const button = within(card).getByRole('button', { name });
      fireEvent.pointerDown(button.querySelector('svg') ?? button, { clientX: 100, clientY: 100, button: 0 });
      fireEvent.pointerMove(window, { clientX: 160, clientY: 120 });
      fireEvent.pointerCancel(window, { clientX: 160, clientY: 120 });
      expect(card.getAttribute('style')).toBe(before);
    }
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card.getAttribute('data-side')).toBe('recall');
  } finally { window.PointerEvent = Original; }
});

test('TC7: all four card sides connect and retain the selected endpoints', async () => {
  const f = await mount(); await openBoardForAdding();
  fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' })); fireEvent.click(screen.getByRole('button', { name: 'Add Delay' }));
  const a = screen.getByRole('group', { name: 'Card: Feedback' }), b = screen.getByRole('group', { name: 'Card: Delay' });
  for (const side of ['top', 'right', 'bottom', 'left']) {
    expect(within(a).getByRole('button', { name: `Connect card: ${side}` })).toBeTruthy();
    fireEvent.click(within(a).getByRole('button', { name: `Connect card: ${side}` }));
    fireEvent.click(within(b).getByRole('button', { name: 'Connect card: top' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete connection' }));
  }
  fireEvent.click(within(a).getByRole('button', { name: 'Connect card: bottom' }));
  fireEvent.click(within(b).getByRole('button', { name: 'Connect card: top' }));
  fireEvent.click(screen.getByRole('button', { name: 'All whiteboards' }));
  await waitFor(() => expect(f.api.save).toHaveBeenCalled());
  expect(vi.mocked(f.api.save).mock.calls.at(-1)![0].edges[0]).toMatchObject({ sourceSide: 'bottom', targetSide: 'top' });
});

test('note placement filter tracks additions and removals and combines with title and book filters', async () => {
  await mount(); fireEvent.click(screen.getByRole('button', { name: 'Open Systems' }));
  const sidebar = await screen.findByRole('complementary', { name: 'Add reading notes' });
  await within(sidebar).findByText('目前白板沒有可用的筆記');
  expect(within(sidebar).queryByRole('button', { name: '全部' })).toBeNull();
  expect(within(sidebar).getByRole('button', { name: '目前白板' }).getAttribute('aria-pressed')).toBe('true');
  expect(within(sidebar).getByText('0 notes')).toBeTruthy();
  expect(within(sidebar).getByText('目前白板沒有可用的筆記')).toBeTruthy();
  fireEvent.click(within(sidebar).getByRole('button', { name: '未加入白板' }));
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Add Feedback' }));
  fireEvent.click(within(sidebar).getByRole('button', { name: '目前白板' }));
  expect(within(sidebar).getByRole('button', { name: 'Locate Feedback' })).toBeTruthy();
  expect(within(sidebar).queryByRole('button', { name: 'Add Delay' })).toBeNull();
  expect(within(sidebar).getByText('1 notes')).toBeTruthy();
  fireEvent.click(within(sidebar).getByRole('button', { name: '未加入白板' }));
  expect(within(sidebar).queryByRole('button', { name: 'Locate Feedback' })).toBeNull();
  expect(within(sidebar).getByRole('button', { name: 'Add Delay' })).toBeTruthy();
  fireEvent.change(within(sidebar).getByRole('searchbox'), { target: { value: 'Feedback' } });
  expect(within(sidebar).getByText('No matching notes')).toBeTruthy();
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Clear filters' }));
  expect(within(sidebar).getByRole('button', { name: '未加入白板' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(within(sidebar).getByRole('button', { name: '目前白板' }));
  fireEvent.focus(within(sidebar).getByRole('combobox', { name: 'Book' }));
  fireEvent.click(within(sidebar).getByRole('option', { name: 'Second book' }));
  expect(within(sidebar).getByText('No matching notes')).toBeTruthy();
  fireEvent.click(within(sidebar).getByRole('button', { name: '未加入白板' }));
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Add Delay' }));
  expect(within(sidebar).getByText('0 notes')).toBeTruthy();
  expect(within(sidebar).queryByRole('button', { name: 'Add Delay' })).toBeNull();
  const card = screen.getByRole('group', { name: 'Card: Delay' });
  fireEvent.click(within(card).getByRole('button', { name: 'Remove from whiteboard' }));
  expect(within(sidebar).getByRole('button', { name: 'Add Delay' })).toBeTruthy();
});

test('TC4: notes sidebar collapses and restores filters without moving cards', async () => {
  await mount(); await openBoardForAdding();
  fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' }));
  const card = screen.getByRole('group', { name: 'Card: Feedback' }); const before = card.getAttribute('style');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search notes' }), { target: { value: 'Feedback' } });
  fireEvent.focus(screen.getByRole('combobox', { name: 'Book' }));
  fireEvent.click(screen.getByRole('option', { name: 'Second book' }));
  fireEvent.click(screen.getByRole('button', { name: '目前白板' }));
  fireEvent.click(screen.getByRole('button', { name: 'Collapse reading notes' }));
  expect(screen.queryByRole('searchbox', { name: 'Search notes' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Expand reading notes' }).getAttribute('aria-expanded')).toBe('false');
  expect(card.getAttribute('style')).toBe(before);
  fireEvent.click(screen.getByRole('button', { name: 'Expand reading notes' }));
  expect((screen.getByRole('searchbox', { name: 'Search notes' }) as HTMLInputElement).value).toBe('Feedback');
  expect((screen.getByRole('combobox', { name: 'Book' }) as HTMLInputElement).value).toBe('Second book');
  expect(screen.getByRole('button', { name: '目前白板' }).getAttribute('aria-pressed')).toBe('true');
  expect(card.getAttribute('style')).toBe(before);
});

test('image dimensions resize the card and its connections, including after flipping', async () => {
  const f = fixture();
  f.notes[0].memoryImages = { recall: { attachmentId: 'recall.png', basedOnRevision: 1 }, understand: { attachmentId: 'front.png', basedOnRevision: 1 } };
  vi.mocked(f.notesApi.attachments.readDataUrl).mockImplementation(async id => `data:image/png;base64,${id}`);
  await mount(f); await openBoardForAdding();
  fireEvent.click(await screen.findByRole('button', { name: 'Add Feedback' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add Delay' }));
  const card = screen.getByRole('group', { name: 'Card: Feedback' });
  const other = screen.getByRole('group', { name: 'Card: Delay' });
  fireEvent.click(within(card).getByRole('button', { name: 'Connect card: bottom' }));
  fireEvent.click(within(other).getByRole('button', { name: 'Connect card: top' }));
  const left = card.style.left, top = card.style.top;
  const loadImage = async (name: string, width: number, height: number) => {
    const image = await within(card).findByRole('img', { name });
    Object.defineProperties(image, { naturalWidth: { configurable: true, value: width }, naturalHeight: { configurable: true, value: height } });
    fireEvent.load(image);
  };
  await loadImage('Recall image for Feedback', 1024, 1024);
  expect(card.style.height).toBe('340px');
  expect(document.querySelector('.wb-edge-line')?.getAttribute('d')).toMatch(new RegExp(`^M${parseFloat(left) + 170} ${parseFloat(top) + 340} `));
  fireEvent.click(within(card).getByRole('button', { name: 'Flip card' }));
  await loadImage('Understanding image for Feedback', 1536, 1024);
  expect(parseFloat(card.style.height)).toBeCloseTo(2 + 338 * 2 / 3);
  expect(card.style.left).toBe(left); expect(card.style.top).toBe(top);
  fireEvent.click(screen.getByRole('button', { name: 'All whiteboards' }));
  await screen.findByRole('button', { name: 'Open Systems' });
  expect(vi.mocked(f.api.save).mock.calls.at(-1)![0].notes[0].height).toBeCloseTo(2 + 338 * 2 / 3);
});

test('F60 whiteboard tag filters combine with placement, book and search and clear safely', async () => {
  const f = fixture(); f.notes[0].tagIds = ['a']; f.notes[1].tagIds = ['b'];
  f.notesApi.tags = { list: vi.fn(async () => [{ id: 'a', name: 'Communication' }, { id: 'b', name: 'Learning' }]), create: vi.fn(), rename: vi.fn(), matchingIds: vi.fn(), change: vi.fn() };
  await mount(f); await openBoardForAdding();
  const sidebar = screen.getByRole('complementary', { name: 'Add reading notes' });
  fireEvent.click(await within(sidebar).findByText('Tags · All'));
  fireEvent.click(await within(sidebar).findByRole('checkbox', { name: 'Communication' }));
  expect(within(sidebar).getByRole('button', { name: 'Add Feedback' })).toBeTruthy();
  expect(within(sidebar).queryByRole('button', { name: 'Add Delay' })).toBeNull();
  fireEvent.click(within(sidebar).getByRole('checkbox', { name: 'Learning' }));
  expect(within(sidebar).getByRole('button', { name: 'Add Delay' })).toBeTruthy();
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Add Feedback' }));
  fireEvent.click(within(sidebar).getByRole('button', { name: '目前白板' }));
  expect(within(sidebar).getByRole('button', { name: 'Locate Feedback' })).toBeTruthy();
  fireEvent.focus(within(sidebar).getByRole('combobox', { name: 'Book' }));
  fireEvent.click(within(sidebar).getByRole('option', { name: 'Second book' }));
  expect(within(sidebar).getByText('No matching notes')).toBeTruthy();
  fireEvent.click(within(sidebar).getByRole('button', { name: 'Clear filters' }));
  expect(within(sidebar).getByText('Tags · All')).toBeTruthy();
  expect(within(sidebar).getByRole('button', { name: 'Locate Feedback' })).toBeTruthy();
  fireEvent.change(within(sidebar).getByRole('searchbox'), { target: { value: 'Delay' } });
  expect(within(sidebar).getByText('No matching notes')).toBeTruthy();
});
