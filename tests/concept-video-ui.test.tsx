// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { ConceptVideo, ConceptVideoApi, ConceptVideoSource } from '../src/shared/concept-video';
import { CONCEPT_VIDEO_BILLING_REASON } from '../src/shared/concept-video';
const modules = import.meta.glob('../src/renderer/ConceptVideoWorkspace.tsx');
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const source: ConceptVideoSource = { bookId: 'b1', chapterId: 'c1', bookTitle: '微積分', chapterTitle: '導數', range: { start: 0, end: 6 }, readingSegment: '兩點逐漸靠近', images: [] };
function fixture() {
  let video: ConceptVideo = { id: 'v1', revision: 1, createdAt: 1, updatedAt: 1, status: 'draft', versions: [], source, context: [], plan: { title: '斜率', goal: '想看懂斜率', scenes: [{ id: 's1', heading: '', visual: '', narration: '' }], pace: 'normal', narration: true }, discussion: [{ id: 'm1', role: 'user', text: '想看懂斜率', createdAt: 1 }], conflicts: [] };
  const api: ConceptVideoApi = { capability: vi.fn(async () => ({ aiAllowed: false as const, generationAllowed: false as const, reason: CONCEPT_VIDEO_BILLING_REASON })), list: vi.fn(async () => [structuredClone(video)]), get: vi.fn(async () => structuredClone(video)), create: vi.fn(async input => { video = { ...video, source: input.source, plan: { ...video.plan, goal: input.question }, discussion: [{ ...video.discussion[0], text: input.question }] }; return structuredClone(video); }), save: vi.fn(async input => { video = { ...video, revision: video.revision + 1, plan: input.plan }; return structuredClone(video); }), append: vi.fn(async input => { video = { ...video, revision: video.revision + 1, discussion: [...video.discussion, { id: 'm2', role: 'user', text: input.question, createdAt: 2 }] }; return structuredClone(video); }), compare: vi.fn(), generate: vi.fn(async () => { throw Error("尚未生成"); }), cancel: vi.fn(async () => { throw Error("尚未生成"); }), adopt: vi.fn(async () => { throw Error("尚未生成"); }), media: vi.fn(async () => new Uint8Array()), poster: vi.fn(async () => new Uint8Array()), remove: vi.fn(async () => {}), requestAi: vi.fn(async () => { throw new Error(CONCEPT_VIDEO_BILLING_REASON); }) };
  return { api, video };
}
async function components() {
  const loader = modules['../src/renderer/ConceptVideoWorkspace.tsx']; expect(loader, 'F53 needs reader and library UI').toBeTypeOf('function');
  return await loader!() as typeof import('../src/renderer/ConceptVideoWorkspace');
}
test('TC14/15/21: book IDs disambiguate same names, drafts have no player, deleted sources stay visible', async () => {
  const { ConceptVideoLibrary } = await components(); const { api, video } = fixture();
  api.list = vi.fn(async () => [video, { ...video, id: 'v2', source: { ...source, bookId: 'b2' }, plan: { ...video.plan, title: '另一支草稿' } }]);
  const open = vi.fn(); render(<ConceptVideoLibrary api={api} books={[{ id: 'b1', title: '微積分', chapters: [{ id: 'c1' }] }]} onOpen={open} />);
  await screen.findByRole('button', { name: 'Continue: 斜率' });
  expect(screen.getByRole('option', { name: /source removed/ })).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter by book' }), { target: { value: 'b2' } });
  expect(screen.queryByRole('button', { name: 'Continue: 斜率' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue: 另一支草稿' })); expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'v2' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '不存在' } });
  expect(screen.getByText('No matching videos')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByRole('button', { name: 'Continue: 斜率' })).toBeTruthy();
  expect(document.querySelector('video')).toBeNull();
});

test('UI refinement: deletion starts on cancel, traps focus and Escape restores trigger', async () => {
  const { ConceptVideoLibrary } = await components(); const { api } = fixture();
  render(<ConceptVideoLibrary api={api} books={[]} onOpen={() => {}} />);
  const trigger = await screen.findByRole('button', { name: 'Delete: 斜率' }); trigger.focus(); fireEvent.click(trigger);
  const cancel = screen.getByRole('button', { name: 'Cancel' });
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(cancel, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete video' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(trigger);
  expect(api.remove).not.toHaveBeenCalled();
});

test('completed card shows its saved cover and separates watching from editing', async () => {
  const { ConceptVideoLibrary } = await components(); const { api, video } = fixture();
  const versionId = '11111111-1111-4111-8111-111111111111';
  video.status = 'completed'; video.currentVersionId = versionId;
  video.versions = [{ id: versionId, createdAt: 2, plan: { ...video.plan, description: '影片以變動的割線展示斜率如何靠近切線。' }, durationSeconds: 9, bytes: 8, scenes: [{ id: 's1', start: 0, end: 9 }] }];
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn((blob: Blob) => blob.type === 'image/png' ? 'blob:cover' : 'blob:video'); static revokeObjectURL = vi.fn(); });
  const open = vi.fn();
  render(<ConceptVideoLibrary api={api} books={[]} onOpen={open} />);
  await waitFor(() => expect(api.poster).toHaveBeenCalledWith({ id: video.id, versionId }));
  expect(screen.getByText('影片以變動的割線展示斜率如何靠近切線。')).toBeTruthy();
  expect(screen.queryByText('想看懂斜率')).toBeNull();
  await waitFor(() => expect(document.querySelector('.concept-video-cover img')?.getAttribute('src')).toBe('blob:cover'));
  expect(api.media).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Watch: 斜率' }));
  const dialog = screen.getByRole('dialog', { name: 'Watch video: 斜率' });
  await waitFor(() => expect(api.media).toHaveBeenCalledWith({ id: video.id, versionId }));
  expect(dialog.querySelector('video')?.getAttribute('src')).toBe('blob:video');
  expect(dialog.querySelector('video')?.autoplay).toBe(true);
  await waitFor(() => expect(play).toHaveBeenCalled());
  expect(open).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.querySelector('video')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Play preview: 斜率' }));
  expect(screen.getByRole('dialog', { name: 'Watch video: 斜率' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Close video' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit: 斜率' }));
  expect(open).toHaveBeenCalledWith(video);
  play.mockRestore();
});

// F53 §7.6 replaces manual-form tests with conversational behavior in concept-video-simple.test.tsx.
test('S5: generate uses the saved AI plan and loads the saved MP4', async () => {
  const { ConceptVideoEditor } = await components(); const { api, video } = fixture();
  video.plan.scenes[0].visual = '兩點逐漸靠近';
  video.discussion.push({ id: 'a', role: 'assistant', text: '這支影片主要說明斜率的變化。', createdAt: 2 });
  api.capability = vi.fn(async () => ({ aiAllowed: true, generationAllowed: true, narrationAllowed: true, reason: '' }));
  const versionId = '11111111-1111-4111-8111-111111111111';
  api.generate = vi.fn(async () => ({ ...video, revision: 3, status: 'completed' as const, versions: [{ id: versionId, createdAt: 2, plan: video.plan, durationSeconds: 6, bytes: 8, scenes: [{ id: 's1', start: 0, end: 6 }] }], currentVersionId: versionId }));
  vi.stubGlobal('URL', class extends URL { static createObjectURL = vi.fn(() => 'blob:local-video'); static revokeObjectURL = vi.fn(); });
  const view = render(<ConceptVideoEditor api={api} initialVideo={video} onBack={() => {}} onOpenLibrary={() => {}} onSource={() => {}} sourceAvailable />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Generate video' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Generate video' }));
  await waitFor(() => expect(api.generate).toHaveBeenCalledWith({ id: video.id, baseRevision: 1 }));
  expect(api.save).not.toHaveBeenCalled();
  await waitFor(() => expect(api.media).toHaveBeenCalledWith({ id: video.id, versionId }));
  expect(document.querySelector('video')?.getAttribute('src')).toBe('blob:local-video');
  expect(document.querySelector('video')?.hasAttribute('controls')).toBe(true); expect(api.requestAi).not.toHaveBeenCalled();
  view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:local-video');
});
test('S1/S4: source required, failed save retains input, retry capability preserves input', async () => {
  const { ConceptVideoEditor } = await components(); const { api } = fixture();
  const view = render(<ConceptVideoEditor api={api} onBack={() => {}} onOpenLibrary={() => {}} onSource={() => {}} sourceAvailable={false} />);
  expect(screen.getByText('Mark a reading range first')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true); view.unmount();
  api.capability = vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue({ aiAllowed: true, generationAllowed: true, reason: '' });
  api.create = vi.fn(async () => { throw new Error('儲存失敗'); });
  render(<ConceptVideoEditor api={api} source={source} onBack={() => {}} onOpenLibrary={() => {}} onSource={() => {}} sourceAvailable />);
  await screen.findByText('Could not connect. Try again.');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '保留我的想法' } });
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText('儲存失敗');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('保留我的想法');
  expect(api.requestAi).not.toHaveBeenCalled();
});
test('S3: unavailable narration automatically uses subtitles, no setting is required', async () => {
  const { ConceptVideoEditor } = await components(); const { api, video } = fixture();
  video.plan.scenes[0].visual = '可製成字幕動畫的重點';
  video.discussion.push({ id: 'a', role: 'assistant', text: '主要內容', createdAt: 2 });
  api.capability = vi.fn(async () => ({ aiAllowed: true, generationAllowed: true, narrationAllowed: false, reason: '' }));
  render(<ConceptVideoEditor api={api} initialVideo={video} onBack={() => {}} onOpenLibrary={() => {}} onSource={() => {}} sourceAvailable />);
  await waitFor(() => expect((screen.getByRole('button', { name: 'Generate video' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Generate video' }));
  await waitFor(() => expect(api.generate).toHaveBeenCalledWith({ id: video.id, baseRevision: 2 }));
  expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ plan: expect.objectContaining({ narration: false }) }));
  expect(screen.queryByLabelText('本機中文旁白')).toBeNull(); expect(api.requestAi).not.toHaveBeenCalled();
});

test('video library orders creation, edits and generated versions newest first, including live updates', async () => {
  const { ConceptVideoLibrary } = await components();
  const { api, video } = fixture();
  const older = { ...video, id: 'older', createdAt: 10, updatedAt: 20, plan: { ...video.plan, title: 'Older' } };
  const edited = { ...video, id: 'edited', createdAt: 5, updatedAt: 40, plan: { ...video.plan, title: 'Edited' } };
  const created = { ...video, id: 'created', createdAt: 30, updatedAt: 30, plan: { ...video.plan, title: 'Created' } };
  const generated = { ...video, id: 'generated', createdAt: 1, updatedAt: 2, plan: { ...video.plan, title: 'Generated' }, versions: [{ id: 'recent-version', createdAt: 50, plan: { ...video.plan, title: 'Generated' }, durationSeconds: 5, bytes: 8, scenes: [] }] };
  const incoming = [older, created, edited, generated];
  api.list = vi.fn(async () => incoming);
  api.poster = vi.fn(async () => { throw new Error('No poster'); });
  const view = render(<ConceptVideoLibrary api={api} books={[]} onOpen={() => {}} />);
  await screen.findByRole('button', { name: 'Continue: Edited' });
  const order = () => [...document.querySelectorAll('.concept-video-card h2')].map(el => el.textContent);
  expect(order()).toEqual(['Generated', 'Edited', 'Created', 'Older']);
  const live = incoming.map(item => item.id === 'older' ? { ...item, updatedAt: 60, revision: item.revision + 1 } : item);
  view.rerender(<ConceptVideoLibrary api={api} books={[]} onOpen={() => {}} liveVideos={live} />);
  await waitFor(() => expect(order()).toEqual(['Older', 'Generated', 'Edited', 'Created']));
  expect(incoming.map(item => item.id)).toEqual(['older', 'created', 'edited', 'generated']);
  expect(live.map(item => item.id)).toEqual(['older', 'created', 'edited', 'generated']);
});
