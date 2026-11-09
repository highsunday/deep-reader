import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { registerPracticeIpc } from '../src/main/practice-ipc';
import { LocalPracticeStore } from '../src/main/practice-store';
test('F45 T1,2: IPC validates and persists idempotent commands across restart', () => {
  const directory = mkdtempSync(join(tmpdir(), 'f45-ipc-'));
  try {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const options = { getNote: (id: string) => id === 'note' ? { id } : undefined };
    registerPracticeIpc({ handle: (name, listener) => handlers.set(name, listener) }, new LocalPracticeStore(directory, options));
    const setPinned = (value: unknown) => handlers.get('practice:set-pinned')!(null, value);
    expect(() => setPinned({ noteId: 'note', pinned: 1 })).toThrow();
    expect(() => setPinned({ noteId: 'missing', pinned: true })).toThrow();
    const pinned = setPinned({ noteId: 'note', pinned: true });
    expect(setPinned({ noteId: 'note', pinned: true })).toEqual(pinned);
    expect(new LocalPracticeStore(directory, options).list()).toEqual(pinned);
    setPinned({ noteId: 'note', pinned: false });
    expect(handlers.get('practice:list')!(null)).toMatchObject({ pins: [] });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
