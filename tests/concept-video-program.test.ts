import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseVideoPlan } from '../src/shared/concept-video';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
export const program = { runtime: 'canvas2d-v1', model: 'verified-test-model', reasoningEffort: 'medium', generatedAt: 1000 };
export const scenes = ['觀察', '變化', '理解'].map((heading, i) => ({ id: `s${i}`, heading, visual: heading, narration: `第${i+1}幕解釋概念的變化。`, code: `ctx.fillStyle='#112233';ctx.fillRect(0,0,width,height);ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(100+t*650,220,30+${i}*10,0,Math.PI*2);ctx.fill();` }));
const plan = { title: '自由動畫', goal: '理解變化', animation: 'program', program, scenes, pace: 'normal', narration: false };
test('P1: accepts original animation code and provenance; rejects missing or oversized programs', () => {
  expect(parseVideoPlan(plan)).toEqual(plan);
  expect(() => parseVideoPlan({...plan, scenes: scenes.map(s=>({...s,code:undefined}))})).toThrow();
  expect(() => parseVideoPlan({...plan, scenes: scenes.map(s=>({...s,code:'x'.repeat(24001)}))})).toThrow();
  expect(() => parseVideoPlan({...plan,program:{...program,runtime:'python'}})).toThrow();
});
test('P1/P2: generated code round-trips through storage and saved versions without loss', () => {
  const directory=mkdtempSync(join(tmpdir(),'video-program-'));
  try {
    const store=new LocalConceptVideoStore(directory);
    const draft=store.create({source:{bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'原文',images:[]},question:'理解變化'});
    const saved=store.save({id:draft.id,baseRevision:1,plan});
    expect(new LocalConceptVideoStore(directory).get(draft.id).plan).toEqual(plan);
    const started=store.startGeneration({id:saved.id,baseRevision:saved.revision});
    const complete=store.finishGeneration(saved.id,started.generation!.id,{status:'completed',stage:'完成',version:{id:'12345678-1234-1234-1234-123456789abc',createdAt:1000,plan:saved.plan,durationSeconds:18,bytes:500,scenes:scenes.map((s,i)=>({id:s.id,start:i*6,end:(i+1)*6}))}});
    const next=store.append({id:complete.id,baseRevision:complete.revision,question:'把白點改成金色'});
    store.completeDiscussion({id:next.id,baseRevision:next.revision,title:'金色動畫',summary:'改成金色，保留原本軌跡。'});
    expect(new LocalConceptVideoStore(directory).get(draft.id).versions[0].plan).toEqual(plan);
  } finally {rmSync(directory,{recursive:true,force:true});}
});
