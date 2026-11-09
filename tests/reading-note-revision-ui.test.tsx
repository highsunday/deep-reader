// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ReadingNoteRevision } from '../src/renderer/ReadingNoteRevision';
import { markdownToReadingNoteDocument as doc, type ReadingNoteBlock } from '../src/shared/reading-note-document';
import { applyNoteChanges, type NoteUpdate } from '../src/shared/reading-note-reference';
// Assert the rich-document handoff, leaving actual rich rendering to editor regression tests.
const rich = vi.fn();
vi.mock('../src/renderer/ReadingNoteReadOnlyContent', () => ({ ReadingNoteReadOnlyContent: (props: any) => { rich(props.note.content); return <div data-testid="rich" />; } }));
afterEach(() => { cleanup(); rich.mockClear(); });
function preview(before: ReadingNoteBlock[], after: ReadingNoteBlock[], title = '新標題') {
  const originalContent = { version: 1 as const, blocks: before };
  const changes = { replacements: [{ blockId: before[0]!.id, content: { version: 1 as const, blocks: after } }], insertions: [] };
  const proposal: NoteUpdate = { id: 'p', noteId: 'n', baseRevision: 1, summary: '修改', status: 'pending', originalTitle: '標題', title, originalContent, changes, content: applyNoteChanges(originalContent, changes, 'p') };
  return render(<ReadingNoteRevision proposal={proposal} api={{} as any} note={{ id: 'n', revision: 1 } as any} />);
}
test('F66 TC1/3: title and mixed bold text retain context with localized marks', () => {
  preview(doc('我認為 **安靜** 是理解。').blocks, doc('我認為 **核對** 是理解。').blocks);
  expect(screen.getByRole('heading').querySelector('ins')?.textContent).toBe('新');
  expect(document.querySelector('.revision-inline del strong')?.textContent).toBe('安靜');
  expect(document.querySelector('.revision-inline ins strong')?.textContent).toBe('核對');
  expect(document.querySelector('.revision-inline')?.textContent).toBe('我認為 安靜核對 是理解。');
});
test.each(['bulletListItem', 'numberedListItem', 'checkListItem'] as const)('F66 TC4: %s retains list presentation', type => {
  const block = { ...doc('原文').blocks[0]!, type };
  preview([block], [{ ...doc('新文').blocks[0]!, type }]);
  expect(document.querySelector('.revision-inline del')?.textContent).toBe('原');
  expect(document.querySelector('.revision-inline ins')?.textContent).toBe('新');
});
test('F66 TC4: formatting-only edits are visible and passed intact to rich renderer', () => {
  preview(doc('相同文字').blocks, doc('**相同文字**').blocks);
  expect(screen.getByText('刪除 · 修改前')).toBeTruthy();
  expect(screen.getByText('新增 · 修改後')).toBeTruthy();
  expect(rich.mock.calls[1]![0].blocks[0].content[0].styles.bold).toBe(true);
});
test.each(['mathBlock', 'image', 'table'] as const)('F66 TC4: %s replacement keeps complete old/new structures', type => {
  const before: ReadingNoteBlock = { id: 'b', type, props: type === 'mathBlock' ? { latex: 'x' } : { assetId: 'asset', alt: 'old' }, children: [], ...(type === 'table' ? { content: { type: 'tableContent' as const, columnWidths: [null], rows: [{ cells: [[{ type: 'text' as const, text: 'old', styles: {} }]] }] } } : {}) };
  const after = { ...before, props: { ...before.props, alt: 'new' } };
  preview([before], [after]);
  expect(screen.getAllByTestId('rich')).toHaveLength(2);
  expect(rich.mock.calls[0]![0].blocks[0]).toEqual(before);
  expect(rich.mock.calls[1]![0].blocks[0]).toMatchObject({ type, props: after.props });
});
test('F66 TC7: regenerated block identifiers do not create fake differences', () => {
  preview(doc('相同').blocks, doc('相同').blocks, '標題');
  expect(screen.getByRole('status').textContent).toBe('沒有內容變更');
  expect(document.querySelector('ins, del')).toBeNull();
});
test('F66 TC4: shifting bold boundaries with identical text is still a visible format revision', () => {
  preview(doc('**相同**文字').blocks, doc('**相同文**字').blocks);
  expect(screen.getByText('刪除 · 修改前')).toBeTruthy();
  expect(screen.getByText('新增 · 修改後')).toBeTruthy();
});

test('F66 UIUX: nested list rewritten as prose shares one continuous text comparison', () => {
  preview(doc('- 理解需要安靜。\n  1. 留意語氣。').blocks, doc('理解需要核對，並留意語氣。').blocks);
  const text = document.querySelector('.revision-inline');
  expect(text).not.toBeNull();
  expect(text?.querySelector('del')).not.toBeNull();
  expect(text?.querySelector('ins')).not.toBeNull();
  expect(text?.textContent).toContain('語氣。');
  expect(document.querySelector('.revision-block-change')).toBeNull();
});
