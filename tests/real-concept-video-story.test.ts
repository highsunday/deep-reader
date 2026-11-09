import { mkdtempSync, mkdirSync, readFileSync, rmSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoAi } from '../src/main/concept-video-ai';
import { ConceptVideoGenerator } from '../src/main/concept-video-generator';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';
const execute = promisify(execFile);
test.skipIf(process.env.REAL_VIDEO_STORY !== '1')('B54 V4/V5: regression source becomes a narrated illustrated story', async () => {
 const directory=mkdtempSync(join(tmpdir(),'real-story-'));
 const store=new LocalConceptVideoStore(directory);
 const ai=new ConceptVideoAi(store,{workingDirectory:directory,createClient:()=>new SpawnedCodexAppServerClient()});
 const generator=new ConceptVideoGenerator(store);
 try {
  const original = {
   source:{bookId:'regression',chapterId:'comparison',bookTitle:'反脆弱概念驗證',chapterTitle:'穩定與風險',range:{start:0,end:80},readingSegment:'約翰是領固定薪水的銀行職員，喬治是計程車司機。兩人長期平均收入相近。約翰的收入很平穩，但失業可能讓收入完全中斷。喬治的收入有日常波動，但來自不同乘客，少一名客人不會失去全部收入，也能調整工作。波動不等於風險，表面穩定不等於安全。',images:[]},
   discussion:[{text:'請用故事說明兩人收入風險的差異'}],context:[],plan:{title:'固定薪水與波動收入：誰更脆弱？',goal:'以約翰和喬治的生活情境，說明固定薪水與波動收入的差異，帶出穩定不等於安全。'}
  };
  const created=store.create({source:original.source,question:original.discussion[0].text},original.context);
  const discussed=store.completeDiscussion({id:created.id,baseRevision:created.revision,title:original.plan.title,summary:original.plan.goal});
  const prepared=await ai.prepare({id:discussed.id,baseRevision:discussed.revision});
  expect(prepared.plan.animation).toBe('program');expect(prepared.plan.scenes.length).toBeGreaterThanOrEqual(3);
  expect(prepared.plan.narration).toBe(true);
  expect(prepared.plan.scenes.every(s=>s.code && s.narration!==original.plan.goal)).toBe(true);
  await generator.generate({id:prepared.id,baseRevision:prepared.revision});await generator.waitForIdle();
  const result=store.get(prepared.id);expect(result.generation?.error).toBeUndefined();expect(result.status).toBe('completed');
  const version=result.versions[0],artifact=store.artifactDirectory(result.id,version.id);
  const metadata=JSON.parse((await execute('/opt/homebrew/bin/ffprobe',['-v','error','-show_streams','-of','json',join(artifact,'video.mp4')])).stdout);
  expect(metadata.streams.some((s:any)=>s.codec_name==='h264')).toBe(true);
  expect(metadata.streams.some((s:any)=>s.codec_name==='aac')).toBe(true);
  const volume=await execute('/opt/homebrew/bin/ffmpeg',['-i',join(artifact,'video.mp4'),'-af','volumedetect','-vn','-sn','-f','null','-']);
  expect(Number(volume.stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1])).toBeGreaterThan(-60);
  const report='reports/concept-video/story-program';mkdirSync(report,{recursive:true});
  for(const name of ['video.mp4','subtitles.srt',...prepared.plan.scenes.map((_,i)=>`preview-${i+1}.png`)])copyFileSync(join(artifact,name),join(report,name));
  writeFileSync(join(report,'storyboard.json'),JSON.stringify({plan:prepared.plan,version},null,2));
  expect(new LocalConceptVideoStore(directory).get(result.id)).toEqual(result);
 } finally {ai.close();generator.close();rmSync(directory,{recursive:true,force:true});}
},240_000);
