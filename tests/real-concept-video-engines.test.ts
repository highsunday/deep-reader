import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoAi } from '../src/main/concept-video-ai';
import { ConceptVideoGenerator } from '../src/main/concept-video-generator';
import { SpawnedCodexAppServerClient } from '../src/main/codex-app-server-client';
test.skipIf(process.env.REAL_VIDEO_ENGINES!=='1').each(['remotion','manim'] as const)('E4/E6: actual Codex generates and renders %s integration',async engine=>{
  const directory=mkdtempSync(join(tmpdir(),'video-engine-codex-'));
  const report=join(process.cwd(),'reports/concept-video/engines',engine);mkdirSync(report,{recursive:true});
  const store=new LocalConceptVideoStore(directory),ai=new ConceptVideoAi(store,{workingDirectory:directory,createClient:()=>new SpawnedCodexAppServerClient()}),generator=new ConceptVideoGenerator(store);
  try {
    const source='在區間零到一上，曲線 y=x² 下方的面積可以用小矩形近似。將區間等分成 n 份，以右端點高度決定矩形高度。n 增加，近似的誤差縮小，極限是三分之一。';
    const draft=store.create({source:{bookId:'engine-test',chapterId:'integral',bookTitle:'引擎驗證',chapterTitle:'積分直覺',range:{start:0,end:source.length},readingSegment:source,images:[]},engine,question:'用三幕動畫解釋積分的面積直覺：曲線與面積、少量右端點矩形、矩形變細逼近面積。每幕旁白15至20字，圖形需連續變化、中文短標籤、不要重疊；精簡程式以便驗證。'});
    let prepared=await ai.prepare({id:draft.id,baseRevision:draft.revision});
    writeFileSync(join(report,'generated-plan.json'),JSON.stringify(prepared.plan,null,2));
    expect(prepared.plan.engine).toBe(engine);
    // This probe checks authorship and rendering; existing narration tests cover service access.
    prepared=store.save({id:prepared.id,baseRevision:prepared.revision,plan:{...prepared.plan,narration:false}});
    await generator.generate({id:prepared.id,baseRevision:prepared.revision});await generator.waitForIdle();
    let saved=store.get(prepared.id);
    if (saved.generation?.status==='failed') {
      prepared=await ai.prepare({id:saved.id,baseRevision:saved.revision,renderingFailure:saved.generation.error});
      writeFileSync(join(report,'repaired-plan.json'),JSON.stringify(prepared.plan,null,2));
      prepared=store.save({id:prepared.id,baseRevision:prepared.revision,plan:{...prepared.plan,narration:false}});
      await generator.generate({id:prepared.id,baseRevision:prepared.revision});await generator.waitForIdle();saved=store.get(prepared.id);
    }
    writeFileSync(join(report,'result.json'),JSON.stringify(saved,null,2));
    expect(saved.generation?.error).toBeUndefined();expect(saved.versions).toHaveLength(1);
    const version=saved.versions[0],out=store.artifactDirectory(saved.id,version.id);
    for(const name of ['video.mp4','subtitles.srt','preview-1.png','preview-2.png','preview-3.png'])copyFileSync(join(out,name),join(report,name));
  }finally{ai.close();generator.close();rmSync(directory,{recursive:true,force:true});}
},600000);
