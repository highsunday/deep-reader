import type { ChatMessage, ReadingNote } from "../shared/contracts";
import { readingNoteDocumentToMarkdown } from "../shared/reading-note-document";
import { parseStartReviewVoice, record, type ReviewVoiceContext, type ReviewVoiceSnapshot, type StartReviewVoiceInput, type VoiceReviewAssessment } from "../shared/review-voice";
import type { CodexAppServerClient } from "./codex-app-server-client";
import { ReadingVoiceSession } from "./reading-voice-session";
import { assessReview, ephemeralReviewThread, reviewVoiceInstructions } from "./review-voice-assessment";

interface Discussion {
  context: ReviewVoiceContext;
  note: { title: string; content: string };
  messages: ChatMessage[];
  voice?: ReadingVoiceSession;
  client?: CodexAppServerClient;
  assessment?: VoiceReviewAssessment;
  abort?: AbortController;
  error?: string;
}
export class ReviewVoiceController {
  #active?: Discussion;
  constructor(private options: {
    createClient(): CodexAppServerClient;
    workingDirectory: string;
    validateSource(context: ReviewVoiceContext): ReadingNote;
    onChanged?(snapshot: ReviewVoiceSnapshot): void;
    canStart?(): boolean;
  }) {}
  snapshot(): ReviewVoiceSnapshot | null {
    const a = this.#active;
    return a ? { discussionId: a.context.discussionId, voice: a.voice?.state ?? { phase: "idle", sessionId: null },
      assessing: !!a.abort, hasAnswer: a.messages.some(m => m.role === "user" && m.status === "completed"),
      ...(a.assessment ? { assessment: { ...a.assessment } } : {}), ...(a.error ? { error: a.error } : {}) } : null;
  }
  get busy() { return !!this.#active?.voice?.busy; }
  #emit(a: Discussion) { const snapshot = this.snapshot(); if (this.#active === a && snapshot) this.options.onChanged?.(snapshot); }
  #require(id: string) {
    if (!this.#active || this.#active.context.discussionId !== id) throw new Error("Voice review session has expired.");
    return this.#active;
  }
  async start(raw: StartReviewVoiceInput) {
    const input = parseStartReviewVoice(raw);
    if (this.busy || this.#active?.abort || this.options.canStart?.() === false) throw new Error("Finish the current voice session first.");
    const note = this.options.validateSource(input.context);
    let a = this.#active;
    if (a && JSON.stringify(a.context) !== JSON.stringify(input.context)) {
      this.discard(a.context.discussionId); a = undefined;
    }
    if (!a) {
      a = { context: { ...input.context }, note: { title: note.title, content: readingNoteDocumentToMarkdown(note.content) }, messages: [] };
      this.#active = a;
    }
    const active = a;
    active.error = undefined;
    active.voice?.dispose(); active.client?.close();
    active.voice = new ReadingVoiceSession({
      prepare: async (_input, isCurrent) => {
        const client = this.options.createClient(); active.client = client;
        await client.initialize({ name: "deep-reading-voice-review", title: "Deep Reading Voice Review", version: "0.1.0" });
        if (!isCurrent()) { client.close(); throw new Error("Voice review cancelled."); }
        const account = await client.readAccount();
        if (!account.account) throw new Error("Connect Codex in the reader before starting voice review.");
        const thread = await client.request("thread/start", ephemeralReviewThread(this.options.workingDirectory, reviewVoiceInstructions));
        if (!isCurrent()) { client.close(); throw new Error("Voice review cancelled."); }
        if (!record(thread) || !record(thread.thread) || typeof thread.thread.id !== "string") throw new Error("Unable to prepare voice review.");
        return { client, threadId: thread.thread.id, includeStartupContext: false,
          prompt: reviewVoiceInstructions + "\n\nUntrusted saved note and earlier completed discussion from THIS review only:\n" + JSON.stringify({ note: active.note,
            discussion: active.messages.filter(m => m.status === "completed").map(m => ({ role: m.role, text: m.text })),
            initialAssessment: active.assessment ? { rating: active.assessment.suggestedRecall, reason: active.assessment.recallReason } : null }) };
      },
      changed: () => this.#emit(active),
      transcript: message => {
        if (this.#active !== active) return;
        const previous = active.messages.find(m => m.id === message.id);
        if (previous) Object.assign(previous, message); else active.messages.push(message);
        this.#emit(active);
      }
    });
    // Signaling reuses the bounded reading voice engine; only this server-owned note
    // reaches the custom prompt. No renderer-provided reading context is accepted.
    try {
      return await active.voice.start({ sessionId: input.sessionId, sdp: input.sdp,
        context: { bookTitle: note.bookTitle || "Saved note", chapterTitle: note.chapterTitle || "Saved note", readingSegment: active.note.content || active.note.title } });
    } catch (error) { active.client?.close(); throw error; }
  }
  async stop(sessionId: string) {
    const a = this.#active;
    if (!a || a.voice?.state.sessionId !== sessionId) return;
    await a.voice.stop(sessionId);
    a.client?.close(); a.client = undefined;
    // Discard interrupted partials; they are neither reliable answers nor persisted history.
    a.messages = a.messages.filter(m => m.status === "completed");
    this.#emit(a);
  }
  async assess(discussionId: string): Promise<VoiceReviewAssessment> {
    const a = this.#require(discussionId);
    if (a.voice?.busy || a.abort) throw new Error("End voice before assessing the discussion.");
    this.options.validateSource(a.context);
    const messages = a.messages.filter(m => m.status === "completed");
    if (!messages.some(m => m.role === "user")) throw new Error("Give your own answer before asking AI to assess it.");
    const abort = new AbortController(); a.abort = abort; a.error = undefined; this.#emit(a);
    try {
      const result = await assessReview(this.options.createClient(), this.options.workingDirectory,
        { note: a.note, discussion: messages.map(m => ({ role: m.role, text: m.text })),
          lockedInitial: a.assessment ? { rating: a.assessment.suggestedRecall, reason: a.assessment.recallReason } : null }, abort.signal);
      if (this.#active !== a || abort.signal.aborted) throw new Error("Voice review session has expired.");
      this.options.validateSource(a.context);
      a.assessment = { ...result, ...(a.assessment ? { suggestedRecall: a.assessment.suggestedRecall, recallReason: a.assessment.recallReason } : {}) };
      return { ...a.assessment };
    } catch (error) {
      a.error = error instanceof Error ? error.message : "Unable to assess this discussion."; throw error;
    } finally { a.abort = undefined; this.#emit(a); }
  }
  discard(discussionId: string) {
    const a = this.#active;
    if (!a || a.context.discussionId !== discussionId) return;
    this.#active = undefined;
    a.abort?.abort(); a.voice?.dispose(); a.client?.close(); a.messages.length = 0;
  }
  close() { if (this.#active) this.discard(this.#active.context.discussionId); }
}
