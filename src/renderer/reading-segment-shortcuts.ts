import { readingCoachPrompt } from "../shared/reading-coach";
import type { ChatIntent, ConnectionPhase } from "../shared/contracts";

export function readingSegmentShortcutText(intent: ChatIntent): string {
  if (intent === "readingGuide") return "請為這段產生導讀";
  if (intent === "explainReadingSegment") return "請展開並詳細說明這段內容";
  if (intent === "readingCoach") return readingCoachPrompt;
  if (intent === "learningQuestionQuiz") return "請根據這段內容產生理解測驗";
  if (intent === "selfRetelling") return "請讓我用自己的話復述這段內容";
  return "請幫我產生一張閱讀筆記；先問我想記住哪一個具體觀念";
}

export function readingSegmentShortcutFallbackError(intent: ChatIntent): string {
  if (intent === "readingGuide") return "無法產生導讀。";
  if (intent === "explainReadingSegment") return "無法送出詳細說明請求。";
  if (intent === "readingCoach") return "無法開始閱讀教練對話，請重試。";
  if (intent === "learningQuestionQuiz") return "無法產生理解測驗。";
  if (intent === "selfRetelling") return "無法建立自我復述。";
  return "無法建立閱讀筆記草稿。";
}

export function readingSegmentShortcutsDisabled(input: {
  hasReadingSegment: boolean;
  connection: ConnectionPhase;
  activeTurnId: string | null;
  managementBusy: boolean;
  conversationActionPending: boolean;
}): boolean {
  return !input.hasReadingSegment || input.connection !== "ready" ||
    Boolean(input.activeTurnId) || input.managementBusy ||
    input.conversationActionPending;
}
