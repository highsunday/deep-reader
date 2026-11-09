import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ChatController } from '../src/main/chat-controller';
import { LocalReadingNoteStore } from '../src/main/reading-note-store';
import { LocalChatConversationStore } from '../src/main/chat-conversation-store';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';
import { markdownToReadingNoteDocument as doc } from '../src/shared/reading-note-document';

test.skipIf(process.env.REAL_NOTE_REFERENCE !== '1')('F63 real Codex: discuss a cross-book note, then prepare and apply a structured update', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f63-real-'));
  const store = new LocalReadingNoteStore(join(dir, 'notes'));
  const note = store.create({ sourceDraftId: 'real-a', title: '傾聽與理解', bookTitle: 'A書', chapterTitle: '第一章', content: doc('傾聽是保持安靜，等對方說完再提出自己的看法。\n\n原本的練習：先讓對方說完，再停頓三秒。\n\n觀察紀錄：我在上週的對話中練習等待，減少打斷。') });
  const options = { createClient: () => new SpawnedCodexAppServerClient(), workingDirectory: dir, readingNoteStore: store, conversationStore: new LocalChatConversationStore(join(dir, 'chat')), readingNoteSkillPath: resolve('.agents/skills/create-reading-note/SKILL.md') };
  let controller = new ChatController(options);
  async function wait() {
    for (let i = 0; i < 240; i++) { if (!controller.getSnapshot().activeTurnId) return; await new Promise(r => setTimeout(r, 500)); }
    throw new Error('AI response timed out');
  }
  try {
    const connected = await controller.connect(); expect(connected.connection).toBe('ready');
    const model = connected.models?.find(m => m.isDefault)?.id ?? connected.models?.[0]?.id;
    await controller.sendMessage({ text: '我覺得 A 筆記忽略了主動確認。請先討論這個差異，不要修改筆記。', model, noteReferenceIds: [note.id], context: { bookTitle: 'B書', chapterTitle: '第二章', readingSegment: '傾聽需要主動核對自己的理解：先用自己的話重述，再詢問對方是否正確，而不是只保持安靜。' } });
    await wait(); expect(controller.getSnapshot().messages.at(-1)?.noteUpdates).toBeUndefined(); expect(store.get(note.id)?.revision).toBe(1);
    controller.close();
    controller = new ChatController(options);
    await controller.connect();
    await controller.sendMessage({ text: '請根據剛剛討論編修引用的「傾聽與理解」第一段，將主動核對的新理解融入第一段，並標明來自 B 書；保留標題與其餘兩段原文。不要只追加文末。請提出可套用的候選。', model });
    await wait();
    const message = controller.getSnapshot().messages.at(-1)!;
    mkdirSync('reports/f63-targeted-edit', { recursive: true });
    writeFileSync('reports/f63-targeted-edit/real-codex-response.json', JSON.stringify({ model, messages: controller.getSnapshot().messages }, null, 2));
    expect(message.noteUpdateError).toBeUndefined(); expect(message.noteUpdates).toHaveLength(1);
    expect(store.get(note.id)?.revision).toBe(1);
    controller.decideReadingNoteUpdate(message.noteUpdates![0]!.id, 'apply');
    expect(message.noteUpdates![0]!.changes?.replacements.length).toBeGreaterThan(0);
    for (const unchanged of note.content.blocks.slice(1)) expect(store.get(note.id)!.content.blocks.find(b => b.id === unchanged.id)).toEqual(unchanged);
    expect(store.get(note.id)?.title).toBe(note.title);
    expect(JSON.stringify(store.get(note.id)!.content.blocks[0])).not.toBe(JSON.stringify(note.content.blocks[0]));
    expect(store.get(note.id)?.revision).toBe(2); expect(store.get(note.id)?.bookTitle).toBe('A書');
    writeFileSync('reports/f63-targeted-edit/real-codex-acceptance.json', JSON.stringify({ passed: true, model, checks: ['authenticated Codex', 'discussion without write', 'follow-up update with exact referenced ID', 'valid structured candidate', 'explicit apply', 'original source preserved', 'targeted revision applied', 'original title and all untouched blocks retained exactly'] }, null, 2));
  } finally { controller.close(); rmSync(dir, { recursive: true, force: true }); }
}, 260_000);
