import { describe, expect, test } from 'vitest';
import { parseReadingSuggestion, stripReadingSuggestion, readingSuggestions } from '../src/shared/reading-input-suggestion';
import type { ChatMessage } from '../src/shared/contracts';

const source = { bookTitle: 'Book', chapterTitle: 'Chapter', readingSegment: 'First paragraph' };
const block = (repeat: string | null, followUp = '這個差異可以舉例嗎？') => '\n```reading-input-suggestion\n' + JSON.stringify({ repeat, followUp }) + '\n```';
const user: ChatMessage = { id: 'u', turnId: 't', role: 'user', text: '詳細解釋', readingSource: source, status: 'completed' };
const answer: ChatMessage = { id: 'a', turnId: 't', role: 'assistant', text: '回答' + block('請詳細解釋這一段。'), status: 'completed' };
describe('F65 reading suggestions', () => {
  test('TC1 exposes a follow-up only for the current source', () => {
    expect(readingSuggestions([user, answer], source)).toEqual({ repeat: '請詳細解釋這一段。', followUp: '這個差異可以舉例嗎？' });
    expect(readingSuggestions([user, answer], { ...source, readingSegment: 'Next' })).toEqual({ repeat: '請詳細解釋這一段。', followUp: '' });
    expect(readingSuggestions([user, answer], { ...source, chapterTitle: 'Other' })).toEqual({ repeat: '', followUp: '' });
  });
  test('TC2 retains the main operation through a detail question', () => {
    const messages: ChatMessage[] = [user, answer, { ...user, id: 'u2', turnId: 't2', text: '回饋是什麼？' }, { ...answer, id: 'a2', turnId: 't2', text: '解釋回饋' + block(null, '正回饋如何放大變化？') }];
    expect(readingSuggestions(messages, source)).toEqual({ repeat: '請詳細解釋這一段。', followUp: '正回饋如何放大變化？' });
  });
  test('TC5 failed, streaming, missing and pending turns do not reuse a stale follow-up', () => {
    for (const status of ['failed', 'streaming'] as const) expect(readingSuggestions([user, { ...answer, status }], source).followUp).toBe('');
    expect(readingSuggestions([user, answer, { ...user, id: 'u2', turnId: 't2' }], source).followUp).toBe('');
    expect(readingSuggestions([], source).repeat).toBe('');
  });
  test('TC6 rejects malformed, duplicate and oversized metadata, hides partial blocks', () => {
    expect(parseReadingSuggestion(answer.text)?.repeat).toBe('請詳細解釋這一段。');
    for (const text of ['plain', block('x') + block('y'), block('x'.repeat(241)), '\n```reading-input-suggestion\n{bad}\n```']) expect(parseReadingSuggestion(text)).toBeNull();
    expect(stripReadingSuggestion(answer.text)).toBe('回答');
    expect(stripReadingSuggestion('```js\nconst n = 1;\n```')).toBe('```js\nconst n = 1;\n```');
    expect(stripReadingSuggestion('回答\n```reading-input-suggestion\n{"followUp":')).toBe('回答');
  });
});

test('TC6/7 controller keeps metadata across restart but excludes it from exported and note/voice context', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { ChatController, readerDeveloperInstructions } = await import('../src/main/chat-controller');
  const { LocalChatConversationStore } = await import('../src/main/chat-conversation-store');
  const { formatReadingConversation } = await import('../src/renderer/reading-conversation-export');
  const dir = mkdtempSync(join(tmpdir(), 'f65-'));
  const store = new LocalChatConversationStore(dir);
  store.save({ version: 1, selectedConversationId: 'c', conversations: [{ id: 'c', threadId: 't', title: 'Reading', source, createdAt: 1, updatedAt: 1, messages: [user, answer] }] });
  const controller = new ChatController({ createClient: () => { throw new Error('No network needed'); }, workingDirectory: dir, conversationStore: store });
  try {
    const snapshot = controller.getSnapshot();
    expect(readingSuggestions(snapshot.messages, source).repeat).toBe('請詳細解釋這一段。');
    expect(formatReadingConversation(snapshot)).toContain('回答');
    expect(formatReadingConversation(snapshot)).not.toContain('reading-input-suggestion');
    expect(controller.getReadingNoteConversationContext()).toContain('回答');
    expect(controller.getReadingNoteConversationContext()).not.toContain('reading-input-suggestion');
    expect(readerDeveloperInstructions()).toContain('reading-input-suggestion');
  } finally { controller.close(); rmSync(dir, { recursive: true, force: true }); }
});
