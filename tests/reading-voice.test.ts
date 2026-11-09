import { afterEach, expect, test, vi } from "vitest";
import type { StoredChatState } from "../src/main/chat-conversation-store";
import { ChatController } from "../src/main/chat-controller";
import type { CodexAppServerClient, CodexNotification } from "../src/main/codex-app-server-client";

const context = { bookTitle: "Systems", chapterTitle: "Gates", readingSegment: "Both BLUE and GREEN levers are required." };
const offer = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const answer = "v=0\r\nm=audio 10 UDP/TLS/RTP/SAVPF 111\r\n";
const controllers: ChatController[] = [];
afterEach(() => controllers.splice(0).forEach(c => c.close()));

class FakeClient implements CodexAppServerClient {
  listeners = new Set<(n: CodexNotification) => void>();
  exits = new Set<(e: Error) => void>();
  autoStart = true;
  initialize = vi.fn(async () => {});
  readAccount = vi.fn(async () => ({ account: { type: "chatgpt" }, requiresOpenaiAuth: false }));
  request = vi.fn(async (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    if (method === "thread/start" || method === "thread/resume") return { thread: { id: "reading-thread" } };
    if (method === "thread/realtime/start" && this.autoStart) queueMicrotask(() => {
      this.emit("thread/realtime/started", {});
      this.emit("thread/realtime/sdp", { sdp: answer });
    });
    if (method === "thread/realtime/stop") this.emit("thread/realtime/closed", { reason: "requested" });
    if (method === "turn/start") return { turn: { id: "text-turn" } };
    if (method === "model/list") return { data: [], nextCursor: null };
    return {};
  });
  onNotification(fn: (n: CodexNotification) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onExit(fn: (e: Error) => void) { this.exits.add(fn); return () => { this.exits.delete(fn); }; }
  close = vi.fn();
  emit(method: string, params: Record<string, unknown>) { this.listeners.forEach(fn => fn({ method, params: { threadId: "reading-thread", ...params } })); }
}
async function setup(stored?: StoredChatState) {
  const client = new FakeClient();
  const saved: StoredChatState[] = [];
  const controller = new ChatController({ createClient: () => client, workingDirectory: "/tmp/reading-voice-test",
    conversationStore: { load: () => stored ? structuredClone(stored) : ({ version: 1, selectedConversationId: null, conversations: [] }), save: state => { saved.push(structuredClone(state)); } } });
  controllers.push(controller);
  await controller.connect();
  expect(typeof (controller as any).startVoice).toBe("function");
  return { controller, client, saved };
}

test("F48: a rejected image turn does not leave a sent message in conversation history", async () => {
  const { controller, client, saved } = await setup();
  client.request.mockReset();
  client.request.mockImplementation(async (method) => {
    if (method === "turn/start") throw new Error("Offline");
    if (method === "thread/start") return { thread: { id: "reading-thread" } };
    return {};
  });
  await expect(controller.sendMessage({ text: "Explain this", images: [{ dataUrl: "data:image/png;base64,aGVsbG8=" }] })).rejects.toThrow("Offline");
  expect(controller.getSnapshot().messages).toEqual([]);
  expect(saved.at(-1)?.conversations[0]?.messages).toEqual([]);
});

test("F40 starts native WebRTC on a reading thread with explicit scoped context", async () => {
  const { controller, client } = await setup();
  const result = await controller.startVoice({ sessionId: "voice-1", sdp: offer, context });
  expect(result).toEqual({ sessionId: "voice-1", sdp: answer });
  const start = client.request.mock.calls.find(([method]) => method === "thread/realtime/start")![1]!;
  expect(start).toMatchObject({ threadId: "reading-thread", version: "v3", outputModality: "audio", transport: { type: "webrtc", sdp: offer }, includeStartupContext: true });
  expect(String(start.prompt)).toContain(context.readingSegment);
  expect(String(start.prompt)).toContain("Systems");
  expect(controller.getSnapshot().messages).toEqual([]);
  expect(controller.getSnapshot().voice?.phase).toBe("active");
});

test("F40 persists final transcripts once and isolates incomplete voice messages", async () => {
  const { controller, client, saved } = await setup();
  await controller.startVoice({ sessionId: "voice-1", sdp: offer, context });
  client.emit("thread/realtime/transcript/delta", { role: "user", delta: "Why " });
  client.emit("thread/realtime/transcript/delta", { role: "user", delta: "both?" });
  client.emit("thread/realtime/transcript/done", { role: "user", text: "Why both?" });
  client.emit("thread/realtime/transcript/delta", { role: "assistant", delta: "Both levers" });
  client.emit("thread/realtime/transcript/done", { role: "assistant", text: "Both levers are required." });
  client.emit("thread/realtime/transcript/delta", { role: "assistant", delta: "Unfinished" });
  await controller.stopVoice("voice-1");
  expect(controller.getSnapshot().messages.map(m => [m.role, m.text, m.status])).toEqual([
    ["user", "Why both?", "completed"], ["assistant", "Both levers are required.", "completed"], ["assistant", "Unfinished", "failed"]
  ]);
  expect(controller.getSnapshot().messages[0]?.readingSource).toEqual(context);
  expect(saved.length).toBeGreaterThan(0);
  expect(controller.getReadingNoteConversationContext()).not.toContain("Unfinished");
  client.emit("thread/realtime/transcript/done", { role: "user", text: "Stale event" });
  expect(controller.getSnapshot().messages).toHaveLength(3);
});

test("F40 prevents overlapping typed turns and conversation changes while voice is active", async () => {
  const { controller } = await setup();
  await controller.startVoice({ sessionId: "voice-1", sdp: offer, context });
  await expect(controller.sendMessage({ text: "Another question" })).rejects.toThrow(/語音|voice/i);
  expect(() => controller.startNewConversation()).toThrow(/語音|voice/i);
  await expect(controller.startVoice({ sessionId: "voice-2", sdp: offer, context })).rejects.toThrow();
  await controller.stopVoice("stale-session");
  expect(controller.getSnapshot().voice?.phase).toBe("active");
  await controller.stopVoice("voice-1");
  await controller.sendMessage({ text: "Continue in text" });
  expect(controller.getSnapshot().activeTurnId).toBe("text-turn");
});

test("F40 surfaces server errors and permits retry without stale session events", async () => {
  const { controller, client } = await setup();
  client.autoStart = false;
  const pending = controller.startVoice({ sessionId: "voice-1", sdp: offer, context });
  const failure = expect(pending).rejects.toThrow(/denied/);
  await vi.waitFor(() => expect(client.request.mock.calls.some(([m]) => m === "thread/realtime/start")).toBe(true));
  client.emit("thread/realtime/error", { message: "Voice access denied" });
  await failure;
  expect(controller.getSnapshot().voice?.phase).toBe("error");
  client.autoStart = true;
  await controller.startVoice({ sessionId: "voice-2", sdp: offer, context });
  expect(controller.getSnapshot().voice?.sessionId).toBe("voice-2");
});

test("F40 ending during startup cancels the pending answer and stops the server", async () => {
  const { controller, client } = await setup();
  client.autoStart = false;
  const pending = controller.startVoice({ sessionId: "voice-1", sdp: offer, context });
  const cancelled = expect(pending).rejects.toThrow(/取消|結束|cancel/i);
  await vi.waitFor(() => expect(client.request.mock.calls.some(([m]) => m === "thread/realtime/start")).toBe(true));
  await controller.stopVoice("voice-1");
  await cancelled;
  client.emit("thread/realtime/sdp", { sdp: answer });
  expect(controller.getSnapshot().voice?.phase).toBe("idle");
  expect(client.request.mock.calls.some(([m]) => m === "thread/realtime/stop")).toBe(true);
});

test("F40 cancelled thread preparation cannot activate a late conversation", async () => {
  const { controller, client } = await setup();
  const original = client.request.getMockImplementation()!;
  let resolveThread!: (value: unknown) => void;
  client.request.mockImplementation((method, params) => method === "thread/start"
    ? new Promise(resolve => { resolveThread = resolve; }) : original(method, params));
  const pending = controller.startVoice({ sessionId: "voice-preparing", sdp: offer, context });
  const cancelled = expect(pending).rejects.toThrow(/取消/);
  const stopping = controller.stopVoice("voice-preparing");
  expect(() => controller.startNewConversation()).toThrow();
  resolveThread({ thread: { id: "late-thread" } });
  await stopping;
  await cancelled;
  expect(controller.getSnapshot().threadId).toBeNull();
  expect(client.request.mock.calls.some(([m]) => m === "thread/realtime/start")).toBe(false);
  expect(client.request).toHaveBeenCalledWith("thread/archive", { threadId: "late-thread" });
});

test("F40 serializes server stop after a late start acknowledgement", async () => {
  const { controller, client } = await setup();
  const original = client.request.getMockImplementation()!;
  let acknowledge!: (value: unknown) => void;
  client.request.mockImplementation((method, params) => method === "thread/realtime/start"
    ? new Promise(resolve => { acknowledge = resolve; }) : original(method, params));
  const pending = controller.startVoice({ sessionId: "voice-starting", sdp: offer, context });
  const cancelled = expect(pending).rejects.toThrow(/取消|結束/);
  await vi.waitFor(() => expect(acknowledge).toBeTypeOf("function"));
  const stopping = controller.stopVoice("voice-starting");
  expect(client.request.mock.calls.some(([m]) => m === "thread/realtime/stop")).toBe(false);
  acknowledge({});
  await stopping;
  await cancelled;
  expect(client.request).toHaveBeenCalledWith("thread/realtime/stop", { threadId: "reading-thread" });
});

test("F40 long marked passages are sent intact without the initialItems 8192-token ceiling", async () => {
  const { controller, client } = await setup();
  const readingSegment = "Long passage reference paragraph. ".repeat(2000) + "END MARKER: both BLUE and GREEN.";
  await controller.startVoice({ sessionId: "voice-long", sdp: offer, context: { ...context, readingSegment } });
  const start = client.request.mock.calls.find(([m]) => m === "thread/realtime/start")![1]!;
  expect(start.prompt).toContain(readingSegment);
  expect(start.initialItems).toBeUndefined();
});

test("F40 carries completed voice discussion into the next voice session and text turn", async () => {
  const { controller, client } = await setup();
  await controller.startVoice({ sessionId: "voice-first", sdp: offer, context });
  client.emit("thread/realtime/transcript/done", { role: "user", text: "Why do both levers matter?" });
  client.emit("thread/realtime/transcript/done", { role: "assistant", text: "One lever alone will not open the gate." });
  client.emit("thread/realtime/transcript/delta", { role: "user", delta: "Incomplete question" });
  await controller.stopVoice("voice-first");
  await controller.startVoice({ sessionId: "voice-second", sdp: offer, context });
  const second = client.request.mock.calls.filter(([m]) => m === "thread/realtime/start").at(-1)![1]!;
  expect(second.prompt).toContain("Why do both levers matter?");
  expect(second.prompt).not.toContain("Incomplete question");
  await controller.stopVoice("voice-second");
  await controller.sendMessage({ text: "What did I just ask aloud?" });
  const typed = client.request.mock.calls.filter(([m]) => m === "turn/start").at(-1)![1]!;
  expect(JSON.stringify(typed.input)).toContain("Why do both levers matter?");
  expect(JSON.stringify(typed.input)).not.toContain("Incomplete question");
  client.emit("turn/completed", { turn: { id: "text-turn", status: "completed" } });
  await controller.sendMessage({ text: "Continue" });
  const nextTyped = client.request.mock.calls.filter(([m]) => m === "turn/start").at(-1)![1]!;
  expect(JSON.stringify(nextTyped.input)).not.toContain("Earlier completed voice discussion");
});

test("F40 blocks voice while a typed turn is preparing its thread", async () => {
  const { controller, client } = await setup();
  const original = client.request.getMockImplementation()!;
  let resolveThread!: (value: unknown) => void;
  client.request.mockImplementation((method, params) => method === "thread/start"
    ? new Promise(resolve => { resolveThread = resolve; }) : original(method, params));
  const pending = controller.sendMessage({ text: "Prepare text thread" });
  await expect(controller.startVoice({ sessionId: "voice-race", sdp: offer, context })).rejects.toThrow();
  resolveThread({ thread: { id: "reading-thread" } });
  await pending;
});

test("B48 voice explicitly includes typed and older voice discussion after a text checkpoint", async () => {
  const { controller, client, saved } = await setup();
  await controller.sendMessage({ text: "I call it the two-key rule.", quote: { text: "Both levers are required." } });
  client.emit("item/completed", { turnId: "text-turn", item: { type: "agentMessage", id: "typed-rule", text: "Two keys prevent accidental opening.\n```learning-question-quiz\n{\"internalSecret\":true}\n```" } });
  client.emit("turn/completed", { turn: { id: "text-turn", status: "completed" } });
  await controller.startVoice({ sessionId: "voice-history-first", sdp: offer, context });
  client.emit("thread/realtime/transcript/done", { role: "user", text: "I often forget the GREEN lever." });
  client.emit("thread/realtime/transcript/done", { role: "assistant", text: "Remember green as well as blue." });
  client.emit("thread/realtime/transcript/delta", { role: "assistant", delta: "Unfinished thought" });
  await controller.stopVoice("voice-history-first");
  await controller.sendMessage({ text: "Continue our discussion next time." });
  client.emit("turn/completed", { turn: { id: "text-turn", status: "completed" } });
  const stored = structuredClone(saved.at(-1)!);
  for (const session of [await setup(stored), { controller, client }]) {
    await session.controller.startVoice({ sessionId: "voice-history-again", sdp: offer, context });
    const start = session.client.request.mock.calls.filter(([m]) => m === "thread/realtime/start").at(-1)![1]!;
    const prompt = String(start.prompt);
    const expected = ["I call it the two-key rule.", "Two keys prevent accidental opening.", "I often forget the GREEN lever.", "Remember green as well as blue.", "Continue our discussion next time."];
    expect(expected.every(text => prompt.includes(text))).toBe(true);
    expect(expected.map(text => prompt.indexOf(text))).toEqual(expected.map(text => prompt.indexOf(text)).sort((a,b)=>a-b));
    expect(prompt).toContain("User quote:\nBoth levers are required.");
    expect(prompt).not.toContain("internalSecret");
    expect(prompt).not.toContain("Unfinished thought");
    await session.controller.stopVoice("voice-history-again");
  }
});

test("B48 only the selected reading conversation supplies voice history", async () => {
  const state: StoredChatState = { version: 1, selectedConversationId: "one", conversations: [
    { id: "one", threadId: "reading-thread", title: "First", createdAt: 1, updatedAt: 1, source: null, messages: [
      { id: "user-one", turnId: "turn-one", role: "user", status: "completed", text: "MY FIRST DISCUSSION" },
      { id: "failed-one", turnId: "turn-one", role: "assistant", status: "failed", text: "FAILED DISCUSSION" },
      { id: "stream-one", turnId: "turn-one", role: "assistant", status: "streaming", text: "PENDING DISCUSSION" }
    ] },
    { id: "two", threadId: "reading-thread", title: "Second", createdAt: 2, updatedAt: 2, source: null, messages: [
      { id: "voice-other-1", turnId: null, role: "user", status: "completed", text: "MY OTHER DISCUSSION" }
    ] }
  ] };
  const { controller, client } = await setup(state);
  await controller.startVoice({ sessionId: "selected-one", sdp: offer, context });
  const lastPrompt = () => String(client.request.mock.calls.filter(([m]) => m === "thread/realtime/start").at(-1)![1]!.prompt);
  expect(lastPrompt()).toContain("MY FIRST DISCUSSION");
  expect(lastPrompt()).not.toMatch(/MY OTHER|FAILED DISCUSSION|PENDING DISCUSSION/);
  await controller.stopVoice("selected-one");
  controller.selectConversation("two");
  await controller.startVoice({ sessionId: "selected-two", sdp: offer, context });
  expect(lastPrompt()).toContain("MY OTHER DISCUSSION");
  expect(lastPrompt()).not.toContain("MY FIRST DISCUSSION");
  await controller.stopVoice("selected-two");
  controller.startNewConversation();
  await controller.startVoice({ sessionId: "selected-new", sdp: offer, context });
  expect(lastPrompt()).not.toMatch(/MY OTHER DISCUSSION|MY FIRST DISCUSSION/);
});
