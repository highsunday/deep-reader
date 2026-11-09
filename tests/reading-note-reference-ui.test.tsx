// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NoteReferencePicker, NoteReferenceHistory, NoteUpdateCard } from '../src/renderer/ReadingConversationNotes';
import type { ReaderDesktopApi, ReadingNoteSummary } from '../src/shared/contracts';
import { markdownToReadingNoteDocument as doc } from '../src/shared/reading-note-document';
import type { NoteUpdate } from '../src/shared/reading-note-reference';
vi.mock('../src/renderer/ReadingNoteEditorDialog', () => ({ ReadingNoteEditorDialog: ({ note, previewControls, onClose, readOnly, initialView, previewContent }: any) => <div role="dialog" aria-label="Note preview" data-readonly={readOnly} data-view={initialView}>{previewControls}{previewContent ?? <div>{note.content.blocks.map((b: any) => b.content?.map((c: any) => c.text).join('')).join('\n')}</div>}<button onClick={onClose}>Close preview</button></div> }));
vi.mock('../src/renderer/ReadingNoteReadOnlyContent', () => ({ ReadingNoteReadOnlyContent: ({ note }: any) => <div>{note.content.blocks[0].content[0].text}</div> }));
afterEach(cleanup);
const a = { id: 'a', title: '同名筆記', bookTitle: 'A書', chapterTitle: '第一章', revision: 1, createdAt: 1, updatedAt: 1 };
const c = { ...a, id: 'c', bookTitle: 'C書' };
function harness(api: ReaderDesktopApi['readingNotes']) {
  function Harness() { const [selected, set] = useState<ReadingNoteSummary[]>([]); return <><p>未送出的問題</p><NoteReferencePicker api={api} selected={selected} onChange={set} /></>; }
  return render(<Harness />);
}
test('TC1/12: search cross-book references, distinguish duplicates and remove selections', async () => {
  const listPage = vi.fn(async () => ({ items: [a, c] }));
  harness({ listPage, activeBookTitles: async () => ['A書', 'C書'] } as any);
  fireEvent.click(screen.getByRole('button', { name: '引用筆記' }));
  await screen.findByRole('button', { name: /引用 同名筆記 A書/ });
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '同名' } });
  await waitFor(() => expect(listPage).toHaveBeenLastCalledWith({ status: 'active', sort: 'recent', search: '同名' }));
  fireEvent.change(screen.getByRole('combobox', { name: '篩選引用筆記的書籍' }), { target: { value: 'C書' } });
  await waitFor(() => expect(listPage).toHaveBeenLastCalledWith({ status: 'active', sort: 'recent', search: '同名', bookTitle: 'C書' }));
  fireEvent.click(screen.getByRole('button', { name: /引用 同名筆記 A書/ }));
  expect(screen.getByRole('button', { name: /已選取 同名筆記 A書/ }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: /引用 同名筆記 C書/ }));
  expect(screen.getAllByRole('button', { name: /移除引用/ })).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '移除引用 同名筆記 A書' }));
  expect(screen.getAllByRole('button', { name: /移除引用/ })).toHaveLength(1);
  expect(screen.getByText('未送出的問題')).toBeTruthy();
});
test('TC11/12: picker errors can retry without losing selected notes', async () => {
  const listPage = vi.fn().mockRejectedValueOnce(new Error('讀取失敗')).mockResolvedValue({ items: [a] });
  harness({ listPage, activeBookTitles: async () => [] } as any);
  fireEvent.click(screen.getByRole('button', { name: '引用筆記' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '讀取失敗');
  fireEvent.click(screen.getByRole('button', { name: '重試' }));
  expect(await screen.findByRole('button', { name: /引用 同名筆記 A書/ })).toBeTruthy();
});
const proposal: NoteUpdate = { id: 'p', noteId: 'a', baseRevision: 1, originalTitle: a.title, title: '新標題', summary: '加入 B 的新理解', content: { version: 1, blocks: [...doc('原文保持不變').blocks, ...doc('新的完整正文').blocks] }, preservedBlockCount: 1, status: 'pending' };
test('TC5/9: full read-only preview, explicit decisions and retry after save error', async () => {
  const decide = vi.fn().mockRejectedValueOnce(new Error('保存失敗')).mockResolvedValue(undefined);
  render(<NoteUpdateCard proposal={proposal} api={{} as any} onDecide={decide} />);
  expect(await screen.findByText('新的完整正文')).toBeTruthy(); expect(decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '加入筆記' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '保存失敗');
  fireEvent.click(screen.getByRole('button', { name: '加入筆記' }));
  await waitFor(() => expect(decide).toHaveBeenCalledTimes(2));
  expect(decide).toHaveBeenLastCalledWith('p', 'apply');
});
test.each(['applied', 'rejected', 'superseded'] as const)('TC5/10: %s candidate has no enabled decision', status => {
  render(<NoteUpdateCard proposal={{ ...proposal, status }} api={{} as any} onDecide={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '加入筆記' })).toBeNull();
  expect(screen.queryByRole('button', { name: '不套用' })).toBeNull();
});

test('TC12: Enter in note search does not submit the reading question and Escape closes it', async () => {
  harness({ listPage: async () => ({ items: [a] }), activeBookTitles: async () => [] } as any);
  fireEvent.click(screen.getByRole('button', { name: '引用筆記' }));
  const search = await screen.findByRole('searchbox');
  expect(fireEvent.keyDown(search, { key: 'Enter' })).toBe(false);
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '引用筆記' }));
});

test('TC1/11: late search results cannot replace a newer search, and pagination appends results', async () => {
  let resolveOld!: (page: any) => void;
  const listPage = vi.fn().mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ items: [c], nextCursor: 'next' }).mockResolvedValueOnce({ items: [a] });
  harness({ listPage, activeBookTitles: async () => [] } as any);
  fireEvent.click(screen.getByRole('button', { name: '引用筆記' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } });
  await screen.findByRole('button', { name: /引用 同名筆記 C書/ });
  resolveOld({ items: [{ ...a, title: '過期結果' }] });
  await waitFor(() => expect(screen.queryByText('過期結果')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '載入更多筆記' }));
  await screen.findByRole('button', { name: /引用 同名筆記 A書/ });
  expect(listPage).toHaveBeenLastCalledWith({ status: 'active', sort: 'recent', search: 'new', cursor: 'next' });
  expect(screen.getByRole('button', { name: /引用 同名筆記 C書/ })).toBeTruthy();
});


test('TC1/12: selections toggle in the list, show their book, and finish returns focus', async () => {
  harness({ listPage: async () => ({ items: [a, c] }), activeBookTitles: async () => ['A書', 'C書'] } as any);
  fireEvent.click(screen.getByRole('button', { name: '引用筆記' }));
  fireEvent.click(await screen.findByRole('button', { name: /引用 同名筆記 A書/ }));
  const selected = screen.getByRole('button', { name: /已選取 同名筆記 A書/ });
  expect(selected.getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('.conversation-note-chip')?.textContent).toContain('A書');
  fireEvent.click(selected);
  expect(screen.queryByRole('button', { name: /移除引用/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /引用 同名筆記 C書/ }));
  fireEvent.click(screen.getByRole('button', { name: '完成選取（1）' }));
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '引用筆記' }));
  expect(screen.getByRole('button', { name: /移除引用 同名筆記 C書/ })).toBeTruthy();
});

test('TC12: clicking outside or moving keyboard focus outside dismisses without losing selections', async () => {
  harness({ listPage: async () => ({ items: [a] }), activeBookTitles: async () => [] } as any);
  fireEvent.click(screen.getByRole('button', { name: '引用筆記' }));
  fireEvent.click(await screen.findByRole('button', { name: /引用 同名筆記 A書/ }));
  fireEvent.pointerDown(screen.getByText('未送出的問題'));
  expect(screen.queryByRole('searchbox')).toBeNull();
  expect(screen.getByRole('button', { name: /移除引用/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '引用筆記' }));
  fireEvent.blur(screen.getByRole('searchbox'), { relatedTarget: document.body });
  expect(screen.queryByRole('searchbox')).toBeNull();
});


test('B69 TC5: append preview shows only additions and explains preservation; full view is optional', async () => {
  render(<NoteUpdateCard proposal={proposal} api={{} as any} onDecide={vi.fn()} />);
  expect(screen.getByText('原標題與原文完整保留，以下內容將加在筆記末尾。')).toBeTruthy();
  expect(screen.getByText('本次新增內容')).toBeTruthy();
  expect(screen.queryByText('原文保持不變')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '查看完整筆記' }));
  expect(await screen.findByText('原文保持不變')).toBeTruthy();
});

test('B69 TC2: old replacement candidates are reviewable but cannot be applied', () => {
  const { preservedBlockCount, ...old } = proposal;
  render(<NoteUpdateCard proposal={old} api={{} as any} onDecide={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '加入筆記' })).toBeNull();
  expect(screen.queryByRole('button', { name: '套用修改' })).toBeNull();
  expect(screen.getByText(/舊版替換候選/)).toBeTruthy();
  expect(screen.getByRole('button', { name: '不套用' })).toBeTruthy();
});


test('F63 reference opens the latest saved note instead of expanding the quoted content', async () => {
  const reference = { ...a, content: doc('歷史原文') };
  const latest = { ...reference, revision: 4, content: doc('最新正文'), sourceDraftId: 'saved' };
  const get = vi.fn(async () => latest), open = vi.fn();
  render(<NoteReferenceHistory references={[reference]} api={{ get } as any} onOpen={open} />);
  expect(screen.queryByText('歷史原文')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /開啟筆記 同名筆記/ }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(latest));
  expect(get).toHaveBeenCalledWith(a.id);
  expect(document.querySelector('.conversation-note-history details')).toBeNull();
});

test('F63 unavailable note shows a recoverable error without opening an editable snapshot', async () => {
  const get = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce({ ...a, content: doc('正文'), trashedAt: 10 });
  const open = vi.fn();
  render(<NoteReferenceHistory references={[{ ...a, content: doc('歷史原文') }]} api={{ get } as any} onOpen={open} />);
  fireEvent.click(screen.getByRole('button', { name: /開啟筆記/ }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '筆記已刪除，無法開啟。');
  fireEvent.click(screen.getByRole('button', { name: /開啟筆記/ }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('垃圾桶'));
  expect(open).not.toHaveBeenCalled();
});


test('targeted revision compares original and revised text before applying', async () => {
  const decide = vi.fn();
  const candidate: NoteUpdate = { ...proposal, preservedBlockCount: undefined, title: a.title,
    originalContent: doc('原本的第一段'), content: doc('整合後的第一段'),
    changes: { replacements: [{ blockId: 'old', content: doc('整合後的第一段') }], insertions: [] } };
  render(<NoteUpdateCard proposal={candidate} api={{ get: async () => ({ ...a, content: candidate.originalContent }) } as any} onDecide={decide} />);
  expect(screen.queryByText('整合後的第一段')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '預覽編修' }));
  expect((await screen.findByRole('dialog')).getAttribute('data-readonly')).toBe('true');
  expect(screen.getByRole('dialog').getAttribute('data-view')).toBe('note');
  expect(screen.getByRole('button', { name: '追蹤修訂' }).getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('article ins')?.textContent).toBe('整合後');
  expect(document.querySelector('article del')?.textContent).toBe('原本');
  fireEvent.click(screen.getByRole('button', { name: '修改前' }));
  expect(screen.getByText('原本的第一段')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '修改後' }));
  expect(screen.getByText('整合後的第一段')).toBeTruthy();
  expect(decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '套用編修' }));
  await waitFor(() => expect(decide).toHaveBeenCalledWith(proposal.id, 'apply'));
});

test('F66 TC5/6/8: uses frozen baseline, restores focus, and rejects without applying', async () => {
  const candidate: NoteUpdate = { ...proposal, preservedBlockCount: undefined, originalContent: doc('快照原文'), content: doc('候選原文'), changes: { replacements: [{ blockId: 'old', content: doc('候選原文') }], insertions: [] } };
  const decide = vi.fn();
  render(<NoteUpdateCard proposal={candidate} api={{ get: async () => ({ ...a, content: doc('後來保存的內容'), revision: 9 }) } as any} onDecide={decide} />);
  fireEvent.click(screen.getByRole('button', { name: '預覽編修' }));
  await screen.findByRole('dialog');
  expect(document.activeElement?.textContent).toBe('追蹤修訂');
  fireEvent.click(screen.getByRole('button', { name: '修改前' }));
  expect(screen.getByText('快照原文')).toBeTruthy();
  expect(screen.queryByText('後來保存的內容')).toBeNull();
  expect(document.activeElement?.textContent).toBe('修改前');
  fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
  expect(document.activeElement?.textContent).toBe('預覽編修');
  expect(decide).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '預覽編修' }));
  await screen.findByRole('dialog');
  expect(screen.getByRole('button', { name: '追蹤修訂' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '不套用' }));
  await waitFor(() => expect(decide).toHaveBeenCalledWith(proposal.id, 'reject'));
  expect(decide).toHaveBeenCalledTimes(1);
});
