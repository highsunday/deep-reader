import { expect, test } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatController } from '../src/main/chat-controller';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';
import { parseReadingSuggestion, readingSuggestions } from '../src/shared/reading-input-suggestion';

test.skipIf(process.env.REAL_INPUT_SUGGESTION !== '1')('F65 real model produces a follow-up and preserves the main operation after a detail question', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f65-real-'));
  const client = new SpawnedCodexAppServerClient();
  const controller = new ChatController({ createClient: () => client, workingDirectory: dir });
  const source = { bookTitle: '測試書籍', chapterTitle: '回饋', readingSegment: '負回饋縮小目前狀態與目標之間的差距，正回饋則放大原本的變化。回饋也可能有延遲。' };
  async function wait() {
    for (let i = 0; i < 240; i++) {
      if (!controller.getSnapshot().activeTurnId) return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error('Timed out');
  }
  let threadId: string | null = null;
  try {
    const connected = await controller.connect();
    expect(connected.connection).toBe('ready');
    const model = connected.models?.find(m => m.isDefault)?.id ?? connected.models?.[0]?.id;
    await controller.sendMessage({ text: '請用生活中的例子解釋這一段，簡短說明即可。', model, context: source, readingSource: source });
    await wait();
    threadId = controller.getSnapshot().threadId;
    const firstMessages = controller.getSnapshot().messages;
    const first = parseReadingSuggestion(firstMessages.at(-1)!.text);
    expect(first?.repeat).toBeTruthy();
    expect(first?.followUp).toBeTruthy();
    await controller.sendMessage({ text: '你提到的延遲是什麼意思？簡短回答。', model, readingSource: source });
    await wait();
    const messages = controller.getSnapshot().messages;
    const second = parseReadingSuggestion(messages.at(-1)!.text);
    mkdirSync('reports/f65-input-suggestions', { recursive: true });
    writeFileSync('reports/f65-input-suggestions/real-model.json', JSON.stringify({ model, first, second, messages }, null, 2));
    expect(second?.followUp).toBeTruthy();
    expect(second?.repeat).toBeNull();
    expect(readingSuggestions(messages, source).repeat).toBe(first!.repeat);
    mkdirSync('reports/f65-input-suggestions', { recursive: true });
    writeFileSync('reports/f65-input-suggestions/real-model.json', JSON.stringify({ model, first, second, messages, passed: true }, null, 2));
  } finally {
    if (threadId) await client.request('thread/archive', { threadId }).catch(() => {});
    controller.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 260_000);
