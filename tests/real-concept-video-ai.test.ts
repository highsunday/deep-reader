import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoAi } from '../src/main/concept-video-ai';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';
test.skipIf(process.env.REAL_VIDEO_AI !== '1')('actual Codex discussion returns a short summary and persists it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'real-video-ai-'));
  const store = new LocalConceptVideoStore(directory);
  const ai = new ConceptVideoAi(store, { workingDirectory: directory, createClient: () => new SpawnedCodexAppServerClient() });
  try {
    const video = store.create({ source: { bookId: 'test', chapterId: 'test', bookTitle: '驗證範例', chapterTitle: '穩定與波動', range: { start: 0, end: 20 }, readingSegment: '表面的穩定不代表能承受衝擊。適度的小幅波動，可以讓系統逐步調整。', images: [] }, question: '我想做一支比較表面穩定和承受波動能力的影片，用生活例子簡單說明。' });
    const result = await ai.discuss({ id: video.id, baseRevision: video.revision, operation: 'discuss' });
    expect(result.discussion.at(-1)?.role).toBe('assistant');
    expect(result.plan.goal.length).toBeGreaterThan(10);
    expect(result.plan.goal.length).toBeLessThan(1500);
    expect(new LocalConceptVideoStore(directory).get(video.id)).toEqual(result);
    mkdirSync('reports/concept-video', { recursive: true });
    writeFileSync('reports/concept-video/simple-discussion.json', JSON.stringify({ verifiedAt: new Date().toISOString(), title: result.plan.title, summary: result.plan.goal, discussion: result.discussion }, null, 2));
  } finally { ai.close(); rmSync(directory, { recursive: true, force: true }); }
}, 150_000);
