import type { ReadingNoteBlock } from '../shared/reading-note-document';
import type { NoteUpdate } from '../shared/reading-note-reference';

export interface TextChange { kind: 'equal' | 'delete' | 'insert'; text: string }
/** Grapheme boundaries keep combining characters and family emoji intact. Bound quadratic work. */
export function diffText(before: string, after: string): TextChange[] {
  if (before === after) return before ? [{ kind: 'equal', text: before }] : [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const a = Array.from(segmenter.segment(before), s => s.segment);
  const b = Array.from(segmenter.segment(after), s => s.segment);
  let start = 0, end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const x = a.slice(start, a.length - end), y = b.slice(start, b.length - end);
  const result: TextChange[] = [];
  function add(kind: TextChange['kind'], text: string) {
    if (!text) return;
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text;
    else result.push({ kind, text });
  }
  add('equal', a.slice(0, start).join(''));
  if (x.length * y.length > 250_000) {
    add('delete', x.join('')); add('insert', y.join(''));
  } else {
    const width = y.length + 1;
    const lengths = new Uint32Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) {
      lengths[i * width + j] = x[i] === y[j] ? lengths[(i + 1) * width + j + 1]! + 1
        : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
    let i = 0, j = 0;
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) { add('equal', x[i++]!); j++; }
      else if (i < x.length && (j === y.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) add('delete', x[i++]!);
      else add('insert', y[j++]!);
    }
  }
  add('equal', end ? a.slice(-end).join('') : '');
  return result;
}

export interface RevisionGroup { kind: 'equal' | 'insert' | 'replace'; before: ReadingNoteBlock[]; after: ReadingNoteBlock[] }
function semantic(blocks: ReadingNoteBlock[]): string {
  // Replacement IDs are intentionally regenerated; they are not visible edits.
  return JSON.stringify(blocks.map(({ id: _id, children, ...block }) => ({ ...block, children: JSON.parse(semantic(children)) })));
}
export function revisionGroups(proposal: Pick<NoteUpdate, 'originalContent' | 'content' | 'changes'>): RevisionGroup[] {
  const groups: RevisionGroup[] = [];
  const replacements = new Map(proposal.changes?.replacements.map(r => [r.blockId, r.content.blocks.length]));
  const insertions = new Map<string | null, number>();
  for (const insertion of proposal.changes?.insertions ?? []) insertions.set(insertion.afterBlockId, (insertions.get(insertion.afterBlockId) ?? 0) + insertion.content.blocks.length);
  let cursor = 0;
  function append(before: ReadingNoteBlock[], count: number) {
    const after = proposal.content.blocks.slice(cursor, cursor + count);
    cursor += count;
    const kind = !before.length ? 'insert' : semantic(before) === semantic(after) ? 'equal' : 'replace';
    const previous = groups.at(-1);
    if (kind === 'equal' && previous?.kind === 'equal') { previous.before.push(...before); previous.after.push(...after); }
    else groups.push({ kind, before, after });
  }
  for (const block of proposal.originalContent?.blocks ?? []) {
    append([block], replacements.get(block.id) ?? 1);
    const count = insertions.get(block.id);
    if (count) append([], count);
  }
  const tail = insertions.get(null);
  if (tail) append([], tail);
  return groups;
}

/** Markdown proposals have regenerated IDs: align semantic blocks, then compare changed gaps. */
export function documentRevisionGroups(before: import('../shared/reading-note-document').ReadingNoteDocument, after: import('../shared/reading-note-document').ReadingNoteDocument): RevisionGroup[] {
  const a = before.blocks, b = after.blocks;
  const ak = a.map(block => semantic([block])), bk = b.map(block => semantic([block]));
  const groups: RevisionGroup[] = [];
  const push = (kind: RevisionGroup['kind'], old: ReadingNoteBlock[], next: ReadingNoteBlock[]) => {
    if (!old.length && !next.length) return;
    const last = groups.at(-1);
    if (kind === 'equal' && last?.kind === 'equal') { last.before.push(...old); last.after.push(...next); }
    else groups.push({ kind, before: old, after: next });
  };
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && ak[prefix] === bk[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && ak[a.length - 1 - suffix] === bk[b.length - 1 - suffix]) suffix++;
  push('equal', a.slice(0, prefix), b.slice(0, prefix));
  const n = a.length - prefix - suffix, m = b.length - prefix - suffix;
  if (n * m > 40_000) {
    push(n ? 'replace' : 'insert', a.slice(prefix, a.length - suffix), b.slice(prefix, b.length - suffix));
  } else {
    const width = m + 1, lengths = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] = ak[prefix + i] === bk[prefix + j] ? lengths[(i + 1) * width + j + 1]! + 1
        : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
    let i = 0, j = 0;
    let old: ReadingNoteBlock[] = [], next: ReadingNoteBlock[] = [];
    const flush = () => {
      // Pair one-to-one gaps for localized text marks; retain one-to-many structures as blocks.
      if (old.length === next.length) old.forEach((block, k) => push('replace', [block], [next[k]!]));
      else push(old.length ? 'replace' : 'insert', old, next);
      old = []; next = [];
    };
    while (i < n || j < m) {
      if (i < n && j < m && ak[prefix + i] === bk[prefix + j]) { flush(); push('equal', [a[prefix + i++]!], [b[prefix + j++]!]); }
      else if (i < n && (j === m || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) old.push(a[prefix + i++]!);
      else next.push(b[prefix + j++]!);
    }
    flush();
  }
  if (suffix) push('equal', a.slice(-suffix), b.slice(-suffix));
  return groups;
}
