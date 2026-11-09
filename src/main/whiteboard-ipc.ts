import type { LocalWhiteboardStore } from './whiteboard-store';
export function registerWhiteboardIpc(ipc: { handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown }, store: LocalWhiteboardStore): void {
  ipc.handle('whiteboards:list', (_event, search) => store.list(search));
  ipc.handle('whiteboards:get', (_event, id) => store.get(id));
  ipc.handle('whiteboards:create', (_event, title) => store.create(title));
  ipc.handle('whiteboards:save', (_event, input) => store.save(input));
  ipc.handle('whiteboards:remove', (_event, id) => store.remove(id));
}
