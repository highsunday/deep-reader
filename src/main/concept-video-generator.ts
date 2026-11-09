import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ConceptVideo, ConceptVideoIdentity, ConceptVideoVersion, ConceptVideoPoll } from '../shared/concept-video';
import { CONCEPT_VIDEO_BILLING_REASON, VIDEO_ENGINES, VIDEO_ENGINE_LABELS, videoEngine, type VideoEngine, type VideoEngineCapability } from '../shared/concept-video';
import { LocalConceptVideoStore } from './concept-video-store';
import rendererScript from './concept-video-render.py?raw';
import { renderVideoProgram } from './concept-video-program-renderer';
import { engineCapabilities, renderEngineProgram } from './concept-video-engine-renderer';
import { synthesizeVideoNarration } from './concept-video-narration';
const execute = promisify(execFile);
export interface LocalVideoCapability { generationAllowed: boolean; narrationAllowed: boolean; reason: string; engines?: Record<VideoEngine, VideoEngineCapability> }
export interface RenderedVideo { durationSeconds: number; bytes: number; scenes: ConceptVideoVersion['scenes'] }
export interface VideoRenderOptions {
  capability(): Promise<LocalVideoCapability>;
  render(video: ConceptVideo, directory: string, signal: AbortSignal): Promise<RenderedVideo>;
}
function executable(name: string): string { return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'].map(p => join(p, name)).find(existsSync) ?? name; }
export function localVideoRenderer(): VideoRenderOptions {
  let python = executable('python3');
  const pythonCandidates = [...new Set([process.env.VIDEO_PYTHON, join(process.cwd(), '.venv/bin/python3'), python, join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3')].filter((p): p is string => Boolean(p)))];
  const ffmpeg = executable('ffmpeg'), ffprobe = executable('ffprobe');
  return {
    async capability() {
      if (process.platform !== 'darwin') return { generationAllowed: false, narrationAllowed: false, reason: 'Local video rendering is currently supported on macOS. Other platforms have not been verified.' };
      try {
        await Promise.all([execute(ffmpeg, ['-version'], { timeout: 10_000 }), execute(ffprobe, ['-version'], { timeout: 10_000 })]);
      } catch { return { generationAllowed: false, narrationAllowed: false, reason: 'Local rendering requires FFmpeg and FFprobe. Install them and try again.' }; }
      // Codex authentication and voice entitlement are checked during synthesis.
      // A missing local system voice must not silently disable AI narration.
      return { generationAllowed: true, narrationAllowed: true, reason: '', engines: { canvas: { available: true, reason: '' }, ...await engineCapabilities() } };
    },
    async render(video, directory, signal) {
      if (video.plan.animation === 'program') return videoEngine(video.plan) === 'canvas' ? renderVideoProgram(video, directory, signal, ffmpeg, ffprobe) : renderEngineProgram(video, directory, signal, ffmpeg, ffprobe);
      if (videoEngine(video.plan) !== 'canvas') throw new Error('The selected engine needs a complete animation program.');
      // Legacy renderer only remains for existing saved plans and regression fixtures.
      let found = false;
      for (const candidate of pythonCandidates) { try { await execute(candidate, ['-c', 'from PIL import Image, ImageFont'], { timeout: 10_000 }); python = candidate; found = true; break; } catch { /* Try another installed runtime. */ } }
      if (!found) throw new Error('Rebuilding legacy videos requires Python Pillow.');
      mkdirSync(directory, { recursive: true });
      await synthesizeVideoNarration(video.plan, directory, signal);
      writeFileSync(join(directory, 'render.py'), rendererScript);
      writeFileSync(join(directory, 'job.json'), JSON.stringify({ plan: video.plan, source: video.source }));
      await new Promise<void>((resolve, reject) => {
        const child = spawn(python, [join(directory, 'render.py'), join(directory, 'job.json'), ffmpeg, ffprobe], { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' });
        let errors = '', settled = false;
        const stop = () => { try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill(); } catch { /* already stopped */ } };
        const finish = (error?: Error) => { if (settled) return; settled = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); error ? reject(error) : resolve(); };
        const abort = () => { stop(); finish(new Error('Generation cancelled')); };
        const timeout = setTimeout(() => { stop(); finish(new Error('Local rendering timed out. Shorten the video and try again.')); }, 10 * 60_000);
        child.stderr.on('data', data => { errors = (errors + data.toString()).slice(-4000); });
        child.on('error', error => finish(error));
        child.on('close', code => finish(code === 0 ? undefined : new Error(errors.trim() || 'Local video generation failed.')));
        signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      });
      const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8')) as RenderedVideo;
      if (!Number.isFinite(result.durationSeconds) || result.durationSeconds <= 0 || result.durationSeconds > 300 || !Number.isSafeInteger(result.bytes) || result.bytes < 1 || result.bytes > 100_000_000 || result.scenes.length !== video.plan.scenes.length) throw new Error('Local video validation failed.');
      // Retain just the playable artifact, subtitles, snapshot and previews.
      for (const file of ['render.py', 'concat.txt', ...video.plan.scenes.flatMap((_, i) => [`${i}.aiff`, `${i}.wav`, `${i}.txt`, `${i}.mp4`])]) rmSync(join(directory, file), { force: true });
      return result;
    }
  };
}
type VideoPreparation = (video: ConceptVideo, signal: AbortSignal, renderingFailure?: string) => Promise<ConceptVideo>;
function animationProgramError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  const fromAnimation = /Codex animation failed|Remotion animation failed|manim-worker\.py|Traceback \(most recent call last\)/i.test(message);
  const remotionSyntax = /Remotion animation failed:/i.test(message) && /Transform failed with \d+ errors?:/i.test(message);
  return remotionSyntax || fromAnimation && /(?:ReferenceError|SyntaxError|TypeError|NameError|AttributeError|IndexError|ValueError):|is not defined|is not a function|Unexpected token|Cannot (?:read|access) (?:properties|property)/i.test(message);
}
export class ConceptVideoGenerator {
  private unsaved = new Map<string, { jobId: string; error: string }>();
  private jobs = new Map<string, { jobId: string; abort: AbortController; task: Promise<void>; children?: string[] }>();
  constructor(private store: LocalConceptVideoStore, private renderer: VideoRenderOptions = localVideoRenderer()) { try { store.interruptGenerations(); } catch { /* Corrupt or unwritable video data must not prevent the reader from opening. Read operations report the original error. */ } }
  async capability() { return { aiAllowed: false as const, ...await this.renderer.capability(), aiReason: CONCEPT_VIDEO_BILLING_REASON }; }
  get(id: unknown): ConceptVideo { return this.overlay(this.store.get(id)); }
  list(filter?: unknown): ConceptVideo[] { return this.store.list(filter).map(video => this.overlay(video)); }
  poll(previous?: string): ConceptVideoPoll {
    // Failed persistence changes the visible status without changing the file/revision.
    const token = createHash('sha256').update(this.store.changeToken()).update(JSON.stringify([...this.unsaved])).digest('hex');
    return token === previous ? { token } : { token, videos: this.list() };
  }
  private overlay(video: ConceptVideo): ConceptVideo {
    const error = this.unsaved.get(video.id);
    if (error && video.generation?.id === error.jobId && video.generation.status === 'running') return { ...video, generation: { ...video.generation, status: 'failed', stage: 'Not saved. Reload and try again.', error: error.error } };
    return video;
  }
  async generate(input: ConceptVideoIdentity, prepare?: VideoPreparation, repair?: VideoPreparation): Promise<ConceptVideo> {
    if (this.jobs.size) throw new Error('Another video is generating. Wait or cancel it before trying again.');
    const capability = await this.renderer.capability();
    if (!capability.generationAllowed) throw new Error(capability.reason);
    const unsaved = this.unsaved.get(input.id);
    if (unsaved) {
      this.store.finishGeneration(input.id, unsaved.jobId, { status: 'failed', stage: 'The previous generation was not saved. You can try again.', error: unsaved.error });
      this.unsaved.delete(input.id);
      throw new Error('Ready to retry. Reload before generating.');
    }
    const current = this.store.get(input.id);
    const engine = capability.engines?.[videoEngine(current.plan)];
    if (engine && !engine.available) throw new Error(engine.reason);
    if (!prepare && current.plan.scenes.some(scene => !scene.visual.trim() && !scene.narration.trim())) throw new Error('Add a visual or narration to each scene before generating.');
    if (!prepare && current.plan.narration && !capability.narrationAllowed) throw new Error(capability.reason || 'Turn off Chinese narration before generating.');
    // Recheck after asynchronous capability lookup so concurrent invocations cannot start twice.
    if (this.jobs.size) throw new Error('Another video is already generating.');
    const video = this.store.startGeneration(input, prepare ? 'Codex is designing the animation…' : undefined), jobId = video.generation!.id, versionId = randomUUID();
    const directory = this.store.artifactDirectory(video.id, versionId), abort = new AbortController();
    const job = { jobId, abort, task: Promise.resolve() }; this.jobs.set(video.id, job);
    job.task = this.run(video, jobId, versionId, directory, abort.signal, prepare, repair).finally(() => { this.jobs.delete(video.id); });
    return video;
  }
  async compare(input: ConceptVideoIdentity, prepare: VideoPreparation): Promise<ConceptVideo> {
    if (this.jobs.size) throw new Error('Another video is generating. Wait or cancel it before trying again.');
    const capability = await this.renderer.capability();
    if (!capability.generationAllowed) throw new Error(capability.reason);
    for (const engine of VIDEO_ENGINES) {
      const available = capability.engines?.[engine];
      if (available?.available === false) throw new Error(`${VIDEO_ENGINE_LABELS[engine]}: ${available.reason}`);
    }
    if (this.jobs.size) throw new Error('Another video is already generating.');
    if (this.unsaved.size) throw new Error('A previous generation was not saved. Reload and retry it before comparing.');
    const video = this.store.startComparison(input), abort = new AbortController();
    const job = { jobId: video.generation!.id, abort, task: Promise.resolve(), children: video.comparison!.videoIds };
    this.jobs.set(video.id, job);
    job.task = this.runComparison(video, abort.signal, prepare).finally(() => this.jobs.delete(video.id));
    return video;
  }
  private async runComparison(video: ConceptVideo, signal: AbortSignal, prepare: VideoPreparation) {
    const jobId = video.generation!.id, children = video.comparison!.videoIds;
    try {
      const failures: string[] = [];
      for (const [index, id] of children.entries()) {
        if (signal.aborted) return;
        const label = VIDEO_ENGINE_LABELS[VIDEO_ENGINES[index]];
        this.store.updateGeneration(video.id, jobId, `${index + 1}/3 · Generating ${label} comparison video…`);
        const child = this.store.get(id), childJobId = child.generation!.id, versionId = randomUUID();
        await this.run(child, childJobId, versionId, this.store.artifactDirectory(id, versionId), signal, prepare, prepare);
        if (signal.aborted) return;
        const result = this.get(id);
        if (result.generation?.status !== 'completed') failures.push(label);
      }
      this.store.finishGeneration(video.id, jobId, { status: failures.length ? 'failed' : 'completed',
        stage: failures.length ? 'Comparison finished with errors. Successful videos are saved.' : 'All three comparison videos generated',
        ...(failures.length ? { error: `Could not generate: ${failures.join(', ')}. See each result for details.` } : {}) });
    } catch (error) {
      if (!signal.aborted) {
        const message = error instanceof Error ? error.message : 'Engine comparison failed';
        for (const id of [...children, video.id]) {
          try { const current = this.store.get(id); this.store.finishGeneration(id, current.generation!.id, { status: 'failed', stage: 'Engine comparison stopped', error: message }); }
          catch { const current = id === video.id ? jobId : undefined; if (current) this.unsaved.set(id, { jobId: current, error: message }); }
        }
      }
    }
  }
  private async run(video: ConceptVideo, jobId: string, versionId: string, directory: string, signal: AbortSignal, prepare?: VideoPreparation, repair?: VideoPreparation) {
    try {
      if (prepare) video = await prepare(video, signal);
      if (signal.aborted) return;
      let result: RenderedVideo;
      for (let attempt = 0; ; attempt++) {
        if (signal.aborted) return;
        video = this.store.updateGeneration(video.id, jobId, video.plan.narration ? 'Generating Codex AI narration and rendering animation' : 'Rendering animation locally');
        try { result = await this.renderer.render(video, directory, signal); break; }
        catch (error) {
          if (signal.aborted || attempt > 0 || !repair || !animationProgramError(error)) throw error;
          rmSync(directory, { recursive: true, force: true });
          video = this.store.updateGeneration(video.id, jobId, 'AI is repairing the animation program (1/1)…');
          video = await repair(video, signal, error instanceof Error ? error.message.slice(-4000) : 'Animation program failed');
        }
      }
      if (signal.aborted) { rmSync(directory, { recursive: true, force: true }); return; }
      this.store.updateGeneration(video.id, jobId, 'Saving video…');
      const next = this.store.finishGeneration(video.id, jobId, { status: 'completed', stage: 'Video generated', version: { id: versionId, createdAt: Date.now(), plan: video.plan, ...result } });
      if (!next.versions.some(v => v.id === versionId)) rmSync(directory, { recursive: true, force: true });
    } catch (e) {
      rmSync(directory, { recursive: true, force: true });
      if (!signal.aborted) { try { this.store.finishGeneration(video.id, jobId, { status: 'failed', stage: 'Generation failed. You can try again.', error: e instanceof Error ? e.message : 'Local generation failed' }); } catch (failure) { this.unsaved.set(video.id, { jobId, error: `Not saved: ${failure instanceof Error ? failure.message : 'Try again'}` }); } }
    }
  }
  async cancel(id: string): Promise<ConceptVideo> {
    const owner = [...this.jobs.entries()].find(([key, job]) => key === id || job.children?.includes(id));
    if (!owner) return this.store.get(id);
    const [ownerId, job] = owner;
    try {
      const ids = new Set([ownerId, ...(job.children ?? [])]);
      // Completed comparison copies can already have been deleted from the library.
      for (const current of this.store.list().filter(video => ids.has(video.id))) {
        this.store.finishGeneration(current.id, current.generation!.id, { status: 'cancelled', stage: 'Generation cancelled. You can try again.' });
      }
    } finally { job.abort.abort(); }
    return this.store.get(id);
  }
  async waitForIdle() { await Promise.all([...this.jobs.values()].map(j => j.task)); }
  close() { for (const job of this.jobs.values()) job.abort.abort(); }
}
