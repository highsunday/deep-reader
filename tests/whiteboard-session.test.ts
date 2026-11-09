import { expect, test, vi } from 'vitest';
import type { Whiteboard, WhiteboardsApi } from '../src/shared/whiteboard';
import type { WhiteboardSession } from '../src/renderer/whiteboard-session';
const loaders = import.meta.glob('../src/renderer/whiteboard-session.ts');
const board: Whiteboard = { id: 'b', title: 'A', revision: 1, createdAt: 1, updatedAt: 1, notes: [], texts: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };
async function session(save: WhiteboardsApi['save']) {
  const loader = loaders['../src/renderer/whiteboard-session.ts']; expect(loader, 'F43 needs a serialized autosave session').toBeTypeOf('function');
  const mod = await loader() as { WhiteboardSession: typeof WhiteboardSession };
  return new mod.WhiteboardSession(board, save);
}
test('TC14: sequential saves preserve edits made during in-flight requests', async () => {
  let resolve!: (b: Whiteboard) => void;
  const save = vi.fn<WhiteboardsApi['save']>().mockImplementationOnce(() => new Promise(r => { resolve = r; }))
    .mockImplementation(async input => ({ ...board, ...input, revision: input.baseRevision + 1 }));
  const s = await session(save); s.edit(b => ({ ...b, title: 'First' }));
  const pending = s.flush(); s.edit(b => ({ ...b, title: 'Latest' }));
  resolve({ ...board, title: 'First', revision: 2 }); await pending;
  expect(save).toHaveBeenCalledTimes(2); expect(save.mock.calls[1][0].baseRevision).toBe(2);
  expect(s.getSnapshot().board.title).toBe('Latest'); expect(s.getSnapshot().status).toBe('saved');
});
test('TC14: failure retains edits; explicit retry saves them without using another board', async () => {
  const save = vi.fn<WhiteboardsApi['save']>().mockRejectedValueOnce(new Error('Disk full')).mockImplementation(async input => ({ ...board, ...input, revision: 2 }));
  const s = await session(save); s.edit(b => ({ ...b, title: 'Retained' }));
  expect(await s.flush()).toBe(false); expect(s.getSnapshot().board.title).toBe('Retained'); expect(s.getSnapshot().status).toBe('error');
  expect(await s.flush()).toBe(true); expect(save.mock.calls[1][0].id).toBe('b'); expect(s.getSnapshot().status).toBe('saved');
});
