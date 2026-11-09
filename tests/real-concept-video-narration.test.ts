import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoGenerator } from '../src/main/concept-video-generator';
const execute = promisify(execFile);
test.skipIf(process.env.REAL_VIDEO_NARRATION !== '1')('TC5: Codex narration is rendered into a playable three-scene video with matching subtitles', async () => {
  // Match the desktop App: a shell API key must not make this integration pass.
  const previousApiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const directory = mkdtempSync(join(tmpdir(), 'codex-narration-real-'));
  const store = new LocalConceptVideoStore(directory), generator = new ConceptVideoGenerator(store);
  const report = join(process.cwd(), 'reports/concept-video/codex-narration'); mkdirSync(report, { recursive: true });
  try {
    const created = store.create({ source: { bookId: 'narration-test', chapterId: 'test', bookTitle: '旁白合成驗證', chapterTitle: '導數的直覺', range: { start: 0, end: 2 }, readingSegment: '導數描述瞬間的變化率。', images: [] }, question: '驗證 AI 旁白' });
    const scripts = ['想像你正在騎腳踏車。', '看一眼碼表，就知道現在騎得多快。', '導數也是這樣，描述這一刻的變化。'];
    const prepared = store.completeProgram({ id: created.id, baseRevision: created.revision, description: '以三段旁白和動態圓形驗證 Codex 語音合成與影片編碼。',
      program: { runtime: 'canvas2d-v1', model: 'test-fixture', reasoningEffort: 'unknown', generatedAt: Date.now() },
      scenes: scripts.map((narration, i) => ({ heading: `旁白 ${i + 1}`, visual: '移動的圓形', narration,
        code: `ctx.fillStyle='#f7f5ef';ctx.fillRect(0,0,width,height);ctx.fillStyle='#2d6989';ctx.beginPath();ctx.arc(150+t*500,200,60,0,Math.PI*2);ctx.fill(); // ${i}` })) });
    await generator.generate({ id: prepared.id, baseRevision: prepared.revision }); await generator.waitForIdle();
    const saved = store.get(prepared.id); expect(saved.generation?.error).toBeUndefined(); expect(saved.versions).toHaveLength(1);
    const artifact = store.artifactDirectory(saved.id, saved.versions[0].id);
    for (const file of ['video.mp4', 'subtitles.srt', 'narration.json', 'preview-1.png']) copyFileSync(join(artifact, file), join(report, file));
    const metadata = JSON.parse((await execute('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', join(report, 'video.mp4')])).stdout);
    expect(metadata.streams.some((s: any) => s.codec_name === 'aac')).toBe(true);
    expect(metadata.streams.some((s: any) => s.codec_name === 'h264')).toBe(true);
    expect(Number(metadata.format.duration)).toBeGreaterThan(5);
    const captions = readFileSync(join(report, 'subtitles.srt'), 'utf8').split('\n').filter(line => line && !/^\d+$/.test(line) && !line.includes('-->')).join('');
    expect(captions).toBe(scripts.join(''));
    const narration = JSON.parse(readFileSync(join(report, 'narration.json'), 'utf8'));
    expect(narration.scenes).toHaveLength(3);
    expect(narration).toMatchObject({version:'v3',transport:'webrtc'});
    await execute('/opt/homebrew/bin/ffmpeg', ['-y', '-v', 'error', '-i', join(report, 'video.mp4'), '-vn', join(report, 'narration.mp3')]);
  } finally { generator.close(); rmSync(directory, { recursive: true, force: true });
    if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousApiKey;
  }
}, 420000);
