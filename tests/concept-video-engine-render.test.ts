import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, expect, test } from 'vitest';
import { createServer } from 'node:http';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoGenerator } from '../src/main/concept-video-generator';
import { VIDEO_ENGINE_RUNTIME, type VideoEngine } from '../src/shared/concept-video';
const dirs:string[]=[],execute=promisify(execFile);
afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
function setup(engine:VideoEngine,code:string) {
  const directory=mkdtempSync(join(tmpdir(),'video-native-'));dirs.push(directory);
  const store=new LocalConceptVideoStore(directory);
  const draft=store.create({source:{bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'原文',images:[]},question:'變化',engine});
  const p=store.completeProgram({id:draft.id,baseRevision:1,description:'觀察圖形隨時間移動，藉三幕畫面理解這個概念如何逐步變化。',program:{runtime:VIDEO_ENGINE_RUNTIME[engine],model:'fixture',reasoningEffort:'low',generatedAt:1},scenes:[0,1,2].map(i=>({heading:'移動',visual:'移動圓形',narration:`第${i+1}幕，觀察圓形移動。`,code}))});
  const video=store.save({id:p.id,baseRevision:p.revision,plan:{...p.plan,narration:false}});
  return {store,video,directory};
}
const motions={remotion:"return <AbsoluteFill style={{background:'#112233',justifyContent:'center'}}><div style={{width:60,height:60,borderRadius:30,background:'#f9c963',transform:`translateX(${80+t*650}px)`}} /></AbsoluteFill>;",manim:"circle = Circle(radius=0.5, color=YELLOW, fill_opacity=1).shift(LEFT*5)\nself.add(circle, MathTypst('x^2', font_size=48).shift(UP*2), Text('觀察變化', font='PingFang TC', font_size=36).shift(UP*3))\nself.play(circle.animate.shift(RIGHT*10), run_time=duration*0.8, rate_func=linear)"};
test.each(['remotion','manim'] as const)('E6: %s renders changing video, subtitles, previews and preserves source',async engine=>{
  const {store,video}=setup(engine,motions[engine]),generator=new ConceptVideoGenerator(store);
  try {
    await generator.generate({id:video.id,baseRevision:video.revision});await generator.waitForIdle();
    const saved=store.get(video.id);expect(saved.generation?.error).toBeUndefined();expect(saved.status).toBe('completed');
    const version=saved.versions[0],out=store.artifactDirectory(video.id,version.id);
    expect(version.plan.engine).toBe(engine);expect(version.scenes).toHaveLength(3);
    expect(readFileSync(join(out,engine==='manim'?'scene-1.py':'scene-1.jsx'),'utf8')).toBe(motions[engine]);
    expect(readFileSync(join(out,'subtitles.srt'),'utf8')).toContain('第1幕');expect(existsSync(join(out,'preview-1.png'))).toBe(true);
    const hashes=(await execute('/opt/homebrew/bin/ffmpeg',['-v','error','-i',join(out,'video.mp4'),'-vf','select=eq(n\\,0)+eq(n\\,40)','-frames:v','2','-an','-f','framemd5','-'])).stdout.split('\n').filter(s=>/^0,/.test(s)).map(s=>s.split(',').at(-1));
    expect(hashes).toHaveLength(2);expect(hashes[0]).not.toBe(hashes[1]);
    const broken=store.save({id:video.id,baseRevision:saved.revision,plan:{...saved.plan,scenes:saved.plan.scenes.map(s=>({...s,code:engine==='manim'?'raise ValueError("revision failed")':'throw Error("revision failed");'}))}});
    await generator.generate({id:video.id,baseRevision:broken.revision});await generator.waitForIdle();
    const failed=store.get(video.id);expect(failed.generation?.status).toBe('failed');expect(failed.versions).toEqual(saved.versions);expect(failed.currentVersionId).toBe(saved.currentVersionId);
    expect(store.readMedia({id:video.id,versionId:version.id}).byteLength).toBe(version.bytes);
  } finally { generator.close(); }
},180000);
test.each([['remotion','while(true) {}'],['manim','import os\nos.remove("/tmp/forbidden")']] as const)('E7: %s invalid programs fail without fallback',async(engine,code)=>{
  const {store,video}=setup(engine,code),generator=new ConceptVideoGenerator(store);
  try {await generator.generate({id:video.id,baseRevision:video.revision});await generator.waitForIdle();expect(store.get(video.id).generation?.status).toBe('failed');expect(store.get(video.id).versions).toEqual([]);}
  finally {generator.close();}
},60000);
test('E7: Remotion blocks external requests and local files',async()=>{
  let requests=0;const server=createServer((_req,res)=>{requests++;res.end('forbidden');});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
  const code=`React.useEffect(()=>{fetch('http://127.0.0.1:${port}/').catch(()=>{});fetch('file:///etc/hosts').catch(()=>{});},[]);${motions.remotion}`;
  const {store,video}=setup('remotion',code),generator=new ConceptVideoGenerator(store);
  try {await generator.generate({id:video.id,baseRevision:video.revision});await generator.waitForIdle();expect(store.get(video.id).generation?.error).toBeUndefined();expect(requests).toBe(0);}
  finally{generator.close();await new Promise<void>(r=>server.close(()=>r()));}
},180000);

test('E7: Manim OS sandbox refuses reads outside its work directory',async()=>{
  const forbidden=mkdtempSync(join(tmpdir(),'manim-private-'));dirs.push(forbidden);writeFileSync(join(forbidden,'secret.txt'),'42');
  const {store,video}=setup('manim',`np.loadtxt(${JSON.stringify(join(forbidden,'secret.txt'))})`),generator=new ConceptVideoGenerator(store);
  try{await generator.generate({id:video.id,baseRevision:video.revision});await generator.waitForIdle();const saved=store.get(video.id);expect(saved.generation?.status).toBe('failed');expect(saved.generation?.error).toMatch(/[Pp]ermission|[Oo]peration not permitted/);expect(saved.versions).toEqual([]);}
  finally{generator.close();}
},60000);
test.each(['remotion','manim'] as const)('E7: cancelling %s cannot save a late version',async engine=>{
  const {store,video}=setup(engine,engine==='manim'?'while True: pass':'while(true){}'),generator=new ConceptVideoGenerator(store);
  try{await generator.generate({id:video.id,baseRevision:video.revision});await new Promise(r=>setTimeout(r,500));await generator.cancel(video.id);await generator.waitForIdle();expect(store.get(video.id).generation?.status).toBe('cancelled');expect(store.get(video.id).versions).toEqual([]);}
  finally{generator.close();}
},60000);
