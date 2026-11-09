import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { ChatController, composeCodexInput } from '../src/main/chat-controller';
import type { CodexAppServerClient, CodexNotification } from '../src/main/codex-app-server-client';
import type { ChatIntent, ChatMessage } from '../src/shared/contracts';
import type { StoredChatState } from '../src/main/chat-conversation-store';
import { readingSegmentShortcutText } from '../src/renderer/reading-segment-shortcuts';
import { readingSuggestions } from '../src/shared/reading-input-suggestion';

const intent = 'readingCoach' as ChatIntent;
const source = { bookTitle: '測試書', chapterTitle: '壓力', readingSegment: '恢復原狀不等於變強；適量刺激可能產生額外能力。' };
const other = { ...source, readingSegment: '負回饋縮小與目標的差距。' };
const start = () => ({ text: readingSegmentShortcutText(intent), intent, context: source });
class Client implements CodexAppServerClient {
  events = new EventEmitter(); requests: { method: string; params?: Record<string, unknown> }[] = []; n = 0;
  async initialize() {}
  async readAccount() { return { account: { type: 'chatgpt' }, requiresOpenaiAuth: false }; }
  async request(method: string, params?: Record<string, unknown>) {
    this.requests.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thread-' + this.requests.length } };
    if (method === 'thread/resume') return { thread: { id: params?.threadId } };
    if (method === 'turn/start') return { turn: { id: 'turn-' + ++this.n } };
    return {};
  }
  onNotification(fn: (n: CodexNotification) => void) { this.events.on('n', fn); return () => { this.events.off('n', fn); }; }
  onExit() { return () => {}; }
  close() {}
  finish(controller: ChatController, text = '恢復原狀與增加能力有何不同？') {
    const snapshot = controller.getSnapshot();
    this.events.emit('n', { method: 'item/completed', params: { threadId: snapshot.threadId, turnId: snapshot.activeTurnId, item: { id: 'assistant-' + snapshot.messages.length, type: 'agentMessage', text } } });
    this.events.emit('n', { method: 'turn/completed', params: { threadId: snapshot.threadId, turn: { id: snapshot.activeTurnId, status: 'completed' } } });
  }
  lastTurn() { return JSON.stringify(this.requests.findLast(r => r.method === 'turn/start')?.params?.input); }
}
function setup(saved?: StoredChatState) {
  let state = saved ?? { version: 1 as const, selectedConversationId: null, conversations: [] };
  const client = new Client();
  const controller = new ChatController({ createClient: () => client, workingDirectory: '/tmp', conversationStore: { load: () => structuredClone(state), save: s => { state = structuredClone(s); } } });
  return { controller, client, saved: () => state };
}
test('F70 TC1: shortcut sends the full approved prompt and bypasses legacy quiz creation', () => {
  const prompt = readingSegmentShortcutText(intent);
  const doc = readFileSync('tests/fixtures/reading-coach-prompt.md', 'utf8');
  expect(prompt).toBe(doc.slice(doc.indexOf('# AI 深度閱讀與理解教練')).trim());
  const input = composeCodexInput(start());
  expect(input).toContain(source.readingSegment);
  expect(input).toContain(prompt);
  expect(input).not.toContain('$design-learning-questions');
  expect(input).not.toContain('3–5 core');
});
test('F70 TC3/4/6: coach rules and source are resent for plain replies and 整理筆記 after restart', async () => {
  const first = setup();
  try {
    await first.controller.sendMessage(start()); first.client.finish(first.controller);
    await first.controller.sendMessage({ text: '只要恢復就算變強', readingSource: source });
    expect(first.client.lastTurn()).toContain('Active reading coach');
    expect(first.client.lastTurn()).toContain('依賴提示完成');
    expect(first.client.lastTurn()).toContain(source.readingSegment);
    first.client.finish(first.controller, '恢復到原先水準，是否多出了能力？');
    const restored = setup(first.saved());
    try {
      await restored.controller.sendMessage({ text: '整理筆記', readingSource: source });
      expect(restored.client.requests.some(r => r.method === 'thread/resume')).toBe(true);
      expect(restored.client.lastTurn()).toContain('Active reading coach');
      expect(restored.client.lastTurn()).toContain('七部分');
      expect(restored.client.lastTurn()).toContain('takes precedence over create-reading-note');
      expect(restored.client.lastTurn()).not.toContain('"type":"skill"');
      expect(restored.controller.getSnapshot().messages.at(-1)?.readingSource).toEqual(source);
    } finally { restored.controller.close(); }
  } finally { first.controller.close(); }
});
test('F70 TC6/7/8: new sources and explicit workflows end coaching; old quiz requests still work', async () => {
  const { controller, client } = setup();
  try {
    await controller.sendMessage(start()); client.finish(controller);
    await controller.sendMessage({ text: '請解釋這個新段落', context: other, readingSource: other });
    expect(client.lastTurn()).not.toContain('Active reading coach'); client.finish(controller);
    await controller.sendMessage({ text: '回到原本段落', context: source });
    expect(client.lastTurn()).not.toContain('Active reading coach'); client.finish(controller);
    await controller.sendMessage(start()); client.finish(controller);
    await controller.sendMessage({ text: '導讀', intent: 'readingGuide', context: source });
    expect(client.lastTurn()).not.toContain('Active reading coach'); client.finish(controller);
    await controller.startNewConversation();
    await controller.sendMessage({ text: '一般問題', context: source });
    expect(client.lastTurn()).not.toContain('Active reading coach');
    expect(composeCodexInput({ text: '舊測驗', intent: 'learningQuestionQuiz', context: source })).toContain('$design-learning-questions');
  } finally { controller.close(); }
});
test('F70 TC10: suppress answer suggestions even if the model accidentally emits one', () => {
  const messages: ChatMessage[] = [
    { id: 'u', turnId: 't', role: 'user', status: 'completed', ...start(), readingSource: source },
    { id: 'a', turnId: 't', role: 'assistant', status: 'completed', text: '請作答\n```reading-input-suggestion\n{"repeat":null,"followUp":"答案是新增額外能力。"}\n```' }
  ];
  expect(readingSuggestions(messages, source).followUp).toBe('');
});
test('F70 TC7: changing the source explicitly tells the model to stop the previous activity', async () => {
  const { controller, client } = setup();
  try {
    await controller.sendMessage(start()); client.finish(controller);
    await controller.sendMessage({ text: '這段怎麼理解？', context: other });
    expect(client.lastTurn()).toContain('Previous reading coach activity is inactive');
  } finally { controller.close(); }
});

test('F70 TC1/6: coach intent, full instructions and source survive disk persistence and export', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { LocalChatConversationStore } = await import('../src/main/chat-conversation-store');
  const { formatReadingConversation } = await import('../src/renderer/reading-conversation-export');
  const dir = mkdtempSync(join(tmpdir(), 'f70-store-'));
  const fixture = setup();
  try {
    await fixture.controller.sendMessage(start()); fixture.client.finish(fixture.controller);
    const store = new LocalChatConversationStore(dir); store.save(fixture.saved());
    const reloaded = new LocalChatConversationStore(dir).load();
    expect(reloaded.conversations[0]?.messages[0]?.intent).toBe('readingCoach');
    expect(reloaded.conversations[0]?.messages[0]?.text).toBe(start().text);
    const restored = setup(reloaded);
    try {
      await restored.controller.sendMessage({ text: '請給我提示' });
      expect(restored.client.lastTurn()).toContain('Active reading coach');
      expect(restored.controller.getSnapshot().messages.at(-1)?.readingSource).toEqual(source);
      restored.client.finish(restored.controller);
      expect(formatReadingConversation(restored.controller.getSnapshot())).toContain(start().text);
    } finally { restored.controller.close(); }
  } finally { fixture.controller.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('F70 TC1: book images remain visual turn inputs in coaching', async () => {
  const { composeCodexTurnInput } = await import('../src/main/chat-controller');
  const image = 'data:image/png;base64,aGVsbG8=';
  const items = composeCodexTurnInput({ ...start(), context: { ...source, images: [{ dataUrl: image }] } }, {});
  expect(items[1]).toEqual({ type: 'image', url: image });
  expect(items.some(item => item.type === 'skill')).toBe(false);
});

test('F71 TC5/6: quiz submission, hints and targeted guidance bind original source after segment changes and restart', async () => {
  const quiz = { version: 2, kind: 'quiz', quizId: 'qz', title: '小考', themes: [{ id:'t',title:'概念',summary:'獨立作答' }], questions:[{id:'q1',number:1,themeId:'t',level:'basic',prompt:'說明差別'}] };
  const result = {id:'q1',assessment:'needs-guidance',scores:{focus:{score:20,max:40,reason:'部分'},correctness:{score:10,max:30,reason:'混淆'},ownWords:{score:10,max:15,reason:'自行說明'},exampleOrExtension:{score:5,max:15,reason:'不足'}},total:45,feedback:'有嘗試',improvement:'辨認差別',revisedAnswer:'恢復不等於增強'};
  const grade = {version:2,kind:'grade',quizId:'qz',results:[result],summary:{average:45,strengths:[],nextSteps:['辨認差別'],encouragement:'繼續釐清'}};
  const fixture = setup();
  try {
    await fixture.controller.sendMessage({text:'小考',intent:'learningQuestionQuiz',context:source});
    fixture.client.finish(fixture.controller,'```learning-question-quiz\n'+JSON.stringify(quiz)+'\n```');
    await fixture.controller.sendMessage({text:'$hint-learning-question-quiz\nQuiz ID: qz\nQuestion ID: q1',context:other});
    expect(fixture.client.lastTurn()).toContain('Active independent quiz');
    expect(fixture.controller.getSnapshot().messages.at(-1)?.readingSource).toEqual(source);
    fixture.client.finish(fixture.controller,'比較恢復與額外能力。');
    await fixture.controller.sendMessage({text:'另一段',intent:'readingGuide',context:other});fixture.client.finish(fixture.controller);
    const restored=setup(fixture.saved());
    try {
      await restored.controller.sendMessage({text:'$submit-learning-question-quiz\nQuiz ID: qz\n\nq1 (Question 1):\n恢復就是增強'});
      expect(restored.client.lastTurn()).toContain('hinted');
      expect(restored.controller.getSnapshot().messages.at(-1)?.readingSource).toEqual(source);
      restored.client.finish(restored.controller,'```learning-question-grade\n'+JSON.stringify(grade)+'\n```');
      await restored.controller.sendMessage({text:'$guide-learning-question-quiz\nQuiz ID: qz\n針對錯題引導',context:other});
      expect(restored.client.lastTurn()).toContain('Active reading coach');
      expect(restored.client.lastTurn()).toContain('恢復就是增強');
      expect(restored.client.lastTurn()).toContain('辨認差別');
      expect(restored.controller.getSnapshot().messages.at(-1)?.intent).toBe('readingCoach');
      expect(restored.controller.getSnapshot().messages.at(-1)?.readingSource).toEqual(source);
      restored.client.finish(restored.controller);
      await restored.controller.sendMessage({text:'我再試一次',readingSource:source});
      expect(restored.client.lastTurn()).toContain('Active reading coach');
    } finally { restored.controller.close(); }
  } finally { fixture.controller.close(); }
});

test('F71 TC6: pre-source-snapshot legacy quiz can still be submitted without reinterpreting a new passage', async()=>{
 const quiz={version:1,kind:'quiz',quizId:'old',title:'歷史測驗',themes:[{id:'t',title:'概念',summary:'概念'}],questions:[{id:'a',number:1,themeId:'t',level:'basic',prompt:'是什麼'},{id:'b',number:2,themeId:'t',level:'relationship',prompt:'為什麼'},{id:'c',number:3,themeId:'core',level:'core',prompt:'如何用'}]};
 const f=setup();try{
  await f.controller.sendMessage({text:'歷史測驗',intent:'learningQuestionQuiz'});
  f.client.finish(f.controller,'```learning-question-quiz\n'+JSON.stringify(quiz)+'\n```');
  await expect(f.controller.sendMessage({text:'$submit-learning-question-quiz\nQuiz ID: old\n\na (Question 1):\n答案'})).resolves.toBeTruthy();
 }finally{f.controller.close();}
});
