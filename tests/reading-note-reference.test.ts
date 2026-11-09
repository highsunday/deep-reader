import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpacedReviewService } from '../src/main/spaced-review-service';
import { assertNoteUpdatePreservesBaseline, parseNoteUpdateArtifact } from '../src/shared/reading-note-reference';
import { ChatController } from '../src/main/chat-controller';
import { LocalReadingNoteStore } from '../src/main/reading-note-store';
import { LocalChatConversationStore } from '../src/main/chat-conversation-store';
import { markdownToReadingNoteDocument as doc } from '../src/shared/reading-note-document';
import type { CodexAppServerClient, CodexNotification } from '../src/main/codex-app-server-client';

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).reverse().forEach(fn => fn()); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'f63-test-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const store = new LocalReadingNoteStore(join(dir, 'notes'));
  const a = store.create({ sourceDraftId: 'a', title: 'A筆記', content: doc('原本理解'), bookTitle: 'A書', chapterTitle: '第一章' });
  const c = store.create({ sourceDraftId: 'c', title: 'C筆記', content: doc('另一觀念'), bookTitle: 'C書', chapterTitle: '第二章' });
  const history = new LocalChatConversationStore(join(dir, 'chat'));
  let notify: (n: CodexNotification) => void = () => {};
  let count = 0;
  const requests: Array<{ method: string; params: any }> = [];
  const client = {
    initialize: async () => {}, readAccount: async () => ({ account: { type: 'chatgpt' }, requiresOpenaiAuth: false }), close: () => {}, onExit: () => () => {},
    onNotification: (fn: typeof notify) => { notify = fn; return () => {}; },
    request: async (method: string, params: any) => {
      requests.push({ method, params });
      if (method === 'account/read') return { account: { type: 'chatgpt' } };
      if (method === 'thread/start' || method === 'thread/resume') return { thread: { id: 'thread' } };
      if (method === 'turn/start') return { turn: { id: `turn-${++count}` } };
      return {};
    }
  } as unknown as CodexAppServerClient;
  const controller = new ChatController({ createClient: () => client, workingDirectory: dir, readingNoteStore: store, conversationStore: history });
  cleanup.push(() => controller.close());
  function finish(proposals?: unknown[], status = 'completed', version = 2) {
    const text = proposals ? '新的理解。\n```reading-note-update\n' + JSON.stringify({ version, proposals }) + '\n```' : '一般討論';
    notify({ method: 'item/completed', params: { threadId: 'thread', turnId: `turn-${count}`, item: { type: 'agentMessage', id: `answer-${count}`, text } } });
    // item completion must not open Apply before the turn succeeds.
    expect(controller.getSnapshot().messages.at(-1)?.noteUpdates).toBeUndefined();
    notify({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: `turn-${count}`, status } } });
  }
  const proposal = (noteId = a.id, content = doc('新理解')) => ({ noteId, summary: '結合 B 書的討論', additions: content });
  const send = (text = '請更新 A 筆記', ids = [a.id]) => controller.sendMessage({ text, noteReferenceIds: ids, context: { bookTitle: 'B書', chapterTitle: '第三章', readingSegment: 'B 書的新觀點' } });
  return { dir, store, a, c, history, controller, requests, finish, proposal, send };
}

test('TC2/3: Main owns cross-book reference snapshots; discussion never writes notes', async () => {
  const s = setup();
  await s.send('這兩個理解有什麼關係？', [s.a.id, s.c.id, s.a.id]);
  const user = s.controller.getSnapshot().messages[0]!;
  expect(user.noteReferences?.map(n => n.id)).toEqual([s.a.id, s.c.id]);
  expect(user.noteReferences?.[0]).toMatchObject({ title: 'A筆記', revision: 1, bookTitle: 'A書' });
  expect(JSON.stringify(s.requests.find(r => r.method === 'turn/start')?.params)).toContain('原本理解');
  s.finish();
  expect(s.store.get(s.a.id)?.revision).toBe(1);
  expect(s.controller.getSnapshot().messages.at(-1)?.noteUpdates).toBeUndefined();
});

test('TC4/5/10: preview does not write; apply updates original once and survives restart', async () => {
  const s = setup(); await s.send(); s.finish([s.proposal()]);
  const candidate = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  expect(candidate.status).toBe('pending'); expect(s.store.get(s.a.id)?.title).toBe('A筆記');
  s.controller.decideReadingNoteUpdate(candidate.id, 'apply');
  expect(s.store.get(s.a.id)).toMatchObject({ id: s.a.id, title: 'A筆記', revision: 2, bookTitle: 'A書', createdAt: s.a.createdAt });
  expect(() => s.controller.decideReadingNoteUpdate(candidate.id, 'apply')).toThrow();
  expect(s.history.load().conversations[0]?.messages.at(-1)?.noteUpdates?.[0]?.status).toBe('applied');
  expect(s.history.load().conversations[0]?.messages[0]?.noteReferences?.[0]?.title).toBe('A筆記');
});

test('TC5: newer candidate supersedes only the same note; reject leaves notes unchanged', async () => {
  const s = setup(); await s.send('更新 A 和 C', [s.a.id, s.c.id]); s.finish([s.proposal(), s.proposal(s.c.id)]);
  const first = s.controller.getSnapshot().messages.at(-1)!.noteUpdates!;
  await s.controller.sendMessage({ text: '把 A 寫得更清楚' }); s.finish([s.proposal()]);
  const messages = s.controller.getSnapshot().messages;
  expect(messages.find(m => m.noteUpdates?.some(p => p.id === first[0]!.id))?.noteUpdates?.[0]?.status).toBe('superseded');
  const latest = messages.at(-1)!.noteUpdates![0]!;
  s.controller.decideReadingNoteUpdate(latest.id, 'reject');
  s.controller.decideReadingNoteUpdate(first[1]!.id, 'apply');
  expect(s.store.get(s.a.id)?.revision).toBe(1); expect(s.store.get(s.c.id)?.revision).toBe(2);
});

test.each(['edit', 'trash', 'delete'] as const)('TC6: %s conflicts cannot overwrite current state', async action => {
  const s = setup(); await s.send(); s.finish([s.proposal()]);
  const candidate = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  if (action === 'edit') s.store.update({ id: s.a.id, baseRevision: 1, title: '人工更新', content: doc('保留') });
  else { s.store.trash(s.a.id); if (action === 'delete') s.store.emptyTrash(); }
  expect(() => s.controller.decideReadingNoteUpdate(candidate.id, 'apply')).toThrow();
  expect(s.store.get(s.a.id)?.title).not.toBe('更新的理解');
});

test.each(['unknown', 'extra-revision', 'new-image', 'external-image', 'malformed', 'malformed-table'] as const)('TC8: reject %s candidates', async kind => {
  const s = setup();
  if (kind === 'new-image') s.store.update({ id: s.a.id, baseRevision: 1, title: s.a.title, content: { version: 1, blocks: [{ id: 'image', type: 'image', props: { assetId: 'asset-a' }, children: [] }] } });
  await s.send();
  const p: any = s.proposal();
  if (kind === 'new-image') p.additions = s.store.get(s.a.id)!.content;
  if (kind === 'unknown') p.noteId = s.c.id;
  if (kind === 'extra-revision') p.baseRevision = 99;
  if (kind === 'external-image') p.additions = { version: 1, blocks: [{ id: 'bad', type: 'image', props: { assetId: 'http://bad' }, children: [] }] };
  if (kind === 'malformed') p.additions = 'bad';
  if (kind === 'malformed-table') p.additions = { version: 1, blocks: [{ id: 'table', type: 'table', props: {}, children: [], content: { type: 'tableContent', columnWidths: [null, null], rows: [{ cells: [[]] }] } }] };
  s.finish([p]);
  expect(s.controller.getSnapshot().messages.at(-1)?.noteUpdates).toBeUndefined();
  expect(s.controller.getSnapshot().messages.at(-1)?.noteUpdateError).toBeTruthy();
});

test('TC9/11: failed turns cannot apply and missing references do not send a turn', async () => {
  const s = setup(); await s.send(); s.finish([s.proposal()], 'interrupted');
  expect(s.controller.getSnapshot().messages.at(-1)?.noteUpdates).toBeUndefined();
  s.store.trash(s.a.id);
  const before = s.requests.filter(r => r.method === 'turn/start').length;
  await expect(s.send()).rejects.toThrow();
  expect(s.requests.filter(r => r.method === 'turn/start')).toHaveLength(before);
});

test('TC9: note save failure retains a pending candidate for retry', async () => {
  const s = setup(); await s.send(); s.finish([s.proposal()]);
  const candidate = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  const spy = vi.spyOn(s.store, 'update').mockImplementationOnce(() => { throw new Error('disk full'); });
  expect(() => s.controller.decideReadingNoteUpdate(candidate.id, 'apply')).toThrow('disk full');
  expect(s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]?.status).toBe('pending');
  s.controller.decideReadingNoteUpdate(candidate.id, 'apply'); expect(s.store.get(s.a.id)?.revision).toBe(2); spy.mockRestore();
});

test('TC7: rich content, original metadata, tags and both memory images survive apply', async () => {
  const s = setup();
  const rich = { version: 1 as const, blocks: [
    ...doc('更新的理解包含 $E=mc^2$。').blocks,
    { id: 'display', type: 'mathBlock' as const, props: { latex: 'E=mc^2' }, children: [] },
    { id: 'table', type: 'table' as const, props: {}, children: [], content: { type: 'tableContent' as const, columnWidths: [null, null], rows: [{ cells: [[{ type: 'text' as const, text: '概念', styles: {} }], [{ type: 'text' as const, text: '說明', styles: {} }]] }] } },
    { id: 'image', type: 'image' as const, props: { assetId: 'asset-a', alt: '正文圖' }, children: [] }
  ] };
  s.store.update({ id: s.a.id, baseRevision: 1, title: s.a.title, content: rich });
  const tag = s.store.createTag('理解'); s.store.changeTags({ noteIds: [s.a.id], tagId: tag.id, action: 'add' });
  s.store.setMemoryImage({ id: s.a.id, baseRevision: s.store.get(s.a.id)!.revision, attachmentId: 'recall-a', side: 'recall' });
  s.store.setMemoryImage({ id: s.a.id, baseRevision: s.store.get(s.a.id)!.revision, attachmentId: 'understand-a', side: 'understand' });
  const before = s.store.get(s.a.id)!;
  await s.send(); s.finish([s.proposal(s.a.id, doc('加入新的理解'))]);
  const p = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  s.controller.decideReadingNoteUpdate(p.id, 'apply');
  const after = s.store.get(s.a.id)!;
  expect(after.content.blocks.slice(0, rich.blocks.length)).toEqual(rich.blocks); expect(JSON.stringify(after.content.blocks.slice(rich.blocks.length))).toContain('加入新的理解'); expect(after.tagIds).toEqual(before.tagIds);
  expect(after.memoryImages).toEqual(before.memoryImages);
  expect(after.sourceDraftId).toBe(before.sourceDraftId); expect(after.bookTitle).toBe('A書');
});

test('TC10: a fresh controller can apply a persisted pending candidate; new conversations cannot', async () => {
  const s = setup(); await s.send(); s.finish([s.proposal()]);
  const p = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  const reloaded = new ChatController({ createClient: () => { throw new Error('not needed'); }, workingDirectory: s.dir, readingNoteStore: s.store, conversationStore: s.history });
  cleanup.push(() => reloaded.close());
  expect(reloaded.getSnapshot().messages.at(-1)!.noteUpdates![0]?.status).toBe('pending');
  reloaded.decideReadingNoteUpdate(p.id, 'apply'); expect(s.store.get(s.a.id)?.revision).toBe(2);
  reloaded.startNewConversation();
  expect(() => reloaded.decideReadingNoteUpdate(p.id, 'apply')).toThrow();
});

test('TC2/4: a successful apply supplies the latest baseline on follow-up without mutating old quotes', async () => {
  const s = setup(); await s.send(); s.finish([s.proposal()]);
  s.controller.decideReadingNoteUpdate(s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!.id, 'apply');
  await s.controller.sendMessage({ text: '再補充一個例子' });
  const turn = s.requests.filter(r => r.method === 'turn/start').at(-1)!;
  expect(turn.params.input[0].text).toContain('"revision":2');
  expect(turn.params.input[0].text).toContain('fenced reading-note-update');
  s.finish([s.proposal()]);
  expect(s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]?.baseRevision).toBe(2);
});

test('TC2/5: applying an older pending candidate after a later quote never regresses the follow-up baseline', async () => {
  const s = setup(); await s.send(); s.finish([s.proposal()]);
  const p = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  await s.send('只討論，不產生新候選'); s.finish();
  s.controller.decideReadingNoteUpdate(p.id, 'apply');
  await s.controller.sendMessage({ text: '根據已套用的理解再修改' }); s.finish([s.proposal()]);
  expect(s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]?.baseRevision).toBe(2);
});


test('TC7: applying a note update preserves its review schedule and pause choice', async () => {
  const s = setup();
  const review = new SpacedReviewService(join(s.dir, 'review'), { notes: s.store, readImage: () => '' });
  review.enroll(s.a.id); review.setPaused(s.a.id, true);
  const before = review.details(s.a.id);
  await s.send(); s.finish([s.proposal()]);
  s.controller.decideReadingNoteUpdate(s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!.id, 'apply');
  expect(review.details(s.a.id)).toEqual(before);
});

test('TC9: a history write failure after a note save reports the error without allowing a second apply', async () => {
  const s = setup(); await s.send(); s.finish([s.proposal()]);
  const p = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  vi.spyOn(s.history, 'save').mockImplementationOnce(() => { throw new Error('history disk full'); });
  const snapshot = s.controller.decideReadingNoteUpdate(p.id, 'apply');
  expect(snapshot.conversationError).toBe('history disk full');
  expect(snapshot.messages.at(-1)!.noteUpdates![0]?.status).toBe('applied');
  expect(s.store.get(s.a.id)?.revision).toBe(2);
  expect(() => s.controller.decideReadingNoteUpdate(p.id, 'apply')).toThrow();
});


test('B69 TC1: adding understanding must retain every original block and the original title', async () => {
  const s = setup();
  const original = s.store.update({ id: s.a.id, baseRevision: 1, title: '不可改名的原筆記', content: doc('第一段原文。\n\n第二段原文與例子。') });
  await s.send(); s.finish([s.proposal()]);
  const p = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  s.controller.decideReadingNoteUpdate(p.id, 'apply');
  const saved = s.store.get(s.a.id)!;
  expect(saved.title).toBe(original.title);
  expect(saved.content.blocks.slice(0, original.content.blocks.length)).toEqual(original.content.blocks);
  expect(JSON.stringify(saved.content)).toContain('新理解');
});


test('B69 TC2/3: legacy replacement artifacts and tampered original blocks cannot be applied', async () => {
  const s = setup();
  expect(() => parseNoteUpdateArtifact('```reading-note-update\n' + JSON.stringify({ version: 1, proposals: [{ noteId: s.a.id, title: '替換', summary: '替換', content: doc('只剩新文') }] }) + '\n```', new Map([[s.a.id, s.a]]), () => 'p')).toThrow();
  await s.send(); s.finish([s.proposal()]);
  const p = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  const { preservedBlockCount, ...legacy } = p;
  expect(() => assertNoteUpdatePreservesBaseline(s.a, legacy)).toThrow('舊版替換候選');
  expect(() => assertNoteUpdatePreservesBaseline(s.a, { ...p, content: doc('只剩新文') })).toThrow('未完整保留原文');
  expect(s.store.get(s.a.id)?.revision).toBe(1);
});

test('B69 TC4: two saved supplements retain the original and first supplement exactly', async () => {
  const s = setup(); await s.send(); s.finish([s.proposal()]);
  s.controller.decideReadingNoteUpdate(s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!.id, 'apply');
  const first = s.store.get(s.a.id)!;
  await s.controller.sendMessage({ text: '再加入例子' }); s.finish([s.proposal(s.a.id, doc('第二次補充'))]);
  s.controller.decideReadingNoteUpdate(s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!.id, 'apply');
  const second = s.store.get(s.a.id)!;
  expect(second.content.blocks.slice(0, first.content.blocks.length)).toEqual(first.content.blocks);
  expect(second.title).toBe(s.a.title);
  expect(JSON.stringify(second.content)).toContain('第二次補充');
  expect(second.content.blocks.length).toBe(first.content.blocks.length + 1);
});


test.each(['legacy', 'tampered'] as const)('B69 TC2/3: persisted %s candidate is blocked by the actual apply path', async kind => {
  const s = setup(); await s.send(); s.finish([s.proposal()]);
  const state = s.history.load();
  const p = state.conversations[0]!.messages.at(-1)!.noteUpdates![0]!;
  if (kind === 'legacy') delete p.preservedBlockCount;
  else p.content.blocks[0] = doc('遭改寫的原文').blocks[0]!;
  s.history.save(state);
  const reloaded = new ChatController({ createClient: () => { throw new Error('not needed'); }, workingDirectory: s.dir, readingNoteStore: s.store, conversationStore: s.history });
  cleanup.push(() => reloaded.close());
  expect(() => reloaded.decideReadingNoteUpdate(p.id, 'apply')).toThrow(kind === 'legacy' ? '舊版替換候選' : '未完整保留原文');
  expect(s.store.get(s.a.id)).toEqual(s.a);
  reloaded.decideReadingNoteUpdate(p.id, 'reject');
  expect(reloaded.getSnapshot().messages.at(-1)!.noteUpdates![0]?.status).toBe('rejected');
});


test('targeted AI revision integrates a change and insertion while keeping every other block', async () => {
  const s = setup();
  const original = s.store.update({ id: s.a.id, baseRevision: 1, title: s.a.title, content: doc('需要釐清的第一段。\n\n必須保留的第二段。\n\n必須保留的第三段。') });
  await s.send();
  s.finish([{ noteId: s.a.id, title: original.title, summary: '釐清第一段，加入例子', changes: {
    replacements: [{ blockId: original.content.blocks[0]!.id, content: doc('釐清後的第一段。') }],
    insertions: [{ afterBlockId: original.content.blocks[0]!.id, content: doc('插入第一段後的例子。') }]
  } }], 'completed', 3);
  const p = s.controller.getSnapshot().messages.at(-1)!.noteUpdates![0]!;
  expect(p).toBeDefined();
  s.controller.decideReadingNoteUpdate(p.id, 'apply');
  const saved = s.store.get(s.a.id)!;
  expect(saved.content.blocks.slice(2)).toEqual(original.content.blocks.slice(1));
  expect(JSON.stringify(saved.content.blocks[0])).toContain('釐清後');
  expect(JSON.stringify(saved.content.blocks[1])).toContain('例子');
});


test.each(['unknown', 'duplicate', 'empty'] as const)('targeted edits reject %s block operations without writing', async kind => {
  const s = setup(); await s.send();
  const replacement = { blockId: kind === 'unknown' ? 'not-in-note' : s.a.content.blocks[0]!.id, content: kind === 'empty' ? { version: 1, blocks: [] } : doc('釐清') };
  s.finish([{ noteId: s.a.id, title: s.a.title, summary: '釐清', changes: { replacements: kind === 'duplicate' ? [replacement, replacement] : [replacement], insertions: [] } }], 'completed', 3);
  expect(s.controller.getSnapshot().messages.at(-1)?.noteUpdateError).toBeTruthy();
  expect(s.controller.getSnapshot().messages.at(-1)?.noteUpdates).toBeUndefined();
  expect(s.store.get(s.a.id)).toEqual(s.a);
});

test('targeted edits survive reload and reject tampering with unlisted blocks', async () => {
  const s = setup(); await s.send();
  s.finish([{ noteId: s.a.id, title: s.a.title, summary: '加入例子', changes: { replacements: [], insertions: [{ afterBlockId: null, content: doc('例子') }] } }], 'completed', 3);
  const state = s.history.load();
  const p = state.conversations[0]!.messages.at(-1)!.noteUpdates![0]!;
  expect(p.originalContent).toEqual(s.a.content);
  const reloaded = new ChatController({ createClient: () => { throw new Error('not needed'); }, workingDirectory: s.dir, readingNoteStore: s.store, conversationStore: s.history });
  cleanup.push(() => reloaded.close());
  reloaded.decideReadingNoteUpdate(p.id, 'apply');
  expect(s.store.get(s.a.id)?.content.blocks[0]).toEqual(s.a.content.blocks[0]);
  const tampered = structuredClone(p);
  tampered.content.blocks[0] = doc('原文遭竄改').blocks[0]!;
  expect(() => assertNoteUpdatePreservesBaseline(s.a, tampered)).toThrow('與原文不一致');
});
