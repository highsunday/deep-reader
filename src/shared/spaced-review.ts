import type { ReadingNote } from "./contracts";

export const REVIEW_RATINGS = ["again", "hard", "good", "easy"] as const;
export type ReviewRating = typeof REVIEW_RATINGS[number];
export interface ReviewSettings { dailyNewLimit: number; dailyDueLimit: number }
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = { dailyNewLimit: 10, dailyDueLimit: 50 };
export interface ReviewActivity {
  completedReviews: number; activeDays: number;
  daily: { date: string; newCompleted: number; dueCompleted: number }[];
}
export interface ReviewProgress {
  solid: number; building: number; delta30Days: number | null;
  recallRate: number | null; recallReviews: number; historyIncomplete: boolean;
  daily: { date: string; solid: number | null }[];
}
export interface ReviewSummary {
  daily: ReviewSettings & { startedNew: number; completedDue: number };
  learning: number;
  backlog: number;
  refreshAt: number;
  progress: ReviewProgress;
  activity: ReviewActivity;
  available: number;
  due: number;
  newCards: number;
  enrolled: number;
  paused: number;
  unavailable: number;
  nextDueAt: number | null;
}
export interface NoteReviewStatus {
  enrolled: boolean;
  paused: boolean;
  eligible: boolean;
  reason?: string;
  dueAt: number | null;
}
export interface ReviewHistoryEntry {
  operationId: string;
  reviewedAt: number;
  rating: ReviewRating;
  dueAt: number;
  voiceReview?: import("./review-voice").SavedVoiceReview;
}
export interface NoteReviewDetails extends NoteReviewStatus {
  lastReviewedAt: number | null;
  lastRating: ReviewRating | null;
  totalReviews: number;
  history: ReviewHistoryEntry[];
}
export interface ReviewCard {
  note: ReadingNote;
  scheduleVersion: number;
  recallAttachmentId?: string;
  recallUrl?: string;
  intervals: Record<ReviewRating, number>;
}
export interface RateReviewInput {
  noteId: string;
  noteRevision: number;
  scheduleVersion: number;
  rating: ReviewRating;
  operationId: string;
  voiceReview?: import("./review-voice").SavedVoiceReview;
}
export interface ReviewResult { operationId: string; noteId: string; dueAt: number }
export interface SpacedReviewApi {
  voice?: import("./review-voice").ReviewVoiceApi;
  summary(): Promise<ReviewSummary>;
  settings(): Promise<ReviewSettings>;
  saveSettings(input: ReviewSettings): Promise<ReviewSettings>;
  status(noteId: string): Promise<NoteReviewStatus>;
  details(noteId: string): Promise<NoteReviewDetails>;
  enroll(noteId: string): Promise<NoteReviewStatus>;
  setPaused(noteId: string, paused: boolean): Promise<NoteReviewStatus>;
  next(): Promise<ReviewCard | null>;
  rate(input: RateReviewInput): Promise<ReviewResult>;
  imageFailed(noteId: string, attachmentId: string): Promise<void>;
  retryImages(): Promise<void>;
  onChanged(listener: () => void): () => void;
}
