import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoAi } from '../src/main/concept-video-ai';
import { ConceptVideoGenerator } from '../src/main/concept-video-generator';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';
import type { ConceptVideo } from '../src/shared/concept-video';
test.skipIf(process.env.REAL_VIDEO_REVISION!=='1')('P2/P6: actual Codex revises a previously generated program, preserving the original playable version',async()=>{
 const originalPath=join(process.cwd(),'reports/concept-video/codex-program/math-area');
 const original=JSON.parse(readFileSync(join(originalPath,'result.json'),'utf8')) as ConceptVideo;
 const directory=mkdtempSync(join(tmpdir(),'codex-revision-'));
 const store=new LocalConceptVideoStore(directory),ai=new ConceptVideoAi(store,{workingDirectory:directory,createClient:()=>new SpawnedCodexAppServerClient()}),generator=new ConceptVideoGenerator(store);
 const report=join(process.cwd(),'reports/concept-video/codex-program/math-area-revised');mkdirSync(report,{recursive:true});
 try{
  const draft=store.create({source:original.source,question:original.discussion[0].text});
  const prepared=store.save({id:draft.id,baseRevision:1,plan:original.plan});
  const running=store.startGeneration({id:draft.id,baseRevision:prepared.revision});
  const first=store.finishGeneration(draft.id,running.generation!.id,{status:'completed',stage:'完成',version:original.versions[0]});
  const firstMedia=store.artifactDirectory(first.id,first.versions[0].id);mkdirSync(firstMedia,{recursive:true});copyFileSync(join(originalPath,'video.mp4'),join(firstMedia,'video.mp4'));
  const requested=store.append({id:first.id,baseRevision:first.revision,question:'修正三幕相同的排版問題：左上方 n=數字、y 軸名稱、刻度 1 重疊。保留曲線、面積算法、配色、矩形變細的動畫和旁白，只調整座標圖的上緣至 y=150（底部維持 390），將 n=數字放在標題下方 x=50,y=95，y 軸名稱放在 x=110,y=125，刻度 1 在 x=85,y=155。檢查所有三幕沒有文字重疊。'});
  const discussed=await ai.discuss({id:first.id,baseRevision:requested.revision,operation:'discuss'});
  const revised=await ai.prepare({id:first.id,baseRevision:discussed.revision});
  expect(revised.plan.scenes[0].code).not.toBe(original.plan.scenes[0].code);
  writeFileSync(join(report,'generated-plan.json'),JSON.stringify(revised.plan,null,2));
  await generator.generate({id:first.id,baseRevision:revised.revision});await generator.waitForIdle();
  const saved=store.get(first.id);writeFileSync(join(report,'result.json'),JSON.stringify(saved,null,2));
  expect(saved.generation?.error).toBeUndefined();expect(saved.versions).toHaveLength(2);
  expect(saved.versions[0]).toEqual(original.versions[0]);expect(saved.currentVersionId).toBe(first.currentVersionId);
  expect(Buffer.from(store.readMedia({id:first.id,versionId:first.currentVersionId!})).equals(readFileSync(join(originalPath,'video.mp4')))).toBe(true);
  const version=saved.versions[1],artifact=store.artifactDirectory(saved.id,version.id);
  for(const name of ['video.mp4','subtitles.srt',...revised.plan.scenes.flatMap((_,i)=>[`preview-${i+1}.png`,`scene-${i+1}.js`])])copyFileSync(join(artifact,name),join(report,name));
  const adopted=store.adopt({id:first.id,baseRevision:saved.revision,versionId:version.id});
  expect(new LocalConceptVideoStore(directory).get(first.id).currentVersionId).toBe(adopted.currentVersionId);
 }finally{ai.close();generator.close();rmSync(directory,{recursive:true,force:true});}
},600000);
