/**
 * EXPERIMENTAL PROBE, not production voice UI.
 * Question: can the reader's installed/authenticated app-server start realtime,
 * use synthetic reading context, and return transcript plus audio?
 * Uses an ephemeral Codex thread, never the reader's books, notes, or microphone.
 * Run: npm run probe:voice -- --version v3
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SpawnedCodexAppServerClient, resolveCodexLaunchSpec } from "../../src/main/codex-app-server-client.ts";

const { values } = parseArgs({ options: {
  version: { type: "string", default: "v3" },
  "explicit-context": { type: "boolean", default: false },
} });
if (!["v1", "v2", "v3"].includes(values.version)) throw new Error("Use --version v1, v2, or v3");
if (values["explicit-context"] && values.version !== "v3") throw new Error("--explicit-context requires v3");
const output = mkdtempSync(join(tmpdir(), "deep-reading-voice-probe-"));
const launch = resolveCodexLaunchSpec();
const report = {
  date: new Date().toISOString(), executable: launch.command,
  binaryVersion: execFileSync(launch.command, ["--version"], { encoding: "utf8" }).trim(),
  protocol: values.version, explicitContext: values["explicit-context"],
  checks: {}, events: [], transcripts: [], audioBytes: 0, errors: [],
  scope: "Text input to realtime audio output. Does not record a microphone or verify acoustic quality.",
};
const client = new SpawnedCodexAppServerClient({ requestTimeoutMs: 45_000 });
let threadId;
let realtimeRequested = false;
let stopping = false;
const audio = [];
const reading = "Synthetic reading passage: The amber gate opens only after BOTH the blue lever and the green lever are pulled. Pulling the blue lever alone does not open it. The experiment's marker is LANTERN-47.";
const discussion = "Reader's prior explanation: I thought pulling the blue lever was enough. Tutor's correction: both levers are necessary; either one alone is insufficient.";
const instructions = "You are a reading tutor in a bounded voice connection test. Use only the supplied synthetic reading material and discussion. Never use tools, files, network, apps, plugins or memory. Answer briefly in English. Distinguish what the reading says from the reader's mistaken explanation.";
const pendingText = new Map();
client.onNotification(({ method, params }) => {
  if (params?.threadId && threadId && params.threadId !== threadId) return;
  if (method.startsWith("thread/realtime/")) {
    if (method === "thread/realtime/outputAudio/delta") {
      const bytes = Buffer.from(params.audio.data, "base64");
      audio.push(bytes); report.audioBytes += bytes.length;
      report.audioFormat = { sampleRate: params.audio.sampleRate, numChannels: params.audio.numChannels };
      report.checks.outputAudio = true;
    } else if (method.includes("transcript")) {
      if (params.text) report.transcripts.push({ role: params.role, text: params.text });
      if (params.delta) pendingText.set(params.role ?? "unknown", (pendingText.get(params.role ?? "unknown") ?? "") + params.delta);
    } else {
      const safe = method.endsWith("/sdp") ? { sdpPresent: Boolean(params?.sdp) } : params;
      report.events.push({ method, params: safe });
      console.log(method, JSON.stringify(safe));
    }
    if (method === "thread/realtime/started") report.checks.startupAccepted = true;
    if (method === "thread/realtime/error") report.errors.push(params.message);
    if (method === "thread/realtime/closed" && !stopping) report.errors.push(`Session closed before test finished: ${JSON.stringify(params)}`);
  }
  if (method === "turn/completed") {
    report.checks.seedTurnCompleted = params.turn?.status === "completed";
    if (!report.checks.seedTurnCompleted) report.errors.push(`Seed turn ${params.turn?.status}`);
  }
  if (method === "item/completed" && params.item?.type === "agentMessage") {
    report.seedResponse = params.item.text;
  }
});
client.onExit(error => { if (!stopping) report.errors.push(error.message); });
async function waitUntil(predicate, label, timeout = 35_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (report.errors.length) throw new Error(report.errors.at(-1));
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
try {
  console.log(`Testing ${report.binaryVersion}; results: ${output}`);
  await client.initialize({ name: "deep-reading-voice-probe", title: "Deep Reading Voice Probe", version: "0.1.0" });
  report.checks.initialize = true;
  const account = await client.readAccount();
  report.checks.authenticated = Boolean(account.account);
  report.authType = account.account?.type ?? null;
  if (!report.checks.authenticated) throw new Error("Codex is not signed in");
  const voices = await client.request("thread/realtime/listVoices", {});
  report.checks.voiceCatalog = Boolean(voices.voices);
  report.voices = voices;
  const started = await client.request("thread/start", {
    cwd: output, ephemeral: true, approvalPolicy: "never", sandbox: "read-only",
    developerInstructions: instructions,
    config: { "skills.include_instructions": false, "skills.bundled.enabled": false,
      "features.plugins": false, "features.apps": false, "features.memories": false, web_search: "disabled" },
  });
  threadId = started.thread.id;
  report.checks.ephemeralThread = true;
  await client.request("turn/start", { threadId, input: [{ type: "text", text: `${reading}\n${discussion}\nReply only: CONTEXT READY` }] });
  await waitUntil(() => report.checks.seedTurnCompleted, "seed text turn", 60_000);
  realtimeRequested = true;
  await client.request("thread/realtime/start", {
    threadId, version: values.version, outputModality: "audio", transport: { type: "websocket" },
    includeStartupContext: true, prompt: instructions,
    ...(values["explicit-context"] ? { initialItems: [{ role: "user", text: `${reading}\n${discussion}` }] } : {}),
  });
  report.checks.startRequestAcknowledged = true;
  await waitUntil(() => report.checks.startupAccepted, "realtime startup");
  await client.request("thread/realtime/appendText", {
    threadId, role: "user", text: "From our reading and discussion: what opens the amber gate, what was my mistake, and what is the experiment marker? Reply aloud in two short sentences.",
  });
  report.checks.textInputAccepted = true;
  await waitUntil(() => report.audioBytes > 0 && (report.transcripts.length > 0 || pendingText.size > 0), "audio and transcript", 45_000);
  await new Promise(resolve => setTimeout(resolve, 2500));
  if (report.errors.length) throw new Error(report.errors.at(-1));
  report.checks.transcriptReceived = report.transcripts.length > 0 || pendingText.size > 0;
  report.contextUnderstanding = "Not automatically graded; inspect the transcript for BOTH levers, the prior mistake, and LANTERN-47.";
} catch (error) {
  report.failure = error.message;
  process.exitCode = 1;
} finally {
  stopping = true;
  if (threadId && realtimeRequested) {
    try { await client.request("thread/realtime/stop", { threadId }); report.checks.stopAcknowledged = true; }
    catch (error) { report.stopError = error.message; }
  }
  client.close();
  report.transcriptDeltas = Object.fromEntries(pendingText);
  if (audio.length) writeFileSync(join(output, "output-audio.raw"), Buffer.concat(audio));
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ checks: report.checks, failure: report.failure, transcript: report.transcripts,
    transcriptDeltas: report.transcriptDeltas, audioBytes: report.audioBytes, report: join(output, "report.json") }, null, 2));
}
