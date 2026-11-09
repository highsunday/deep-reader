// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { ConceptVideo, ConceptVideoApi } from '../src/shared/concept-video';
const modules = import.meta.glob('../src/renderer/ReaderVideosPanel.tsx');
async function component() {
  const loader = modules['../src/renderer/ReaderVideosPanel.tsx'];
  expect(loader, 'F59 requires a reader Videos panel').toBeTypeOf('function');
  return (await loader!()) as typeof import('../src/renderer/ReaderVideosPanel');
}
const plan = { title: 'Feedback', goal: 'Explain feedback', scenes: [], pace: 'normal' as const, narration: false };
const first: ConceptVideo = { id: 'v1', revision: 1, createdAt: 1, updatedAt: 1, status: 'completed', source: { bookId: 'b1', chapterId: 'c1', bookTitle: 'Same book', chapterTitle: 'Same chapter', range: { start: 0, end: 1 }, readingSegment: 'x', images: [] }, context: [], plan, discussion: [], conflicts: [], currentVersionId: 'adopted', versions: [{ id: 'adopted', createdAt: 2, plan, durationSeconds: 8, bytes: 1, scenes: [] }, { id: 'preview', createdAt: 3, plan: { ...plan, title: 'Unadopted' }, durationSeconds: 9, bytes: 1, scenes: [] }] };
const second = { ...first, id: 'v2', updatedAt: 4, source: { ...first.source, chapterId: 'c2' }, plan: { ...plan, title: 'Resilience' }, versions: [], currentVersionId: undefined, status: 'draft' as const };
const other = { ...second, id: 'v3', source: { ...second.source, bookId: 'b2' }, plan: { ...plan, title: 'Other book' } };
const api = { poster: vi.fn(async () => new Uint8Array([1])), media: vi.fn(async () => new Uint8Array([2])) } as unknown as ConceptVideoApi;
const props = { api, videos: [first, second, other], bookId: 'b1', chapterId: 'c1', chapterTitle: 'Same chapter', loading: false, error: '', active: true, canCreate: true, onCreate: vi.fn(), onOpen: vi.fn(), onRefresh: vi.fn() };
beforeEach(() => { vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn((blob: Blob) => blob.type === 'image/png' ? 'blob:cover' : 'blob:video'); static revokeObjectURL = vi.fn(); }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
test('TC1 scopes use IDs, title search and newest first', async () => {
  const { ReaderVideosPanel } = await component(); render(<ReaderVideosPanel {...props} />);
  expect(screen.getByRole('button', { name: 'View: Feedback' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'View: Resilience' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'This book' }));
  expect(screen.getAllByRole('button', { name: /^View:/ }).map(b => b.textContent)).toEqual([expect.stringContaining('Resilience'), expect.stringContaining('Feedback')]);
  fireEvent.click(screen.getByRole('button', { name: 'All videos' }));
  expect(screen.getByRole('button', { name: 'View: Other book' })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter videos by book' }), { target: { value: 'b2' } });
  expect(screen.queryByRole('button', { name: 'View: Resilience' })).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'other' } });
  expect(screen.getByText('1 video found')).toBeTruthy();
  expect(api.media).not.toHaveBeenCalled();
});
test('TC2 adopted version plays, return retains search and switching away releases media', async () => {
  const { ReaderVideosPanel } = await component(); const view = render(<ReaderVideosPanel {...props} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Feed' } });
  fireEvent.click(screen.getByRole('button', { name: 'View: Feedback' }));
  await waitFor(() => expect(api.media).toHaveBeenCalledWith({ id: 'v1', versionId: 'adopted' }));
  expect(document.querySelector('video')?.hasAttribute('controls')).toBe(true);
  view.rerender(<ReaderVideosPanel {...props} active={false} />);
  expect(document.querySelector('video')).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:video');
  view.rerender(<ReaderVideosPanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Back to videos' }));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('Feed');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'View: Feedback' })));
});
test('TC3 draft continues discussion without loading MP4; failures keep adopted versions', async () => {
  const { ReaderVideosPanel } = await component(); render(<ReaderVideosPanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'This book' }));
  fireEvent.click(screen.getByRole('button', { name: 'View: Resilience' }));
  expect(screen.getByText('No video generated yet.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Continue discussion' }));
  expect(props.onOpen).toHaveBeenCalledWith(second); expect(api.media).not.toHaveBeenCalled();
});
test('TC4 loading, retry, empty and clear search', async () => {
  const { ReaderVideosPanel } = await component(); const view = render(<ReaderVideosPanel {...props} loading />);
  expect(screen.getByRole('status').textContent).toBe('Loading videos…');
  view.rerender(<ReaderVideosPanel {...props} error="Offline" />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(props.onRefresh).toHaveBeenCalled();
  view.rerender(<ReaderVideosPanel {...props} videos={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create video' })); expect(props.onCreate).toHaveBeenCalled();
  view.rerender(<ReaderVideosPanel {...props} />);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  expect(screen.getByText('No matching videos.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('button', { name: 'View: Feedback' })).toBeTruthy();
});

test('TC3 live generation state keeps the adopted version available after a new version fails', async () => {
  const { ReaderVideosPanel } = await component();
  const generation = { id: 'job', status: 'running' as const, stage: 'Rendering animation', startedAt: 1 };
  const view = render(<ReaderVideosPanel {...props} videos={[{ ...first, generation }]} />);
  expect(screen.getByText('Rendering animation')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'View: Feedback' }));
  const failed = { ...first, generation: { ...generation, status: 'failed' as const, error: 'Render failed' } };
  view.rerender(<ReaderVideosPanel {...props} videos={[failed]} />);
  expect(screen.getByRole('region', { name: 'Video preview' }).querySelector('[role="status"].reader-videos-status')?.textContent).toBe('New version failed');
  expect(screen.getByRole('alert').textContent).toBe('Render failed');
  await waitFor(() => expect(api.media).toHaveBeenCalledWith({ id: 'v1', versionId: 'adopted' }));
});
test('TC2 missing cover falls back and media read errors remain visible', async () => {
  const { ReaderVideosPanel } = await component();
  const brokenApi = { ...api, poster: vi.fn(async () => { throw Error('missing cover'); }), media: vi.fn(async () => { throw Error('Missing saved MP4'); }) };
  render(<ReaderVideosPanel {...props} api={brokenApi} />);
  await screen.findByText('Preview unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Play preview: Feedback' }));
  expect(await screen.findByText('Missing saved MP4')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Back to videos' })).toBeTruthy();
});

test('the hidden Videos tab requests covers only when opened', async () => {
  const { ReaderVideosPanel } = await component();
  const view = render(<ReaderVideosPanel {...props} active={false} />);
  expect(api.poster).not.toHaveBeenCalled();
  view.rerender(<ReaderVideosPanel {...props} />);
  await waitFor(() => expect(api.poster).toHaveBeenCalledTimes(1));
});
