import type { ChangeBookTagInput, ChangeReadingNoteTagsInput } from '../shared/contracts';
import { parseReadingNoteListInput } from './app-ipc';
import type { LocalReadingNoteStore } from './reading-note-store';

export function registerReadingNoteTagsIpc(ipc: { handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown }, store: LocalReadingNoteStore): void {
  ipc.handle('reading-notes:book-tags-list', () => store.bookTags());
  ipc.handle('reading-notes:book-tags-change', (_event, input) => store.changeBookTag(input as ChangeBookTagInput));
  ipc.handle('reading-notes:tags-list', () => store.listTags());
  ipc.handle('reading-notes:tags-create', (_event, name) => store.createTag(name));
  // The store validates all mutation input before touching in-memory or persisted data.
  ipc.handle('reading-notes:tags-rename', (_event, input) => store.renameTag(input as { id: string; name: string }));
  ipc.handle('reading-notes:tags-change', (_event, input) => store.changeTags(input as ChangeReadingNoteTagsInput));
  ipc.handle('reading-notes:tags-matching-ids', (_event, input) => store.matchingIds(parseReadingNoteListInput(input)));
}
