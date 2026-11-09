import { expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatController } from '../src/main/chat-controller';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';
import { readingCoachPrompt } from '../src/shared/reading-coach';
import { stripReadingSuggestion } from '../src/shared/reading-input-suggestion';

test.skipIf(process.env.REAL_READING_COACH !== '1')('F70 real AI diagnoses, hints, explains, evaluates application and summarizes in conversation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f70-real-'));
  const client = new SpawnedCodexAppServerClient();
  const controller = new ChatController({ createClient: () => client, workingDirectory: dir });
  const source = { bookTitle: '壓力與能力（自造測試文本）', chapterTitle: '恢復與增強', readingSegment: '恢復原狀，是受到衝擊後回到原先水準；過度補償則是在適量刺激與休息後建立超過原先需求的額外能力。這份額外能力形成備餘，可承受更大需求，也可能在新機會出現時創造利益。並非所有壓力都能使人增強；刺激太大或缺乏休息可能造成傷害。只看到當下工作速度提高，不足以判定產生了可持續使用的額外能力。' };
  const turns: { question: string; answer: string }[] = [];
  let model: string | undefined;
  async function send(text: string, initial = false) {
    await controller.sendMessage({ text, model, ...(initial ? { intent: 'readingCoach' as const, context: source } : { readingSource: source }) });
    await expect.poll(() => controller.getSnapshot().activeTurnId, { timeout: 150_000, interval: 500 }).toBeNull();
    const message = controller.getSnapshot().messages.findLast(m => m.role === 'assistant');
    expect(message?.status).toBe('completed');
    const answer = stripReadingSuggestion(message!.text);
    turns.push({ question: text, answer });
    mkdirSync('reports/f70-reading-coach', { recursive: true });
    writeFileSync('reports/f70-reading-coach/real-model.json', JSON.stringify({ model, source, turns }, null, 2));
    expect(answer).not.toMatch(/```(?:learning-question|reading-note-draft)/);
    return answer;
  }
  try {
    const connected = await controller.connect();
    expect(connected.connection).toBe('ready');
    model = connected.models?.find(m => m.isDefault)?.id ?? connected.models?.[0]?.id;
    const first = await send(readingCoachPrompt, true);
    expect(first).toMatch(/[？?]/);
    expect(first).not.toContain('本次理解評估');
    const diagnosis = await send('我認為只要恢復原狀就代表變強了，所以壓力越大一定越好。');
    expect(diagnosis).toMatch(/恢復|原先/);
    expect(diagnosis).toMatch(/傷害|不一定|適量|過大|界線|限制/);
    await send('我還是卡住，請先給我一個小提示。');
    await send('直接解釋恢復原狀與增加額外能力的差別，簡短說明就好。');
    await send('我修正一下：恢復只是回到原先水準；過度補償要建立超過需求且之後仍可使用的能力。比如團隊在合理期限下學會規劃與取捨，之後不靠熬夜也能處理更多工作，額外能力也能接有利潤的急單。若只是熬夜趕完，或期限太短造成損害，不能說成長。');
    const summary = await send('現在結束，請整理筆記。對尚未實際測過的能力如實標示。');
    for (const heading of ['本段核心思想', '關鍵概念', '作者的論證邏輯', '白話解釋與具體例子', '我的理解與常見誤區', '深入思考', '本次理解評估', '已獨立掌握', '部分理解', '尚未驗證']) expect(summary).toContain(heading);
    expect(summary).toMatch(/提示|引導|解釋後/);
    expect(summary).not.toMatch(/```reading-note|想記住哪|確認.*保存/);
  } finally {
    const threadId = controller.getSnapshot().threadId;
    if (threadId) await client.request('thread/archive', { threadId }).catch(() => {});
    controller.close(); rmSync(dir, { recursive: true, force: true });
  }
}, 900_000);

test.skipIf(process.env.REAL_READING_COACH_MASTERY !== '1')('F70 real AI naturally summarizes after independently demonstrated understanding', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'f70-mastery-'));
  const client = new SpawnedCodexAppServerClient();
  const controller = new ChatController({ createClient: () => client, workingDirectory: dir });
  const source = { bookTitle: '測試書', chapterTitle: '負回饋', readingSegment: '負回饋會以目前狀態與目標的差距來調整行動，縮小這個差距，使系統較穩定。例如室溫低於設定溫度時，暖氣啟動；溫度達標後，暖氣停止。負回饋中的「負」表示抑制偏差，不表示結果不好。這個機制需要能觀察狀態並調整行動；若資訊或行動有很長的延遲，也可能反覆超過目標。' };
  const turns: { question: string; answer: string }[] = [];
  try {
    const state = await controller.connect(); expect(state.connection).toBe('ready');
    const model = state.models?.find(m => m.isDefault)?.id ?? state.models?.[0]?.id;
    async function send(text: string, initial = false) {
      await controller.sendMessage({ text, model, readingSource: source, ...(initial ? { intent: 'readingCoach' as const, context: source } : {}) });
      await expect.poll(() => controller.getSnapshot().activeTurnId, { timeout: 150_000, interval: 500 }).toBeNull();
      const m = controller.getSnapshot().messages.findLast(m => m.role === 'assistant'); expect(m?.status).toBe('completed');
      const answer = stripReadingSuggestion(m!.text); turns.push({ question: text, answer });
      mkdirSync('reports/f70-reading-coach', { recursive: true });
      writeFileSync('reports/f70-reading-coach/real-mastery.json', JSON.stringify({ model, source, turns }, null, 2));
      return answer;
    }
    await send(readingCoachPrompt, true);
    let answer = await send('負回饋就是根據目前狀態和目標之間的差距，做能縮小差距的調整，因而促進穩定。「負」指抑制偏差，不代表壞結果。暖氣依溫差開關是原文例子。換成新的生活情境：我的目標是每月支出兩萬元，若觀察到支出過高，就減少可調整的開支，讓支出回到目標；要有及時記帳和可調整的支出才能運作。若帳單延遲很久才看到，可能過度節流或超支，來回偏離目標。作者的因果是觀察差距、反向調整、差距縮小；不是說所有修正一定穩定，延遲會限制效果。');
    if (!answer.includes('本次理解評估')) answer = await send('我的判斷依據是行動會縮小還是放大相對目標的差距；若價格上漲導致搶購、又推高價格，就是放大變化，不能算負回饋。若資訊或行動有延遲，依舊資訊持續加熱可能導致過熱，再停止太久而過冷。因此即使調整方向抑制偏差，也不能保證穩定；需要觀察延遲與實際結果。這是我從原文條件推出的應用，原文沒有直接描述搶購。');
    if (!answer.includes('本次理解評估')) answer = await send('如果偏差已經消失，卻因舊資料繼續同方向修正，就會跨過目標；因此先辨別目前狀態與目標，確認行動是否縮小當前差距，再檢查資訊和行動的延遲。這個推理不需要把「負」解釋為負面結果。若看不到狀態或無法調整行動，這個機制就無法按原文描述運作。');
    expect(answer).toContain('本次理解評估');
    expect(answer).toContain('已獨立掌握');
    expect(answer).toContain('尚未驗證');
    expect(answer).not.toContain('```reading-note-draft');
  } finally {
    const id = controller.getSnapshot().threadId;
    if (id) await client.request('thread/archive', { threadId: id }).catch(() => {});
    controller.close(); rmSync(dir, { recursive: true, force: true });
  }
}, 600_000);
