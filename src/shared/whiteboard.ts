export interface BoardPoint { x: number; y: number }
export interface BoardViewport extends BoardPoint { zoom: number }
export interface BoardNote extends BoardPoint { id: string; noteId: string; height?: number }
export interface BoardText extends BoardPoint { id: string; text: string }
export type BoardSide = 'top' | 'right' | 'bottom' | 'left';
export const BOARD_SIDES: BoardSide[] = ['top', 'right', 'bottom', 'left'];
export interface BoardEdge { sourceSide?: BoardSide; targetSide?: BoardSide; id: string; source: string; target: string; label: string; arrow: boolean }
export interface Whiteboard {
  id: string; title: string; revision: number; createdAt: number; updatedAt: number;
  notes: BoardNote[]; texts: BoardText[]; edges: BoardEdge[]; viewport: BoardViewport;
}
export type SaveWhiteboard = Pick<Whiteboard, 'id' | 'title' | 'notes' | 'texts' | 'edges' | 'viewport'> & { baseRevision: number };
export interface WhiteboardsApi {
  list(search?: string): Promise<Whiteboard[]>;
  get(id: string): Promise<Whiteboard>;
  create(title: string): Promise<Whiteboard>;
  save(input: SaveWhiteboard): Promise<Whiteboard>;
  remove(id: string): Promise<void>;
}
export const BOARD_CARD_WIDTH = 340;
export const BOARD_CARD_HEIGHT = 480;
export const BOARD_TEXT_HEIGHT = 150;
export function boardCardHeight(note: { height?: number }): number { return note.height ?? BOARD_CARD_HEIGHT; }
export function boardId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('Invalid whiteboard identifier.');
  return value;
}
export function boardTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw new Error('Enter a whiteboard name (1–200 characters).');
  return value.trim();
}
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid whiteboard data.');
  return v as Record<string, unknown>;
}
function coordinate(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1_000_000) throw new Error('Invalid whiteboard position.');
  return v;
}
function point(v: Record<string, unknown>): BoardPoint { return { x: coordinate(v.x), y: coordinate(v.y) }; }
function text(v: unknown, limit: number): string {
  if (typeof v !== 'string' || v.length > limit) throw new Error('Invalid whiteboard text.');
  return v;
}
function array<T>(v: unknown, parse: (item: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(v) || v.length > 5000) throw new Error('Invalid whiteboard elements.');
  return v.map(item => parse(obj(item)));
}
export function parseBoardContent(value: unknown): Pick<Whiteboard, 'title' | 'notes' | 'texts' | 'edges' | 'viewport'> {
  const v = obj(value), viewport = obj(v.viewport);
  if (typeof viewport.zoom !== 'number' || !Number.isFinite(viewport.zoom) || viewport.zoom < 0.2 || viewport.zoom > 2.5) throw new Error('Invalid whiteboard zoom.');
  const notes = array(v.notes, n => {
    if (n.height !== undefined && (typeof n.height !== 'number' || !Number.isFinite(n.height) || n.height <= 2 || n.height > 1_000_000)) throw new Error('Invalid whiteboard card height.');
    return { id: boardId(n.id), noteId: boardId(n.noteId), ...point(n), ...(n.height !== undefined ? { height: n.height as number } : {}) };
  });
  const texts = array(v.texts, t => ({ id: boardId(t.id), text: text(t.text, 20000), ...point(t) }));
  const edges = array(v.edges, e => {
    if (typeof e.arrow !== 'boolean') throw new Error('Invalid whiteboard arrow.');
    for (const side of [e.sourceSide, e.targetSide]) if (side !== undefined && !BOARD_SIDES.includes(side as BoardSide)) throw new Error('Invalid connection side.');
    return { ...(e.sourceSide !== undefined ? { sourceSide: e.sourceSide as BoardSide } : {}), ...(e.targetSide !== undefined ? { targetSide: e.targetSide as BoardSide } : {}), id: boardId(e.id), source: boardId(e.source), target: boardId(e.target), label: text(e.label, 1000), arrow: e.arrow };
  });
  const ids = [...notes, ...texts, ...edges].map(n => n.id);
  if (new Set(ids).size !== ids.length || new Set(notes.map(n => n.noteId)).size !== notes.length) throw new Error('Duplicate whiteboard element.');
  const noteIds = new Set(notes.map(n => n.id)), pairs = new Set<string>();
  for (const edge of edges) {
    const pair = JSON.stringify(edge.arrow ? [edge.source, edge.target, true] : [...[edge.source, edge.target].sort(), false]);
    if (edge.source === edge.target || !noteIds.has(edge.source) || !noteIds.has(edge.target) || pairs.has(pair)) throw new Error('Invalid or duplicate whiteboard connection.');
    pairs.add(pair);
  }
  return { title: boardTitle(v.title), notes, texts, edges, viewport: { ...point(viewport), zoom: viewport.zoom } };
}
export function boardRevision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Invalid whiteboard version.');
  return value;
}
export function parseWhiteboard(value: unknown): Whiteboard {
  const v = obj(value);
  for (const field of ['createdAt', 'updatedAt']) if (typeof v[field] !== 'number' || !Number.isFinite(v[field]) || Number(v[field]) < 0) throw new Error('Invalid whiteboard timestamp.');
  return { ...parseBoardContent(v), id: boardId(v.id), revision: boardRevision(v.revision), createdAt: Number(v.createdAt), updatedAt: Number(v.updatedAt) };
}
export function canvasPoint(client: BoardPoint, rect: { left: number; top: number }, viewport: BoardViewport): BoardPoint {
  return { x: (client.x - rect.left - viewport.x) / viewport.zoom, y: (client.y - rect.top - viewport.y) / viewport.zoom };
}
export function zoomBoard(viewport: BoardViewport, zoom: number, anchor: BoardPoint): BoardViewport {
  zoom = Math.max(0.2, Math.min(2.5, zoom));
  return { zoom, x: anchor.x - (anchor.x - viewport.x) * zoom / viewport.zoom, y: anchor.y - (anchor.y - viewport.y) * zoom / viewport.zoom };
}
export function fitBoard(board: Pick<Whiteboard, 'notes' | 'texts'>, width: number, height: number): BoardViewport {
  const all = [...board.notes.map(n => ({ ...n, height: boardCardHeight(n) })), ...board.texts.map(n => ({ ...n, height: BOARD_TEXT_HEIGHT }))];
  if (!all.length) return { x: 0, y: 0, zoom: 1 };
  const left = Math.min(...all.map(n => n.x)), top = Math.min(...all.map(n => n.y));
  const w = Math.max(...all.map(n => n.x + BOARD_CARD_WIDTH)) - left, h = Math.max(...all.map(n => n.y + n.height)) - top;
  const zoom = Math.max(0.2, Math.min(1.25, (width - 80) / w, (height - 80) / h));
  return { x: (width - w * zoom) / 2 - left * zoom, y: (height - h * zoom) / 2 - top * zoom, zoom };
}

/** Keep a new element visible and separated from existing cards and text. */
export function placeBoardElement(
  board: Pick<Whiteboard, 'notes' | 'texts' | 'viewport'>,
  width: number,
  height: number,
  elementHeight = BOARD_CARD_HEIGHT
): BoardPoint & { viewport: BoardViewport } {
  const viewport = { ...board.viewport, zoom: Math.min(board.viewport.zoom, Math.max(.2, Math.min((width - 32) / BOARD_CARD_WIDTH, (height - 32) / elementHeight))) };
  const zoom = viewport.zoom;
  const center = { x: (width / 2 - viewport.x) / zoom - BOARD_CARD_WIDTH / 2, y: (height / 2 - viewport.y) / zoom - elementHeight / 2 };
  const occupied = [...board.notes.map(n => ({ ...n, height: boardCardHeight(n) })), ...board.texts.map(t => ({ ...t, height: BOARD_TEXT_HEIGHT }))];
  const available = (point: BoardPoint) => occupied.every(n => point.x + BOARD_CARD_WIDTH + 24 <= n.x || point.x >= n.x + BOARD_CARD_WIDTH + 24 || point.y + elementHeight + 24 <= n.y || point.y >= n.y + n.height + 24);
  const visible = (point: BoardPoint) => point.x * zoom + viewport.x >= 16 && point.y * zoom + viewport.y >= 16 && (point.x + BOARD_CARD_WIDTH) * zoom + viewport.x <= width - 16 && (point.y + elementHeight) * zoom + viewport.y <= height - 16;
  const candidates = [center];
  for (let row = 0; row < Math.min(20, height / zoom / (elementHeight + 24)); row++) {
    for (let col = 0; col < Math.min(20, width / zoom / (BOARD_CARD_WIDTH + 24)); col++) {
      candidates.push({ x: (16 - viewport.x) / zoom + col * (BOARD_CARD_WIDTH + 24), y: (16 - viewport.y) / zoom + row * (elementHeight + 24) });
    }
  }
  const point = candidates.find(p => visible(p) && available(p));
  if (point) return { ...point, viewport };
  const x = occupied.length ? Math.max(...occupied.map(n => n.x + BOARD_CARD_WIDTH)) + 24 : center.x;
  const y = center.y;
  return { x, y, viewport: { zoom, x: width / 2 - (x + BOARD_CARD_WIDTH / 2) * zoom, y: height / 2 - (y + elementHeight / 2) * zoom } };
}

export function boardPort(note: BoardPoint & { height?: number }, side: BoardSide): BoardPoint {
  return { x: note.x + (side === 'left' ? 0 : side === 'right' ? BOARD_CARD_WIDTH : BOARD_CARD_WIDTH / 2), y: note.y + (side === 'top' ? 0 : side === 'bottom' ? boardCardHeight(note) : boardCardHeight(note) / 2) };
}
export function boardEdgeGeometry(a: BoardPoint & { height?: number }, b: BoardPoint & { height?: number }, edge: Pick<BoardEdge, 'sourceSide' | 'targetSide'>) {
  const sourceSide = edge.sourceSide ?? (b.x >= a.x ? 'right' : 'left');
  const targetSide = edge.targetSide ?? (b.x >= a.x ? 'left' : 'right');
  const start = boardPort(a, sourceSide), end = boardPort(b, targetSide);
  const normals = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
  const bend = Math.max(60, Math.min(220, Math.hypot(end.x - start.x, end.y - start.y) * .45));
  const c1 = { x: start.x + normals[sourceSide].x * bend, y: start.y + normals[sourceSide].y * bend };
  const c2 = { x: end.x + normals[targetSide].x * bend, y: end.y + normals[targetSide].y * bend };
  return { start, end, path: `M${start.x} ${start.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`, label: { x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8, y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8 } };
}
