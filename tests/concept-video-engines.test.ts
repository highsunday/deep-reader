import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import worker from '../src/main/concept-video-remotion-worker.cjs.txt?raw';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { parseVideoPlan } from '../src/shared/concept-video';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
const source = { bookId:'b', chapterId:'c', bookTitle:'書', chapterTitle:'章', range:{start:0,end:2}, readingSegment:'原文', images:[] };
const scenes = [0,1,2].map(i => ({ id:`s${i}`, heading:'變化', visual:'圖形', narration:'理解圖形的變化。', code:'return null;' }));
test.each([['canvas','canvas2d-v1'],['remotion','remotion-v1'],['manim','manim-ce-v1']])('E1: %s plans retain engine and reject mismatched runtimes', (engine, runtime) => {
  const plan = {title:'影片',goal:'理解',engine,animation:'program',scenes,pace:'normal',narration:false,program:{runtime,model:'test',reasoningEffort:'low',generatedAt:1}};
  expect(parseVideoPlan(plan)).toEqual(plan);
  expect(() => parseVideoPlan({...plan,program:{...plan.program,runtime:'other'}})).toThrow();
});
test('E2: create and discussion preserve selected engine across reopening', () => {
  const dir=mkdtempSync(join(tmpdir(),'video-engines-')); dirs.push(dir);
  const store=new LocalConceptVideoStore(dir);
  const video=store.create({source,question:'解釋',engine:'manim'});
  expect((video.plan as any).engine).toBe('manim');
  const reply=store.completeDiscussion({id:video.id,baseRevision:video.revision,title:'影片',summary:'解釋變化。'});
  expect((reply.plan as any).engine).toBe('manim');
  expect(new LocalConceptVideoStore(dir).get(video.id).plan).toEqual(reply.plan);
  expect(() => store.create({source,question:'解釋',engine:'unknown'})).toThrow();
});
test('E2: switching invalidates current code and retains immutable versions and adoption', () => {
  const dir=mkdtempSync(join(tmpdir(),'video-engines-'));dirs.push(dir);const store=new LocalConceptVideoStore(dir);
  const draft=store.create({source,question:'解釋'});
  const prepared=store.completeProgram({id:draft.id,baseRevision:1,description:'以三幕圖形展示概念逐步改變的過程，讓讀者觀察物件的差異。',scenes,program:{runtime:'canvas2d-v1',model:'test',reasoningEffort:'low',generatedAt:1}});
  const running=store.startGeneration({id:draft.id,baseRevision:prepared.revision});
  expect(()=>store.save({id:draft.id,baseRevision:running.revision,plan:{...running.plan,engine:'manim'}})).toThrow(/generating/);
  const saved=store.finishGeneration(draft.id,running.generation!.id,{status:'completed',stage:'完成',version:{id:'12345678-1234-1234-1234-123456789abc',createdAt:1,plan:prepared.plan,bytes:10,durationSeconds:18,scenes:scenes.map((s,i)=>({id:s.id,start:i*6,end:(i+1)*6}))}});
  const switched=store.save({id:saved.id,baseRevision:saved.revision,plan:{...saved.plan,engine:'manim'}});
  expect(switched.plan.engine).toBe('manim');expect(switched.plan.program).toBeUndefined();expect(switched.plan.animation).not.toBe('program');expect(switched.plan.scenes.every(s=>!s.code)).toBe(true);
  expect(switched.versions).toEqual(saved.versions);expect(switched.currentVersionId).toBe(saved.currentVersionId);
});
test('E5: unavailable selected engine rejects before preparing or starting a job',async()=>{
  const {ConceptVideoGenerator}=await import('../src/main/concept-video-generator');
  const dir=mkdtempSync(join(tmpdir(),'video-engines-'));dirs.push(dir);const store=new LocalConceptVideoStore(dir);
  const video=store.create({source,question:'解釋',engine:'manim'});let prepared=false,rendered=false;
  const generator=new ConceptVideoGenerator(store,{capability:async()=>({generationAllowed:true,narrationAllowed:true,reason:'',engines:{canvas:{available:true,reason:''},remotion:{available:true,reason:''},manim:{available:false,reason:'Manim missing'}}}),render:async()=>{rendered=true;return {durationSeconds:1,bytes:1,scenes:[]};}});
  await expect(generator.generate({id:video.id,baseRevision:1},async v=>{prepared=true;return v;})).rejects.toThrow('Manim missing');
  expect(prepared).toBe(false);expect(rendered).toBe(false);expect(store.get(video.id).generation).toBeUndefined();
});

test('B62 T4: real Remotion worker identifies the broken scene and includes local code context', async()=>{
 const directory=mkdtempSync(join(tmpdir(),'remotion-syntax-'));dirs.push(directory);
 const workerPath=join(directory,'worker.cjs'),jobPath=join(directory,'job.json');
 writeFileSync(workerPath,worker);
 writeFileSync(jobPath,JSON.stringify({scenes:[{heading:'Valid scene',code:'return <text>{"V(x) < 0"}</text>;'}, {heading:'Stable goal',code:'return <text>V̇(x) < 0 when x ≠ x*</text>;'}]}));
 let error: any;
 try {await promisify(execFile)(process.execPath,[workerPath,jobPath,join(process.cwd(),'node_modules'),'unused-browser'],{timeout:10_000});}catch(e){error=e;}
 expect(error.stderr).toContain('Remotion animation failed: Scene 2 (Stable goal)');
 expect(error.stderr).toContain('Expected identifier but found "0"');
 expect(error.stderr).toContain('Code near error:');
 expect(error.stderr).toContain('V̇(x) < 0');
});
