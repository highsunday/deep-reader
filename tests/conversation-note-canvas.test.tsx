// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ChatMessage, ReaderDesktopApi } from "../src/shared/contracts";
vi.mock("../src/renderer/ConversationReadingNoteCanvas", () => ({ ConversationReadingNoteCanvas: ({ draftId }: { draftId: string }) => <div role="dialog">Canvas {draftId}</div> }));
import { ChatMessageList } from "../src/renderer/App";
afterEach(cleanup);
const draft: ChatMessage = { id: "a", turnId: "t", role: "assistant", status: "completed", text: '```reading-note-draft\n{"version":3,"draftId":"generated","title":"單一概念","content":"討論的理解。"}\n```' };
const user: ChatMessage = { id: "u", turnId: "t", role: "user", status: "completed", text: "把剛才的概念整理成筆記" };
const props = { source: { bookTitle: "書", chapterTitle: "章" }, notesApi: {} as ReaderDesktopApi["readingNotes"], chatApi: {} as ReaderDesktopApi["chat"] };
test("F73 opens a newly completed result, never a streaming result or restored history", async () => {
  const view = render(<ChatMessageList {...props} messages={[user]} activeTurnId="t" />);
  view.rerender(<ChatMessageList {...props} messages={[user, { ...draft, status: "streaming" }]} activeTurnId="t" />);
  expect(screen.queryByRole("dialog")).toBeNull();
  view.rerender(<ChatMessageList {...props} messages={[user, draft]} activeTurnId={null} />);
  await waitFor(() => expect(screen.getByRole("dialog").textContent).toBe("Canvas generated"));
  view.unmount();
  render(<ChatMessageList {...props} messages={[user, draft]} activeTurnId={null} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
test("F73 loading another conversation does not open its historical drafts", () => {
  const view = render(<ChatMessageList {...props} messages={[user]} activeTurnId={null} />);
  view.rerender(<ChatMessageList {...props} messages={[{ ...user, id: "other" }, draft]} activeTurnId={null} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("F73 restoring history after the initial empty snapshot never opens a draft", () => {
  const view = render(<ChatMessageList {...props} messages={[]} activeTurnId={null} />);
  view.rerender(<ChatMessageList {...props} messages={[user, draft]} activeTurnId={null} />);
  expect(screen.queryByRole("dialog")).toBeNull();
});
