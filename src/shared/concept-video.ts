import { parseChatImages } from './chat-images';
import type { ReadingRange } from './contracts';

export const VIDEO_ENGINES = ['canvas', 'remotion', 'manim'] as const;
export type VideoEngine = typeof VIDEO_ENGINES[number];
export const VIDEO_ENGINE_LABELS: Record<VideoEngine, string> = { canvas: 'Canvas', remotion: 'Remotion', manim: 'Manim' };
export const VIDEO_ENGINE_RUNTIME = { canvas: 'canvas2d-v1', remotion: 'remotion-v1', manim: 'manim-ce-v1' } as const;
export function parseVideoEngine(value: unknown): VideoEngine {
  if (!VIDEO_ENGINES.includes(value as VideoEngine)) throw new Error('Unsupported video engine.');
  return value as VideoEngine;
}
export function videoEngine(plan: ConceptVideoPlan): VideoEngine { return plan.engine ?? 'canvas'; }
export interface VideoEngineCapability { available: boolean; reason: string }

export interface ConceptVideoSource {
  bookId: string; chapterId: string; bookTitle: string; chapterTitle: string;
  range: ReadingRange; contextRange?: ReadingRange; readingSegment: string; images: { dataUrl: string }[];
}
export const VIDEO_STORY_ICONS = ['person', 'office', 'taxi', 'tree', 'boat', 'coins', 'network', 'brain', 'book', 'shield'] as const;
export const VIDEO_STORY_MOTIONS = ['steady', 'move', 'grow', 'fall', 'sway', 'connect'] as const;
export interface ConceptVideoStage {
  layout: 'focus' | 'compare' | 'sequence';
  actors: { icon: typeof VIDEO_STORY_ICONS[number]; label: string; motion: typeof VIDEO_STORY_MOTIONS[number] }[];
}
export interface ConceptVideoScene { id: string; heading: string; visual: string; narration: string; stage?: ConceptVideoStage; code?: string }
export interface ConceptVideoProgram {
  runtime: typeof VIDEO_ENGINE_RUNTIME[VideoEngine]; model: string; reasoningEffort: string; generatedAt: number;
}
export interface ConceptVideoPlan {
  title: string; goal: string; description?: string; scenes: ConceptVideoScene[];
  pace: 'normal' | 'slow'; narration: boolean; animation?: 'flow' | 'derivative' | 'story' | 'program';
  program?: ConceptVideoProgram;
  engine?: VideoEngine;
}
export interface ConceptVideoContext { role: 'user' | 'assistant'; text: string; sourceLabel: string; quote?: string }
export interface ConceptVideoConflict { id: string; createdAt: number; plan?: ConceptVideoPlan; question?: string }
export interface ConceptVideoVersion {
  id: string; createdAt: number; plan: ConceptVideoPlan; durationSeconds: number; bytes: number;
  scenes: { id: string; start: number; end: number }[];
}
export interface ConceptVideoGeneration {
  id: string; status: 'running' | 'completed' | 'cancelled' | 'failed' | 'interrupted'; stage: string; error?: string;
}
export interface ConceptVideo {
  id: string; revision: number; createdAt: number; updatedAt: number; status: 'draft' | 'completed'; versions: ConceptVideoVersion[]; currentVersionId?: string; generation?: ConceptVideoGeneration;
  source: ConceptVideoSource; context: ConceptVideoContext[]; plan: ConceptVideoPlan;
  comparison?: { videoIds: string[] };
  previousProgram?: ConceptVideoPlan;
  discussion: { id: string; role: 'user' | 'assistant'; text: string; createdAt: number }[];
  conflicts: ConceptVideoConflict[];
}
export interface ConceptVideoFilter { bookId?: string; search?: string; status?: 'all' | 'draft' | 'completed' }
export interface CreateConceptVideo { source: ConceptVideoSource; question: string; engine?: VideoEngine }
export interface SaveConceptVideo { id: string; baseRevision: number; plan: ConceptVideoPlan }
export interface ConceptVideoIdentity { id: string; baseRevision: number }
export const CONCEPT_VIDEO_BILLING_REASON = 'AI video discussion is unavailable. Local rendering remains available.';
export interface ConceptVideoPoll { token: string; videos?: ConceptVideo[] }
export interface ConceptVideoApi {
  capability(): Promise<{ aiAllowed: boolean; generationAllowed: boolean; narrationAllowed?: boolean; reason: string; engines?: Record<VideoEngine, VideoEngineCapability> }>;
  generate(input: ConceptVideoIdentity): Promise<ConceptVideo>;
  compare(input: ConceptVideoIdentity): Promise<ConceptVideo>;
  cancel(id: string): Promise<ConceptVideo>;
  adopt(input: ConceptVideoIdentity & { versionId: string }): Promise<ConceptVideo>;
  media(input: { id: string; versionId: string }): Promise<Uint8Array>;
  poster(input: { id: string; versionId: string }): Promise<Uint8Array>;
  list(filter?: ConceptVideoFilter): Promise<ConceptVideo[]>;
  poll?(token?: string): Promise<ConceptVideoPoll>;
  get(id: string): Promise<ConceptVideo>;
  create(input: CreateConceptVideo): Promise<ConceptVideo>;
  save(input: SaveConceptVideo): Promise<ConceptVideo>;
  append(input: ConceptVideoIdentity & { question: string }): Promise<ConceptVideo>;
  remove(input: ConceptVideoIdentity): Promise<void>;
  requestAi(input: { id: string; baseRevision?: number; operation: 'discuss' | 'generate' }): Promise<ConceptVideo>;
}

export function videoObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid video data.');
  return value as Record<string, unknown>;
}
export function videoText(value: unknown, max = 100_000, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim())) throw new Error('Video text is empty or too long.');
  return value;
}
export function videoRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new Error('Invalid video revision.');
  return value as number;
}
export function parseVideoSource(value: unknown): ConceptVideoSource {
  const v = videoObject(value), r = videoObject(v.range);
  if (!Number.isSafeInteger(r.start) || !Number.isSafeInteger(r.end) || (r.start as number) < 0 || (r.end as number) <= (r.start as number)) throw new Error('Mark a reading range first.');
  // Source snapshots retain originals; the aggregate wire budget applies after compression.
  const images = parseChatImages(v.images, 'book', undefined, Number.POSITIVE_INFINITY);
  let contextRange: ReadingRange | undefined;
  if (v.contextRange !== undefined) {
    const c = videoObject(v.contextRange);
    if (!Number.isSafeInteger(c.start) || !Number.isSafeInteger(c.end) || (c.start as number) < 0 || (c.start as number) > (r.start as number) || (c.end as number) < (r.end as number)) throw new Error('Invalid reading segment boundaries.');
    contextRange = { start: c.start as number, end: c.end as number };
  }
  return { bookId: videoText(v.bookId, 200), chapterId: videoText(v.chapterId, 500), bookTitle: videoText(v.bookTitle, 1000), chapterTitle: videoText(v.chapterTitle, 1000), range: { start: r.start as number, end: r.end as number }, ...(contextRange ? { contextRange } : {}), readingSegment: videoText(v.readingSegment), images };
}
export function parseVideoStage(value: unknown): ConceptVideoStage {
  const v = videoObject(value);
  if (!['focus', 'compare', 'sequence'].includes(v.layout as string) || !Array.isArray(v.actors) || v.actors.length < 1 || v.actors.length > 3) throw new Error('Invalid story scene.');
  if (v.layout === 'compare' && v.actors.length !== 2 || v.layout === 'focus' && v.actors.length !== 1) throw new Error('The story scene has the wrong number of actors.');
  return { layout: v.layout as ConceptVideoStage['layout'], actors: v.actors.map(item => {
    const a = videoObject(item);
    if (!VIDEO_STORY_ICONS.includes(a.icon as any) || !VIDEO_STORY_MOTIONS.includes(a.motion as any)) throw new Error('Unsupported story image or motion.');
    return { icon: a.icon as ConceptVideoStage['actors'][number]['icon'], motion: a.motion as ConceptVideoStage['actors'][number]['motion'], label: videoText(a.label, 24) };
  }) };
}
export function parseVideoPlan(value: unknown): ConceptVideoPlan {
  const v = videoObject(value);
  const engine = v.engine === undefined ? undefined : parseVideoEngine(v.engine);
  if (!Array.isArray(v.scenes) || v.scenes.length > 5 || v.scenes.length < 1 || (v.pace !== 'normal' && v.pace !== 'slow') || typeof v.narration !== 'boolean') throw new Error('Invalid video plan.');
  if (v.animation !== undefined && !['flow', 'derivative', 'story', 'program'].includes(v.animation as string)) throw new Error('Unsupported animation format.');
  const scenes = v.scenes.map(item => { const s = videoObject(item); return { id: videoText(s.id, 200), heading: videoText(s.heading, 200, true), visual: videoText(s.visual, 5000, true), narration: videoText(s.narration, 5000, true), ...(s.stage === undefined ? {} : { stage: parseVideoStage(s.stage) }), ...(s.code === undefined ? {} : { code: videoText(s.code, 24_000) }) }; });
  if (v.animation === 'story' && (scenes.length < 3 || scenes.some(s => !s.stage || !s.narration.trim() || s.narration.length > 350 || s.visual.length > 48 || s.heading.length > 30))) throw new Error('Story animation needs 3–5 complete scenes and narration.');
  let program: ConceptVideoProgram | undefined;
  if (v.animation === 'program') {
    if (scenes.length < 3 || scenes.some(s => !s.code || !s.narration.trim() || s.narration.length > 350)) throw new Error('Animation needs 3–5 complete scenes with code and narration.');
    const p = videoObject(v.program);
    if (p.runtime !== VIDEO_ENGINE_RUNTIME[engine ?? 'canvas'] || !Number.isSafeInteger(p.generatedAt) || (p.generatedAt as number) < 0) throw new Error('Invalid animation runtime.');
    program = { runtime: p.runtime as ConceptVideoProgram['runtime'], model: videoText(p.model, 200), reasoningEffort: videoText(p.reasoningEffort, 100), generatedAt: p.generatedAt as number };
  }
  if (new Set(scenes.map(s => s.id)).size !== scenes.length) throw new Error('Duplicate scene ID.');
  return { title: videoText(v.title, 200), goal: videoText(v.goal, 5000, true), ...(engine ? { engine } : {}), ...(v.description === undefined ? {} : { description: videoText(v.description, 300) }), scenes, pace: v.pace, narration: v.narration, ...(v.animation === undefined ? {} : { animation: v.animation as ConceptVideoPlan['animation'] }), ...(program ? { program } : {}) };
}
export function parseVideoContext(value: unknown): ConceptVideoContext[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid discussion context.');
  return value.map(item => { const v = videoObject(item); if (v.role !== 'user' && v.role !== 'assistant') throw new Error('Invalid discussion message.'); return { role: v.role, text: videoText(v.text), sourceLabel: videoText(v.sourceLabel, 2000), ...(v.quote === undefined ? {} : { quote: videoText(v.quote) }) }; });
}
export function parseConceptVideo(value: unknown): ConceptVideo {
  const v = videoObject(value);
  if (!['draft', 'completed'].includes(v.status as string) || !Array.isArray(v.discussion) || !Array.isArray(v.conflicts)) throw new Error('Invalid video draft.');
  const time = (n: unknown) => { if (!Number.isSafeInteger(n) || (n as number) < 0) throw new Error('Invalid video timestamp.'); return n as number; };
  let comparison: ConceptVideo['comparison'];
  if (v.comparison !== undefined) {
    const c = videoObject(v.comparison);
    if (!Array.isArray(c.videoIds) || c.videoIds.length !== 3 || new Set(c.videoIds).size !== 3 || c.videoIds.includes(v.id)) throw new Error('Invalid engine comparison.');
    comparison = { videoIds: c.videoIds.map(id => { const text = videoText(id, 100); if (!/^[a-f0-9-]{36}$/.test(text)) throw new Error('Invalid comparison video ID.'); return text; }) };
  }
  const previousProgram = v.previousProgram === undefined ? undefined : parseVideoPlan(v.previousProgram);
  if (previousProgram && previousProgram.animation !== 'program') throw new Error('Invalid previous animation program.');
  return { id: videoText(v.id, 200), revision: videoRevision(v.revision), createdAt: time(v.createdAt), updatedAt: time(v.updatedAt), status: v.status as 'draft' | 'completed', ...(comparison ? { comparison } : {}), ...parseVideoResults(v), source: parseVideoSource(v.source), context: parseVideoContext(v.context), plan: parseVideoPlan(v.plan), ...(previousProgram ? { previousProgram } : {}),
    discussion: v.discussion.map(item => { const m = videoObject(item); if (m.role !== 'user' && m.role !== 'assistant') throw new Error('Invalid video discussion history.'); return { id: videoText(m.id, 200), role: m.role as 'user' | 'assistant', text: videoText(m.text, 5000), createdAt: time(m.createdAt) }; }),
    conflicts: v.conflicts.map(item => { const c = videoObject(item); return { id: videoText(c.id, 200), createdAt: time(c.createdAt), ...(c.plan === undefined ? {} : { plan: parseVideoPlan(c.plan) }), ...(c.question === undefined ? {} : { question: videoText(c.question, 5000) }) }; }) };
}

function parseVideoResults(v: Record<string, unknown>): Pick<ConceptVideo, 'versions' | 'currentVersionId' | 'generation'> {
  const number = (n: unknown, max: number) => { if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) throw new Error('Invalid video media data.'); return n; };
  const uuid = (value: unknown) => { const id = videoText(value, 100); if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid video version ID.'); return id; };
  if (v.versions !== undefined && !Array.isArray(v.versions)) throw new Error('Invalid video version.');
  const versions: ConceptVideoVersion[] = ((v.versions ?? []) as unknown[]).map(item => {
    const r = videoObject(item); if (!Array.isArray(r.scenes)) throw new Error('Invalid scene timing.');
    const durationSeconds = number(r.durationSeconds, 600);
    const scenes = r.scenes.map(item => { const t = videoObject(item), start = number(t.start, durationSeconds), end = number(t.end, durationSeconds); if (end <= start) throw new Error('Invalid scene timing.'); return { id: videoText(t.id, 200), start, end }; });
    return { id: uuid(r.id), createdAt: number(r.createdAt, Number.MAX_SAFE_INTEGER), plan: parseVideoPlan(r.plan), bytes: number(r.bytes, 100_000_000), durationSeconds, scenes };
  });
  if (new Set(versions.map(r => r.id)).size !== versions.length) throw new Error('Duplicate video version.');
  const currentVersionId = v.currentVersionId === undefined ? undefined : uuid(v.currentVersionId);
  if (currentVersionId && !versions.some(r => r.id === currentVersionId) || v.status === 'completed' && !currentVersionId || v.status === 'draft' && versions.length) throw new Error('Invalid selected version.');
  let generation: ConceptVideoGeneration | undefined;
  if (v.generation !== undefined) {
    const g = videoObject(v.generation);
    if (!['running', 'completed', 'cancelled', 'failed', 'interrupted'].includes(g.status as string)) throw new Error('Invalid generation status.');
    generation = { id: uuid(g.id), status: g.status as ConceptVideoGeneration['status'], stage: videoText(g.stage, 200), ...(g.error === undefined ? {} : { error: videoText(g.error, 2000) }) };
  }
  return { versions, ...(currentVersionId ? { currentVersionId } : {}), ...(generation ? { generation } : {}) };
}
