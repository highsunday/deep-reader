import type { LocalPracticeStore } from './practice-store';
export function registerPracticeIpc(ipc: { handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown }, store: LocalPracticeStore): void {
  ipc.handle('practice:list', () => store.list());
  ipc.handle('practice:set-pinned', (_event, input) => store.setPinned(input));
}
