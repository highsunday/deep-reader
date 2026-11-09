import { expect, test } from 'vitest';
import { diffText, revisionGroups } from '../src/renderer/reading-note-revision';
import { markdownToReadingNoteDocument as doc } from '../src/shared/reading-note-document';
import { applyNoteChanges, type NoteUpdate } from '../src/shared/reading-note-reference';

test('F66 TC1: marks only the changed Chinese and English fragments', () => {
  expect(diffText('理解 old 想法。', '理解 new 想法。')).toEqual([
    { kind: 'equal', text: '理解 ' }, { kind: 'delete', text: 'old' },
    { kind: 'insert', text: 'new' }, { kind: 'equal', text: ' 想法。' }
  ]);
});
test.each([['', '新增'], ['刪除', ''], ['重複重複', '重複'], ['👨‍👩‍👧好', '👨‍👩‍👧更好'], ['é', 'é'], ['a'.repeat(3000), 'b'.repeat(3000)]])('F66 TC3/7: lossless bounded diff %s', (before, after) => {
  const result = diffText(before, after);
  expect(result.filter(p => p.kind !== 'insert').map(p => p.text).join('')).toBe(before);
  expect(result.filter(p => p.kind !== 'delete').map(p => p.text).join('')).toBe(after);
});
test('F66 TC2/4/7: aligns replacements and insertions without marking preserved blocks', () => {
  const originalContent = doc('第一段\n\n第二段\n\n第三段');
  const changes = { replacements: [{ blockId: originalContent.blocks[1]!.id, content: doc('第二段修改') }], insertions: [{ afterBlockId: originalContent.blocks[0]!.id, content: doc('插入') }] };
  const proposal = { originalContent, changes, content: applyNoteChanges(originalContent, changes, 'p') } as NoteUpdate;
  const groups = revisionGroups(proposal);
  expect(groups.map(g => g.kind)).toEqual(['equal', 'insert', 'replace', 'equal']);
  expect(groups.flatMap(g => g.before)).toEqual(originalContent.blocks);
  expect(groups.flatMap(g => g.after)).toEqual(proposal.content.blocks);
  const sameChanges = { replacements: [{ blockId: originalContent.blocks[0]!.id, content: { version: 1 as const, blocks: [originalContent.blocks[0]!] } }], insertions: [] };
  expect(revisionGroups({ ...proposal, changes: sameChanges, content: applyNoteChanges(originalContent, sameChanges, 'p') }).every(g => g.kind === 'equal')).toBe(true);
});

test('F66 TC10: full-document edits align unchanged paragraphs across inserted and removed blocks', async () => {
  const { documentRevisionGroups } = await import('../src/renderer/reading-note-revision');
  const before = doc('保留首段\n\n修改舊句\n\n保留中段\n\n刪除尾段');
  const after = doc('新增開頭\n\n保留首段\n\n修改新句\n\n保留中段');
  const groups = documentRevisionGroups(before, after);
  expect(groups.map(g => g.kind)).toEqual(['insert', 'equal', 'replace', 'equal', 'replace']);
  expect(groups.flatMap(g => g.before)).toEqual(before.blocks);
  expect(groups.flatMap(g => g.after)).toEqual(after.blocks);
});
test('F66 TC10: large changed documents use bounded block fallback without losing content', async () => {
  const { documentRevisionGroups } = await import('../src/renderer/reading-note-revision');
  const before = doc(Array.from({ length: 210 }, (_, i) => `舊段${i}`).join('\n\n'));
  const after = doc(Array.from({ length: 210 }, (_, i) => `新段${i}`).join('\n\n'));
  const groups = documentRevisionGroups(before, after);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toEqual({ kind: 'replace', before: before.blocks, after: after.blocks });
});
