import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, vi } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { localVideoRenderer } from '../src/main/concept-video-generator';
import { VIDEO_ENGINE_RUNTIME } from '../src/shared/concept-video';
// Deterministic voice fixture: test real native rendering and audio muxing independently of account access.
vi.mock('../src/main/concept-video-narration',()=>({synthesizeVideoNarration:async(plan:any,directory:string)=>{
  mkdirSync(directory,{recursive:true});
  for(let i=0;i<plan.scenes.length;i++){
    const samples=16000,header=Buffer.alloc(44),pcm=Buffer.alloc(samples*2);
    header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(16000,24);header.writeUInt32LE(32000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);
    for(let s=0;s<samples;s++)pcm.writeInt16LE(Math.round(Math.sin(s/16000*Math.PI*2*440)*4000),s*2);
    writeFileSync(join(directory,`${i}.wav`),Buffer.concat([header,pcm]));
  }
}}));
const execute=promisify(execFile);
test.each(['remotion','manim'] as const)('E6: %s aligns native animation with narration WAV and emits audible AAC',async engine=>{
 const directory=mkdtempSync(join(tmpdir(),'engine-audio-'));
 try{
  const store=new LocalConceptVideoStore(directory),draft=store.create({source:{bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'原文',images:[]},question:'解釋',engine});
  const code=engine==='manim'?'self.add(Circle())':'return <AbsoluteFill style={{background:"#234567"}} />;';
  const video=store.completeProgram({id:draft.id,baseRevision:1,description:'觀察三幕圖形變化，讓讀者逐步理解物件之間的關係。',scenes:[0,1,2].map(i=>({heading:'變化',visual:'圖形',narration:'解釋畫面中的變化。',code})),program:{runtime:VIDEO_ENGINE_RUNTIME[engine],model:'fixture',reasoningEffort:'low',generatedAt:1}});
  const out=join(directory,'render'),result=await localVideoRenderer().render(video,out,new AbortController().signal);
  expect(result.durationSeconds).toBeCloseTo(4.8);expect(result.scenes[0].end).toBeCloseTo(1.6);
  const probe=JSON.parse((await execute('/opt/homebrew/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(out,'video.mp4')])).stdout);
  expect(probe.streams.some((s:any)=>s.codec_name==='aac')).toBe(true);
  const volume=(await execute('/opt/homebrew/bin/ffmpeg',['-i',join(out,'video.mp4'),'-af','volumedetect','-vn','-f','null','-'])).stderr;
  expect(Number(volume.match(/mean_volume: (-?[\d.]+) dB/)?.[1])).toBeGreaterThan(-40);
 }finally{rmSync(directory,{recursive:true,force:true});}
},180000);
