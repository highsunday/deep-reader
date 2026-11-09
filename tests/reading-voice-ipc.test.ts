import { expect, test, vi } from "vitest";
import { registerReadingVoiceIpc } from "../src/main/reading-voice-ipc";

test("F40 voice IPC validates sender, scoped context and signaling without arbitrary RPC access", async () => {
  const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
  const chat = { startVoice: vi.fn(), stopVoice: vi.fn() };
  registerReadingVoiceIpc({ handle: (key, fn) => handlers.set(key, fn) }, chat, event => event === "main-frame");
  const start = handlers.get("reading-voice:start")!;
  const stop = handlers.get("reading-voice:stop")!;
  const valid = { sessionId: "voice-1", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n", context: { bookTitle: "Book", chapterTitle: "Chapter", readingSegment: "Only the marked passage." } };
  expect(() => start("subframe", valid)).toThrow(/Untrusted/);
  expect(() => stop("subframe", "voice-1")).toThrow(/Untrusted/);
  for (const bad of [null, { ...valid, method: "turn/start" }, { ...valid, sdp: "a".repeat(64001) },
    { ...valid, context: { ...valid.context, readingSegment: " " } }]) {
    expect(() => start("main-frame", bad)).toThrow();
  }
  expect(chat.startVoice).not.toHaveBeenCalled();
  start("main-frame", valid);
  expect(chat.startVoice).toHaveBeenCalledWith(valid);
  expect(() => stop("main-frame", { sessionId: "voice-1" })).toThrow();
  stop("main-frame", "voice-1");
  expect(chat.stopVoice).toHaveBeenCalledWith("voice-1");
});
