import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { afterEach, expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoGenerator, localVideoRenderer } from '../src/main/concept-video-generator';
const execute=promisify(execFile), directories:string[]=[];
afterEach(()=>directories.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
function setup(code:string) {
  const directory=mkdtempSync(join(tmpdir(),'canvas-video-'));directories.push(directory);
  const store=new LocalConceptVideoStore(directory);
  const created=store.create({source:{bookId:'b',chapterId:'c',bookTitle:'測試',chapterTitle:'自由動畫',range:{start:0,end:2},readingSegment:'隨著時間改變的波',images:[]},question:'顯示波形'});
  const prepared=store.completeProgram({id:created.id,baseRevision:1,description:'以波形動畫說明振幅如何隨時間改變，讓讀者看見週期運動的規律。',program:{runtime:'canvas2d-v1',model:'test-fixture',reasoningEffort:'unknown',generatedAt:Date.now()},scenes:[0,1,2].map(i=>({heading:'波形',visual:'振幅變化',narration:`第${i+1}幕的變化。`,code}))});
  const video=store.save({id:prepared.id,baseRevision:prepared.revision,plan:{...prepared.plan,narration:false}});
  return {directory,store,video};
}
const motion="ctx.fillStyle='#112233';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#eaba69';ctx.lineWidth=5;ctx.beginPath();for(let x=40;x<920;x++){const y=220+Math.sin(x/50+t*6)*70; x===40?ctx.moveTo(x,y):ctx.lineTo(x,y);}ctx.stroke();";
test('P4: sandbox renders a custom wave program into changing playable frames and preserves code',async()=>{
  const {directory,store,video}=setup(motion),generator=new ConceptVideoGenerator(store);
  try{
    await generator.generate({id:video.id,baseRevision:video.revision});await generator.waitForIdle();
    const saved=new LocalConceptVideoStore(directory).get(video.id);
    expect(saved.generation?.error).toBeUndefined();expect(saved.status).toBe('completed');
    const version=saved.versions[0],output=store.artifactDirectory(video.id,version.id);
    expect(version.plan.scenes[0].code).toBe(motion);
    expect(readFileSync(join(output,'scene-1.js'),'utf8')).toBe(motion);
    expect(readFileSync(join(output,'subtitles.srt'),'utf8')).toContain('第1幕');
    expect(existsSync(join(output,'preview-1.png'))).toBe(true);
    expect(existsSync(join(output,'runtime-data'))).toBe(false);
    const hash=(await execute('/opt/homebrew/bin/ffmpeg',['-v','error','-i',join(output,'video.mp4'),'-vf','select=eq(n\\,0)+eq(n\\,40)','-frames:v','2','-an','-f','framemd5','-'])).stdout.split('\n').filter(s=>/^0,/.test(s)).map(s=>s.split(',').at(-1));
    expect(hash).toHaveLength(2);expect(hash[0]).not.toBe(hash[1]);
    const broken=store.save({id:video.id,baseRevision:saved.revision,plan:{...saved.plan,scenes:saved.plan.scenes.map(s=>({...s,code:'throw Error("修訂執行失敗");'}))}});
    await generator.generate({id:video.id,baseRevision:broken.revision});await generator.waitForIdle();
    const failed=store.get(video.id);expect(failed.generation?.status).toBe('failed');
    expect(failed.versions).toEqual(saved.versions);expect(failed.currentVersionId).toBe(saved.currentVersionId);
    expect(store.readMedia({id:video.id,versionId:version.id}).byteLength).toBe(version.bytes);
  }finally{generator.close();}
},120000);
test.each([
  ['syntax','ctx.???'], ['Node access',"require('node:fs').readFileSync('/etc/hosts')"], ['infinite loop','while(true) {}']
])('P5: %s fails promptly, without a successful version or fixed-template fallback',async(_label,code)=>{
  const {store,video}=setup(code),generator=new ConceptVideoGenerator(store);
  try{
    await generator.generate({id:video.id,baseRevision:video.revision});await generator.waitForIdle();
    const saved=store.get(video.id);expect(saved.generation?.status).toBe('failed');expect(saved.generation?.error).toBeTruthy();expect(saved.versions).toEqual([]);
    expect(saved.plan.scenes[0].code).toBe(code);
  }finally{generator.close();}
},20000);
test('P5: worker cannot read Node globals, local files, or network endpoints',async()=>{
  let requests=0;
  const server=createServer((_req,res)=>{requests++;res.end('forbidden');});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=(server.address() as {port:number}).port;
  const guard=`if(typeof process!=='undefined'||typeof require!=='undefined'||typeof window!=='undefined')throw Error('privilege leak');for(const url of ['http://127.0.0.1:${port}/','file:///etc/hosts']){const xhr=new XMLHttpRequest();xhr.open('GET',url,false);let blocked=false;try{xhr.send();}catch(e){blocked=true;}if(!blocked)throw Error('external access allowed');}`;
  const {video,directory}=setup(guard+motion),renderer=localVideoRenderer();
  try {await renderer.render(video,join(directory,'render'),new AbortController().signal);expect(requests).toBe(0);}
  finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
},120000);
test('P5: cancellation terminates a hung program and cannot publish a late version',async()=>{
  const {store,video}=setup('while(true){}'),generator=new ConceptVideoGenerator(store);
  try{
    await generator.generate({id:video.id,baseRevision:video.revision});
    await new Promise(resolve=>setTimeout(resolve,500));
    await generator.cancel(video.id);await generator.waitForIdle();
    expect(store.get(video.id).generation?.status).toBe('cancelled');expect(store.get(video.id).versions).toEqual([]);
  }finally{generator.close();}
},15000);
test('B58 T1: real Canvas undefined assignment is repaired once before saving playable media',async()=>{
 const broken='const blocks=[[seventy=76,120,220,32]];ctx.fillStyle="#48c8a2";for(const b of blocks)ctx.fillRect(...b);';
 const {store,video}=setup(broken),generator=new ConceptVideoGenerator(store);
 let repairs=0;
 try {
  await generator.generate({id:video.id,baseRevision:video.revision},undefined,async(running,_signal,failure)=>{
   repairs++;expect(failure).toContain('seventy is not defined');
   return store.updateGeneration(running.id,running.generation!.id,'Rendering repaired animation',{...running.plan,scenes:running.plan.scenes.map(s=>({...s,code:s.code!.replace('seventy=76','76')}))});
  });
  await generator.waitForIdle();const saved=store.get(video.id);
  expect(repairs).toBe(1);expect(saved.generation?.status).toBe('completed');expect(saved.versions).toHaveLength(1);expect(store.readMedia({id:video.id,versionId:saved.versions[0].id}).byteLength).toBeGreaterThan(0);
 }finally{generator.close();}
},180000);
