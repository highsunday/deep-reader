import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
const modules = import.meta.glob('../src/main/concept-video-ipc.ts');
test('TC03/05/18: IPC copies only completed visible relevant context and enforces source IDs and billing', async () => {
  const loader = modules['../src/main/concept-video-ipc.ts']; expect(loader, 'F53 needs main-process IPC').toBeTypeOf('function');
  const { registerConceptVideoIpc } = await loader!() as typeof import('../src/main/concept-video-ipc');
  const directory = mkdtempSync(join(tmpdir(), 'f53-ipc-'));
  try {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const store = new LocalConceptVideoStore(directory);
    const trusted = { sender: 'main' };
    const source = { bookId: 'b', chapterId: 'c', bookTitle: '書', chapterTitle: '章', range: { start: 0, end: 4 }, readingSegment: '原文內容', images: [] };
    const messages = [
      { role: 'user', status: 'completed', text: '這裡怎麼理解', readingSource: { bookTitle: '書', chapterTitle: '章', readingSegment: '原文內容' } },
      { role: 'assistant', status: 'completed', text: '可見說明\n```reading-note-draft\n{"hidden":true}\n```' },
      { role: 'user', status: 'completed', text: '別本書的問題', readingSource: { bookTitle: '另一書', chapterTitle: '章', readingSegment: '不同來源' } },
      { role: 'assistant', status: 'completed', text: '別本書答案' },
      { role: 'assistant', status: 'streaming', text: '未完成' }
    ];
    registerConceptVideoIpc({ handle: (channel, listener) => handlers.set(channel, listener) }, store, {
      trusted: e => e === trusted, sourceExists: async s => s.bookId === 'b' && s.chapterId === 'c',
      getMessages: () => messages as import('../src/shared/contracts').ChatMessage[]
    });
    const poll = handlers.get('concept-videos:poll')!;
    expect(() => poll(trusted, {})).toThrow();
    expect(() => poll(trusted, 'x'.repeat(201))).toThrow();
    const snapshot = poll(trusted) as { token: string; videos?: unknown[] };
    expect(snapshot.videos).toEqual([]);
    expect(poll(trusted, snapshot.token)).toEqual({ token: snapshot.token });
    const create = handlers.get('concept-videos:create')!;
    await expect(create(null, { source, question: '困惑' })).rejects.toThrow(/source/);
    await expect(create(trusted, { source: { ...source, chapterId: 'unknown' }, question: '困惑' })).rejects.toThrow(/source/);
    const video = await create(trusted, { source, question: '困惑' }) as import('../src/shared/concept-video').ConceptVideo;
    expect(video.context.map(m => m.text)).toEqual(['這裡怎麼理解', '可見說明']);
    expect(video.context.every(m => m.sourceLabel.includes('書'))).toBe(true);
    expect(() => handlers.get('concept-videos:request-ai')!(trusted, { id: video.id, operation: 'generate' })).toThrow(/unavailable/);
    expect(() => handlers.get('concept-videos:list')!(null)).toThrow(/source/);
    for (const channel of ['generate', 'cancel', 'adopt', 'media', 'poster', 'poll']) expect(() => handlers.get(`concept-videos:${channel}`)!(null, {})).toThrow(/source/);
    expect(() => handlers.get('concept-videos:media')!(trusted, { id: video.id, versionId: '../../private' })).toThrow(/version/);
    expect(() => handlers.get('concept-videos:poster')!(trusted, { id: video.id, versionId: '../../private' })).toThrow(/version/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('P3: production generate prepares animation code first, then renders the new revision; failure never falls back to GUI', async () => {
  const { registerConceptVideoIpc } = await import('../src/main/concept-video-ipc');
  const directory=mkdtempSync(join(tmpdir(),'story-ipc-'));
  try {
    const store=new LocalConceptVideoStore(directory);
    const video=store.create({source:{bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'原文',images:[]},question:'用故事說明'});
    const handlers=new Map<string, (event:unknown,...args:unknown[])=>unknown>();
    const calls:string[]=[];
    const ai={prepare:async(input:any)=>{calls.push('prepare');expect(input.baseRevision).toBe(2);return store.completeProgram({...input,description:'用連續動畫說明原文概念，展示各階段之間的變化。',program:{runtime:'canvas2d-v1',model:'test',reasoningEffort:'medium',generatedAt:1000},scenes:['開端','轉折','結果'].map((heading,i)=>({heading,visual:heading,narration:`這是第${i+1}幕的解說內容。`,code:`ctx.fillRect(t*100,${i*50},50,50);`}))});}};
    const { ConceptVideoGenerator } = await import('../src/main/concept-video-generator');
    const generator = new ConceptVideoGenerator(store, { capability: async () => ({ generationAllowed: true, narrationAllowed: true, reason: '' }), render: async video => { calls.push('render'); expect(video.plan.animation).toBe('program'); return { durationSeconds: 5, bytes: 100, scenes: [] }; } });
    registerConceptVideoIpc({handle:(channel,listener)=>handlers.set(channel,listener)},store,{trusted:e=>e==='main',sourceExists:async()=>true,getMessages:()=>[],ai:ai as any,generator:generator as any});
    expect(()=>handlers.get('concept-videos:generate')!(null,{id:video.id,baseRevision:1})).toThrow(/source/);
    await handlers.get('concept-videos:generate')!('main',{id:video.id,baseRevision:1});
    await generator.waitForIdle();
    expect(calls).toEqual(['prepare','render']);
    const reset = store.save({id:video.id,baseRevision:store.get(video.id).revision,plan:video.plan});
    ai.prepare=async()=>{calls.push('failed-prepare');throw Error('腳本失敗');};
    await handlers.get('concept-videos:generate')!('main',{id:video.id,baseRevision:reset.revision});
    await generator.waitForIdle();
    expect(store.get(video.id).generation).toMatchObject({ status: 'failed', error: '腳本失敗' });
    expect(calls).toEqual(['prepare','render','failed-prepare']);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('P3/P5: retry of a failed program asks Codex for a new program before rendering', async()=>{
 const {registerConceptVideoIpc}=await import('../src/main/concept-video-ipc');
 const directory=mkdtempSync(join(tmpdir(),'retry-program-'));
 try{
  const store=new LocalConceptVideoStore(directory);
  const draft=store.create({source:{bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'原文',images:[]},question:'說明概念'});
  const prepared=store.completeProgram({id:draft.id,baseRevision:1,description:'用連續動畫說明原文概念，展示各階段之間的變化。',program:{runtime:'canvas2d-v1',model:'test',reasoningEffort:'medium',generatedAt:1000},scenes:[0,1,2].map(i=>({heading:'概念',visual:'變化',narration:`第${i+1}幕。`,code:'invalid()'}))});
  const running=store.startGeneration({id:draft.id,baseRevision:prepared.revision});
  const failed=store.finishGeneration(draft.id,running.generation!.id,{status:'failed',stage:'失敗',error:'invalid is not defined'});
  const handlers=new Map<string,(e:unknown,...args:unknown[])=>unknown>(),calls:string[]=[];
  const ai={prepare:async(input:any)=>{calls.push('prepare');return store.completeProgram({...input,description:'用連續動畫說明原文概念，展示各階段之間的變化。',program:prepared.plan.program,scenes:prepared.plan.scenes.map(s=>({...s,code:'ctx.fillRect(0,0,width,height);'}))});}};
  const { ConceptVideoGenerator } = await import('../src/main/concept-video-generator');
  const generator = new ConceptVideoGenerator(store, { capability: async () => ({ generationAllowed: true, narrationAllowed: true, reason: '' }), render: async video => { calls.push('render'); expect(video.plan.scenes[0].code).toBe('ctx.fillRect(0,0,width,height);'); return { durationSeconds: 5, bytes: 100, scenes: [] }; } });
  registerConceptVideoIpc({handle:(c,l)=>handlers.set(c,l)},store,{trusted:()=>true,sourceExists:async()=>true,getMessages:()=>[],ai:ai as any,generator:generator as any});
  await handlers.get('concept-videos:generate')!({}, {id:draft.id,baseRevision:failed.revision});
  await generator.waitForIdle();
  expect(calls).toEqual(['prepare','render']);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('E5: IPC retains engine on create and rejects unavailable generation before AI',async()=>{
 const {registerConceptVideoIpc}=await import('../src/main/concept-video-ipc');
 const {ConceptVideoGenerator}=await import('../src/main/concept-video-generator');
 const directory=mkdtempSync(join(tmpdir(),'engine-ipc-'));
 try {
  const store=new LocalConceptVideoStore(directory),handlers=new Map<string,(e:unknown,...args:unknown[])=>unknown>();let prepared=false;
  const generator=new ConceptVideoGenerator(store,{capability:async()=>({generationAllowed:true,narrationAllowed:true,reason:'',engines:{canvas:{available:true,reason:''},remotion:{available:true,reason:''},manim:{available:false,reason:'Manim missing'}}}),render:async()=>{throw Error('must not render');}});
  registerConceptVideoIpc({handle:(c,l)=>handlers.set(c,l)},store,{trusted:e=>e==='main',sourceExists:async()=>true,getMessages:()=>[],generator,ai:{prepare:async()=>{prepared=true;throw Error('must not prepare');}} as any});
  const source={bookId:'b',chapterId:'c',bookTitle:'書',chapterTitle:'章',range:{start:0,end:2},readingSegment:'原文',images:[]};
  const video=await handlers.get('concept-videos:create')!('main',{source,question:'解釋',engine:'manim'}) as import('../src/shared/concept-video').ConceptVideo;
  expect(video.plan.engine).toBe('manim');
  await expect(handlers.get('concept-videos:generate')!('main',{id:video.id,baseRevision:1})).rejects.toThrow('Manim missing');
  expect(prepared).toBe(false);expect(store.get(video.id).generation).toBeUndefined();
 }finally{rmSync(directory,{recursive:true,force:true});}
});
