/** Opt-in integration check: real authenticated Codex + synthetic audio, never a microphone. */
import { expect, test } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalChatConversationStore } from "../src/main/chat-conversation-store";
import { ChatController } from "../src/main/chat-controller";
import { SpawnedCodexAppServerClient } from "../src/main/codex-app-server-client";

test("F40 production controller sends scoped reading context and persists native voice discussion", async () => {
  const output = mkdtempSync(join(tmpdir(), "deep-reading-f40-"));
  const historyMode = !!process.env.VOICE_HISTORY_CONTEXT;
  const aiff = join(output, "question.aiff"), wav = join(output, "question.wav");
  execFileSync("say", ["-v", "Meijia", "-o", aiff, historyMode ? "之前討論琥珀門時，我在文字裡替這個規則取了什麼名字？我在上次語音裡說我容易忘記哪個顏色的拉桿？" : "根據目前的閱讀內容，琥珀門要怎麼打開？"], { timeout: 15000 });
  execFileSync("afconvert", [aiff, wav, "-f", "WAVE", "-d", "LEI16"], { timeout: 15000 });
  const electron = spawn(join(process.cwd(), "node_modules/.bin/electron"), [join(process.cwd(), "tests/probes/realtime-webrtc-peer.cjs")], { stdio: ["pipe", "pipe", "ignore"] });
  const errors: string[] = [];
  let offer = "", buffer = "", rtc: any;
  electron.stdout.on("data", chunk => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (line.startsWith("OFFER:")) offer = JSON.parse(line.slice(6));
      if (line.startsWith("STATE:")) rtc = JSON.parse(line.slice(6));
      if (line.startsWith("ANSWER_ERROR:")) errors.push(line);
    }
  });
  let client = new SpawnedCodexAppServerClient({ requestTimeoutMs: 45000 });
  const saved: unknown[] = [];
  const store = new LocalChatConversationStore(join(output, "conversations"));
  const createController = () => new ChatController({ createClient: () => client, workingDirectory: output,
    conversationStore: { load: () => store.load(), save: value => { store.save(value); saved.push(structuredClone(value)); } } });
  let controller = createController();
  const send = (message: unknown) => electron.stdin.write(JSON.stringify(message) + "\n");
  async function until(predicate: () => boolean, label: string, timeout = 45000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (errors.length) throw new Error(errors.join("\n"));
      if (controller.getSnapshot().voice?.phase === "error") throw new Error(controller.getSnapshot().voice?.error);
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      if (offer) send({ snapshot: true });
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  let report: Record<string, unknown> = { output, date: new Date().toISOString(), longContext: !!process.env.VOICE_LONG_CONTEXT, historyMode };
  try {
    await until(() => !!offer, "offer", 15000);
    expect((await controller.connect()).connection).toBe("ready");
    if (historyMode) {
      await controller.sendMessage({ text: "在我們的閱讀討論中，我把琥珀門的規則取名為『雙鑰匙』。請只回覆：記住了。" });
      await until(() => controller.getSnapshot().activeTurnId === null, "seed text discussion");
      controller.close();
      // Synthetic saved voice fixture, deliberately absent from the server thread.
      // A later typed checkpoint reproduces the old omission of older local voice messages.
      const restored = store.load();
      restored.conversations.find(c => c.id === restored.selectedConversationId)!.messages.push(
        { id: "voice-synthetic-earlier-1", turnId: null, role: "user", status: "completed", text: "我容易忘記綠色拉桿，常常只想到藍色。" },
        { id: "voice-synthetic-earlier-2", turnId: null, role: "assistant", status: "completed", text: "下次我們特別練習記得綠色拉桿。" },
        { id: "user-synthetic-later", turnId: "synthetic-checkpoint", role: "user", status: "completed", text: "下次繼續這個討論。" }
      );
      store.save(restored);
      client = new SpawnedCodexAppServerClient({ requestTimeoutMs: 45000 });
      controller = createController();
      expect((await controller.connect()).connection).toBe("ready");
      report.historyFixture = "Real typed naming turn, synthetic saved prior voice transcripts plus later text checkpoint, then fresh controller/client restored from LocalChatConversationStore.";
    }
    const startedAt = performance.now();
    const answer = await controller.startVoice({ sessionId: "production-voice-smoke", sdp: offer,
      context: { bookTitle: "Synthetic Gates", chapterTitle: "The amber gate", readingSegment: (process.env.VOICE_LONG_CONTEXT ? "A field diary describes many unrelated stone paths and quiet courtyards. ".repeat(600) : "") + "The amber gate opens only after BOTH the BLUE and GREEN levers are pulled. Either lever alone is insufficient." } });
    send({ sdp: answer.sdp });
    await until(() => rtc?.connectionState === "connected", "connected");
    report.startToConnectedMs = performance.now() - startedAt;
    send({ speech: readFileSync(wav).toString("base64") });
    await until(() => {
      const reply = controller.getSnapshot().messages.filter(m => m.role === "assistant" && m.id.startsWith("voice-production-voice-smoke-")).map(m => m.text).join(" ");
      return rtc?.peak > 0.0001 && (historyMode ? /雙鑰匙/.test(reply) && /綠|green/i.test(reply) : /藍|blue/i.test(reply) && /綠|green/i.test(reply));
    }, "native voice response");
    await until(() => controller.getSnapshot().messages.some(m => m.role === "assistant" && m.id.startsWith("voice-production-voice-smoke-") && m.status === "completed"), "final transcript", 15000);
    report.messages = controller.getSnapshot().messages;
    report.rtc = { peak: rtc.peak, timing: rtc.timing, connectionState: rtc.connectionState };
    await controller.stopVoice("production-voice-smoke");
    expect(controller.getSnapshot().voice?.phase).toBe("idle");
    expect(saved.length).toBeGreaterThan(0);
    report.persisted = true;
    report.stopped = true;
    await controller.sendMessage({ text: "我剛才透過語音問了你什麼問題？請用一句話回答。" });
    await until(() => controller.getSnapshot().activeTurnId === null, "text continuation", 45000);
    const continuation = controller.getSnapshot().messages.at(-1)!;
    report.textContinuation = continuation.text;
    expect(continuation.text).toMatch(/琥珀|amber/i);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await controller.stopVoice("production-voice-smoke").catch(() => {});
    const threadId = controller.getSnapshot().threadId;
    if (threadId) await client.request("thread/archive", { threadId }).catch(() => {});
    controller.close();
    electron.kill();
    writeFileSync(join(output, "report.json"), JSON.stringify({ ...report, errors, final: controller.getSnapshot() }, null, 2));
  }
}, 110000);
