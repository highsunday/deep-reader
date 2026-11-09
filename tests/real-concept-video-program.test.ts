import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoAi } from '../src/main/concept-video-ai';
import { ConceptVideoGenerator } from '../src/main/concept-video-generator';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';
const execute=promisify(execFile);
const cases=[
 {slug:'math-area',title:'積分的直覺',source:'在區間 [0,1] 上，曲線 y=x² 下方的面積可以用許多小矩形近似。把區間等分成 n 份，每份寬度 1/n，使用每小段右端點的函數值作為矩形高度。右端點矩形總面積略大於真實面積，n 越大時誤差越小，極限是三分之一。',question:'讓我看懂積分為什麼是面積：把曲線下的長方形越切越細，顯示近似如何改善。做約 30 秒的動畫，三幕，旁白精簡。不要用導數例子。'},
 {slug:'abstract-feedback',title:'回饋迴路',source:'負回饋讓系統偏離目標後逐步回到目標。例如室溫低於恆溫器的設定時，暖氣開啟；接近設定溫度後減弱或停止。正回饋則會放大原有變化，例如麥克風接收喇叭聲音，再放大送回喇叭，可能形成尖銳嘯叫。正負描述的是變化的方向，不代表好壞。',question:'用看得見的連續變化比較負回饋與正回饋。自行畫房間暖氣與聲音波動，呈現偏差縮小和放大。三幕、約 30 秒，旁白精簡，不要只用箭頭與文字卡。'}
];
test.skipIf(process.env.REAL_VIDEO_PROGRAM!=='1').each(cases)('P6: actual Codex authors and renders $slug',async sample=>{
 const directory=mkdtempSync(join(tmpdir(),'codex-program-real-'));
 const store=new LocalConceptVideoStore(directory),ai=new ConceptVideoAi(store,{workingDirectory:directory,createClient:()=>new SpawnedCodexAppServerClient()}),generator=new ConceptVideoGenerator(store);
 const report=join(process.cwd(),'reports/concept-video/codex-program',sample.slug);mkdirSync(report,{recursive:true});
 try{
  const draft=store.create({source:{bookId:sample.slug,chapterId:'test',bookTitle:'驗證用概念範例',chapterTitle:sample.title,range:{start:0,end:sample.source.length},readingSegment:sample.source,images:[]},question:sample.question});
  const prepared=await ai.prepare({id:draft.id,baseRevision:draft.revision});
  writeFileSync(join(report,'generated-plan.json'),JSON.stringify(prepared.plan,null,2));
  expect(prepared.plan.animation).toBe('program');expect(prepared.plan.program?.model).not.toBe('unknown');
  expect(prepared.plan.scenes.every(s=>s.code && !s.stage)).toBe(true);
  await generator.generate({id:prepared.id,baseRevision:prepared.revision});await generator.waitForIdle();
  const saved=store.get(prepared.id);writeFileSync(join(report,'result.json'),JSON.stringify(saved,null,2));
  expect(saved.generation?.error).toBeUndefined();expect(saved.status).toBe('completed');
  const version=saved.versions[0],artifact=store.artifactDirectory(saved.id,version.id);
  for(const name of ['video.mp4','subtitles.srt',...prepared.plan.scenes.flatMap((_,i)=>[`preview-${i+1}.png`,`scene-${i+1}.js`])])copyFileSync(join(artifact,name),join(report,name));
  const metadata=JSON.parse((await execute('/opt/homebrew/bin/ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(report,'video.mp4')])).stdout);
  writeFileSync(join(report,'ffprobe.json'),JSON.stringify(metadata,null,2));
  expect(metadata.streams.some((s:any)=>s.codec_name==='h264'&&s.width===960&&s.height===540)).toBe(true);
  expect(metadata.streams.some((s:any)=>s.codec_name==='aac')).toBe(true);
  const volume=await execute('/opt/homebrew/bin/ffmpeg',['-i',join(report,'video.mp4'),'-af','volumedetect','-vn','-sn','-f','null','-']);
  expect(Number(volume.stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1])).toBeGreaterThan(-60);
  const hashes=(await execute('/opt/homebrew/bin/ffmpeg',['-v','error','-i',join(report,'video.mp4'),'-vf','select=eq(n\\,0)+eq(n\\,60)','-frames:v','2','-an','-f','framemd5','-'])).stdout.split('\n').filter(s=>/^0,/.test(s)).map(s=>s.split(',').at(-1));
  expect(hashes).toHaveLength(2);expect(hashes[0]).not.toBe(hashes[1]);
  expect(new LocalConceptVideoStore(directory).get(saved.id)).toEqual(saved);
 }finally{ai.close();generator.close();rmSync(directory,{recursive:true,force:true});}
},600000);
