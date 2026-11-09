import { createRequire } from 'node:module';
import { join } from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import type { ConceptVideo } from '../shared/concept-video';
import type { RenderedVideo } from './concept-video-generator';
import workerSource from './concept-video-canvas-worker.cjs.txt?raw';
import { synthesizeVideoNarration } from './concept-video-narration';

export async function renderVideoProgram(video: ConceptVideo, directory: string, signal: AbortSignal, ffmpeg: string, ffprobe: string): Promise<RenderedVideo> {
  if (signal.aborted) throw new Error('Generation cancelled');
  mkdirSync(directory, { recursive: true });
  await synthesizeVideoNarration(video.plan, directory, signal);
  const worker = join(directory, 'canvas-worker.cjs');
  writeFileSync(worker, workerSource);
  writeFileSync(join(directory, 'job.json'), JSON.stringify({ plan: video.plan, source: video.source }));
  // Keep the exact generated code with every artifact, independently of metadata storage.
  for (const [i, scene] of video.plan.scenes.entries()) writeFileSync(join(directory, `scene-${i+1}.js`), scene.code!);
  const executable = process.versions.electron ? process.execPath : createRequire(join(process.cwd(), 'package.json'))('electron') as string;
  await new Promise<void>((resolve, reject) => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, [worker, join(directory, 'job.json'), ffmpeg, ffprobe], { stdio: ['ignore', 'ignore', 'pipe'], detached: true, env });
    let errors = '', failure: Error | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
      killTimer ??= setTimeout(() => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ } }, 2000);
    };
    const abort = () => stop(new Error('Generation cancelled'));
    const timer = setTimeout(() => stop(new Error('Local rendering timed out. Shorten the video and try again.')), 10*60_000);
    const cleanup = () => { clearTimeout(timer); clearTimeout(killTimer); signal.removeEventListener('abort', abort); };
    child.stderr.on('data', data => { errors = (errors + data).slice(-4000); });
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', code => { cleanup(); failure || code !== 0 ? reject(failure ?? new Error(errors.trim() || 'Codex animation generation failed.')) : resolve(); });
    signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
  });
  if (signal.aborted) throw new Error('Generation cancelled');
  const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8')) as RenderedVideo;
  if (!Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0 || result.durationSeconds > 300 || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || result.bytes > 100_000_000 || result.scenes.length !== video.plan.scenes.length) throw new Error('Animation video validation failed.');
  for (const file of ['canvas-worker.cjs', 'runtime-data', 'concat.txt', ...video.plan.scenes.flatMap((_,i)=>[`${i}.txt`,`${i}.aiff`,`${i}.wav`,`${i}.mp4`])]) rmSync(join(directory, file), { recursive: true, force: true });
  return result;
}
