import { stripReadingSuggestion } from "../shared/reading-input-suggestion";
import { stripNoteUpdateArtifacts } from "../shared/reading-note-reference";
import { readingNoteDocumentToMarkdown } from "../shared/reading-note-document";
import type { ChatMessage, ChatSnapshot } from "../shared/contracts";

function fencedOriginal(text: string): string {
  let longestBackticks = 0;
  for (const match of text.matchAll(/`+/g)) {
    longestBackticks = Math.max(longestBackticks, match[0].length);
  }
  const fence = "`".repeat(Math.max(3, longestBackticks + 1));
  return `${fence}text\n${text}\n${fence}`;
}

function userBlock(message: ChatMessage, hasBookSource: boolean): string {
  const parts = ["## 使用者", message.text];
  if (message.readingSource) {
    parts.push(
      `書籍：${message.readingSource.bookTitle}\n章節：${message.readingSource.chapterTitle}`,
      "### 當次完整 START／END 閱讀區段",
      fencedOriginal(message.readingSource.readingSegment)
    );
    if (message.readingSource.bookImageCount) {
      parts.push(`此閱讀區段另含 ${message.readingSource.bookImageCount} 張書籍圖片；純文字複製不含圖片，請另行附上。`);
    }
  } else if (hasBookSource) {
    parts.push("當次完整閱讀區段未保存（舊對話或未附閱讀區段的回合）。");
  }
  for (const n of message.noteReferences ?? []) parts.push(`### 引用筆記：${n.title}`, `來源：${n.bookTitle}／${n.chapterTitle} · 版本 ${n.revision}`, fencedOriginal(readingNoteDocumentToMarkdown(n.content)));
  if (message.quote) parts.push("### 原書引用（逐字）", fencedOriginal(message.quote.text));
  if (message.images?.length) {
    parts.push(`此提問另附有 ${message.images.length} 張圖片；純文字複製不含圖片，請另行附上。`);
  }
  return parts.filter(Boolean).join("\n\n");
}

export function formatReadingConversation(snapshot: ChatSnapshot): string | null {
  const conversation = snapshot.conversations.find(({ id }) => id === snapshot.activeConversationId);
  if (!conversation) return null;
  const completed = snapshot.messages.filter(message => message.status === "completed");
  if (!completed.length) return null;
  const source = [conversation.source?.bookTitle, conversation.source?.chapterTitle].filter(Boolean).join("／");
  const blocks = [
    `# 閱讀對話：${conversation.title}`,
    ...(source ? [`書籍／章節：${source}`] : []),
    ...completed.map(message => message.role === "user"
      ? userBlock(message, Boolean(source))
      : ["## AI", stripReadingSuggestion(stripNoteUpdateArtifacts(message.text)), ...((message.noteUpdates ?? []).map(p =>
          `### 更新筆記：${p.originalTitle}（${({ pending: "待確認", applied: "已套用", rejected: "不套用", superseded: "已取代" })[p.status]}）\n\n${p.summary}\n\n#### ${p.title}\n\n${readingNoteDocumentToMarkdown(p.content)}`)), message.noteUpdateError ?? ""].filter(Boolean).join("\n\n"))
  ];
  return `${blocks.join("\n\n---\n\n")}\n`;
}

export async function copyReadingConversation(
  snapshot: ChatSnapshot,
  writeText: (value: string) => Promise<void>
): Promise<boolean> {
  const markdown = formatReadingConversation(snapshot);
  if (!markdown) return false;
  await writeText(markdown);
  return true;
}
