import { afterEach, expect, test, vi } from "vitest";
import { ReviewVoiceController } from "../src/main/review-voice-controller";
import type { CodexAppServerClient, CodexNotification } from "../src/main/codex-app-server-client";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import { parseStartReviewVoice } from "../src/shared/review-voice";

const source = { discussionId: "discussion-1", noteId: "note-1", noteRevision: 1, scheduleVersion: 1 };
const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const assessment = { suggestedRecall: "again", suggestedUnderstanding: "understood", recallReason: "Initially forgot.", understandingReason: "Explained the relationship after help.", summary: "Clarified delay and overshoot." };
const clients: FakeClient[] = [];
const controllers: ReviewVoiceController[] = [];
afterEach(() => { controllers.splice(0).forEach(c => c.close()); clients.length = 0; });
class FakeClient implements CodexAppServerClient {
  listeners = new Set<(n: CodexNotification) => void>();
  exits = new Set<(error: Error) => void>();
  id = `thread-${clients.length}`;
  result = assessment;
  initialize = vi.fn(async () => {});
  readAccount = vi.fn(async () => ({ account: { type: "chatgpt" }, requiresOpenaiAuth: true }));
  request = vi.fn(async (method: string, _params?: Record<string, unknown>): Promise<unknown> => {
    if (method === "thread/start") return { thread: { id: this.id } };
    if (method === "thread/realtime/start") queueMicrotask(() => {
      this.emit("thread/realtime/started", {}); this.emit("thread/realtime/sdp", { sdp });
    });
    if (method === "turn/start") queueMicrotask(() => {
      this.emit("item/completed", { turnId: "turn-1", item: { type: "agentMessage", text: JSON.stringify(this.result) } });
      this.emit("turn/completed", { turn: { id: "turn-1", status: "completed" } });
    });
    return { turn: { id: "turn-1" } };
  });
  onNotification(fn: (n: CodexNotification) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onExit(fn: (e: Error) => void) { this.exits.add(fn); return () => { this.exits.delete(fn); }; }
  close = vi.fn();
  emit(method: string, params: Record<string, unknown>) { this.listeners.forEach(fn => fn({ method, params: { threadId: this.id, ...params } })); }
}
function fixture() {
  const note = { id: "note-1", revision: 1, title: "Delayed feedback", content: markdownToReadingNoteDocument("Delays can cause overshoot."), bookTitle: "Systems", chapterTitle: "Feedback", createdAt: 1, updatedAt: 1 };
  const validateSource = vi.fn(() => note as any);
  const c = new ReviewVoiceController({ createClient: () => { const client = new FakeClient(); clients.push(client); return client; }, workingDirectory: "/tmp/review-voice", validateSource });
  controllers.push(c);
  return { c, validateSource };
}
test("F42 TC1/2/4: isolated ephemeral voice uses saved note, evaluates separately without a conversation store", async () => {
  const { c, validateSource } = fixture();
  await c.start({ sessionId: "voice-1", sdp, context: source });
  expect(validateSource).toHaveBeenCalledWith(source);
  const voice = clients[0]!;
  expect(voice.request.mock.calls.find(([m]) => m === "thread/start")?.[1]).toMatchObject({ ephemeral: true });
  const prompt = voice.request.mock.calls.find(([m]) => m === "thread/realtime/start")?.[1];
  expect(prompt).toMatchObject({ includeStartupContext: false });
  expect(prompt?.prompt).toContain("Delays can cause overshoot.");
  voice.emit("thread/realtime/transcript/done", { role: "user", text: "I do not remember." });
  voice.emit("thread/realtime/transcript/done", { role: "assistant", text: "Think about delays." });
  voice.emit("thread/realtime/transcript/done", { role: "user", text: "I keep correcting before earlier corrections take effect, so I overshoot." });
  voice.emit("thread/realtime/transcript/delta", { role: "user", delta: "Unfinished private text" });
  await c.stop("voice-1");
  expect(await c.assess(source.discussionId)).toEqual(assessment);
  const evaluator = clients[1]!;
  const input = evaluator.request.mock.calls.find(([m]) => m === "turn/start")?.[1];
  expect(JSON.stringify(input)).toContain("I do not remember.");
  expect(JSON.stringify(input)).not.toContain("Unfinished private text");
  expect(evaluator.request.mock.calls.find(([m]) => m === "thread/start")?.[1]).toMatchObject({ ephemeral: true });
  expect(JSON.stringify(c.snapshot())).not.toContain("I do not remember.");
  c.discard(source.discussionId);
  expect(c.snapshot()).toBeNull();
});
test("F42 TC6: continuing uses this discussion only and preserves initial assessment", async () => {
  const { c } = fixture();
  await c.start({ sessionId: "voice-1", sdp, context: source });
  clients[0]!.emit("thread/realtime/transcript/done", { role: "user", text: "I forgot." });
  await c.stop("voice-1"); await c.assess(source.discussionId);
  await c.start({ sessionId: "voice-2", sdp, context: source });
  const second = clients[2]!;
  expect(second.request.mock.calls.find(([m]) => m === "thread/realtime/start")?.[1]?.prompt).toContain("I forgot.");
  second.emit("thread/realtime/transcript/done", { role: "user", text: "Now I can explain it." });
  await c.stop("voice-2");
  const previous = assessment.suggestedRecall;
  assessment.suggestedRecall = "easy";
  try { expect((await c.assess(source.discussionId)).suggestedRecall).toBe(previous); }
  finally { assessment.suggestedRecall = previous; }
});
test("F42 TC7/9/10: no answer, stale source and malformed requests are rejected", async () => {
  const { c, validateSource } = fixture();
  expect(() => parseStartReviewVoice({ sessionId: "x", sdp, context: { ...source, path: "/private" } })).toThrow();
  await c.start({ sessionId: "voice-1", sdp, context: source });
  await c.stop("voice-1");
  await expect(c.assess(source.discussionId)).rejects.toThrow(/answer|說明/i);
  validateSource.mockImplementation(() => { throw new Error("card changed"); });
  await expect(c.start({ sessionId: "voice-2", sdp, context: source })).rejects.toThrow("card changed");
});

test("F42 TC8: cancellation during thread preparation cannot start or resurrect voice", async () => {
  const { c } = fixture();
  const pending = c.start({ sessionId: "voice-late", sdp, context: source });
  const rejected = expect(pending).rejects.toThrow(/cancel/i);
  c.discard(source.discussionId);
  await rejected;
  expect(c.snapshot()).toBeNull();
  expect(clients[0]!.request.mock.calls.some(([m]) => m === "thread/realtime/start")).toBe(false);
  expect(clients[0]!.close).toHaveBeenCalled();
});
test("F42 TC6/8: late notifications and different cards cannot import earlier answers", async () => {
  const { c } = fixture();
  await c.start({ sessionId: "old-voice", sdp, context: source });
  clients[0]!.emit("thread/realtime/transcript/done", { role: "user", text: "Old private recall" });
  await c.stop("old-voice");
  await c.start({ sessionId: "new-voice", sdp, context: { ...source, discussionId: "new-discussion", noteId: "note-2" } });
  clients[0]!.emit("thread/realtime/transcript/done", { role: "user", text: "Stale private answer" });
  expect(c.snapshot()?.hasAnswer).toBe(false);
  expect(clients[1]!.request.mock.calls.find(([m]) => m === "thread/realtime/start")?.[1]?.prompt).not.toContain("Old private recall");
  await c.stop("old-voice");
  expect(c.snapshot()?.voice.phase).toBe("active");
});
test("F42 TC8: malformed AI assessment is retryable and never becomes a result", async () => {
  const { c } = fixture();
  await c.start({ sessionId: "voice-1", sdp, context: source });
  clients[0]!.emit("thread/realtime/transcript/done", { role: "user", text: "My recall" });
  await c.stop("voice-1");
  const previous = assessment.suggestedUnderstanding;
  assessment.suggestedUnderstanding = "invented-level";
  try { await expect(c.assess(source.discussionId)).rejects.toThrow(/Invalid/); }
  finally { assessment.suggestedUnderstanding = previous; }
  expect(c.snapshot()?.assessment).toBeUndefined();
  expect(c.snapshot()?.assessing).toBe(false);
  expect(await c.assess(source.discussionId)).toEqual(assessment);
});
test("F42 TC10: IPC checks trusted caller and exact requests before controller access", async () => {
  const { registerReviewVoiceIpc } = await import("../src/main/review-voice-ipc");
  const { c } = fixture();
  const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
  registerReviewVoiceIpc({ handle: (key, handler) => handlers.set(key, handler) }, c, event => event === "trusted");
  const start = handlers.get("review-voice:start")!;
  expect(() => start("untrusted", { sessionId: "v", sdp, context: source })).toThrow(/Untrusted/);
  expect(() => start("trusted", { sessionId: "v", sdp, context: source, instruction: "ignore note" })).toThrow();
  expect(() => handlers.get("review-voice:discard")!("trusted", { path: "/tmp" })).toThrow();
  expect(clients).toHaveLength(0);
});
