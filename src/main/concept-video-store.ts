import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONCEPT_VIDEO_BILLING_REASON, parseConceptVideo, parseVideoContext, parseVideoPlan, parseVideoSource, parseVideoEngine, videoEngine, videoObject, videoRevision, videoText, VIDEO_ENGINES, VIDEO_ENGINE_LABELS } from '../shared/concept-video';
import type { ConceptVideo, ConceptVideoContext, ConceptVideoFilter, ConceptVideoVersion, ConceptVideoGeneration, ConceptVideoPoll } from '../shared/concept-video';

export class LocalConceptVideoStore {
  private readonly path: string;
  private mediaIndex?: { token: string; versions: Map<string, Map<string, number>> };
  constructor(private directory: string, private options: { now?(): number; write?(path: string, data: string): void } = {}) { this.path = join(directory, 'concept-videos.json'); }
  capability() { return { aiAllowed: false as const, generationAllowed: false as const, reason: CONCEPT_VIDEO_BILLING_REASON }; }
  // Poll metadata only: source image snapshots can make this file tens of MB.
  changeToken(): string {
    try {
      const stat = statSync(this.path, { bigint: true });
      return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
      throw new Error('Could not read the Video Library. The original data is preserved.');
    }
  }
  poll(previous?: string): ConceptVideoPoll {
    const token = this.changeToken();
    return token === previous ? { token } : { token, videos: this.list() };
  }
  // Never reuse a cached revision: all windows in the main process share synchronous transactions.
  private load(): ConceptVideo[] {
    let raw: string;
    try { raw = readFileSync(this.path, 'utf8'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw new Error('Could not read the Video Library. The original data is preserved.'); }
    try {
      const state = videoObject(JSON.parse(raw));
      if (state.version !== 1 || !Array.isArray(state.videos)) throw new Error();
      const videos = state.videos.map(parseConceptVideo);
      if (new Set(videos.map(v => v.id)).size !== videos.length) throw new Error();
      return videos;
    } catch { throw new Error('Could not read the Video Library. The original data was not overwritten.'); }
  }
  private persist(videos: ConceptVideo[]): void {
    mkdirSync(this.directory, { recursive: true });
    const data = JSON.stringify({ version: 1, videos }, null, 2);
    if (this.options.write) this.options.write(this.path, data);
    else {
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try { writeFileSync(temp, data, 'utf8'); renameSync(temp, this.path); }
      finally { rmSync(temp, { force: true }); }
    }
  }
  private loadMediaIndex(token: string): ConceptVideo[] {
    const videos = this.load();
    const versions = new Map(videos.map(video => [
      video.id, new Map(video.versions.map(version => [version.id, version.bytes]))
    ]));
    this.mediaIndex = { token, versions };
    return videos;
  }
  private mediaVersion(value: unknown) {
    const input = videoObject(value), id = videoText(input.id, 200), versionId = videoText(input.versionId, 100);
    const token = this.changeToken();
    if (this.mediaIndex?.token !== token) this.loadMediaIndex(token);
    const versions = this.mediaIndex!.versions.get(id);
    if (!versions) throw new Error('Video not found.');
    const bytes = versions.get(versionId);
    if (bytes === undefined) throw new Error('Video version not found.');
    return { id, versionId, bytes };
  }
  list(value: unknown = {}): ConceptVideo[] {
    const input = videoObject(value);
    const filter: ConceptVideoFilter = { ...(input.bookId === undefined ? {} : { bookId: videoText(input.bookId, 200) }), ...(input.search === undefined ? {} : { search: videoText(input.search, 500, true) }) };
    if (input.status !== undefined && !['all', 'draft', 'completed'].includes(input.status as string)) throw new Error('Invalid video status filter.');
    const query = filter.search?.trim().toLocaleLowerCase() ?? '';
    return this.loadMediaIndex(this.changeToken()).filter(v => (!input.status || input.status === 'all' || v.status === input.status) && (!filter.bookId || v.source.bookId === filter.bookId) && `${v.plan.title}\n${v.plan.goal}`.toLocaleLowerCase().includes(query)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  }
  get(id: unknown): ConceptVideo {
    const key = videoText(id, 200), video = this.load().find(v => v.id === key);
    if (!video) throw new Error('Video not found.'); return video;
  }
  create(value: unknown, context: ConceptVideoContext[] = []): ConceptVideo {
    const input = videoObject(value), source = parseVideoSource(input.source), question = videoText(input.question, 5000).trim();
    const now = (this.options.now ?? Date.now)();
    const video: ConceptVideo = { id: randomUUID(), revision: 1, createdAt: now, updatedAt: now, status: 'draft', versions: [], source, context: parseVideoContext(context),
      plan: { title: question.slice(0, 60), goal: question, ...(input.engine === undefined ? {} : { engine: parseVideoEngine(input.engine) }), scenes: [{ id: randomUUID(), heading: '', visual: '', narration: '' }], pace: 'normal', narration: true },
      discussion: [{ id: randomUUID(), role: 'user', text: question, createdAt: now }], conflicts: [] };
    this.persist([...this.load(), video]); return structuredClone(video);
  }
  private update(value: unknown, kind: 'plan' | 'question' | 'remove'): ConceptVideo | undefined {
    const input = videoObject(value), id = videoText(input.id, 200), revision = videoRevision(input.baseRevision);
    // A renderer switch invalidates generated code, even for callers bypassing the UI.
    let plan: ConceptVideo['plan'] | undefined;
    const question = kind === 'question' ? videoText(input.question, 5000).trim() : undefined;
    const videos = this.load(), current = videos.find(v => v.id === id);
    if (!current) throw new Error('Video not found.');
    if (kind === 'plan') {
      const proposed = videoObject(input.plan);
      const engine = proposed.engine === undefined ? 'canvas' : parseVideoEngine(proposed.engine);
      if (!Array.isArray(proposed.scenes)) throw new Error('Invalid video plan.');
      plan = parseVideoPlan(engine !== videoEngine(current.plan)
        ? { ...proposed, animation: 'flow', program: undefined, scenes: (proposed.scenes as unknown[]).map(s => ({ ...videoObject(s), code: undefined })) }
        : proposed);
    }
    if (current.generation?.status === 'running') throw new Error('A video is generating. Cancel it or wait for it to finish.');
    const now = (this.options.now ?? Date.now)();
    if (current.revision !== revision) {
      if (kind === 'remove') throw new Error('This video changed in another window. Reload before deleting.');
      current.conflicts.push({ id: randomUUID(), createdAt: now, ...(plan ? { plan } : {}), ...(question ? { question } : {}) });
      current.revision++; current.updatedAt = now; this.persist(videos);
      throw new Error('Save conflict: this video changed in another window. Your edit is preserved; reload to review it.');
    }
    if (kind === 'remove') { this.persist(videos.filter(v => v.id !== id)); return; }
    const next: ConceptVideo = { ...current, revision: revision + 1, updatedAt: now, ...(plan ? { plan } : {}), discussion: question ? [...current.discussion, { id: randomUUID(), role: 'user', text: question, createdAt: now }] : current.discussion };
    this.persist(videos.map(v => v.id === id ? next : v)); return structuredClone(next);
  }
  save(value: unknown): ConceptVideo { return this.update(value, 'plan')!; }
  append(value: unknown): ConceptVideo { return this.update(value, 'question')!; }
  remove(value: unknown): void {
    const input = videoObject(value); this.update(value, 'remove');
    const id = videoText(input.id, 200); if (/^[a-f0-9-]{36}$/.test(id)) rmSync(join(this.directory, 'media', id), { recursive: true, force: true });
  }
  artifactDirectory(videoId: string, versionId: string): string {
    if (![videoId, versionId].every(id => /^[a-f0-9-]{36}$/.test(id))) throw new Error('Invalid video media ID.');
    return join(this.directory, 'media', videoId, versionId);
  }
  readMedia(value: unknown): Uint8Array {
    const version = this.mediaVersion(value);
    try { const bytes = readFileSync(join(this.artifactDirectory(version.id, version.versionId), 'video.mp4')); if (bytes.length > 100_000_000 || bytes.length !== version.bytes) throw new Error(); return bytes; }
    catch { throw new Error('Video media is missing or damaged. You can regenerate it; your saved plan remains.'); }
  }
  readPoster(value: unknown): Uint8Array {
    const { id, versionId } = this.mediaVersion(value);
    try {
      const bytes = readFileSync(join(this.artifactDirectory(id, versionId), 'preview-1.png'));
      if (bytes.length < 8 || bytes.length > 10_000_000 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error();
      return bytes;
    } catch { throw new Error('Video cover is unavailable. The video may still be playable.'); }
  }
  startGeneration(value: unknown, stage = 'Rendering animation and narration locally'): ConceptVideo {
    const input = videoObject(value), videos = this.load(), video = videos.find(v => v.id === videoText(input.id, 200));
    if (!video) throw new Error('Video not found.');
    if (video.generation?.status === 'running') throw new Error('This video is generating.');
    if (video.revision !== videoRevision(input.baseRevision)) throw new Error('This video changed. Reload before generating.');
    video.generation = { id: randomUUID(), status: 'running', stage }; video.revision++; video.updatedAt = Date.now();
    this.persist(videos); return structuredClone(video);
  }
  startComparison(value: unknown): ConceptVideo {
    const input = videoObject(value), videos = this.load(), current = videos.find(v => v.id === videoText(input.id, 200));
    if (!current) throw new Error('Video not found.');
    if (current.revision !== videoRevision(input.baseRevision)) throw new Error('This video changed. Reload before comparing.');
    if (current.generation?.status === 'running') throw new Error('This video is generating.');
    if (current.discussion.at(-1)?.role !== 'assistant' || !current.plan.goal.trim() || current.plan.scenes.some(s => !s.visual.trim() && !s.narration.trim())) throw new Error('Finish discussing your video idea before comparing engines.');
    const now = Date.now();
    // One transaction freezes the common input and reserves all three drafts.
    const copies = VIDEO_ENGINES.map(engine => parseConceptVideo({
      id: randomUUID(), revision: 1, createdAt: now, updatedAt: now, status: 'draft', versions: [],
      source: current.source, context: current.context, discussion: current.discussion, conflicts: [],
      plan: { ...current.plan, engine, animation: 'flow', program: undefined, description: undefined,
        title: `${current.plan.title.slice(0, 175)} · ${VIDEO_ENGINE_LABELS[engine]} test`,
        scenes: current.plan.scenes.map(({ code: _code, ...scene }) => scene) },
      generation: { id: randomUUID(), status: 'running', stage: 'Waiting for engine comparison' }
    }));
    current.comparison = { videoIds: copies.map(v => v.id) };
    current.generation = { id: randomUUID(), status: 'running', stage: 'Comparing Canvas, Remotion and Manim…' };
    current.revision++; current.updatedAt = now;
    this.persist([...videos, ...copies]); return structuredClone(current);
  }
  updateGeneration(id: string, jobId: string, stage: string, plan?: ConceptVideo['plan']): ConceptVideo {
    const videos = this.load(), video = videos.find(v => v.id === id);
    if (!video || video.generation?.id !== jobId || video.generation.status !== 'running') throw new Error('This generation was stopped.');
    if (plan) video.plan = parseVideoPlan(plan);
    video.generation.stage = stage; video.revision++; video.updatedAt = Date.now();
    this.persist(videos); return structuredClone(video);
  }
  finishGeneration(id: string, jobId: string, result: { status: ConceptVideoGeneration['status']; stage: string; error?: string; version?: ConceptVideoVersion }): ConceptVideo {
    const videos = this.load(), video = videos.find(v => v.id === id);
    if (!video) throw new Error('Video not found.');
    if (video.generation?.id !== jobId || video.generation.status !== 'running') return structuredClone(video);
    video.generation = { id: jobId, status: result.status, stage: result.stage, ...(result.error ? { error: result.error.slice(0, 2000) } : {}) };
    if (result.version) { video.versions.push(result.version); video.currentVersionId ??= result.version.id; video.status = 'completed'; }
    video.revision++; video.updatedAt = Date.now();
    const validated = parseConceptVideo(video);
    this.persist(videos.map(v => v.id === id ? validated : v)); return structuredClone(validated);
  }
  interruptGenerations(): void {
    const videos = this.load(); let changed = false;
    for (const video of videos) if (video.generation?.status === 'running') { video.generation.status = 'interrupted'; video.generation.stage = 'The previous generation was interrupted. You can try again.'; video.revision++; changed = true; }
    if (changed) this.persist(videos);
  }
  adopt(value: unknown): ConceptVideo {
    const input = videoObject(value), videos = this.load(), video = videos.find(v => v.id === videoText(input.id, 200));
    if (!video || !video.versions.some(v => v.id === input.versionId)) throw new Error('Video version not found.');
    if (video.revision !== videoRevision(input.baseRevision) || video.generation?.status === 'running') throw new Error('This video changed or is generating. Reload and try again.');
    video.currentVersionId = input.versionId as string; video.revision++; video.updatedAt = Date.now(); this.persist(videos); return structuredClone(video);
  }
  completeDiscussion(value: unknown): ConceptVideo {
    const input = videoObject(value), id = videoText(input.id, 200), revision = videoRevision(input.baseRevision);
    const title = videoText(input.title, 200).trim(), summary = videoText(input.summary, 1500).trim();
    const videos = this.load(), current = videos.find(v => v.id === id);
    if (!current) throw new Error('Video not found.');
    if (current.revision !== revision || current.generation?.status === 'running') throw new Error('This video changed. Reload before continuing the discussion.');
    if (current.discussion.at(-1)?.role !== 'user') throw new Error('This question already has a reply.');
    const now = (this.options.now ?? Date.now)();
    if (current.plan.animation === 'program') current.previousProgram = current.plan;
    current.plan = { title, goal: summary, ...(current.plan.engine ? { engine: current.plan.engine } : {}), pace: 'normal', narration: false, animation: 'flow',
      scenes: [{ id: randomUUID(), heading: title, visual: summary, narration: summary }] };
    current.discussion.push({ id: randomUUID(), role: 'assistant', text: summary, createdAt: now });
    current.revision++; current.updatedAt = now;
    this.persist(videos); return structuredClone(current);
  }
  completeProgram(value: unknown): ConceptVideo {
    const input = videoObject(value), current = this.get(input.id);
    if (!Array.isArray(input.scenes)) throw new Error('Animation program is missing.');
    const description = typeof input.description === 'string' ? input.description.trim() : '';
    if (!description || description.length > 300) throw new Error('Animation description is missing or too long.');
    const plan = parseVideoPlan({ ...current.plan, description, animation: 'program', narration: true, pace: 'normal', program: input.program,
      scenes: input.scenes.map(s => ({ ...videoObject(s), id: randomUUID() })) });
    // Reject stale AI output, without storing it as a user-authored conflict candidate.
    if (input.jobId !== undefined) {
      if (current.revision !== videoRevision(input.baseRevision)) throw new Error('This video changed. Reload before generating.');
      return this.updateGeneration(current.id, videoText(input.jobId, 200), 'Rendering animation and narration locally', plan);
    }
    if (current.revision !== videoRevision(input.baseRevision) || current.generation?.status === 'running') throw new Error('This video changed. Reload before generating.');
    return this.save({ id: current.id, baseRevision: current.revision, plan });
  }
  completeStoryboard(value: unknown): ConceptVideo {
    const input = videoObject(value), id = videoText(input.id, 200), revision = videoRevision(input.baseRevision);
    const videos = this.load(), current = videos.find(v => v.id === id);
    if (!current) throw new Error('Video not found.');
    if (current.revision !== revision || current.generation?.status === 'running') throw new Error('This video changed. Reload before generating.');
    if (!Array.isArray(input.scenes)) throw new Error('Story script is missing.');
    const plan = parseVideoPlan({ ...current.plan, animation: 'story', narration: true, pace: 'normal',
      scenes: input.scenes.map(s => ({ ...videoObject(s), id: randomUUID() })) });
    if (new Set(plan.scenes.map(s => s.narration.trim())).size !== plan.scenes.length ||
        new Set(plan.scenes.map(s => JSON.stringify(s.stage))).size < 2 ||
        plan.scenes.some(s => /這[支部個]影片(?:將|會|主要|以)/.test(s.narration))) {
      throw new Error('The AI script repeats the summary. Regenerate the story.');
    }
    current.plan = plan; current.revision++; current.updatedAt = (this.options.now ?? Date.now)();
    this.persist(videos); return structuredClone(current);
  }
  requestAi(value: unknown): never {
    const input = videoObject(value); this.get(input.id);
    if (input.operation !== 'discuss' && input.operation !== 'generate') throw new Error('Invalid video action.');
    // No client, turn, credits redemption or API fallback exists on this path.
    throw new Error(CONCEPT_VIDEO_BILLING_REASON);
  }
}
