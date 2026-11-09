import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoGenerator, localVideoRenderer } from '../src/main/concept-video-generator';
const execute = promisify(execFile);
test('TC11/19/22 real local pipeline: fresh animated MP4s, Chinese narration, subtitles and offline persisted playback bytes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'f53-real-video-'));
  const store = new LocalConceptVideoStore(directory), renderer = localVideoRenderer();
  expect(await renderer.capability()).toMatchObject({ generationAllowed: true, narrationAllowed: true });
  const generator = new ConceptVideoGenerator(store, renderer);
  try {
    for (const animation of ['flow', 'derivative'] as const) {
      const created = store.create({ source: { bookId: 'b1', chapterId: 'c1', bookTitle: '微積分的直覺', chapterTitle: '導數', range: { start: 0, end: 12 }, readingSegment: '兩點逐漸靠近，割線趨近切線。', images: [] }, question: '我想看懂斜率如何改變' });
      const video = store.save({ id: created.id, baseRevision: created.revision, plan: { ...created.plan, title: animation === 'derivative' ? '從割線到切線' : '理解的三個步驟', narration: animation === 'derivative', animation, scenes: [{ id: 'step-1', heading: '觀察兩點的變化', visual: '沿著曲線移動第二個點，觀察割線如何轉動。', narration: '兩個點慢慢靠近，割線的斜率接近二。' }, ...(animation === 'flow' ? [{ id: 'step-2', heading: '用自己的話解釋', visual: '連結觀察結果與理解目標，再用自己的話說明。', narration: '整理觀察，再用自己的話說明。' }] : [])] } });
      await generator.generate({ id: video.id, baseRevision: video.revision }); await generator.waitForIdle();
      const saved = new LocalConceptVideoStore(directory).get(video.id);
      expect(saved.generation?.error).toBeUndefined(); expect(saved.status).toBe('completed'); expect(saved.versions).toHaveLength(1);
      const version = saved.versions[0], artifact = store.artifactDirectory(video.id, version.id), mp4 = join(artifact, 'video.mp4');
      expect(store.readMedia({ id: video.id, versionId: version.id }).byteLength).toBe(version.bytes);
      const metadata = JSON.parse((await execute('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', mp4])).stdout);
      expect(metadata.streams.some((s: any) => s.codec_name === 'h264' && s.width === 960 && s.height === 540)).toBe(true);
      if (animation === 'derivative') {
        expect(metadata.streams.some((s: any) => s.codec_type === 'audio' && s.codec_name === 'aac')).toBe(true);
        const volume = await execute('/opt/homebrew/bin/ffmpeg', ['-i', mp4, '-af', 'volumedetect', '-vn', '-sn', '-f', 'null', '-']);
        const mean = Number(volume.stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1]); expect(mean).toBeGreaterThan(-60);
      }
      await execute('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', mp4, '-f', 'null', '-']);
      const hashes = (await execute('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-i', mp4, '-vf', 'select=eq(n\\,0)+eq(n\\,40)', '-frames:v', '2', '-an', '-f', 'framemd5', '-'])).stdout.split('\n').filter(line => /^0,/.test(line)).map(line => line.split(',').at(-1)?.trim());
      expect(hashes).toHaveLength(2); expect(hashes[0]).not.toBe(hashes[1]);
      expect(readFileSync(join(artifact, 'subtitles.srt'), 'utf8')).toContain('兩個點慢慢靠近');
      const report = join(process.cwd(), 'reports/concept-video/local-generation'); mkdirSync(report, { recursive: true });
      copyFileSync(mp4, join(report, `${animation}.mp4`)); copyFileSync(join(artifact, 'preview-1.png'), join(report, `${animation}.png`));
    }
  } finally { generator.close(); rmSync(directory, { recursive: true, force: true }); }
}, 120_000);
