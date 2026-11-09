import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardId, boardRevision, boardTitle, parseBoardContent, parseWhiteboard } from '../shared/whiteboard';
import type { Whiteboard } from '../shared/whiteboard';
interface Options {
  getNote(id: string): { id: string; trashedAt?: number } | undefined;
  now?(): number;
  write?(path: string, data: string): void;
}
export class LocalWhiteboardStore {
  private boards?: Whiteboard[];
  private readonly path: string;
  constructor(private directory: string, private options: Options) { this.path = join(directory, 'whiteboards.json'); }
  private load(): Whiteboard[] {
    if (this.boards) return this.boards;
    let raw: string;
    try { raw = readFileSync(this.path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.boards = []; throw new Error('Could not read whiteboard data.'); }
    try {
      const state = JSON.parse(raw);
      if (state.version !== 1 || !Array.isArray(state.boards)) throw new Error();
      const boards: Whiteboard[] = state.boards.map(parseWhiteboard);
      if (new Set(boards.map(b => b.id)).size !== boards.length) throw new Error();
      return this.boards = boards;
    } catch { throw new Error('Could not read whiteboard data. The original file has been preserved.'); }
  }
  private commit(boards: Whiteboard[]): void {
    mkdirSync(this.directory, { recursive: true });
    const data = JSON.stringify({ version: 1, boards }, null, 2);
    if (this.options.write) this.options.write(this.path, data);
    else {
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try { writeFileSync(temporary, data, 'utf8'); renameSync(temporary, this.path); }
      finally { rmSync(temporary, { force: true }); }
    }
    this.boards = boards;
  }
  list(search: unknown = ''): Whiteboard[] {
    if (typeof search !== 'string') throw new Error('Invalid whiteboard search.');
    const query = search.trim().toLocaleLowerCase();
    return structuredClone(this.load().filter(b => b.title.toLocaleLowerCase().includes(query)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)));
  }
  get(id: unknown): Whiteboard {
    const board = this.load().find(b => b.id === boardId(id));
    if (!board) throw new Error('Whiteboard not found.');
    return structuredClone(board);
  }
  create(title: unknown): Whiteboard {
    const boards = this.load(), now = (this.options.now ?? Date.now)();
    const board: Whiteboard = { id: randomUUID(), title: boardTitle(title), revision: 1, createdAt: now, updatedAt: now, notes: [], texts: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
    this.commit([...boards, board]); return structuredClone(board);
  }
  save(value: unknown): Whiteboard {
    if (!value || typeof value !== 'object') throw new Error('Invalid whiteboard update.');
    const input = value as Record<string, unknown>, current = this.get(input.id);
    if (boardRevision(input.baseRevision) !== current.revision) throw new Error('This whiteboard changed elsewhere. Reload the saved version before editing.');
    const content = parseBoardContent(input);
    for (const placement of content.notes) {
      if (current.notes.some(n => n.id === placement.id && n.noteId === placement.noteId)) continue;
      const note = this.options.getNote(placement.noteId);
      if (!note || note.trashedAt !== undefined) throw new Error('This reading note is unavailable. Refresh notes and try again.');
    }
    const board: Whiteboard = { ...current, ...content, revision: current.revision + 1, updatedAt: (this.options.now ?? Date.now)() };
    this.commit(this.load().map(b => b.id === board.id ? board : b)); return structuredClone(board);
  }
  remove(id: unknown): void { const board = this.get(id); this.commit(this.load().filter(b => b.id !== board.id)); }
}
