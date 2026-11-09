// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ConceptVideo, ConceptVideoApi } from '../src/shared/concept-video';
const modules = import.meta.glob('../src/renderer/ConceptVideoActivity.tsx');
afterEach(() => { cleanup(); vi.useRealTimers(); });
const video = (status: 'running' | 'completed' | 'failed', revision: number): ConceptVideo => ({ id: 'v', revision, createdAt: 1, updatedAt: revision, status: status === 'completed' ? 'completed' : 'draft', versions: [], source: { bookId: 'b', chapterId: 'c', bookTitle: 'Book', chapterTitle: 'Chapter', range: { start: 0, end: 1 }, readingSegment: 'x', images: [] }, context: [], conflicts: [], discussion: [], plan: { title: 'LASA example', goal: 'Explain', scenes: [], pace: 'normal', narration: false }, generation: { id: 'job', status, stage: status === 'running' ? 'Codex is designing the animation…' : status === 'completed' ? 'Video generated' : 'Generation failed', ...(status === 'failed' ? { error: 'AI timed out' } : {}) } });
async function load() { expect(modules['../src/renderer/ConceptVideoActivity.tsx'], 'video notifications must be mounted globally').toBeTypeOf('function'); return await modules['../src/renderer/ConceptVideoActivity.tsx']!() as any; }
test('B55 TC3/4: global notification follows preparation and completion, dismiss stays dismissed', async () => {
  const { useConceptVideoActivity, ConceptVideoActivity } = await load();
  let current = video('running', 2);
  const api = { list: vi.fn(async () => [current]), get: vi.fn(async () => current) } as unknown as ConceptVideoApi;
  const open = vi.fn();
  function Harness() { const activity = useConceptVideoActivity(api); return <ConceptVideoActivity activity={activity} onOpen={open} />; }
  render(<Harness />);
  await screen.findByRole('button', { name: 'Expand video activity' });
  fireEvent.click(screen.getByRole('button', { name: 'Expand video activity' }));
  await screen.findByText('Codex is designing the animation…');
  expect(screen.getByRole('button', { name: 'Dismiss video notifications' }).hasAttribute('disabled')).toBe(true);
  current = video('completed', 3);
  await screen.findByText(/Video ready/, {}, { timeout: 2500 });
  fireEvent.click(screen.getByRole('button', { name: 'Open video: LASA example' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(current));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss video notifications' }));
  await new Promise(resolve => setTimeout(resolve, 1100));
  expect(screen.queryByLabelText('Video activity')).toBeNull();
});
test('B55 TC3/4: no historical success notification; immediate generation is tracked before the next poll', async () => {
  const { useConceptVideoActivity, ConceptVideoActivity } = await load();
  let current = video('completed', 3);
  const api = { list: vi.fn(async () => [current]), generate: vi.fn(async () => { current = { ...video('running', 4), generation: { ...video('running', 4).generation!, id: 'next-job' } }; return current; }), get: vi.fn(async () => current) } as unknown as ConceptVideoApi;
  function Harness() { const activity = useConceptVideoActivity(api); return <><button onClick={() => void activity.api.generate({ id: 'v', baseRevision: 3 })}>Generate</button><ConceptVideoActivity activity={activity} onOpen={() => {}} /></>; }
  render(<Harness />);
  await waitFor(() => expect(api.list).toHaveBeenCalled());
  expect(screen.queryByLabelText('Video activity')).toBeNull();
  fireEvent.click(screen.getByText('Generate'));
  await screen.findByRole('button', { name: 'Expand video activity' });
  fireEvent.click(screen.getByRole('button', { name: 'Expand video activity' }));
  await screen.findByText('Codex is designing the animation…');
  current = { ...video('failed', 5), generation: { ...video('failed', 5).generation!, id: 'next-job' } };
  await screen.findByText('AI timed out', {}, { timeout: 2500 });
  expect(screen.queryByText('Video ready')).toBeNull();
});

test('B55 TC5: library exposes preparation and failure while keeping the saved version playable', async () => {
  const { ConceptVideoLibrary } = await import('../src/renderer/ConceptVideoWorkspace');
  const failed = video('failed', 5);
  failed.status = 'completed'; failed.versions = [{ id: 'version-1', createdAt: 1, plan: failed.plan, bytes: 100, durationSeconds: 5, scenes: [] }]; failed.currentVersionId = 'version-1';
  const api = { list: async () => [failed], poster: async () => { throw Error('no poster'); } } as unknown as ConceptVideoApi;
  render(<ConceptVideoLibrary api={api} books={[]} onOpen={() => {}} />);
  await screen.findByText('New version failed');
  expect(screen.getByText('AI timed out')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Watch: LASA example' })).toBeTruthy();
});

test('B55 TC4: a late initial list cannot roll a newer job back or hide its result', async () => {
  const { useConceptVideoActivity, ConceptVideoActivity } = await load();
  let initial!: (videos: ConceptVideo[]) => void;
  const api = { list: vi.fn(() => new Promise<ConceptVideo[]>(resolve => { initial = resolve; })) } as unknown as ConceptVideoApi;
  let activity: any;
  function Harness() { activity = useConceptVideoActivity(api); return <ConceptVideoActivity activity={activity} onOpen={() => {}} />; }
  render(<Harness />);
  await act(async () => { activity.receive([video('running', 2)]); });
  await act(async () => { activity.receive([video('completed', 3)]); });
  await act(async () => { initial([video('running', 1)]); });
  fireEvent.click(screen.getByRole('button', { name: 'Expand video activity' }));
  expect(screen.getByText(/Video ready/)).toBeTruthy();
  expect(screen.queryByText('Codex is designing the animation…')).toBeNull();
});

test('B55 TC3: a persistence failure overlay with the same revision replaces running', async () => {
  const { useConceptVideoActivity, ConceptVideoActivity } = await load();
  const api = { list: async () => [] } as unknown as ConceptVideoApi;
  let activity: any;
  function Harness() { activity = useConceptVideoActivity(api); return <ConceptVideoActivity activity={activity} onOpen={() => {}} />; }
  render(<Harness />);
  await act(async () => { activity.receive([video('running', 2)]); });
  await act(async () => { activity.receive([video('failed', 2)]); });
  fireEvent.click(screen.getByRole('button', { name: 'Expand video activity' }));
  expect(screen.getByText('AI timed out')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Dismiss video notifications' }).hasAttribute('disabled')).toBe(false);
  await act(async () => { activity.receive([video('running', 2)]); });
  expect(screen.getByText('AI timed out')).toBeTruthy();
});

test('B55 TC7: matches image disclosure, viewed retention, Escape, outside click and individual dismissal', async () => {
  const { useConceptVideoActivity, ConceptVideoActivity } = await load();
  const current = video('completed', 3);
  const api = { list: async () => [], get: vi.fn(async () => current) } as unknown as ConceptVideoApi;
  let activity: any;
  const open = vi.fn();
  function Harness() { activity = useConceptVideoActivity(api); return <ConceptVideoActivity activity={activity} onOpen={open} />; }
  render(<Harness />);
  await act(async () => { activity.receive([video('running', 2)]); });
  expect(screen.getByRole('button', { name: 'Expand video activity' }).getAttribute('aria-expanded')).toBe('false');
  await act(async () => { activity.receive([current]); });
  expect(screen.queryByRole('button', { name: 'Open video: LASA example' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand video activity' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open video: LASA example' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(current));
  expect(screen.queryByRole('button', { name: 'Open video: LASA example' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand video activity' }));
  expect(screen.getByText(/Viewed/)).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Open video: LASA example' }), { key: 'Escape' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Expand video activity' }));
  fireEvent.click(screen.getByRole('button', { name: 'Expand video activity' }));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('button', { name: 'Open video: LASA example' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Expand video activity' }));
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss LASA example notification' }));
  await act(async () => { activity.receive([current]); });
  expect(screen.queryByLabelText('Video activity')).toBeNull();
});


test('B64: token-only polls preserve state; changed snapshots still update jobs and deletions', async () => {
  const { useConceptVideoActivity } = await load();
  vi.useFakeTimers();
  let snapshot = { token: 'one', videos: [video('running', 2)] };
  const poll = vi.fn(async (token?: string) => token === snapshot.token ? { token } : snapshot);
  const list = vi.fn();
  const api = { poll, list } as unknown as ConceptVideoApi;
  let activity: any;
  function Harness() { activity = useConceptVideoActivity(api); return null; }
  await act(async () => { render(<Harness />); });
  expect(poll).toHaveBeenCalledWith(undefined);
  const original = activity.videos;
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(poll).toHaveBeenLastCalledWith('one');
  expect(activity.videos).toBe(original);
  expect(list).not.toHaveBeenCalled();
  snapshot = { token: 'two', videos: [video('completed', 3)] };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(activity.videos[0].generation.status).toBe('completed');
  expect(activity.notices).toHaveLength(1);
  snapshot = { token: 'three', videos: [] };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(activity.videos).toEqual([]);
});
