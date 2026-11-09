import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import type { CodexAppServerClient, CodexNotification } from '../src/main/codex-app-server-client';
import { synthesizeVideoNarration } from '../src/main/concept-video-narration';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'video-narration-')); directories.push(directory);
  let listener: (n: CodexNotification) => void = () => {};
  let reply = () => {
    listener({ method: 'thread/realtime/outputAudio/delta', params: { threadId: 't', audio: { data: Buffer.alloc(4800).toString('base64'), sampleRate: 24000, numChannels: 1 } } });
    listener({ method: 'thread/realtime/transcript/done', params: { threadId: 't', role: 'assistant', text: '看看這個變化。' } });
  };
  const client: CodexAppServerClient = {
    initialize: vi.fn(async () => {}), readAccount: vi.fn(async () => ({ account: { type: 'chatgpt' }, requiresOpenaiAuth: true })),
    request: vi.fn(async method => {
      if (method === 'thread/start') return { thread: { id: 't' } };
      if (method === 'thread/realtime/start') {listener({ method: 'thread/realtime/started', params: { threadId: 't' } });listener({ method:'thread/realtime/sdp',params:{threadId:'t',sdp:'remote-answer'}});}
      if (method === 'thread/realtime/appendSpeech') reply();
      return {};
    }), onNotification: vi.fn(fn => { listener = fn; return () => {}; }), onExit: vi.fn(() => () => {}), close: vi.fn()
  };
  const peer = { offer: vi.fn(async () => 'local-offer'), answer: vi.fn(async () => {}), finish: vi.fn(async () => ({pcm:Buffer.alloc(4800),sampleRate:24000,channels:1})), close: vi.fn() };
  const options = { createClient: () => client, createPeer: async () => peer, quietMs: 5, timeoutMs: 100 };
  return { directory, client, peer, options, plan: { narration: true, pace: 'normal' as const, goal: '理解', scenes: [{ narration: '看看這個變化。', visual: '變化' }] }, signal: new AbortController().signal,
    emit: (n: CodexNotification) => listener(n), setReply: (fn: () => void) => { reply = fn; } };
}
test('TC1: Codex speech produces a valid WAV using ChatGPT auth and isolated v3 WebRTC transport', async () => {
  const { directory, plan, signal, options, client } = setup();
  await synthesizeVideoNarration(plan, directory, signal, options);
  expect(client.request).toHaveBeenCalledWith('thread/realtime/start', expect.objectContaining({ version: 'v3', transport: { type: 'webrtc', sdp:'local-offer' } }));
  expect(client.request).toHaveBeenCalledWith('thread/realtime/appendSpeech', expect.objectContaining({ text: expect.stringContaining(plan.scenes[0].narration) }));
  const wav = readFileSync(join(directory, '0.wav'));
  expect(wav.subarray(0, 4).toString()).toBe('RIFF'); expect(wav.readUInt32LE(24)).toBe(24000); expect(wav.length).toBe(4844);
  expect(readFileSync(join(directory, 'narration.json'), 'utf8')).toContain('codex-app-server');
  expect(client.close).toHaveBeenCalled();
});
test('TC2: silent video never connects; an API-key account is rejected', async () => {
  const { directory, plan, signal, options, client } = setup();
  await synthesizeVideoNarration({ ...plan, narration: false }, directory, signal, options);
  expect(client.initialize).not.toHaveBeenCalled();
  vi.mocked(client.readAccount).mockResolvedValue({ account: { type: 'apiKey' }, requiresOpenaiAuth: false });
  await expect(synthesizeVideoNarration(plan, directory, signal, options)).rejects.toThrow(/ChatGPT/);
  expect(client.request).not.toHaveBeenCalled(); expect(client.close).toHaveBeenCalled();
});
test('TC3: mismatched narration cannot publish audio', async () => {
  const { directory, plan, signal, options, setReply, emit } = setup();
  setReply(() => { emit({ method: 'thread/realtime/outputAudio/delta', params: { threadId: 't', audio: { data: Buffer.alloc(4800).toString('base64'), sampleRate: 24000, numChannels: 1 } } }); emit({ method: 'thread/realtime/transcript/done', params: { threadId: 't', role: 'assistant', text: '別的內容。' } }); });
  await expect(synthesizeVideoNarration(plan, directory, signal, options)).rejects.toThrow(/script/i);
  expect(existsSync(join(directory, '0.wav'))).toBe(false);
});
test('TC3: denied service is a failure', async () => {
  const { directory, plan, signal, options, setReply, emit, client } = setup();
  setReply(() => emit({ method: 'thread/realtime/error', params: { threadId: 't', message: 'access denied' } }));
  await expect(synthesizeVideoNarration(plan, directory, signal, options)).rejects.toThrow(/Codex/);
  expect(existsSync(join(directory, '0.wav'))).toBe(false); expect(client.close).toHaveBeenCalled();
});
test('TC4: cancellation closes the client without publishing late audio', async () => {
  const { directory, plan, options, client, setReply } = setup(); const controller = new AbortController();
  setReply(() => controller.abort());
  await expect(synthesizeVideoNarration(plan, directory, controller.signal, options)).rejects.toThrow(/cancel/i);
  expect(client.close).toHaveBeenCalled(); expect(existsSync(join(directory, '0.wav'))).toBe(false);
});
test('TC3/TC4: startup acknowledgement without any audio times out', async () => {
  const { directory, plan, options, client, setReply, signal } = setup(); setReply(() => {});
  await expect(synthesizeVideoNarration(plan, directory, signal, options)).rejects.toThrow(/timed out/i);
  expect(client.close).toHaveBeenCalled(); expect(existsSync(join(directory, '0.wav'))).toBe(false);
});

test('TC2: WAV publication waits for the actual recording after the completed transcript', async () => {
  const {directory,plan,options,signal,peer}=setup();
  let complete!: (value:Awaited<ReturnType<typeof peer.finish>>)=>void;
  peer.finish.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
  const run=synthesizeVideoNarration(plan,directory,signal,options);
  await vi.waitFor(()=>expect(complete).toBeTypeOf('function'));
  expect(existsSync(join(directory,'0.wav'))).toBe(false);
  complete({pcm:Buffer.alloc(9600),sampleRate:24000,channels:1});await run;
  expect(readFileSync(join(directory,'0.wav')).length).toBe(9644);
});

test('TC3: wrong-thread errors are ignored and invalid peer audio cannot publish a WAV', async () => {
  const { directory, plan, options, signal, setReply, emit, peer } = setup();
  peer.finish.mockResolvedValue({pcm:Buffer.alloc(0),sampleRate:24000,channels:1});
  setReply(() => {
    emit({ method: 'thread/realtime/error', params: { threadId: 'other', message: 'ignore' } });
    emit({method:'thread/realtime/transcript/done',params:{threadId:'t',role:'assistant',text:plan.scenes[0].narration}});
  });
  await expect(synthesizeVideoNarration(plan, directory, signal, options)).rejects.toThrow(/invalid.*audio/i);
  expect(existsSync(join(directory, '0.wav'))).toBe(false);
});

test('TC3: service errors retain their actual cause instead of claiming missing voice access', async () => {
  const { directory, plan, signal, options, setReply, emit, peer } = setup();
  setReply(() => emit({method:'thread/realtime/error',params:{threadId:'t',message:'realtime conversation requires API key auth'}}));
  await expect(synthesizeVideoNarration(plan,directory,signal,options)).rejects.toThrow(/requires API key auth/);
  expect(peer.close).toHaveBeenCalled();
});

test('TC4: cancellation during peer initialization closes the late peer and never starts realtime', async () => {
  const { directory, plan, options, peer, client }=setup();const abort=new AbortController();
  let ready!: (value:typeof peer)=>void;options.createPeer=()=>new Promise(resolve=>{ready=resolve;});
  const run=synthesizeVideoNarration(plan,directory,abort.signal,options);await vi.waitFor(()=>expect(ready).toBeTypeOf('function'));
  abort.abort();await expect(run).rejects.toThrow(/cancel/i);ready(peer);
  await vi.waitFor(()=>expect(peer.close).toHaveBeenCalled());
  expect(client.request).not.toHaveBeenCalledWith('thread/realtime/start',expect.anything());
});

test('TC3: a mismatched take is re-recorded with a bounded retry and only matching audio is published', async () => {
  const {directory,plan,signal,options,client,setReply,emit,peer}=setup();let attempt=0;
  setReply(()=>emit({method:'thread/realtime/transcript/done',params:{threadId:'t',role:'assistant',text:++attempt===1?'好的，看看這個變化。':plan.scenes[0].narration}}));
  await synthesizeVideoNarration(plan,directory,signal,options);
  expect(attempt).toBe(2);expect(peer.finish).toHaveBeenCalledTimes(1);
  expect(client.close).toHaveBeenCalledTimes(3);
  expect(existsSync(join(directory,'0.wav'))).toBe(true);
});
