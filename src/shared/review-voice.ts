import { REVIEW_RATINGS, type ReviewRating } from "./spaced-review";
import { parseVoiceSessionId, type ReadingVoiceAnswer, type ReadingVoiceState } from "./reading-voice";

export const UNDERSTANDING_LEVELS = ["unassessed", "unclear", "partial", "understood"] as const;
export type UnderstandingLevel = typeof UNDERSTANDING_LEVELS[number];
export const understandingLabels: Record<UnderstandingLevel, string> = {
  unassessed: "Not enough evidence", unclear: "Needs clarification", partial: "Partly understood", understood: "Core concept understood"
};
export interface VoiceReviewAssessment {
  suggestedRecall: ReviewRating | null;
  suggestedUnderstanding: UnderstandingLevel;
  recallReason: string;
  understandingReason: string;
  summary: string;
}
export interface SavedVoiceReview extends VoiceReviewAssessment { understanding: UnderstandingLevel }
export interface ReviewVoiceContext {
  discussionId: string; noteId: string; noteRevision: number; scheduleVersion: number;
}
export interface StartReviewVoiceInput { sessionId: string; sdp: string; context: ReviewVoiceContext }
export interface ReviewVoiceSnapshot {
  discussionId: string;
  voice: ReadingVoiceState;
  assessing: boolean;
  hasAnswer: boolean;
  assessment?: VoiceReviewAssessment;
  error?: string;
}
export interface ReviewVoiceApi {
  start(input: StartReviewVoiceInput): Promise<ReadingVoiceAnswer>;
  stop(sessionId: string): Promise<void>;
  assess(discussionId: string): Promise<VoiceReviewAssessment>;
  discard(discussionId: string): Promise<void>;
  onChanged(listener: (state: ReviewVoiceSnapshot) => void): () => void;
}
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).sort().join() === [...keys].sort().join();
}
export function parseAssessment(value: unknown, saved = false): VoiceReviewAssessment | SavedVoiceReview {
  const keys = ["suggestedRecall", "suggestedUnderstanding", "recallReason", "understandingReason", "summary"];
  if (saved) keys.push("understanding");
  if (!record(value) || !exact(value, keys) ||
      (value.suggestedRecall !== null && !REVIEW_RATINGS.includes(value.suggestedRecall as ReviewRating)) ||
      !UNDERSTANDING_LEVELS.includes(value.suggestedUnderstanding as UnderstandingLevel) ||
      (saved && !UNDERSTANDING_LEVELS.includes(value.understanding as UnderstandingLevel)) ||
      ["recallReason", "understandingReason", "summary"].some(key => typeof value[key] !== "string" || !(value[key] as string).trim() || (value[key] as string).length > 1500)) {
    throw new Error("Invalid voice review assessment. Please retry.");
  }
  // Return only known fields in stable order, for persistence and idempotency.
  return Object.fromEntries(keys.map(key => [key, value[key]])) as unknown as VoiceReviewAssessment | SavedVoiceReview;
}
export function parseStartReviewVoice(value: unknown): StartReviewVoiceInput {
  if (!record(value) || !exact(value, ["sessionId", "sdp", "context"]) ||
    typeof value.sdp !== "string" || !value.sdp.startsWith("v=0") || !value.sdp.includes("m=audio") || value.sdp.length > 64_000) throw new Error("Invalid review voice request.");
  const c = value.context;
  if (!record(c) || !exact(c, ["discussionId", "noteId", "noteRevision", "scheduleVersion"]) ||
    typeof c.noteId !== "string" || !c.noteId.trim() || c.noteId.length > 200 ||
    !Number.isSafeInteger(c.noteRevision) || Number(c.noteRevision) < 1 || !Number.isSafeInteger(c.scheduleVersion) || Number(c.scheduleVersion) < 1) throw new Error("Invalid review voice source.");
  parseVoiceSessionId(c.discussionId);
  return { sessionId: parseVoiceSessionId(value.sessionId), sdp: value.sdp, context: c as unknown as ReviewVoiceContext };
}
