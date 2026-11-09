import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoGenerator } from '../src/main/concept-video-generator';
import { VIDEO_ENGINE_RUNTIME, VIDEO_ENGINES, videoEngine } from '../src/shared/concept-video';
const execute=promisify(execFile);
test('TC2: batch creates three playable MP4s through actual local engines',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'f56-native-'));
 const store=new LocalConceptVideoStore(directory),generator=new ConceptVideoGenerator(store);
 try {
  const initial=store.create({source:{bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'圓形移動表示概念的改變。',images:[]},question:'觀察圖形移動'});
  const video=store.completeDiscussion({id:initial.id,baseRevision:initial.revision,title:'概念變化',summary:'觀察圓形在三幕中隨時間移動。'});
  const code={canvas:'ctx.fillStyle="#122c3b";ctx.fillRect(0,0,width,height);ctx.fillStyle="#48c8a2";ctx.beginPath();ctx.arc(120+t*600,200,45,0,Math.PI*2);ctx.fill();',remotion:'return <AbsoluteFill style={{backgroundColor:"#122c3b"}}><div style={{position:"absolute",left:120+t*600,top:160,width:90,height:90,borderRadius:"50%",backgroundColor:"#48c8a2"}} /></AbsoluteFill>;',manim:'circle = Circle(radius=0.6, color=GREEN).set_fill(GREEN, opacity=1).shift(LEFT*4+UP)\nself.add(circle)\nself.play(circle.animate.shift(RIGHT*8), run_time=duration*0.8, rate_func=linear)'};
  await generator.compare({id:video.id,baseRevision:video.revision},async(running)=>{
   const engine=videoEngine(running.plan);
   const prepared=store.completeProgram({id:running.id,baseRevision:running.revision,jobId:running.generation!.id,description:'觀察圓形隨時間移動，以三幕連續動畫理解概念變化的過程。',program:{runtime:VIDEO_ENGINE_RUNTIME[engine],model:'render-fixture',reasoningEffort:'low',generatedAt:1},scenes:[0,1,2].map(i=>({heading:'變化',visual:'移動圓形',narration:`第${i+1}幕觀察圖形的變化。`,code:code[engine]}))});
   return store.updateGeneration(prepared.id,prepared.generation!.id,'Rendering comparison',{...prepared.plan,narration:false});
  });
  await generator.waitForIdle();
  const saved=store.get(video.id);expect(saved.generation?.error, JSON.stringify(saved.comparison?.videoIds.map(id=>store.get(id).generation))).toBeUndefined();expect(saved.generation?.status).toBe('completed');expect(saved.plan).toEqual(video.plan);
  for(const [i,id] of saved.comparison!.videoIds.entries()){
   const result=store.get(id);expect(result.generation?.error).toBeUndefined();expect(result.versions).toHaveLength(1);
   const version=result.versions[0];expect(videoEngine(version.plan)).toBe(VIDEO_ENGINES[i]);const media = Buffer.from(store.readMedia({id,versionId:version.id}));expect(media.byteLength).toBe(version.bytes);expect(media.toString('latin1')).toContain('crf=19.0');
   const poster = Buffer.from(store.readPoster({id,versionId:version.id}));expect(poster.readUInt32BE(16)).toBe(1920);expect(poster.readUInt32BE(20)).toBe(1080);
   const output=await execute('/opt/homebrew/bin/ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=codec_name,width,height,r_frame_rate','-of','json',join(store.artifactDirectory(id,version.id),'video.mp4')]);
   expect(JSON.parse(output.stdout).streams[0]).toMatchObject({codec_name:'h264',width:1920,height:1080,r_frame_rate:'30/1'});
  }
 }finally{generator.close();rmSync(directory,{recursive:true,force:true});}
},180000);
