import { EventEmitter } from 'node:events';
import { describe, expect, test, vi } from 'vitest';
import { ChatController } from '../src/main/chat-controller';
import { generateConversationTopicTitle } from '../src/main/conversation-topic-title';
import { LocalChatConversationStore, type StoredChatConversation, type StoredChatState } from '../src/main/chat-conversation-store';
import type { CodexAppServerClient, CodexNotification } from '../src/main/codex-app-server-client';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

class Client implements CodexAppServerClient {
  events = new EventEmitter(); requests: {method: string; params?: Record<string, unknown>}[] = []; closed = false;
  response = JSON.stringify({title: '荒謬創作如何重現人的現實'});
  async initialize() {}
  async readAccount() { return {account: {type: 'chatgpt'}, requiresOpenaiAuth: false}; }
  async request(method: string, params?: Record<string, unknown>) {
    this.requests.push({method, params});
    if (method === 'thread/start') return {thread: {id: 'thread-new'}};
    if (method === 'thread/resume') return {thread: {id: params?.threadId}};
    if (method === 'turn/start') {
      if (params?.outputSchema) queueMicrotask(() => {
        this.notify('item/completed', {threadId: 'thread-new', turnId: 'turn-1', item: {type: 'agentMessage', text: this.response}});
        this.notify('turn/completed', {threadId: 'thread-new', turn: {id: 'turn-1', status: 'completed'}});
      });
      return {turn: {id: 'turn-1'}};
    }
    return {};
  }
  notify(method: string, params: unknown) { this.events.emit('n', {method, params}); }
  onNotification(fn: (n: CodexNotification) => void) {this.events.on('n', fn); return () => {this.events.off('n', fn);};}
  onExit(fn: (e: Error) => void) {this.events.on('exit', fn); return () => {this.events.off('exit', fn);};}
  close() {this.closed = true;}
}
function conversation(id = 'a'): StoredChatConversation {
  return {id, threadId: 'thread-'+id, title: '請改寫成白話', createdAt: 1, updatedAt: 2, source: {bookTitle: '薛西弗斯的神話', chapterTitle: id}, messages: [
    {id: 'u', turnId: 't', role: 'user', status: 'completed', text: '請改寫成白話', readingSource: {bookTitle: '薛西弗斯的神話', chapterTitle: id, readingSegment: '創作是重現自身現實。'}},
    {id: 'a', turnId: 't', role: 'assistant', status: 'completed', text: '創作呈現人所經驗的現實。\n```reading-input-suggestion\n{"repeat":null,"followUp":"內部"}\n```'}
  ]};
}
function setup(conversations: StoredChatConversation[], generateTitle: (input: any, signal: AbortSignal) => Promise<string>) {
  let stored: StoredChatState = {version: 1, selectedConversationId: conversations[0]?.id ?? null, conversations};
  const client = new Client();
  const controller = new ChatController({workingDirectory: '/tmp', createClient: () => client, generateConversationTitle: generateTitle,
    conversationStore: {load: () => structuredClone(stored), save: s => {stored = structuredClone(s);}}});
  return {controller, client, saved: () => stored};
}

describe('F69 topic titles', () => {
  test('TC1/2 serially backfills legacy conversations, strips metadata, persists version without changing selection, source, messages or ordering', async () => {
    const items = [conversation('a'), conversation('b')];
    const generated = vi.fn(async (input: any) => {expect(JSON.stringify(input)).not.toContain('reading-input-suggestion'); return input.source.chapterTitle === 'a' ? '創作如何重現人的現實' : '荒謬與藝術的關係';});
    const {controller, saved} = setup(items, generated);
    try {
      await controller.connect();
      await vi.waitFor(() => expect(generated).toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(saved().conversations.every(c => c.topicTitleVersion === 1)).toBe(true));
      expect(saved().conversations.map(c => c.title)).toEqual(['創作如何重現人的現實', '荒謬與藝術的關係']);
      expect(saved().selectedConversationId).toBe('a');
      saved().conversations.forEach((c,i) => {expect(c.updatedAt).toBe(2); expect(c.source).toEqual(items[i].source); expect(c.messages).toEqual(items[i].messages);});
      controller.close(); await controller.connect();
      expect(generated).toHaveBeenCalledTimes(2);
      const restarted = setup(saved().conversations, generated);
      try {await restarted.controller.connect(); expect(generated).toHaveBeenCalledTimes(2);}
      finally {restarted.controller.close();}
    } finally {controller.close();}
  });
  test('TC3 switching keeps the result bound to its conversation; deleted result is ignored', async () => {
    let finish!: (s: string) => void;
    const generated = vi.fn(() => new Promise<string>(r => {finish = r;}));
    const b = {...conversation('b'), topicTitleVersion: 1 as const};
    const {controller, saved} = setup([conversation(), b], generated);
    try {
      await controller.connect(); await vi.waitFor(() => expect(generated).toHaveBeenCalled());
      controller.selectConversation('b'); finish('創作與現實');
      await vi.waitFor(() => expect(saved().conversations[0].title).toBe('創作與現實'));
      expect(controller.getSnapshot().activeConversationId).toBe('b');
    } finally {controller.close();}
    const second = setup([conversation()], generated);
    try {
      await second.controller.connect(); await vi.waitFor(() => expect(generated).toHaveBeenCalledTimes(2));
      await second.controller.removeConversation('a'); finish('不能復活');
      await new Promise(r => setTimeout(r, 10)); expect(second.saved().conversations).toEqual([]);
    } finally {second.controller.close();}
  });
  test('TC4 failed title stays unchanged, does not loop, and retries on reconnect; close aborts', async () => {
    const generated = vi.fn(async () => {throw new Error('offline');});
    const {controller, saved} = setup([conversation()], generated);
    try {
      await controller.connect(); await vi.waitFor(() => expect(generated).toHaveBeenCalledTimes(1));
      expect(saved().conversations[0].title).toBe('請改寫成白話');
      await controller.connect(); expect(generated).toHaveBeenCalledTimes(1);
      controller.close(); await controller.connect(); await vi.waitFor(() => expect(generated).toHaveBeenCalledTimes(2));
    } finally {controller.close();}
    let signal: AbortSignal | undefined;
    const pending = setup([conversation()], async (_input, s) => {signal = s; return new Promise(() => {});});
    await pending.controller.connect(); await vi.waitFor(() => expect(signal).toBeDefined()); pending.controller.close(); expect(signal?.aborted).toBe(true);
  });
  test('TC2/5 waits for a completed reply in a new conversation', async () => {
    const generated = vi.fn(async () => '創作如何呈現現實');
    const {controller, client} = setup([], generated);
    try {
      await controller.connect(); await controller.sendMessage({text: '請改寫成白話'});
      expect(generated).not.toHaveBeenCalled();
      client.notify('item/completed', {threadId: 'thread-new', turnId: 'turn-1', item: {type:'agentMessage', id:'reply', text:'創作讓人重現現實。'}});
      expect(generated).not.toHaveBeenCalled();
      client.notify('turn/completed', {threadId:'thread-new', turn:{id:'turn-1', status:'completed'}});
      await vi.waitFor(() => expect(controller.getSnapshot().conversations[0].title).toBe('創作如何呈現現實'));
    } finally {controller.close();}
  });
  test('TC3 background backfill is serial and does not block sending another reading question', async () => {
    const finishes: Array<(title: string) => void> = [];
    const generated = vi.fn(() => new Promise<string>(resolve => finishes.push(resolve)));
    const {controller, client, saved} = setup([conversation('a'), conversation('b')], generated);
    try {
      await controller.connect(); await vi.waitFor(() => expect(generated).toHaveBeenCalledTimes(1));
      await controller.sendMessage({text:'這和模仿有何不同？'});
      expect(client.requests.some(r => r.method === 'turn/start')).toBe(true);
      finishes[0]('創作與現實的關係');
      await vi.waitFor(() => expect(generated).toHaveBeenCalledTimes(2));
      finishes[1]('模仿與藝術的關係');
      await vi.waitFor(() => expect(saved().conversations.every(c => c.topicTitleVersion === 1)).toBe(true));
      expect(controller.getSnapshot().activeTurnId).toBe('turn-1');
    } finally {controller.close();}
  });
  test('TC4 history write failure preserves original title and leaves it eligible after restart', async () => {
    const record = conversation();
    const client = new Client();
    const generated = vi.fn(async () => '創作如何重現現實');
    const controller = new ChatController({createClient:()=>client,workingDirectory:'/tmp',generateConversationTitle:generated,
      conversationStore:{load:()=>({version:1,selectedConversationId:'a',conversations:[structuredClone(record)]}), save:()=>{throw Error('disk full');}}});
    try {
      await controller.connect(); await vi.waitFor(() => expect(controller.getSnapshot().conversationError).toBe('disk full'));
      expect(controller.getSnapshot().conversations[0].title).toBe(record.title);
      expect(controller.getSnapshot().messages).toEqual(record.messages);
      expect(generated).toHaveBeenCalledTimes(1);
    } finally {controller.close();}
  });
  test('TC5 no title is inferred from user-only, failed, streaming or empty internal-only replies', async () => {
    for (const status of ['failed','streaming','completed'] as const) {
      const record = conversation(); record.messages[0].readingSource = undefined;
      record.messages[1].status = status;
      record.messages[1].text = '```reading-note-saved\n{"title":"hidden internal control"}\n```';
      const generated = vi.fn(async () => '不該產生標題');
      const {controller} = setup([record], generated);
      try {await controller.connect(); await new Promise(r=>setTimeout(r,10)); expect(generated).not.toHaveBeenCalled();}
      finally {controller.close();}
    }
  });
  test('TC2 store preserves version and remains compatible with legacy records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'f69-'));
    try {const store = new LocalChatConversationStore(dir); store.save({version:1,selectedConversationId:'a',conversations:[{...conversation(),topicTitleVersion:1},conversation('b')]}); expect(store.load().conversations.map(c=>c.topicTitleVersion)).toEqual([1,undefined]);}
    finally {rmSync(dir,{recursive:true,force:true});}
  });
  test('TC1/5 isolated generator requests structured topic output and closes client', async () => {
    const client = new Client();
    const title = await generateConversationTopicTitle({source: conversation().source, messages:[{role:'assistant',text:'創作呈現現實'}]}, {createClient: () => client, workingDirectory:'/tmp'}, new AbortController().signal);
    expect(title).toBe('荒謬創作如何重現人的現實'); expect(client.closed).toBe(true);
    expect(client.requests.find(r=>r.method==='thread/start')?.params).toMatchObject({ephemeral:true,approvalPolicy:'never',sandbox:'read-only'});
    expect(client.requests.find(r=>r.method==='turn/start')?.params?.outputSchema).toBeDefined();
  });
  test('TC4 malformed, multiline, oversized and generic output is rejected; timeout/cancel cleans up', async () => {
    for (const title of ['', '請改寫成白話', '整理重點', '甲\n乙', '字'.repeat(41)]) {
      const client = new Client(); client.response = JSON.stringify({title});
      await expect(generateConversationTopicTitle({source:null,messages:[]},{createClient:()=>client,workingDirectory:'/tmp'},new AbortController().signal)).rejects.toThrow(); expect(client.closed).toBe(true);
    }
    const client = new Client(); client.initialize = () => new Promise(() => {});
    await expect(generateConversationTopicTitle({source:null,messages:[]},{createClient:()=>client,workingDirectory:'/tmp',timeoutMs:10},new AbortController().signal)).rejects.toThrow(/timed out/); expect(client.closed).toBe(true);
    const cancel = new AbortController(); cancel.abort();
    await expect(generateConversationTopicTitle({source:null,messages:[]},{createClient:()=>new Client(),workingDirectory:'/tmp'},cancel.signal)).rejects.toThrow();
  });
});
