import { useMemo, type ReactNode } from 'react';
import type { ReaderDesktopApi, ReadingNote } from '../shared/contracts';
import type { ReadingNoteBlock, ReadingNoteText } from '../shared/reading-note-document';
import type { NoteUpdate } from '../shared/reading-note-reference';
import { ReadingNoteReadOnlyContent } from './ReadingNoteReadOnlyContent';
import { diffText, revisionGroups, documentRevisionGroups } from './reading-note-revision';
import './reading-note-revision.css';

function styledSlice(runs: ReadingNoteText[], start: number, end: number): ReactNode {
  let offset = 0;
  return runs.map((run, index) => {
    const text = run.text.slice(Math.max(0, start - offset), Math.max(0, end - offset));
    offset += run.text.length;
    if (!text) return null;
    const s = run.styles;
    let content: ReactNode = text;
    if (s.bold) content = <strong>{content}</strong>;
    if (s.italic) content = <em>{content}</em>;
    if (s.code) content = <code>{content}</code>;
    return <span key={index} style={{ textDecoration: [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ') || undefined }}>{content}</span>;
  });
}
function TextDiff({ before, after, beforeRuns, afterRuns }: { before: string; after: string; beforeRuns?: ReadingNoteText[]; afterRuns?: ReadingNoteText[] }) {
  let oldOffset = 0, newOffset = 0;
  return diffText(before, after).map((part, i) => {
    const runs = part.kind === 'delete' ? beforeRuns : afterRuns;
    const offset = part.kind === 'delete' ? oldOffset : newOffset;
    const content = runs ? styledSlice(runs, offset, offset + part.text.length) : part.text;
    if (part.kind !== 'insert') oldOffset += part.text.length;
    if (part.kind !== 'delete') newOffset += part.text.length;
    return part.kind === 'delete' ? <del key={i} aria-label="刪除">{content}</del>
      : part.kind === 'insert' ? <ins key={i} aria-label="新增">{content}</ins> : <span key={i}>{content}</span>;
  });
}
function textRun(block: ReadingNoteBlock): { text: string; runs: ReadingNoteText[] } | undefined {
  if (!Array.isArray(block.content) || block.children.length || block.content.some(c => c.type !== 'text')) return;
  const runs = block.content as ReadingNoteText[];
  if (runs.some(c => Object.keys(c.styles).some(key => !['bold', 'italic', 'code', 'underline', 'strike'].includes(key)))) return;
  return { text: runs.map(c => c.text).join(''), runs };
}
function unchangedFormatting(before: ReadingNoteText[], after: ReadingNoteText[], changes: ReturnType<typeof diffText>): boolean {
  function signature(runs: ReadingNoteText[], start: number, length: number) {
    let offset = 0;
    const fragments: Array<{ text: string; styles: ReadingNoteText['styles'] }> = [];
    for (const run of runs) {
      const text = run.text.slice(Math.max(0, start - offset), Math.max(0, start + length - offset));
      offset += run.text.length;
      if (!text) continue;
      const last = fragments.at(-1);
      if (last && JSON.stringify(last.styles) === JSON.stringify(run.styles)) last.text += text;
      else fragments.push({ text, styles: run.styles });
    }
    return JSON.stringify(fragments);
  }
  let oldOffset = 0, newOffset = 0;
  for (const part of changes) {
    if (part.kind === 'equal' && signature(before, oldOffset, part.text.length) !== signature(after, newOffset, part.text.length)) return false;
    if (part.kind !== 'insert') oldOffset += part.text.length;
    if (part.kind !== 'delete') newOffset += part.text.length;
  }
  return true;
}
function InlineRevision({ before, after }: { before: ReadingNoteBlock; after: ReadingNoteBlock }) {
  const a = textRun(before), b = textRun(after);
  // Rich/structural changes use the established renderer so nothing is silently flattened.
  if (!a || !b || before.type !== after.type || JSON.stringify(before.props) !== JSON.stringify(after.props)
    || !unchangedFormatting(a.runs, b.runs, diffText(a.text, b.text))) return null;
  const content = <TextDiff before={a.text} after={b.text} beforeRuns={a.runs} afterRuns={b.runs} />;
  switch (before.type) {
    case 'heading': return <div className={`revision-inline revision-heading level-${before.props.level}`} role="heading" aria-level={Number(before.props.level) || 2}>{content}</div>;
    case 'paragraph': return <p className="revision-inline">{content}</p>;
    case 'quote': return <blockquote className="revision-inline">{content}</blockquote>;
    case 'codeBlock': return <pre className="revision-inline"><code>{content}</code></pre>;
    case 'bulletListItem': return <ul className="revision-inline"><li>{content}</li></ul>;
    case 'numberedListItem': return <ol className="revision-inline"><li>{content}</li></ol>;
    case 'checkListItem': return <p className="revision-inline"><span aria-label={before.props.checked ? '已勾選' : '未勾選'}>{before.props.checked ? '☑ ' : '☐ '}</span>{content}</p>;
    default: return null;
  }
}
/** Text-only structural rewrites stay in one reading flow; rich nodes keep their renderer. */
function proseRuns(blocks: ReadingNoteBlock[], depth = 0): ReadingNoteText[] | undefined {
  const result: ReadingNoteText[] = [];
  let number = 0;
  for (const block of blocks) {
    if (!['paragraph', 'bulletListItem', 'numberedListItem', 'checkListItem', 'quote'].includes(block.type)) return;
    const own = textRun({ ...block, children: [] });
    const children = proseRuns(block.children, depth + 1);
    if (!own || !children) return;
    number = block.type === 'numberedListItem' ? number + 1 : 0;
    const marker = block.type === 'bulletListItem' ? '• ' : block.type === 'numberedListItem' ? `${number}. `
      : block.type === 'checkListItem' ? (block.props.checked ? '☑ ' : '☐ ') : block.type === 'quote' ? '› ' : '';
    if (result.length) result.push({ type: 'text', text: '\n', styles: {} });
    if (marker) result.push({ type: 'text', text: '  '.repeat(depth) + marker, styles: {} });
    result.push(...own.runs);
    if (children.length) result.push({ type: 'text', text: '\n', styles: {} }, ...children);
  }
  return result;
}
function ProseRevision({ before, after }: { before: ReadingNoteBlock[]; after: ReadingNoteBlock[] }) {
  const a = proseRuns(before), b = proseRuns(after);
  if (!a || !b) return null;
  const oldText = a.map(run => run.text).join(''), newText = b.map(run => run.text).join('');
  // Formatting-only edits must remain visible, not disappear into equal text.
  if (oldText === newText || !unchangedFormatting(a, b, diffText(oldText, newText))) return null;
  return <p className="revision-inline"><TextDiff before={oldText} after={newText} beforeRuns={a} afterRuns={b} /></p>;
}
export type RevisionProposal = Pick<NoteUpdate, 'originalTitle' | 'title' | 'originalContent' | 'content' | 'changes'>;
export function ReadingNoteRevision({ proposal, note, api, metadata }: { proposal: RevisionProposal; metadata?: ReactNode; note: ReadingNote; api: ReaderDesktopApi['readingNotes'] }) {
  const groups = useMemo(() => proposal.changes ? revisionGroups(proposal) : documentRevisionGroups(proposal.originalContent ?? { version: 1, blocks: [] }, proposal.content), [proposal]);
  const unchanged = proposal.originalTitle === proposal.title && groups.every(g => g.kind === 'equal');
  const rich = (blocks: ReadingNoteBlock[], key: string) => <ReadingNoteReadOnlyContent key={key} api={api} note={{ ...note, content: { version: 1, blocks } }} />;
  return <article className="reading-note-revision" aria-label="筆記修訂內容">
    <h2><TextDiff before={proposal.originalTitle} after={proposal.title} /></h2>
    {metadata}
    {unchanged ? <p role="status">沒有內容變更</p> : null}
    {groups.map((group, index) => {
      if (group.kind === 'equal') return <div key={index}>{rich(group.after, `${index}-equal`)}</div>;
      const inline = group.before.length === 1 && group.after.length === 1 ? InlineRevision({ before: group.before[0]!, after: group.after[0]! }) : null;
      const prose = inline ?? ProseRevision({ before: group.before, after: group.after });
      if (prose) return <div key={index}>{prose}</div>;
      return <section className="revision-block-change" key={index} aria-label={group.kind === 'insert' ? '新增區塊' : '區塊修訂'}>
        {group.before.length ? <div className="revision-deleted"><small>刪除 · 修改前</small>{rich(group.before, `${index}-before`)}</div> : null}
        {group.after.length ? <div className="revision-inserted"><small>新增 · 修改後</small>{rich(group.after, `${index}-after`)}</div> : null}
      </section>;
    })}
  </article>;
}
