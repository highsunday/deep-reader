import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { LocalWhiteboardStore } from '../src/main/whiteboard-store';
import { registerWhiteboardIpc } from '../src/main/whiteboard-ipc';
import { canvasPoint, fitBoard, zoomBoard } from '../src/shared/whiteboard';
test('TC2,8,13: IPC persists boards and validates untrusted inputs', () => {
  const directory = mkdtempSync(join(tmpdir(), 'f43-ipc-'));
  try {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const store = new LocalWhiteboardStore(directory, { getNote: () => undefined });
    registerWhiteboardIpc({ handle: (name, fn) => handlers.set(name, fn) }, store);
    const call = (name: string, value?: unknown) => handlers.get(`whiteboards:${name}`)!(null, value);
    expect(handlers.size).toBe(5);
    expect(() => call('create', {})).toThrow(); expect(() => call('list', { search: 'x' })).toThrow();
    const board = call('create', 'Connections') as ReturnType<LocalWhiteboardStore['create']>;
    expect(call('get', board.id)).toEqual(board); expect(() => call('save', { ...board, baseRevision: '1' })).toThrow();
    expect(() => call('save', { ...board, baseRevision: 1, edges: null })).toThrow();
    call('remove', board.id); expect(call('list')).toEqual([]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('TC6: screen/world transforms, anchored zoom, limits and fit-to-content', () => {
  const viewport = { x: 50, y: -20, zoom: .5 };
  expect(canvasPoint({ x: 250, y: 100 }, { left: 100, top: 30 }, viewport)).toEqual({ x: 200, y: 180 });
  const anchor = { x: 500, y: 300 }, zoomed = zoomBoard(viewport, 2, anchor);
  expect(canvasPoint(anchor, { left: 0, top: 0 }, viewport)).toEqual(canvasPoint(anchor, { left: 0, top: 0 }, zoomed));
  expect(zoomBoard(viewport, 100, anchor).zoom).toBe(2.5);
  expect(fitBoard({ notes: [], texts: [] }, 800, 600)).toEqual({ x: 0, y: 0, zoom: 1 });
  const fitted = fitBoard({ notes: [{ id: 'p', noteId: 'n', x: -500, y: 100 }], texts: [{ id: 't', text: '', x: 700, y: 800 }] }, 1000, 800);
  expect(fitted.zoom).toBeGreaterThanOrEqual(.2); expect(fitted.zoom).toBeLessThan(1);
});

test('F43 UX: consecutive additions find visible space instead of stacking cards', async () => {
  const geometry = await import('../src/shared/whiteboard');
  expect(geometry.placeBoardElement, 'Adding notes should avoid covering earlier cards').toBeTypeOf('function');
  const initial = { notes: [], texts: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const first = geometry.placeBoardElement(initial, 850, 620);
  const board = { ...initial, notes: [{ id: 'p', noteId: 'n', x: first.x, y: first.y }] };
  const next = geometry.placeBoardElement(board, 850, 620);
  expect(Math.abs(next.x - first.x) >= geometry.BOARD_CARD_WIDTH + 24 || Math.abs(next.y - first.y) >= geometry.BOARD_CARD_HEIGHT + 24).toBe(true);
  expect(next.x * next.viewport.zoom + next.viewport.x).toBeGreaterThanOrEqual(0);
  expect(next.x * next.viewport.zoom + next.viewport.x + geometry.BOARD_CARD_WIDTH * next.viewport.zoom).toBeLessThanOrEqual(850);
  const narrow = geometry.placeBoardElement(board, 300, 330);
  expect(Math.abs(narrow.x - first.x) >= geometry.BOARD_CARD_WIDTH + 24 || Math.abs(narrow.y - first.y) >= geometry.BOARD_CARD_HEIGHT + 24).toBe(true);
});

test('TC7: every side anchors to its edge and legacy connections retain horizontal endpoints', async () => {
  const { BOARD_SIDES, BOARD_CARD_WIDTH: w, BOARD_CARD_HEIGHT: h, boardPort, boardEdgeGeometry } = await import('../src/shared/whiteboard');
  const a = { x: 10, y: 20 }, b = { x: 600, y: 800 };
  expect(boardPort(a, 'top')).toEqual({ x: 10 + w / 2, y: 20 });
  expect(boardPort(a, 'bottom')).toEqual({ x: 10 + w / 2, y: 20 + h });
  expect(boardPort(a, 'left')).toEqual({ x: 10, y: 20 + h / 2 });
  expect(boardPort(a, 'right')).toEqual({ x: 10 + w, y: 20 + h / 2 });
  for (const sourceSide of BOARD_SIDES) for (const targetSide of BOARD_SIDES) {
    const edge = boardEdgeGeometry(a, b, { sourceSide, targetSide });
    expect(edge.start).toEqual(boardPort(a, sourceSide)); expect(edge.end).toEqual(boardPort(b, targetSide));
    expect(Number.isFinite(edge.label.x) && Number.isFinite(edge.label.y)).toBe(true);
  }
  expect(boardEdgeGeometry(a, b, {}).start).toEqual(boardPort(a, 'right'));
  expect(boardEdgeGeometry(a, b, {}).end).toEqual(boardPort(b, 'left'));
});

test('fit and placement use the image-sized bounds of cards', async () => {
  const { fitBoard, placeBoardElement } = await import('../src/shared/whiteboard');
  const note = { id: 'p', noteId: 'n', x: 0, y: 0, height: 1000 };
  const board = { notes: [note], texts: [], viewport: { x: 0, y: 0, zoom: 1 } };
  const fit = fitBoard(board, 800, 600);
  expect(note.y * fit.zoom + fit.y).toBeGreaterThanOrEqual(40);
  expect((note.y + note.height) * fit.zoom + fit.y).toBeLessThanOrEqual(560);
  const next = placeBoardElement(board, 800, 1200);
  expect(next.x >= 364 || next.x + 364 <= 0 || next.y >= 1024 || next.y + 504 <= 0).toBe(true);
});
