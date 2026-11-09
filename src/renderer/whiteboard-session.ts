import type { Whiteboard, WhiteboardsApi } from '../shared/whiteboard';
export interface BoardSessionState { board: Whiteboard; status: 'saved' | 'dirty' | 'saving' | 'error'; error?: string }
/** One board per session; in-flight saves never replace more recent local edits. */
export class WhiteboardSession {
  private state: BoardSessionState;
  private listeners = new Set<() => void>();
  private generation = 0;
  private savedGeneration = 0;
  private revision: number;
  private pending?: Promise<boolean>;
  constructor(board: Whiteboard, private save: WhiteboardsApi['save']) {
    this.state = { board, status: 'saved' }; this.revision = board.revision;
  }
  getSnapshot = (): BoardSessionState => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: BoardSessionState) { this.state = state; this.listeners.forEach(listener => listener()); }
  edit(update: (board: Whiteboard) => Whiteboard): void {
    const board = update(this.state.board);
    if (board === this.state.board) return;
    if (board.id !== this.state.board.id) throw new Error('Cannot change a whiteboard session identity.');
    this.generation++;
    this.publish({ board, status: this.state.status === 'error' ? 'error' : 'dirty', error: this.state.error });
  }
  flush = (): Promise<boolean> => {
    if (this.pending) return this.pending;
    if (this.savedGeneration === this.generation) return Promise.resolve(true);
    this.pending = this.run().finally(() => { this.pending = undefined; });
    return this.pending;
  };
  private async run(): Promise<boolean> {
    while (this.savedGeneration < this.generation) {
      const generation = this.generation, board = this.state.board;
      this.publish({ board, status: 'saving' });
      try {
        const saved = await this.save({ ...board, baseRevision: this.revision });
        this.revision = saved.revision; this.savedGeneration = generation;
        this.publish({ board: generation === this.generation ? saved : { ...this.state.board, revision: saved.revision, updatedAt: saved.updatedAt }, status: generation === this.generation ? 'saved' : 'dirty' });
      } catch (error) {
        this.publish({ board: this.state.board, status: 'error', error: error instanceof Error ? error.message : String(error) });
        return false;
      }
    }
    return true;
  }
}
