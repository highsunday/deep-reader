import { mkdtempSync, rmSync } from 'node:fs';
import { transformSync } from 'esbuild';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoGenerator, type VideoRenderOptions } from '../src/main/concept-video-generator';
import { videoEngine, VIDEO_ENGINES, type ConceptVideo } from '../src/shared/concept-video';
const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
function setup(render?:VideoRenderOptions['render']) {
 const directory=mkdtempSync(join(tmpdir(),'f56-'));dirs.push(directory);
 const store=new LocalConceptVideoStore(directory);
 const initial=store.create({source:{bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'來源快照',images:[]},question:'解釋面積',engine:'remotion'},[{role:'assistant',text:'閱讀脈絡',sourceLabel:'書'}]);
 const video=store.completeDiscussion({id:initial.id,baseRevision:initial.revision,title:'積分',summary:'把面積切成越來越細的矩形。'});
 const renderer:VideoRenderOptions={capability:async()=>({generationAllowed:true,narrationAllowed:true,reason:'',engines:Object.fromEntries(VIDEO_ENGINES.map(e=>[e,{available:true,reason:''}])) as any}),render:render??vi.fn(async(v:ConceptVideo)=>({durationSeconds:3,bytes:100,scenes:v.plan.scenes.map(s=>({id:s.id,start:0,end:3}))}))};
 const generator=new ConceptVideoGenerator(store,renderer);
 const prepare=vi.fn(async(v:ConceptVideo)=>v);
 return {store,video,generator,renderer,prepare,directory};
}
test('TC1/2: three independent engine results persist, reuse frozen concept and preserve original',async()=>{
 const {store,video,generator,prepare,directory}=setup();
 const running=await generator.compare({id:video.id,baseRevision:video.revision},prepare);
 expect(running.generation?.status).toBe('running');
 await generator.waitForIdle();
 const saved=new LocalConceptVideoStore(directory).get(video.id);
 expect(saved.plan).toEqual(video.plan);expect(saved.versions).toEqual(video.versions);expect(saved.currentVersionId).toBe(video.currentVersionId);
 expect(saved.generation?.status).toBe('completed');expect(saved.comparison?.videoIds).toHaveLength(3);
 const results=saved.comparison!.videoIds.map(id=>store.get(id));
 expect(results.map(v=>videoEngine(v.plan))).toEqual(VIDEO_ENGINES);
 for(const v of results){expect(v.source).toEqual(video.source);expect(v.context).toEqual(video.context);expect(v.discussion).toEqual(video.discussion);expect(v.plan.goal).toBe(video.plan.goal);expect(v.versions).toHaveLength(1);}
 expect(prepare).toHaveBeenCalledTimes(3);expect(store.list()).toHaveLength(4);
});
test('TC3: failed engine does not prevent following engine from completing',async()=>{
 const {store,video,generator,prepare}=setup(async(v)=>{if(videoEngine(v.plan)==='remotion')throw Error('Remotion failed');return {durationSeconds:3,bytes:10,scenes:v.plan.scenes.map(s=>({id:s.id,start:0,end:3}))};});
 await generator.compare({id:video.id,baseRevision:video.revision},prepare);await generator.waitForIdle();
 const saved=store.get(video.id),results=saved.comparison!.videoIds.map(id=>store.get(id));
 expect(results.map(v=>v.generation?.status)).toEqual(['completed','failed','completed']);expect(saved.generation?.error).toContain('Remotion');
});
test('TC3: cancel stops queued jobs and ignores late results while reserving global renderer',async()=>{
 let finish!:(v:any)=>void;
 const {store,video,generator,prepare}=setup(async()=>new Promise(r=>{finish=r;}));
 const running=await generator.compare({id:video.id,baseRevision:video.revision},prepare);
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 await expect(generator.generate({id:video.id,baseRevision:running.revision})).rejects.toThrow(/generat/i);
 await generator.cancel(video.id);finish({durationSeconds:3,bytes:10,scenes:[]});await generator.waitForIdle();
 expect(store.get(video.id).generation?.status).toBe('cancelled');
 for(const id of running.comparison!.videoIds){expect(store.get(id).generation?.status).toBe('cancelled');expect(store.get(id).versions).toHaveLength(0);}
 expect(prepare).toHaveBeenCalledTimes(1);
});
test('TC4: missing engine and stale revision fail before making copies',async()=>{
 const {store,video,generator,renderer,prepare}=setup();
 const cap=await renderer.capability();cap.engines!.manim={available:false,reason:'Install Manim'};renderer.capability=async()=>cap;
 await expect(generator.compare({id:video.id,baseRevision:video.revision},prepare)).rejects.toThrow('Install Manim');expect(store.list()).toHaveLength(1);expect(prepare).not.toHaveBeenCalled();
 cap.engines!.manim.available=true;
 await expect(generator.compare({id:video.id,baseRevision:1},prepare)).rejects.toThrow(/changed/i);expect(store.list()).toHaveLength(1);
});
test('TC1: adopted media survives comparison without rewriting original program',async()=>{
 const {store,video,generator,prepare}=setup();
 await generator.generate({id:video.id,baseRevision:video.revision});await generator.waitForIdle();
 const original=store.get(video.id);
 await generator.compare({id:original.id,baseRevision:original.revision},prepare);await generator.waitForIdle();
 const saved=store.get(video.id);
 expect(saved.plan).toEqual(original.plan);expect(saved.versions).toEqual(original.versions);expect(saved.currentVersionId).toBe(original.currentVersionId);
});
test('TC4: unfinished discussion rejects comparison; restart marks all reserved copies interrupted',async()=>{
 const {store,video,generator,prepare,directory}=setup();
 const pending=store.append({id:video.id,baseRevision:video.revision,question:'再想一下'});
 await expect(generator.compare({id:pending.id,baseRevision:pending.revision},prepare)).rejects.toThrow(/discuss/i);expect(store.list()).toHaveLength(1);
 const ready=store.completeDiscussion({id:pending.id,baseRevision:pending.revision,title:'積分',summary:'以矩形逼近面積。'});
 const running=store.startComparison({id:ready.id,baseRevision:ready.revision});
 const reopened=new LocalConceptVideoStore(directory);new ConceptVideoGenerator(reopened);
 for(const id of [video.id,...running.comparison!.videoIds])expect(reopened.get(id).generation?.status).toBe('interrupted');
});
test('TC3: cancelling from a child also cancels remaining batch, preserves a completed engine',async()=>{
 let finish!:(v:any)=>void;
 const {store,video,generator,prepare}=setup(async(v)=>videoEngine(v.plan)==='canvas'?{durationSeconds:3,bytes:10,scenes:[]} :new Promise(r=>{finish=r;}));
 const running=await generator.compare({id:video.id,baseRevision:video.revision},prepare);
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 await generator.cancel(running.comparison!.videoIds[1]);finish({durationSeconds:3,bytes:10,scenes:[]});await generator.waitForIdle();
 expect(running.comparison!.videoIds.map(id=>store.get(id).generation?.status)).toEqual(['completed','cancelled','cancelled']);
 expect(store.get(running.comparison!.videoIds[0]).versions).toHaveLength(1);
});
test('TC1/4: trusted IPC freshly prepares each engine through AI and respects narration capability',async()=>{
 const {registerConceptVideoIpc}=await import('../src/main/concept-video-ipc');
 const {VIDEO_ENGINE_RUNTIME}=await import('../src/shared/concept-video');
 const {store,video,generator,renderer}=setup();
 const cap=await renderer.capability();renderer.capability=async()=>({...cap,narrationAllowed:false});
 const prepared:string[]=[];
 const ai={prepare:vi.fn(async(input:any)=>{const v=store.get(input.id),engine=videoEngine(v.plan);prepared.push(engine);return store.completeProgram({...input,description:'利用三幕動畫把同一份解說構想逐步展示，理解面積如何逼近。',program:{runtime:VIDEO_ENGINE_RUNTIME[engine],model:'fixture',reasoningEffort:'low',generatedAt:1},scenes:[0,1,2].map(i=>({heading:'面積',visual:'矩形',narration:`觀察第${i+1}幕的面積。`,code:'fixture'}))});})};
 const handlers=new Map<string,(e:unknown,...args:unknown[])=>unknown>();
 registerConceptVideoIpc({handle:(c,l)=>handlers.set(c,l)},store,{trusted:e=>e==='main',sourceExists:async()=>true,getMessages:()=>[],generator,ai:ai as any});
 await expect(handlers.get('concept-videos:compare')!('untrusted',video)).rejects.toThrow(/source/i);
 await handlers.get('concept-videos:compare')!('main',{id:video.id,baseRevision:video.revision});await generator.waitForIdle();
 expect(prepared).toEqual(VIDEO_ENGINES);
 for(const id of store.get(video.id).comparison!.videoIds){const result=store.get(id);expect(result.plan.animation).toBe('program');expect(result.plan.narration).toBe(false);expect(result.versions[0].plan.program?.runtime).toBe(VIDEO_ENGINE_RUNTIME[videoEngine(result.plan)]);}
 const unavailable=new Map<string,(e:unknown,...args:unknown[])=>unknown>();
 registerConceptVideoIpc({handle:(c,l)=>unavailable.set(c,l)},store,{trusted:()=>true,sourceExists:async()=>true,getMessages:()=>[],generator});
 await expect(unavailable.get('concept-videos:compare')!('main',{id:video.id,baseRevision:store.get(video.id).revision})).rejects.toThrow(/requires AI/i);expect(store.list()).toHaveLength(4);
});
test('TC3: deleted completed result cannot prevent cancellation of the remaining engines',async()=>{
 let finish!:(v:any)=>void;
 const {store,video,generator,prepare}=setup(async(v)=>videoEngine(v.plan)==='canvas'?{durationSeconds:3,bytes:10,scenes:[]} :new Promise(r=>{finish=r;}));
 const running=await generator.compare({id:video.id,baseRevision:video.revision},prepare);
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
 const first=store.get(running.comparison!.videoIds[0]);store.remove({id:first.id,baseRevision:first.revision});
 await generator.cancel(video.id);finish({durationSeconds:3,bytes:10,scenes:[]});await generator.waitForIdle();
 expect(store.get(video.id).generation?.status).toBe('cancelled');
 expect(store.get(running.comparison!.videoIds[2]).generation?.status).toBe('cancelled');
});
test('B58 T1: comparison repairs an undefined-variable program once with diagnostics',async()=>{
 let broken=true;
 const {store,video,generator}=setup(async(v)=>{if(videoEngine(v.plan)==='canvas'&&broken)throw Error('Codex animation failed: seventy is not defined');return {durationSeconds:3,bytes:10,scenes:[]};});
 const prepare=vi.fn(async(v:ConceptVideo,_signal:AbortSignal,error?:string)=>{if(error){expect(error).toContain('seventy is not defined');expect(v.generation?.status).toBe('running');broken=false;}return v;});
 await generator.compare({id:video.id,baseRevision:video.revision},prepare);await generator.waitForIdle();
 expect(store.get(video.id).generation?.status).toBe('completed');expect(prepare).toHaveBeenCalledTimes(4);
});
test('B58 T2: program repair is bounded and system errors never ask AI to fix code',async()=>{
 const {store,video,generator}=setup(async()=>{throw Error('Codex animation failed: seventy is not defined');});
 const prepare=vi.fn(async(v:ConceptVideo)=>v);
 await generator.generate({id:video.id,baseRevision:video.revision},prepare,prepare);await generator.waitForIdle();
 expect(prepare).toHaveBeenCalledTimes(2);expect(store.get(video.id).generation?.error).toContain('seventy');
 const second=setup(async()=>{throw Error('Narration entitlement unavailable');});
 await second.generator.compare({id:second.video.id,baseRevision:second.video.revision},second.prepare);await second.generator.waitForIdle();expect(second.prepare).toHaveBeenCalledTimes(3);
});
test('B58 T2: cancellation during repair ignores late AI output and never renders again',async()=>{
 let finish!:(v:ConceptVideo)=>void;
 const {store,video,generator,renderer}=setup(vi.fn(async()=>{throw Error('Codex animation failed: seventy is not defined');}));
 const repair=vi.fn(async(v:ConceptVideo)=>new Promise<ConceptVideo>(resolve=>{finish=()=>resolve(v);}));
 await generator.generate({id:video.id,baseRevision:video.revision},undefined,repair);
 await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));await generator.cancel(video.id);finish(video);await generator.waitForIdle();
 expect(store.get(video.id).generation?.status).toBe('cancelled');expect(store.get(video.id).versions).toHaveLength(0);expect(renderer.render).toHaveBeenCalledTimes(1);
});

test('B62 T1: actual JSX less-than transform error triggers one program repair', async () => {
 const broken = 'return <text>V̇(x) < 0 when x ≠ x*</text>;';
 const fixed = 'return <text>{"V̇(x) < 0 when x ≠ x*"}</text>;';
 let code = broken;
 const render = vi.fn(async () => {
  try { transformSync(`function SceneBody(){\n${code}\n}`, {loader:'jsx'}); }
  catch(error) { throw new Error(`Remotion animation failed: ${(error as Error).message}`); }
  return {durationSeconds:3,bytes:10,scenes:[]};
 });
 const {store,video,generator}=setup(render);
 const repair=vi.fn(async(v:ConceptVideo,_signal:AbortSignal,error?:string)=>{
  expect(error).toContain('Expected identifier but found "0"');
  code=fixed;return v;
 });
 await generator.generate({id:video.id,baseRevision:video.revision},undefined,repair);
 await generator.waitForIdle();
 expect(repair).toHaveBeenCalledTimes(1);
 expect(render).toHaveBeenCalledTimes(2);
 expect(store.get(video.id).generation?.status).toBe('completed');
});
test.each([
 'Remotion animation failed: Transform failed with 1 error: <stdin>:12:2159: ERROR: Expected identifier but found "0"',
 'Remotion animation failed: Transform failed with 1 error: <stdin>:1:10: ERROR: Unexpected end of file'
])('B62 T2: compiler repair is bounded: %s', async message => {
 const render=vi.fn(async()=>{throw Error(message);});
 const {store,video,generator}=setup(render);
 const repair=vi.fn(async(v:ConceptVideo)=>v);
 await generator.generate({id:video.id,baseRevision:video.revision},undefined,repair);
 await generator.waitForIdle();
 expect(repair).toHaveBeenCalledTimes(1);expect(render).toHaveBeenCalledTimes(2);
 expect(store.get(video.id).generation?.status).toBe('failed');
});
test.each([
 'Remotion animation failed: browser executable not found',
 'Remotion animation failed: bundle dependency missing',
 'Narration failed: Transform failed with 1 error: Expected identifier but found "0"'
])('B62 T3: non-animation-compiler errors do not trigger repair: %s',async message=>{
 const {video,generator}=setup(async()=>{throw Error(message);});
 const repair=vi.fn(async(v:ConceptVideo)=>v);
 await generator.generate({id:video.id,baseRevision:video.revision},undefined,repair);
 await generator.waitForIdle();expect(repair).not.toHaveBeenCalled();
});
