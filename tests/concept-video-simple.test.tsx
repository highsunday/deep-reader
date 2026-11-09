// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ConceptVideoEditor } from '../src/renderer/ConceptVideoWorkspace';
import type { ConceptVideo, ConceptVideoApi } from '../src/shared/concept-video';
afterEach(cleanup);
const source = { bookId: 'b', chapterId: 'c', bookTitle: '書', chapterTitle: '章', range: { start: 0, end: 4 }, readingSegment: '穩定與變動', images: [] };
const draft: ConceptVideo = { id: 'v', revision: 1, createdAt: 1, updatedAt: 1, status: 'draft', versions: [], source, context: [], conflicts: [], discussion: [{ id: 'u', role: 'user', text: '比較兩者', createdAt: 1 }], plan: { title: '比較兩者', goal: '比較兩者', scenes: [{ id: 's', heading: '', visual: '', narration: '' }], pace: 'normal', narration: false } };
function setup() {
  const reply = { ...draft, revision: 2, discussion: [...draft.discussion, { id: 'a', role: 'assistant', text: '這支比較影片主要說明穩定與變動的差異。', createdAt: 2 }], plan: { ...draft.plan, goal: '這支比較影片主要說明穩定與變動的差異。', scenes: [{ id: 's', heading: '比較', visual: '穩定與變動', narration: '兩者差異' }] } };
  const api = { capability: vi.fn(async () => ({ aiAllowed: true, generationAllowed: true, narrationAllowed: false, reason: '' })), create: vi.fn(async () => draft), append: vi.fn(async () => draft), requestAi: vi.fn(async () => reply), get: vi.fn(async () => draft), generate: vi.fn(async () => reply), save: vi.fn(), cancel: vi.fn(), media: vi.fn(), adopt: vi.fn(), list: vi.fn(), remove: vi.fn() } as unknown as ConceptVideoApi;
  render(<ConceptVideoEditor api={api} source={source} sourceAvailable onBack={() => {}} onOpenLibrary={() => {}} onSource={() => {}} />);
  return api;
}
test('S1/S2/S3: discuss type, read a short explanation, then explicitly generate without production fields', async () => {
  const api = setup();
  for (const label of ['影片標題', '理解目標', '動畫方式', '第 1 段畫面', '影片節奏']) expect(screen.queryByLabelText(label)).toBeNull();
  const input = screen.getByRole('textbox', { name: 'Describe your video idea' });
  fireEvent.change(input, { target: { value: '比較兩者' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
  await screen.findByText('這支比較影片主要說明穩定與變動的差異。');
  expect(api.create).toHaveBeenCalledWith({ source, question: '比較兩者' });
  expect(api.requestAi).toHaveBeenCalledWith({ id: 'v', baseRevision: 1, operation: 'discuss' });
  expect(api.generate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Generate video' }));
  await waitFor(() => expect(api.generate).toHaveBeenCalledWith({ id: 'v', baseRevision: 2 }));
});
test('S4: failure preserves saved question and retries AI without duplicating it', async () => {
  const api = setup(); vi.mocked(api.requestAi).mockRejectedValueOnce(new Error('連線中斷'));
  fireEvent.change(screen.getByRole('textbox', { name: 'Describe your video idea' }), { target: { value: '比較兩者' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
  await screen.findByText(/連線中斷/);
  expect(screen.getByText('比較兩者')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry AI reply' }));
  await screen.findByText('這支比較影片主要說明穩定與變動的差異。');
  expect(api.create).toHaveBeenCalledTimes(1); expect(api.append).not.toHaveBeenCalled();
});
