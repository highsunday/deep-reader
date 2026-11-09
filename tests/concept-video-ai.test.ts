import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { LocalConceptVideoStore } from '../src/main/concept-video-store';
import { ConceptVideoAi } from '../src/main/concept-video-ai';
import { createChatImageCompressor } from '../src/main/chat-image-compression';
import type { CodexAppServerClient, CodexNotification } from '../src/main/codex-app-server-client';
const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); dirs.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })); });
function setup(timeoutMs: number | null = 100) {
  const path = mkdtempSync(join(tmpdir(), 'video-discussion-')); dirs.push(path);
  const store = new LocalConceptVideoStore(path);
  const source = { bookId: 'b', chapterId: 'c', bookTitle: '書', chapterTitle: '章', range: { start: 0, end: 2 }, readingSegment: '原文', images: [] };
  const video = store.create({ source, question: '比較兩者' });
  let listener: (n: CodexNotification) => void = () => {};
  let onTurn = () => {
    listener({ method: 'item/completed', params: { threadId: 'other', turnId: 'x', item: { type: 'agentMessage', text: 'invalid' } } });
    listener({ method: 'item/completed', params: { threadId: 't', turnId: 'r', item: { type: 'agentMessage', text: JSON.stringify({ title: '兩者比較', summary: '這支影片主要比較兩個觀念，透過生活例子說明差異。' }) } } });
    listener({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'r', status: 'completed' } } });
  };
  const client: CodexAppServerClient = {
    initialize: vi.fn(async () => {}), readAccount: vi.fn(async () => ({ account: { type: 'chatgpt' }, requiresOpenaiAuth: false })),
    request: vi.fn(async method => { if (method === 'thread/start') return { thread: { id: 't' }, model: 'resolved-model', reasoningEffort: 'high' }; if (method === 'turn/start') { onTurn(); return { turn: { id: 'r' } }; } throw Error(method); }),
    onNotification: vi.fn(fn => { listener = fn; return () => {}; }), onExit: vi.fn(() => () => {}), close: vi.fn()
  };
  const createClient = vi.fn(() => client), ai = new ConceptVideoAi(store, { createClient, workingDirectory: path, ...(timeoutMs === null ? {} : { timeoutMs }) });
  return { store, video, ai, client, createClient, path, emit: (n: CodexNotification) => listener(n), setTurn: (fn: () => void) => { onTurn = fn; } };
}
test('S2/S5: real store atomically persists assistant and renderable summary, reload and follow-up use frozen source', async () => {
  const { store, video, ai, client, path } = setup();
  const reply = await ai.discuss({ id: video.id, baseRevision: 1, operation: 'discuss' });
  expect(reply.discussion.map(m => m.role)).toEqual(['user', 'assistant']);
  expect(reply.plan.scenes[0].visual).toBe(reply.plan.goal);
  expect(reply.versions).toEqual([]);
  expect(new LocalConceptVideoStore(path).get(video.id)).toEqual(reply);
  expect(client.close).toHaveBeenCalled();
  const thread = vi.mocked(client.request).mock.calls.find(([method]) => method === 'thread/start')![1]!;
  expect(thread).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'never', ephemeral: true });
  expect(thread.config).toMatchObject({ web_search: 'disabled', 'features.plugins': false });
  const next = store.append({ id: video.id, baseRevision: reply.revision, question: '改用生活例子' });
  await ai.discuss({ id: video.id, baseRevision: next.revision, operation: 'discuss' });
  const turn = vi.mocked(client.request).mock.calls.filter(([method]) => method === 'turn/start').at(-1)![1]!;
  const payload = JSON.parse((turn.input as { text: string }[])[0].text);
  expect(payload.source.readingSegment).toBe('原文');
  expect(payload.discussion.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user']);
});
test('S4: stale reply never overwrites a newer requirement', async () => {
  const { store, video, ai, setTurn, emit } = setup();
  setTurn(() => {
    store.append({ id: video.id, baseRevision: 1, question: '更新方向' });
    emit({ method: 'item/completed', params: { threadId: 't', turnId: 'r', item: { type: 'agentMessage', text: '{"title":"過期","summary":"過期結果"}' } } });
    emit({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'r', status: 'completed' } } });
  });
  await expect(ai.discuss({ id: video.id, baseRevision: 1, operation: 'discuss' })).rejects.toThrow(/changed/);
  expect(store.get(video.id).discussion.map(m => m.text)).toEqual(['比較兩者', '更新方向']);
  expect(store.get(video.id).plan).toEqual(video.plan);
});
test('S4: invalid response and timeout leave draft intact and close the client', async () => {
  const { store, video, ai, client, setTurn, emit } = setup();
  setTurn(() => {
    emit({ method: 'item/completed', params: { threadId: 't', turnId: 'r', item: { type: 'agentMessage', text: '{"title":"","summary":""}' } } });
    emit({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'r', status: 'completed' } } });
  });
  await expect(ai.discuss({ id: video.id, baseRevision: 1, operation: 'discuss' })).rejects.toThrow();
  expect(store.get(video.id)).toEqual(video);
  setTurn(() => {});
  await expect(ai.discuss({ id: video.id, baseRevision: 1, operation: 'discuss' })).rejects.toThrow(/timed out/);
  expect(client.close).toHaveBeenCalled(); expect(store.get(video.id)).toEqual(video);
});
test('S4: API-key account, stale input, and unsupported operation never start an AI turn', async () => {
  const { video, ai, client, createClient } = setup();
  await expect(ai.discuss({ id: video.id, baseRevision: 9, operation: 'discuss' })).rejects.toThrow(/changed/);
  await expect(ai.discuss({ id: video.id, baseRevision: 1, operation: 'generate' })).rejects.toThrow(/Generate video button/);
  expect(createClient).not.toHaveBeenCalled();
  vi.mocked(client.readAccount).mockResolvedValue({ account: { type: 'apiKey' }, requiresOpenaiAuth: false });
  await expect(ai.discuss({ id: video.id, baseRevision: 1, operation: 'discuss' })).rejects.toThrow(/Sign in/);
  expect(client.request).not.toHaveBeenCalled();
});
test('P1: preparation requests free animation code, stores actual model, and rejects missing programs', async () => {
  const {store,video,ai,client,setTurn,emit}=setup();
  const scenes=['開端','變化','結果'].map((heading,i)=>({heading,visual:heading,narration:`角色在第${i+1}幕經歷不同情境，理解事情的變化。`,code:`ctx.fillRect(t*width,100,50,50); // scene ${i}`}));
  setTurn(()=>{
    emit({method:'item/completed',params:{threadId:'t',turnId:'r',item:{type:'agentMessage',text:JSON.stringify({description:'用三幕畫面說明概念的變化，並展示不同情境如何影響結果。',scenes})}}});
    emit({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'completed'}}});
  });
  const result=await ai.prepare({id:video.id,baseRevision:1});
  expect(result.plan.animation).toBe('program');expect(result.plan.program).toMatchObject({model:'resolved-model',reasoningEffort:'high'});expect(result.plan.scenes[0].code).toBe(scenes[0].code);expect(result.plan.scenes).toHaveLength(3);expect(result.plan.narration).toBe(true);expect(result.plan.description).toContain('三幕畫面');
  expect(store.get(video.id).plan.description).toBe(result.plan.description);
  const thread=vi.mocked(client.request).mock.calls.find(([method])=>method==='thread/start')![1]!;
  expect(thread.developerInstructions).toContain('旁白直接說故事或解釋');
  const turn=vi.mocked(client.request).mock.calls.find(([method])=>method==='turn/start')![1]!;
  expect((turn.outputSchema as any).required).toEqual(['description', 'scenes']);
  const current=store.get(video.id);
  setTurn(()=>{
    emit({method:'item/completed',params:{threadId:'t',turnId:'r',item:{type:'agentMessage',text:JSON.stringify({scenes})}}});
    emit({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'completed'}}});
  });
  await expect(ai.prepare({id:video.id,baseRevision:current.revision})).rejects.toThrow(/description/);
  expect(store.get(video.id)).toEqual(current);
  setTurn(()=>{
    emit({method:'item/completed',params:{threadId:'t',turnId:'r',item:{type:'agentMessage',text:'{"summary":"只有說明"}'}}});
    emit({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'completed'}}});
  });
  await expect(ai.prepare({id:video.id,baseRevision:current.revision})).rejects.toThrow(/program/);
  expect(store.get(video.id)).toEqual(current);
});

test('P2: editing supplies previous version code with the latest discussion and source', async () => {
  const {store,video,ai,client,setTurn,emit}=setup();
  const scenes=['開始','轉折','結果'].map((heading,i)=>({heading,visual:heading,narration:`概念的第${i+1}個變化。`,code:`ctx.fillRect(t*100,${i*60},20,20);`}));
  setTurn(()=>{
    emit({method:'item/completed',params:{threadId:'t',turnId:'r',item:{type:'agentMessage',text:JSON.stringify({description:'用三幕畫面說明概念的變化，並展示不同情境如何影響結果。',scenes})}}});
    emit({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'completed'}}});
  });
  const prepared=await ai.prepare({id:video.id,baseRevision:1});
  const started=store.startGeneration({id:video.id,baseRevision:prepared.revision});
  const completed=store.finishGeneration(video.id,started.generation!.id,{status:'completed',stage:'完成',version:{id:'12345678-1234-1234-1234-123456789abc',createdAt:1000,plan:prepared.plan,durationSeconds:18,bytes:500,scenes:prepared.plan.scenes.map((s,i)=>({id:s.id,start:i*6,end:(i+1)*6}))}});
  const followup=store.append({id:video.id,baseRevision:completed.revision,question:'放慢第二幕'});
  const summary=store.completeDiscussion({id:video.id,baseRevision:followup.revision,title:'慢一點',summary:'放慢第二幕，保留圖形。'});
  await ai.prepare({id:video.id,baseRevision:summary.revision});
  const turn=vi.mocked(client.request).mock.calls.filter(([method])=>method==='turn/start').at(-1)![1]!;
  const payload=JSON.parse((turn.input as {text:string}[])[0].text);
  expect(payload.previousAnimation).toEqual(prepared.plan);
  expect(payload.discussion.at(-2).text).toBe('放慢第二幕');
  expect(store.get(video.id).versions[0].plan).toEqual(prepared.plan);
});

test('P2: discussing a failed first draft retains its code for repair even without a successful version', async () => {
  const {store,video,ai,client,setTurn,emit}=setup();
  const scenes=['開始','轉折','結果'].map(heading=>({heading,visual:heading,narration:'解釋這個畫面。',code:'ctx.fillRect(0,0,width,height);'}));
  const prepared=store.completeProgram({id:video.id,baseRevision:1,description:'用三幕畫面說明概念的變化，並展示不同情境如何影響結果。',scenes,program:{runtime:'canvas2d-v1',model:'prior',reasoningEffort:'medium',generatedAt:1000}});
  const next=store.append({id:video.id,baseRevision:prepared.revision,question:'加上移動的波形'});
  const discussed=store.completeDiscussion({id:video.id,baseRevision:next.revision,title:'波形動畫',summary:'加入移動波形。'});
  setTurn(()=>{
    emit({method:'item/completed',params:{threadId:'t',turnId:'r',item:{type:'agentMessage',text:JSON.stringify({description:'用三幕畫面說明概念的變化，並展示不同情境如何影響結果。',scenes})}}});
    emit({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'completed'}}});
  });
  await ai.prepare({id:video.id,baseRevision:discussed.revision});
  const turn=vi.mocked(client.request).mock.calls.find(([method])=>method==='turn/start')![1]!;
  const payload=JSON.parse((turn.input as {text:string}[])[0].text);
  expect(payload.previousAnimation).toEqual(prepared.plan);
});

test.each([['remotion','remotion-v1','React'],['manim','manim-ce-v1','Scene.construct']] as const)('E4: %s preparation uses engine instructions and matching provenance',async(engine,runtime,keyword)=>{
  const {store,video,ai,client,setTurn,emit}=setup();
  const selected=store.save({id:video.id,baseRevision:1,plan:{...video.plan,engine}});
  setTurn(()=>{
    emit({method:'item/completed',params:{threadId:'t',turnId:'r',item:{type:'agentMessage',text:JSON.stringify({description:'三幕畫面逐步解釋概念如何改變，讓觀眾從變化中看見關係。',scenes:[0,1,2].map(i=>({heading:'變化',visual:'圖形',narration:`觀察第${i+1}幕的變化。`,code:engine==='manim'?'self.add(Circle())':'return <AbsoluteFill />;'}))})}}});
    emit({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'completed'}}});
  });
  const result=await ai.prepare({id:video.id,baseRevision:selected.revision});
  expect(result.plan.engine).toBe(engine);expect(result.plan.program?.runtime).toBe(runtime);
  const thread=vi.mocked(client.request).mock.calls.find(([m])=>m==='thread/start')![1]!;
  expect(thread.developerInstructions).toContain(keyword);
  const turn=vi.mocked(client.request).mock.calls.find(([m])=>m==='turn/start')![1]!;
  expect(JSON.parse((turn.input as {text:string}[])[0].text).engine).toBe(engine);
});
test('E4: switching engines never passes incompatible previous code to AI',async()=>{
  const {store,video,ai,client,setTurn,emit}=setup();
  const p=store.completeProgram({id:video.id,baseRevision:1,description:'三幕畫面逐步解釋概念如何改變，讓觀眾從變化中看見關係。',scenes:[0,1,2].map(i=>({heading:'變化',visual:'圖形',narration:'觀察變化。',code:'ctx.fillRect(0,0,20,20);'})),program:{runtime:'canvas2d-v1',model:'fixture',reasoningEffort:'low',generatedAt:1}});
  const u=store.append({id:p.id,baseRevision:p.revision,question:'改成幾何動畫'});
  const d=store.completeDiscussion({id:p.id,baseRevision:u.revision,title:'幾何',summary:'觀察形狀變化。'});
  const selected=store.save({id:d.id,baseRevision:d.revision,plan:{...d.plan,engine:'manim'}});
  setTurn(()=>{emit({method:'item/completed',params:{threadId:'t',turnId:'r',item:{type:'agentMessage',text:JSON.stringify({description:'三幕畫面逐步解釋概念如何改變，讓觀眾從變化中看見關係。',scenes:[0,1,2].map(i=>({heading:'變化',visual:'圖形',narration:'觀察變化。',code:'self.add(Circle())'}))})}}});emit({method:'turn/completed',params:{threadId:'t',turn:{id:'r',status:'completed'}}});});
  await ai.prepare({id:p.id,baseRevision:selected.revision});
  const turn=vi.mocked(client.request).mock.calls.find(([m])=>m==='turn/start')![1]!;
  expect(JSON.parse((turn.input as {text:string}[])[0].text).previousAnimation).toBeUndefined();
});

const timeoutProgram = JSON.stringify({ description: '用三幕展示機器人如何逐漸抵達目標，說明移動規則與穩定性的關係。', scenes: [0,1,2].map(i => ({ heading: `Scene ${i}`, visual: 'A robot moves toward the goal', narration: 'The robot moves toward its goal.', code: 'ctx.fillRect(t*100,100,20,20);' })) });
function finishProgram(emit: ReturnType<typeof setup>['emit']) {
  emit({ method: 'item/completed', params: { threadId: 't', turnId: 'r', item: { type: 'agentMessage', text: timeoutProgram } } });
  emit({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'r', status: 'completed' } } });
}
test('B61 T1: active animation generation survives five minutes and saves progress without stale revision errors', async () => {
  vi.useFakeTimers();
  const { store, video, ai, emit, setTurn, client } = setup(null);
  setTurn(() => {});
  const running = store.startGeneration({ id: video.id, baseRevision: video.revision });
  const result = ai.prepare({ id: running.id, baseRevision: running.revision, jobId: running.generation!.id });
  void result.catch(() => {});
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 3; i++) {
    await vi.advanceTimersByTimeAsync(120_000);
    emit({ method: i === 0 ? 'item/reasoning/summaryTextDelta' : 'item/agentMessage/delta', params: { threadId: 't', turnId: 'r', delta: 'working' } });
  }
  expect(client.close).not.toHaveBeenCalled();
  expect(store.get(video.id).generation!.stage).toContain('Receiving animation code');
  finishProgram(emit);
  expect((await result).plan.animation).toBe('program');
});
test('B61 T2: silent animation generation times out; unrelated or empty events do not extend it', async () => {
  vi.useFakeTimers();
  const { video, ai, emit, setTurn, client } = setup(null);
  setTurn(() => {});
  const result = ai.prepare({ id: video.id, baseRevision: video.revision });
  const failed = result.catch(error => error);
  await vi.advanceTimersByTimeAsync(240_000);
  emit({ method: 'item/agentMessage/delta', params: { threadId: 'other', turnId: 'r', delta: 'working' } });
  emit({ method: 'item/agentMessage/delta', params: { threadId: 't', turnId: 'r', delta: '' } });
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await failed).message).toMatch(/animation.*no progress/i);
  expect(client.close).toHaveBeenCalled();
});
test('B61 T3: continuous reasoning still hits the fifteen minute animation limit', async () => {
  vi.useFakeTimers();
  const { video, ai, emit, setTurn } = setup(null);
  setTurn(() => {});
  const result = ai.prepare({ id: video.id, baseRevision: video.revision });
  const failed = result.catch(error => error);
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 14; i++) {
    await vi.advanceTimersByTimeAsync(60_000);
    emit({ method: 'item/reasoning/textDelta', params: { threadId: 't', turnId: 'r', delta: 'thinking' } });
  }
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await failed).message).toMatch(/animation.*time limit/i);
});
test.each(['initialize', 'account/read', 'thread/start', 'turn/start'].flatMap(step => ['timeout', 'cancel'].map(kind => ({ step, kind }))))('B61 T4: $kind releases hung $step immediately', async ({ step, kind }) => {
  vi.useFakeTimers();
  const { video, ai, client } = setup(null);
  if (step === 'initialize') vi.mocked(client.initialize).mockImplementation(() => new Promise(() => {}));
  else if (step === 'account/read') vi.mocked(client.readAccount).mockImplementation(() => new Promise(() => {}));
  else {
    const request = vi.mocked(client.request).getMockImplementation()!;
    vi.mocked(client.request).mockImplementation((method, params) => method === step ? new Promise(() => {}) : request(method, params));
  }
  const abort = new AbortController();
  const result = ai.prepare({ id: video.id, baseRevision: video.revision }, abort.signal);
  let settled = false;
  void result.catch(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(0);
  if (kind === 'cancel') abort.abort();
  await vi.advanceTimersByTimeAsync(kind === 'timeout' ? 300_000 : 0);
  expect(settled).toBe(true);
  await expect(result).rejects.toThrow(kind === 'timeout' ? /no progress/i : /stopped/);
  expect(client.close).toHaveBeenCalled();
  if (step === 'initialize' || step === 'account/read') expect(client.request).not.toHaveBeenCalled();
});

test('B61 T5: heartbeat distinguishes waiting from real activity and stops on cancellation', async () => {
  vi.useFakeTimers();
  const { store, video, ai, emit, setTurn } = setup(null);
  setTurn(() => {});
  const running = store.startGeneration({ id: video.id, baseRevision: video.revision });
  const abort = new AbortController();
  const result = ai.prepare({ id: running.id, baseRevision: running.revision, jobId: running.generation!.id }, abort.signal);
  const failed = result.catch(error => error);
  await vi.advanceTimersByTimeAsync(45_000);
  expect(store.get(video.id).generation!.stage).toMatch(/45s elapsed.*No response yet.*Waiting for Codex/);
  emit({ method: 'item/reasoning/summaryTextDelta', params: { threadId: 't', turnId: 'r', delta: 'planning' } });
  expect(store.get(video.id).generation!.stage).toMatch(/Planning animation.*0s since last response/);
  emit({ method: 'item/agentMessage/delta', params: { threadId: 't', turnId: 'r', delta: '1234567890' } });
  expect(store.get(video.id).generation!.stage).toContain('10 characters');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(store.get(video.id).generation!.stage).toMatch(/30s since last response.*Waiting for Codex/);
  const cancelled = store.finishGeneration(video.id, running.generation!.id, { status: 'cancelled', stage: 'Cancelled' });
  abort.abort();
  expect((await failed).message).toContain('stopped');
  finishProgram(emit);
  await vi.advanceTimersByTimeAsync(900_000);
  expect(store.get(video.id)).toEqual(cancelled);
  expect(vi.getTimerCount()).toBe(0);
});
test('B61 T6: progress cannot absorb a conflicting revision and save late code', async () => {
  vi.useFakeTimers();
  const { store, video, ai, emit, setTurn } = setup(null);
  setTurn(() => {});
  const running = store.startGeneration({ id: video.id, baseRevision: video.revision });
  const result = ai.prepare({ id: running.id, baseRevision: running.revision, jobId: running.generation!.id });
  const failed = result.catch(error => error);
  await vi.advanceTimersByTimeAsync(0);
  store.updateGeneration(video.id, running.generation!.id, 'Another owner changed the job');
  emit({ method: 'item/agentMessage/delta', params: { threadId: 't', turnId: 'r', delta: 'code' } });
  expect((await failed).message).toContain('changed');
  expect(store.get(video.id).plan.animation).not.toBe('program');
});


test('B63 discussion, follow-up and animation preparation compress wire images while preserving source originals', async () => {
  const { store, video, client, path, setTurn, emit } = setup();
  const bytes = Buffer.alloc(600 * 1024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  const opaque = `data:image/png;base64,${bytes.toString('base64')}`;
  const transparent = 'data:image/png;base64,iVBORw0KGgo=';
  const compressImage = createChatImageCompressor(() => ({
    isEmpty: () => false, toBitmap: () => Buffer.from([0, 0, 0, 255]),
    getSize: () => ({ width: 1200, height: 600 }),
    resize: () => { throw new Error('must not upscale'); },
    toJPEG: () => Buffer.from([255, 216, 255, 1, 2, 3])
  }));
  const ai = new ConceptVideoAi(store, { createClient: () => client, workingDirectory: path, compressImage });
  const images = [...Array.from({ length: 40 }, () => ({ dataUrl: opaque })), { dataUrl: transparent }];
  const draft = store.create({ source: { ...video.source, images, readingSegment: images.map((_, i) => `[Book image ${i + 1}]`).join(' ') }, question: 'Explain' });
  const first = await ai.discuss({ id: draft.id, baseRevision: draft.revision, operation: 'discuss' });
  const next = store.append({ id: draft.id, baseRevision: first.revision, question: 'Compare' });
  const second = await ai.discuss({ id: draft.id, baseRevision: next.revision, operation: 'discuss' });
  setTurn(() => {
    const result = { description: '用三幕展示機器人如何逐漸抵達目標，說明移動規則與穩定性的關係。', scenes: [0, 1, 2].map(i => ({ heading: `Scene ${i}`, visual: 'A robot moves toward the goal', narration: 'The robot moves toward its goal.', code: 'ctx.fillRect(t*100,100,20,20);' })) };
    emit({ method: 'item/completed', params: { threadId: 't', turnId: 'r', item: { type: 'agentMessage', text: JSON.stringify(result) } } });
    emit({ method: 'turn/completed', params: { threadId: 't', turn: { id: 'r', status: 'completed' } } });
  });
  await ai.prepare({ id: draft.id, baseRevision: second.revision });
  const turns = vi.mocked(client.request).mock.calls.filter(([m]) => m === 'turn/start');
  expect(turns).toHaveLength(3);
  for (const [, params] of turns) {
    expect((params!.input as { type: string; url?: string }[]).filter(i => i.type === 'image').map(i => i.url))
      .toEqual([...Array(40).fill(`data:image/jpeg;base64,${Buffer.from([255, 216, 255, 1, 2, 3]).toString('base64')}`), transparent]);
  }
  expect(new LocalConceptVideoStore(path).get(draft.id).source).toEqual(draft.source);
});


test('B63 oversized transmitted images are rejected before connecting AI while preserving the draft', async () => {
  const { store, video, client, path } = setup();
  const bytes = Buffer.alloc(5 * 1024 * 1024);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  const image = { dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
  const draft = store.create({ source: { ...video.source, images: Array(5).fill(image) }, question: 'Explain' });
  const ai = new ConceptVideoAi(store, { createClient: () => client, workingDirectory: path, compressImage: url => url });
  await expect(ai.discuss({ id: draft.id, baseRevision: draft.revision, operation: 'discuss' })).rejects.toThrow(/compressed.*20 MiB/i);
  expect(client.initialize).not.toHaveBeenCalled();
  expect(store.get(draft.id).source).toEqual(draft.source);
});
