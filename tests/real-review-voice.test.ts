/** Opt-in: authenticated service and synthetic speech only; never opens a microphone. */
import { test, expect } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReviewVoiceController } from "../src/main/review-voice-controller";
import { SpawnedCodexAppServerClient } from "../src/main/codex-app-server-client";
import { markdownToReadingNoteDocument } from "../src/shared/reading-note-document";
import { assessReview } from "../src/main/review-voice-assessment";

test.skipIf(!process.env.REAL_REVIEW_VOICE)("F42 real native voice and independent structured assessment on ephemeral threads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "deep-reading-f42-real-"));
  const synth = join(directory, "recall.aiff"), wav = join(directory, "recall.wav");
  execFileSync("say", ["-v", "Meijia", "-o", synth, "我看到圖片想到回饋延遲。如果我還沒等到先前調整的效果，就繼續加大調整，可能會矯正過頭。這就是筆記的核心意思嗎？"], { timeout: 15000 });
  execFileSync("afconvert", [synth, wav, "-f", "WAVE", "-d", "LEI16"], { timeout: 15000 });
  const electron = spawn(join(process.cwd(), "node_modules/.bin/electron"), [join(process.cwd(), "tests/probes/realtime-webrtc-peer.cjs")], { stdio: ["pipe", "pipe", "ignore"] });
  let buffer = "", offer = "", rtc: any, replyDone = false;
  const errors: string[] = [], threadStarts: any[] = [];
  electron.stdout.on("data", chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (line.startsWith("OFFER:")) offer = JSON.parse(line.slice(6));
      if (line.startsWith("STATE:")) rtc = JSON.parse(line.slice(6));
      if (line.startsWith("ANSWER_ERROR:")) errors.push(line);
    }
  });
  const clients: SpawnedCodexAppServerClient[] = [];
  function client() {
    const c = new SpawnedCodexAppServerClient({ requestTimeoutMs: 45000 }); clients.push(c);
    const request = c.request.bind(c);
    c.request = (method, params) => {
      if (method === "thread/start") threadStarts.push({ ephemeral: params?.ephemeral });
      return request(method, params);
    };
    c.onNotification(n => { const p = n.params as any; if (n.method === "thread/realtime/transcript/done" && p?.role === "assistant") replyDone = true; });
    return c;
  }
  const c = new ReviewVoiceController({ createClient: client, workingDirectory: directory,
    validateSource: () => ({ id: "synthetic", revision: 1, title: "Feedback delay", content: markdownToReadingNoteDocument("Feedback delay: repeatedly increasing a correction before earlier corrections take effect may cause overshoot. Wait for feedback before adjusting again."), bookTitle: "Synthetic systems", chapterTitle: "Delay", createdAt: 1, updatedAt: 1 } as any) });
  const send = (value: unknown) => electron.stdin.write(JSON.stringify(value) + "\n");
  async function until(predicate: () => boolean, label: string) {
    const deadline = Date.now() + 45000;
    while (!predicate()) {
      if (errors.length) throw new Error(errors.join("\n"));
      if (c.snapshot()?.voice.phase === "error") throw new Error(c.snapshot()?.voice.error);
      if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
      if (offer) send({ snapshot: true });
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  try {
    await until(() => !!offer, "offer");
    const result = await c.start({ sessionId: "f42-real-voice", sdp: offer, context: { discussionId: "f42-real-discussion", noteId: "synthetic", noteRevision: 1, scheduleVersion: 1 } });
    send({ sdp: result.sdp });
    await until(() => rtc?.connectionState === "connected", "connected");
    send({ speech: readFileSync(wav).toString("base64") });
    await until(() => replyDone && rtc?.peak > 0.0001 && !!c.snapshot()?.hasAnswer, "native answer");
    await c.stop("f42-real-voice");
    const assessment = await c.assess("f42-real-discussion");
    expect(assessment.suggestedRecall).not.toBeNull();
    expect(assessment.summary.length).toBeGreaterThan(0);
    expect(threadStarts.every(t => t.ephemeral === true)).toBe(true);
    const separate = await assessReview(client(), directory, {
      note: { title: "Two levers", content: "Both blue and green levers are required. Either lever alone cannot open the gate." },
      discussion: [
        { role: "user", text: "I cannot remember any of this." },
        { role: "assistant", text: "Both blue and green levers must be pulled together; neither alone works. Explain that in your own words." },
        { role: "user", text: "The two levers form an AND condition: I need both, so pulling just blue or just green cannot open the gate." }
      ], lockedInitial: null
    }, new AbortController().signal);
    expect(separate.suggestedRecall).toBe("again");
    expect(separate.suggestedUnderstanding).toBe("understood");
    const report = { date: new Date().toISOString(), syntheticAudioOnly: true, ephemeralThreadCount: threadStarts.length,
      nativeAudioReceived: rtc.peak > 0.0001, assessment, separate, transcriptPersistedByApp: false };
    mkdirSync("reports", { recursive: true });
    writeFileSync("reports/f42-voice-review-real.json", JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally { c.close(); clients.forEach(c => c.close()); electron.kill(); rmSync(directory, { recursive: true, force: true }); }
}, 180000);
