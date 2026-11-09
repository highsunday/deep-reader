import type { ChatMessage } from '../shared/contracts';
import { parseVideoSource, videoEngine, videoObject, videoText } from '../shared/concept-video';
import type { ConceptVideoContext, ConceptVideoSource } from '../shared/concept-video';
import type { ConceptVideoGenerator } from './concept-video-generator';
import type { LocalConceptVideoStore } from './concept-video-store';

export function conceptVideoContext(messages: ChatMessage[], source: ConceptVideoSource): ConceptVideoContext[] {
  const context: ConceptVideoContext[] = [];
  let eligible = false, turnId: string | null = null;
  for (const message of messages) {
    if (message.role === 'user') {
      const s = message.readingSource;
      eligible = message.status === 'completed' && Boolean(s && s.bookTitle === source.bookTitle && s.chapterTitle === source.chapterTitle && s.readingSegment === source.readingSegment);
      turnId = message.turnId;
    }
    if (!eligible || message.status !== 'completed' || message.turnId !== turnId) continue;
    const text = message.text.replace(/```(?:learning-question-(?:quiz|grade)|self-retelling-(?:task|grade)|reading-note-(?:draft|saved))\s*\n[\s\S]*?```/g, '').trim();
    if (text) context.push({ role: message.role, text, sourceLabel: `${source.bookTitle} / ${source.chapterTitle} (same reading segment)`, ...(message.quote?.text ? { quote: message.quote.text } : {}) });
  }
  return context;
}
export function registerConceptVideoIpc(
  ipc: { handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown },
  store: LocalConceptVideoStore,
  options: { trusted(event: unknown): boolean; sourceExists(source: ConceptVideoSource): Promise<boolean>; getMessages(): ChatMessage[]; generator?: ConceptVideoGenerator; ai?: import('./concept-video-ai').ConceptVideoAi }
): void {
  const check = (event: unknown) => { if (!options.trusted(event)) throw new Error('Invalid video action source.'); };
  ipc.handle('concept-videos:capability', async event => { check(event); const capability = await (options.generator?.capability() ?? store.capability()); return { ...capability, aiAllowed: Boolean(options.ai) }; });
  ipc.handle('concept-videos:list', (event, filter) => { check(event); return options.generator?.list(filter) ?? store.list(filter); });
  ipc.handle('concept-videos:poll', (event, previous) => {
    check(event);
    const token = previous === undefined ? undefined : videoText(previous, 200);
    return options.generator?.poll(token) ?? store.poll(token);
  });
  ipc.handle('concept-videos:get', (event, id) => { check(event); return options.generator?.get(id) ?? store.get(id); });
  ipc.handle('concept-videos:create', async (event, value) => {
    check(event); const input = videoObject(value), source = parseVideoSource(input.source);
    // Capture visible conversation before yielding to library lookup.
    const context = conceptVideoContext(options.getMessages(), source);
    if (!await options.sourceExists(source)) throw new Error('The source chapter is missing. Reload and try again.');
    return store.create({ source, question: input.question, engine: input.engine }, context);
  });
  ipc.handle('concept-videos:save', (event, value) => { check(event); return store.save(value); });
  ipc.handle('concept-videos:append', (event, value) => { check(event); return store.append(value); });
  ipc.handle('concept-videos:remove', (event, value) => { check(event); return store.remove(value); });
  ipc.handle('concept-videos:generate', (event, input) => {
    check(event); if (!options.generator) throw new Error('Local rendering is unavailable.');
    const generate = async () => {
      const identity = input as import('../shared/concept-video').ConceptVideoIdentity;
      const current = store.get(identity.id);
      if (current.revision !== identity.baseRevision) throw new Error('This video changed. Reload and try again.');
      const capability = await options.generator!.capability();
      if (!capability.generationAllowed) throw new Error(capability.reason);
      const engine = capability.engines?.[videoEngine(current.plan)];
      if (engine && !engine.available) throw new Error(engine.reason);
      const needsPreparation = current.plan.animation !== 'program' || current.generation?.status === 'failed';
      if (needsPreparation && !options.ai) throw new Error('Animation generation is unavailable. Restart the app.');
      const prepare = async (running: import('../shared/concept-video').ConceptVideo, signal: AbortSignal, renderingFailure?: string) => {
        let prepared = needsPreparation || renderingFailure
          ? await options.ai!.prepare({ id: running.id, baseRevision: running.revision, jobId: running.generation!.id, renderingFailure: renderingFailure ?? current.generation?.error }, signal)
          : running;
        if (signal.aborted) throw new Error('Generation cancelled');
        if (prepared.plan.animation !== 'program') throw new Error('The animation program is incomplete. Try generating again.');
        if (prepared.plan.narration && !capability.narrationAllowed) prepared = store.updateGeneration(prepared.id, running.generation!.id, 'Rendering animation and narration locally', { ...prepared.plan, narration: false });
        return prepared;
      };
      return options.generator!.generate(identity, prepare, options.ai ? prepare : undefined);
    };
    return generate();
  });
  ipc.handle('concept-videos:compare', async (event, input) => {
    check(event);
    if (!options.generator || !options.ai) throw new Error('Engine comparison requires AI animation generation. Restart the app.');
    const identity = videoObject(input) as unknown as import('../shared/concept-video').ConceptVideoIdentity;
    const capability = await options.generator.capability();
    return options.generator.compare(identity, async (running, signal, renderingFailure) => {
      let prepared = await options.ai!.prepare({ id: running.id, baseRevision: running.revision, jobId: running.generation!.id, renderingFailure }, signal);
      if (signal.aborted) throw new Error('Generation cancelled');
      if (prepared.plan.animation !== 'program') throw new Error('The animation program is incomplete. Try generating again.');
      if (prepared.plan.narration && !capability.narrationAllowed) prepared = store.updateGeneration(prepared.id, running.generation!.id, 'Rendering animation locally', { ...prepared.plan, narration: false });
      return prepared;
    });
  });
  ipc.handle('concept-videos:cancel', (event, id) => { check(event); if (!options.generator) throw new Error('Local rendering is unavailable.'); return options.generator.cancel(id as string); });
  ipc.handle('concept-videos:adopt', (event, input) => { check(event); return store.adopt(input); });
  ipc.handle('concept-videos:media', (event, input) => { check(event); return store.readMedia(input); });
  ipc.handle('concept-videos:poster', (event, input) => { check(event); return store.readPoster(input); });
  ipc.handle('concept-videos:request-ai', (event, value) => { check(event); return options.ai ? options.ai.discuss(value) : store.requestAi(value); });
}
