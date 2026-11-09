// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReadingNoteTagPicker, ReadingNoteTagManager, ReadingNoteTagEditor } from '../src/renderer/ReadingNoteTags';
import type { ReaderDesktopApi, ReadingNoteTagsApi } from '../src/shared/contracts';
afterEach(cleanup);
function fixture() {
  const tags = [{ id: 'a', name: 'Communication' }, { id: 'b', name: 'Psychology' }];
  const api: ReadingNoteTagsApi = { list: vi.fn(async () => tags), create: vi.fn(async name => ({ id: 'new', name })), rename: vi.fn(async input => input), matchingIds: vi.fn(async () => []), change: vi.fn(async () => 1) };
  return { tags, api };
}
test('TC6: picker searches, creates a tag and applies it explicitly', async () => {
  const { api } = fixture(); const picked = vi.fn();
  render(<ReadingNoteTagPicker api={api} title="Add tag" onPick={picked} onClose={() => {}} />);
  await screen.findByText('Communication');
  fireEvent.change(screen.getByLabelText('Search or create tag'), { target: { value: 'Relationships' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create “Relationships”' }));
  await waitFor(() => expect(picked).toHaveBeenCalledWith({ id: 'new', name: 'Relationships' }));
});
test('TC6: manager renames and keeps validation errors visible', async () => {
  const { api } = fixture(); vi.mocked(api.rename).mockRejectedValueOnce(new Error('Already exists'));
  render(<ReadingNoteTagManager api={api} onChanged={() => {}} onClose={() => {}} />);
  const input = await screen.findByLabelText('Rename Communication');
  fireEvent.change(input, { target: { value: 'New name' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save Communication' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Already exists');
  fireEvent.click(screen.getByRole('button', { name: 'Save Communication' }));
  await waitFor(() => expect(api.rename).toHaveBeenCalledTimes(2));
});
test('TC6: saved note tag editor removes one association and keeps others', async () => {
  const { api: tags } = fixture();
  const api = { tags, get: vi.fn(async () => ({ id: 'note', tagIds: ['a', 'b'] })) } as unknown as ReaderDesktopApi['readingNotes'];
  render(<ReadingNoteTagEditor api={api} noteId="note" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Remove Communication' }));
  await waitFor(() => expect(tags.change).toHaveBeenCalledWith({ noteIds: ['note'], tagId: 'a', action: 'remove' }));
  expect(screen.getByText('Psychology')).toBeDefined();
});
