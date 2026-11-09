// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BlockNoteEditor } from "@blocknote/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type {
  ReaderDesktopApi,
  ReadingNote,
  ReadingNoteAiSnapshot
} from "../src/shared/contracts";
import { ReadingNoteEditorDialog, readingNoteEditorDirty } from "../src/renderer/ReadingNoteEditorDialog";
import { ReadingNoteLibrary } from "../src/renderer/ReadingNoteLibrary";
import {
  markdownToReadingNoteDocument,
  readingNoteDocumentToMarkdown
} from "../src/shared/reading-note-document";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn()
    }))
  });
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.IntersectionObserver = class {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  } as unknown as typeof IntersectionObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList);
  Range.prototype.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON: () => ({})
  }));
});

beforeEach(() => {
  const stored = new Map<string, string>();
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value)
  } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const source = {
  bookTitle: "Thinking in Systems",
  chapterTitle: "Feedback",
  readingSegment: "A reinforcing loop feeds its output back as a new input."
};

const draftCompletionRequest =
  [
    "請以我的草稿為主，結合目前閱讀區段與本次閱讀對話中已釐清的理解，整理成一份可繼續編輯的卡片筆記。保留我的核心觀點、思考方向與語氣，並聚焦於一個核心概念。",
    "撰寫時請假設讀者不熟悉這本書、相關術語與前置背景。採用類似費曼法的方式，用自己的話和簡單、具體的語言把概念說清楚，避免用另一串抽象詞解釋抽象詞。若有無法省略的術語，請在第一次出現時自然說明，但不要為此固定增加章節。",
    "請根據草稿與閱讀脈絡，自行判斷需要整理、保留或補充什麼，不預設任何必備內容類型。唯一原則是：讓一位不熟悉這個概念的人，以及隔一段時間後回看的我，都能只靠這份筆記充分理解核心概念並有效複習。",
    "請用金字塔原理自上而下組織筆記內容：先用一個短段落直接說出核心結論或定義，再用 2–4 個符合內容的 Markdown `##` 副標題，分組展開彼此不重疊的支撐觀點。副標題本身要表達該段的觀點或問題，不要使用「說明」「細節」「其他」等空泛名稱。",
    "標題會由 App 獨立顯示，因此筆記內容不要使用 `#`、`###` 或更深層標題，只使用 2–4 個 `##` 副標題，維持單一概念卡片的淺層結構。每段通常 2–4 句；三個以上的平行要點請改用條列，避免形成大段文字。這只是呈現結構，不代表套用固定內容欄位；仍應依概念需要選擇支撐面向。",
    "不要精簡到失去重要的理解線索，也不要延伸到核心概念之外。其他相關概念若值得保留，可以簡短提及，但不要在這份筆記中展開。",
    "只有在加入書中未明確提出的推論或外部知識，而且來源差異會影響理解時，才就近標示為「AI 補充」。簡化說明時仍須保持原意與準確性。"
  ].join("\n\n");

const savedNote: ReadingNote = {
  id: "note-1",
  sourceDraftId: "session-1",
  title: "How reinforcing loops amplify change",
  content: markdownToReadingNoteDocument("A reinforcing loop amplifies its initial direction of change."),
  bookTitle: source.bookTitle,
  chapterTitle: source.chapterTitle,
  createdAt: 1,
  updatedAt: 1,
  revision: 1
};

function api() {
  const startCreate = vi.fn(async () => ({
    sessionId: "session-1",
    mode: "create" as const,
    phase: "ready" as const,
    messages: [],
    hasChanges: false,
    status: "Ready to complete from the reading segment and conversation."
  }));
  const complete = vi.fn(async () => ({
    sessionId: "session-1",
    mode: "create" as const,
    phase: "ready" as const,
    messages: [],
    draft: {
      title: "How reinforcing loops amplify change",
      content: "A reinforcing loop **amplifies** its initial direction of change."
    },
    hasChanges: true,
    status: "Note completed."
  }));
  const send = vi.fn(async () => ({
    sessionId: "session-1",
    mode: "create" as const,
    phase: "ready" as const,
    messages: [
      { id: "message-1", role: "user" as const, text: "Explain the cycle more explicitly." },
      { id: "message-2", role: "assistant" as const, text: "I prepared a clearer causal explanation." }
    ],
    draft: {
      title: "How reinforcing loops amplify change",
      content: "A reinforcing loop **amplifies** change by feeding its result into the next cycle."
    },
    hasChanges: true,
    status: "Note updated."
  }));
  const save = vi.fn(async () => savedNote);
  const accept = vi.fn(async () => ({
    sessionId: "session-1",
    mode: "create" as const,
    phase: "ready" as const,
    messages: [
      { id: "message-1", role: "user" as const, text: "Explain the cycle more explicitly." },
      { id: "message-2", role: "assistant" as const, text: "I prepared a clearer causal explanation." }
    ],
    hasChanges: false,
    status: "AI changes applied."
  }));
  const reject = vi.fn(async () => ({
    sessionId: "session-1",
    mode: "create" as const,
    phase: "ready" as const,
    messages: [
      { id: "message-1", role: "user" as const, text: "Explain the cycle more explicitly." },
      { id: "message-2", role: "assistant" as const, text: "I prepared a clearer causal explanation." }
    ],
    hasChanges: false,
    status: "AI changes were not applied."
  }));
  const discard = vi.fn(async () => undefined);
  return {
    beginDraft: vi.fn(async () => ({ draftId: "draft-canvas" })),
    create: vi.fn(async () => savedNote),
    discardDraft: vi.fn(),
    update: vi.fn(),
    attachments: {
      upload: vi.fn(),
      readDataUrl: vi.fn(),
      copyForNote: vi.fn(),
      discardStaged: vi.fn()
    },
    ai: {
      startCreate,
      complete,
      startEdit: vi.fn(),
      startTransform: vi.fn(async () => ({
        sessionId: "transform-1",
        mode: "transform" as const,
        phase: "ready" as const,
        messages: [],
        hasChanges: false,
        status: "Ready to edit."
      })),
      send,
      accept,
      reject,
      stop: vi.fn(),
      save,
      discard
    }
  } as unknown as ReaderDesktopApi["readingNotes"];
}

test("the reader opens the shared rich-text canvas inside a centered temporary dialog", () => {
  render(
    <ReadingNoteEditorDialog
      api={api()}
      mode="create"
      source={source}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );

  expect(screen.getByRole("dialog", { name: "Create a reading note" })).toBeTruthy();
  expect(document.querySelector(".reading-note-reader-overlay")).not.toBeNull();
  expect(screen.getByLabelText("Editable reading note")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Reading note title" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "AI writing tools" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Reading note draft" })).toBeNull();
});

test("long source titles cannot widen the reader-note dialog or clip its controls", () => {
  const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");

  render(
    <ReadingNoteEditorDialog
      api={api()}
      mode="create"
      source={{
        ...source,
        bookTitle: "Nonviolent Communication: A Language of Life, 3rd Edition: Life-Changing Tools for Healthy Relationships",
        chapterTitle: "An exceptionally long chapter title that must stay inside the floating reading-note card"
      }}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );

  expect(screen.getByText(/Nonviolent Communication/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Close reading note draft" })).toBeTruthy();
  expect(styles).toMatch(/\.reading-note-editor-dialog\s*\{[^}]*width:\s*min\(1080px,\s*100%\);[^}]*height:\s*min\(820px,\s*100%\);/s);
  expect(styles).toMatch(/\.reading-note-canvas-source\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
});

test("the floating note keeps the original page clearly visible behind a light unblurred overlay", () => {
  const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");
  const overlayRule = styles.match(/\.reading-note-reader-overlay\s*\{([^}]*)\}/s)?.[1] ?? "";

  expect(overlayRule).toMatch(/background:\s*rgb\(28 34 29 \/ 16%\)/);
  expect(overlayRule).toMatch(/padding:\s*clamp\(32px,\s*3vw,\s*44px\)/);
  expect(overlayRule).not.toMatch(/backdrop-filter:\s*blur/);
});

test("the AI editor adds a stable collaboration column on wide screens and overlays on narrow screens", () => {
  const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");

  expect(styles).toMatch(/\.reading-note-ai-panel\s*\{[^}]*position:\s*absolute;[^}]*width:\s*min\(360px,\s*calc\(100% - 48px\)\);/s);
  expect(styles).toMatch(/@media \(min-width:\s*1280px\)[\s\S]*\.reading-note-editor-dialog:has\(\.reading-note-canvas\.ai-open\)\s*\{[^}]*width:\s*min\(1320px,\s*calc\(100% - 64px\)\);/s);
  expect(styles).toMatch(/@media \(min-width:\s*1280px\)[\s\S]*\.reading-note-reader-overlay:has\(\.reading-note-canvas\.ai-open\)\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*var\(--app-header-height\) 0 0;[^}]*padding:\s*32px;/s);
  expect(styles).toMatch(/@media \(min-width:\s*1280px\)[\s\S]*\.reading-note-canvas\.ai-open\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*920px\) 400px;/s);
  expect(styles).toMatch(/@media \(min-width:\s*1280px\)[\s\S]*\.reading-note-canvas\.ai-open > \.reading-note-ai-panel\s*\{[^}]*width:\s*400px;/s);
  expect(styles).toMatch(/\.chat-composer-actions select\s*\{[^}]*width:\s*165px;/s);
  expect(styles).not.toMatch(/\.reading-note-ai-form \.reading-note-ai-composer-options select\s*\{[^}]*width:/s);
});

test("the memory-image AI panel shares the pinned composer and responsive layout language", () => {
  const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");

  expect(styles).not.toMatch(/\.reading-note-editor-dialog:has\(\.reading-note-memory-back\)\s*\{[^}]*\bwidth\s*:/s);
  expect(styles).toMatch(/\.reading-note-memory-back-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(300px,\s*38%\);/s);
  expect(styles).not.toMatch(/\.reading-note-memory-back\.is-empty \.reading-note-memory-visual\s*\{[^}]*display:\s*none;/s);
  expect(styles).toMatch(/\.reading-note-memory-ai-panel\[hidden\][^{]*\{\s*display:\s*none;/);
  expect(styles).not.toMatch(/\.reading-note-memory-back\.is-empty[^{}]*\{[^}]*grid-template-(?:columns|rows):/s);
  expect(styles).toMatch(/\.reading-note-memory-ai-panel\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  expect(styles).toMatch(/\.reading-note-memory-ai-panel\s*\{[^}]*container-type:\s*inline-size;/s);
  expect(styles).toMatch(/\.reading-note-metadata-summary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/s);
  expect(styles).not.toMatch(/\.reading-note-memory-context-(?:summary|source)\s*\{/s);
  expect(styles).toMatch(/\.reading-note-memory-composer\s*\{[^}]*margin-top:\s*auto;/s);
  expect(styles).toMatch(/\.reading-note-memory-composer \.chat-composer-card\s*\{[^}]*min-height:\s*122px;/s);
  expect(styles).toMatch(/@container memory-editor \(max-width:\s*680px\)[\s\S]*\.reading-note-memory-back-body\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  expect(styles).toMatch(/\.reading-note-memory-image-frame img\s*\{[^}]*object-fit:\s*contain;/s);
});

test("the source-backed draft offers one-click AI completion after the reader writes body content", async () => {
  const readingNotes = api();
  const user = userEvent.setup();
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="create"
      source={source}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );

  expect(screen.queryByRole("button", { name: "Complete from Draft" })).toBeNull();
  const editor = document.querySelector<HTMLElement>('.bn-editor [contenteditable="true"], .bn-editor[contenteditable="true"]');
  expect(editor).not.toBeNull();
  editor!.focus();
  await user.type(editor!, "我認為增強迴路會讓原本的變化方向持續放大。", { skipClick: true });

  const collapsedShortcut = await screen.findByRole("button", { name: "Complete from Draft" });
  expect(collapsedShortcut.classList.contains("annotation-analysis-preset")).toBe(true);
  expect(collapsedShortcut.getAttribute("data-tooltip")).toBe("Complete from Draft");

  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  const aiPanel = screen.getByRole("complementary", { name: "AI editing conversation" });
  expect(within(aiPanel).getByRole("note", { name: "AI context" }).textContent)
    .toContain("marked passage");
  const aiForm = aiPanel.querySelector<HTMLElement>(".reading-note-ai-form");
  const aiContent = aiPanel.querySelector<HTMLElement>(".reading-note-ai-content");
  expect(aiForm).not.toBeNull();
  expect(aiContent).not.toBeNull();
  const shortcut = within(aiForm!).getByRole("button", { name: "Complete from Draft" });
  expect(within(aiContent!).queryByRole("button", { name: "Complete from Draft" })).toBeNull();
  expect(shortcut.compareDocumentPosition(within(aiForm!).getByRole("textbox", { name: "Message AI about this note" }))
    & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(shortcut.classList.contains("annotation-analysis-preset")).toBe(true);
  expect(shortcut.getAttribute("data-tooltip")).toBe("Complete from Draft");
  const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");
  expect(styles).not.toMatch(/\.reading-note-draft-completion\s*\{[^}]*background:\s*var\(--primary\)/s);
  const model = within(aiPanel).getByRole("combobox", { name: "Choose AI model" });
  fireEvent.change(model, { target: { value: "gpt-5.6-luna" } });
  fireEvent.click(shortcut);

  await waitFor(() => expect(readingNotes.ai.startCreate).toHaveBeenCalledWith({
    ...source,
    userDraft: "Note content:\n我認為增強迴路會讓原本的變化方向持續放大。"
  }));
  await waitFor(() => expect(readingNotes.ai.send).toHaveBeenCalledWith(
    "session-1",
    draftCompletionRequest,
    "gpt-5.6-luna"
  ));
  expect(readingNotes.ai.send).toHaveBeenCalledTimes(1);
  expect(readingNotes.create).not.toHaveBeenCalled();
  expect(readingNotes.update).not.toHaveBeenCalled();
  expect(await screen.findByRole("region", { name: "AI proposed note preview" })).toBeTruthy();
  expect(within(aiPanel).queryByRole("button", { name: "Complete from Draft" })).toBeNull();
});

test("the draft completion shortcut stays absent from collapsed and expanded AI tools for ineligible notes", () => {
  const readingNotes = api();
  const view = render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="create"
      source={source}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "只有標題" }
  });
  expect(screen.queryByRole("button", { name: "Complete from Draft" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  expect(within(screen.getByRole("complementary", { name: "AI editing conversation" }))
    .queryByRole("button", { name: "Complete from Draft" })).toBeNull();

  view.unmount();
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="manual-edit"
      note={savedNote}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );
  expect(screen.queryByRole("button", { name: "Complete from Draft" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  expect(within(screen.getByRole("complementary", { name: "AI editing conversation" }))
    .queryByRole("button", { name: "Complete from Draft" })).toBeNull();
});

test("the note AI conversation reuses the right-panel message and composer interaction", async () => {
  const readingNotes = api();
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="manual-edit"
      note={savedNote}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  const panel = screen.getByRole("complementary", { name: "AI editing conversation" });
  const contextNotice = screen.getByRole("note", { name: "AI context" });
  expect(contextNotice.textContent).toContain("title and content of this note");
  expect(contextNotice.parentElement?.classList.contains("reading-note-ai-content")).toBe(true);
  expect(contextNotice.nextElementSibling).toBe(panel.querySelector(".messages"));
  expect(panel.querySelector(".chat-header")).not.toBeNull();
  expect(panel.querySelector(".messages")).not.toBeNull();
  expect(panel.querySelector(".chat-form .chat-composer-card")).not.toBeNull();
  expect(panel.querySelector(".chat-send-button")).not.toBeNull();
  const model = screen.getByRole("combobox", { name: "Choose AI model" }) as HTMLSelectElement;
  expect(model.value).toBe("gpt-5.6-sol");
  fireEvent.change(model, { target: { value: "gpt-5.6-terra" } });

  const composer = screen.getByRole("textbox", { name: "Message AI about this note" });
  fireEvent.change(composer, { target: { value: "What should be clearer?" } });
  fireEvent.keyDown(composer, { key: "Enter", shiftKey: true });
  expect(readingNotes.ai.send).not.toHaveBeenCalled();
  fireEvent.keyDown(composer, { key: "Enter" });

  await waitFor(() => expect(readingNotes.ai.send).toHaveBeenCalledWith(
    "transform-1",
    "What should be clearer?",
    "gpt-5.6-terra"
  ));
});

test("the note AI model choice survives closing and reopening another note", async () => {
  const readingNotes = api();
  const props = { api: readingNotes, mode: "manual-edit" as const,
    onClose: () => undefined, onSaved: () => undefined };
  const view = render(<ReadingNoteEditorDialog {...props} note={savedNote} />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Choose AI model" }), {
    target: { value: "gpt-5.6-terra" }
  });
  view.unmount();

  render(<ReadingNoteEditorDialog {...props} note={{ ...savedNote, id: "note-2" }} />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  expect((screen.getByRole("combobox", { name: "Choose AI model" }) as HTMLSelectElement).value)
    .toBe("gpt-5.6-terra");
  const composer = screen.getByRole("textbox", { name: "Message AI about this note" });
  fireEvent.change(composer, { target: { value: "Clarify this note." } });
  fireEvent.keyDown(composer, { key: "Enter" });
  await waitFor(() => expect(readingNotes.ai.send).toHaveBeenCalledWith(
    "transform-1", "Clarify this note.", "gpt-5.6-terra"
  ));
});

test("a sent message appears immediately while the note AI is still responding", async () => {
  const readingNotes = api();
  let finishResponse: ((value: ReadingNoteAiSnapshot) => void) | undefined;
  readingNotes.ai.send = vi.fn(() => new Promise<ReadingNoteAiSnapshot>((resolve) => {
    finishResponse = resolve;
  }));
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="manual-edit"
      note={savedNote}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Add one clear example." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  const sentMessage = await screen.findByRole("article", { name: "Your message" });
  expect(sentMessage.textContent).toContain("Add one clear example.");
  expect(screen.getByText("AI is responding…")).toBeTruthy();
  expect((screen.getByRole("textbox", {
    name: "Message AI about this note"
  }) as HTMLTextAreaElement).value).toBe("");

  finishResponse?.({
    sessionId: "transform-1",
    mode: "transform",
    phase: "ready",
    messages: [
      { id: "message-user", role: "user", text: "Add one clear example." },
      { id: "message-ai", role: "assistant", text: "Here is one example." }
    ],
    hasChanges: false,
    status: "Ready."
  });
  expect(await screen.findByText("Here is one example.")).toBeTruthy();
});

test("a streaming AI draft appears as a read-only left-side preview before send completes", async () => {
  const readingNotes = api();
  let onStateChanged: ((snapshot: ReadingNoteAiSnapshot) => void) | undefined;
  const unsubscribe = vi.fn();
  (readingNotes.ai as typeof readingNotes.ai & {
    onStateChanged(listener: (snapshot: ReadingNoteAiSnapshot) => void): () => void;
  }).onStateChanged = vi.fn((listener) => {
    onStateChanged = listener;
    return unsubscribe;
  });
  let finishResponse: ((value: ReadingNoteAiSnapshot) => void) | undefined;
  readingNotes.ai.send = vi.fn(() => new Promise<ReadingNoteAiSnapshot>((resolve) => {
    finishResponse = resolve;
  }));
  const view = render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="manual-edit"
      note={savedNote}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Add a concrete example." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(readingNotes.ai.send).toHaveBeenCalled());
  expect(onStateChanged).toBeDefined();

  act(() => onStateChanged?.({
    sessionId: "stale-session",
    mode: "transform",
    phase: "responding",
    streamingDraft: { title: "Stale title", content: "Stale content" },
    messages: [],
    hasChanges: false,
    status: "Updating note…"
  }));
  expect(screen.queryByRole("region", { name: "AI streaming note preview" })).toBeNull();

  act(() => onStateChanged?.({
    sessionId: "transform-1",
    mode: "transform",
    phase: "responding",
    streamingDraft: {
      title: "How feedback amplifies change",
      content: "A reinforcing loop feeds **one result** into"
    },
    messages: [],
    hasChanges: false,
    status: "Updating note…"
  }));

  const preview = screen.getByRole("region", { name: "AI streaming note preview" });
  expect(preview.textContent).toContain("How feedback amplifies change");
  expect(preview.textContent).toContain("one result");
  expect(screen.queryByRole("textbox", { name: "Reading note title" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
  await new Promise((resolve) => window.setTimeout(resolve, 650));
  expect(readingNotes.update).not.toHaveBeenCalled();

  act(() => finishResponse?.({
    sessionId: "transform-1",
    mode: "transform",
    phase: "error",
    messages: [],
    hasChanges: false,
    status: "AI could not update the reading note."
  }));
  await waitFor(() => expect(screen.queryByRole("region", {
    name: "AI streaming note preview"
  })).toBeNull());
  expect((screen.getByRole("textbox", {
    name: "Reading note title"
  }) as HTMLTextAreaElement).value).toBe(savedNote.title);
  expect(readingNotes.update).not.toHaveBeenCalled();

  view.unmount();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test("a failed note AI turn keeps the applied note and reports the error", async () => {
  const readingNotes = api();
  readingNotes.ai.send = vi.fn(async () => {
    throw new Error("AI completion is temporarily unavailable.");
  });
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="manual-edit"
      note={savedNote}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Add a concrete example." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  expect(await screen.findByText("AI completion is temporarily unavailable.")).toBeTruthy();
  expect((screen.getByRole("textbox", { name: "Reading note title" }) as HTMLTextAreaElement).value)
    .toBe(savedNote.title);
  expect(readingNotes.update).not.toHaveBeenCalled();
});

test("AI completion immediately previews its proposal without saving until the reader applies it", async () => {
  const readingNotes = api();
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="create"
      source={source}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );

  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "I think the output strengthens the next cycle." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Explain the cycle more explicitly." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  await waitFor(() => expect(readingNotes.ai.startCreate).toHaveBeenCalledWith({
    ...source,
    userDraft: "Title: I think the output strengthens the next cycle."
  }));
  await waitFor(() => expect(readingNotes.ai.send).toHaveBeenCalledWith(
    "session-1", "Explain the cycle more explicitly.", "gpt-5.6-sol"
  ));
  expect(readingNotes.ai.startTransform).not.toHaveBeenCalled();
  expect(readingNotes.create).not.toHaveBeenCalled();
  expect(readingNotes.update).not.toHaveBeenCalled();
  expect(readingNotes.ai.save).not.toHaveBeenCalled();
  const preview = await screen.findByRole("region", { name: "AI proposed note preview" });
  expect(screen.getByRole('button', { name: '追蹤修訂' }).getAttribute('aria-pressed')).toBe('true');
  expect(preview.querySelector('del')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '修改後' }));
  expect(preview.textContent).toContain("How reinforcing loops amplify change");
  expect(preview.textContent).toContain("feeding its result into the next cycle");
  expect(screen.queryByRole("textbox", { name: "Reading note title" })).toBeNull();
  expect(screen.getByRole("button", { name: "Apply changes" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Don't apply changes" })).toBeTruthy();
  expect(await screen.findByText("I prepared a clearer causal explanation.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await waitFor(() => expect(readingNotes.ai.accept).toHaveBeenCalledWith("session-1"));
  expect(await screen.findByDisplayValue("How reinforcing loops amplify change")).toBeTruthy();
});

test("AI Complete Note previews and saves a selected original book image", async () => {
  const image = { dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
  const sourceWithImage = {
    ...source,
    readingSegment: "Lyapunov function is a bowl.\n\n[Book image 1] Figure 3.2",
    images: [image]
  };
  const readingNotes = api();
  vi.mocked(readingNotes.ai.send).mockResolvedValue({
    sessionId: "session-1", mode: "create", phase: "ready", messages: [],
    draft: { title: "Lyapunov 圖解", content: "這個碗形圖說明收斂。\n\n![原文圖 3.2](book-image:1)" },
    hasChanges: true, status: "Previewing AI changes."
  });
  vi.mocked(readingNotes.attachments.upload).mockResolvedValue({
    id: "source-image-1", name: "book-image-1.png", mimeType: "image/png",
    size: 68, url: "reading-note-asset:source-image-1"
  });
  vi.mocked(readingNotes.attachments.readDataUrl).mockResolvedValue(image.dataUrl);
  vi.mocked(readingNotes.attachments.discardStaged).mockResolvedValue(1);
  render(<ReadingNoteEditorDialog api={readingNotes} mode="create" source={sourceWithImage}
    onClose={() => undefined} onSaved={() => undefined} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "說明圖 3.2" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "請根據原文說明此圖" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  const preview = await screen.findByRole("region", { name: "AI proposed note preview" });
  await waitFor(() => expect(preview.querySelector("img[src^='data:image/png']")).not.toBeNull());
  expect(readingNotes.attachments.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '修改後' }));
  await waitFor(() => expect(preview.querySelector("img[src^='data:image/png']")).not.toBeNull());
  expect(readingNotes.attachments.upload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await waitFor(() => expect(readingNotes.attachments.upload).toHaveBeenCalled());
  await waitFor(() => expect(readingNotes.ai.accept).toHaveBeenCalledWith(
    "session-1", "這個碗形圖說明收斂。\n\n![原文圖 3.2](reading-note-asset:source-image-1)"));
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(readingNotes.create).toHaveBeenCalled());
  const savedInput = vi.mocked(readingNotes.create).mock.calls[0]![0];
  expect(savedInput.content.blocks.some(block => block.type === "image" &&
    block.props.assetId === "source-image-1")).toBe(true);
});

test("not applying an AI preview restores the last applied note and keeps the conversation", async () => {
  const readingNotes = api();
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="create"
      source={source}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );

  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "Keep my original wording." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Rewrite this." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  await screen.findByRole("region", { name: "AI proposed note preview" });
  fireEvent.click(screen.getByRole("button", { name: "Don't apply changes" }));

  await waitFor(() => expect(readingNotes.ai.reject).toHaveBeenCalledWith("session-1"));
  expect(screen.queryByRole("region", { name: "AI proposed note preview" })).toBeNull();
  expect(await screen.findByDisplayValue("Keep my original wording.")).toBeTruthy();
  expect(screen.getByText("I prepared a clearer causal explanation.")).toBeTruthy();
  expect(readingNotes.create).not.toHaveBeenCalled();
  expect(readingNotes.update).not.toHaveBeenCalled();
});

test("saving the completed AI draft persists it once and closes the floating card", async () => {
  const readingNotes = api();
  const onSaved = vi.fn();
  const onClose = vi.fn();
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="create"
      source={source}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "The loop reinforces its own movement." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Explain the cycle more explicitly." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByRole("button", { name: "Apply changes" });
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await screen.findByDisplayValue("How reinforcing loops amplify change");

  fireEvent.click(screen.getByRole("button", { name: "Save note" }));

  await waitFor(() => expect(readingNotes.create).toHaveBeenCalledWith(expect.objectContaining({
    draftId: "draft-canvas",
    title: "How reinforcing loops amplify change"
  })));
  expect(readingNoteDocumentToMarkdown(vi.mocked(readingNotes.create).mock.calls[0]![0].content))
    .toContain("A reinforcing loop **amplifies** change by feeding its result into the next cycle.");
  expect(readingNotes.ai.save).not.toHaveBeenCalled();
  expect(onSaved).toHaveBeenCalledWith(savedNote);
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("the AI editing conversation survives collapse and continues after applying", async () => {
  const readingNotes = api();
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="create"
      source={source}
      onClose={() => undefined}
      onSaved={() => undefined}
    />
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "The result returns as input." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Explain the cycle more explicitly." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("I prepared a clearer causal explanation.");
  expect(screen.getByRole("region", { name: "AI proposed note preview" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Collapse AI editor" }));
  expect(screen.queryByText("I prepared a clearer causal explanation.")).toBeNull();
  expect(screen.getByRole("region", { name: "AI proposed note preview" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  expect(screen.getByText("I prepared a clearer causal explanation.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
  await waitFor(() => expect(readingNotes.ai.accept).toHaveBeenCalledWith("session-1"));

  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Make it shorter." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  await waitFor(() => expect(readingNotes.ai.send).toHaveBeenCalledWith(
    "session-1",
    "Make it shorter.",
    "gpt-5.6-sol"
  ));
  expect(readingNotes.ai.startCreate).toHaveBeenCalledTimes(1);
  expect(readingNotes.ai.startTransform).not.toHaveBeenCalled();
});

test("closing a non-empty reader draft asks before discarding it", () => {
  const onClose = vi.fn();
  render(
    <ReadingNoteEditorDialog
      api={api()}
      mode="create"
      source={source}
      onClose={onClose}
      onSaved={() => undefined}
    />
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "Keep this thought." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Close reading note draft" }));

  const confirmation = screen.getByRole("alertdialog", { name: "Discard this reading-note draft?" });
  const confirmationBackdrop = confirmation.parentElement;
  const floatingCard = document.querySelector(".reading-note-editor-dialog");
  const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");

  expect(confirmation).toBeTruthy();
  expect(confirmationBackdrop?.parentElement).toBe(floatingCard);
  expect(styles).toMatch(/\.reading-note-editor-dialog\s*>\s*\.reading-note-discard-backdrop\s*\{[^}]*z-index:\s*20;[^}]*background:\s*rgb\(28 34 29 \/ 38%\);/s);
  expect(styles.match(/\.reading-note-editor-dialog\s*>\s*\.reading-note-discard-backdrop\s*\{([^}]*)\}/s)?.[1] ?? "").not.toMatch(/backdrop-filter/);
  expect(onClose).not.toHaveBeenCalled();
});

test("discard confirmation closes an active source-backed AI session", async () => {
  const readingNotes = api();
  const onClose = vi.fn();
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="create"
      source={source}
      onClose={onClose}
      onSaved={() => undefined}
    />
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "The result returns as input." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Explain the cycle more explicitly." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByRole("button", { name: "Apply changes" });
  fireEvent.click(screen.getByRole("button", { name: "Close reading note draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

  await waitFor(() => expect(readingNotes.ai.discard).toHaveBeenCalledWith("session-1"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("closing a saved note protects an unapplied AI proposal", async () => {
  const readingNotes = api();
  const onClose = vi.fn();
  render(
    <ReadingNoteEditorDialog
      api={readingNotes}
      mode="manual-edit"
      note={savedNote}
      onClose={onClose}
      onSaved={() => undefined}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Explain the cycle more explicitly." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByRole("button", { name: "Apply changes" });

  fireEvent.keyDown(document, { key: "Escape" });

  expect(screen.getByRole("alertdialog", { name: "Discard unapplied AI changes?" })).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});

test("the dirty guard protects unsaved reader drafts and active AI sessions", () => {
  expect(readingNoteEditorDirty({ stage: "draft", userDraft: " " })).toBe(false);
  expect(readingNoteEditorDirty({ stage: "draft", userDraft: "my thought" })).toBe(true);
  expect(readingNoteEditorDirty({ stage: "ai", userDraft: "", hasSession: true })).toBe(true);
});

test("the Library keeps its list mounted beneath the shared floating note canvas", async () => {
  const readingNotes = {
    ...api(),
    list: vi.fn(async () => [savedNote]),
    listPage: vi.fn(async () => ({ items: [savedNote] })),
    activeBookTitles: vi.fn(async () => [savedNote.bookTitle]),
    get: vi.fn(async () => savedNote),
    counts: vi.fn(async () => ({ active: 1, trashed: 0 })),
    restore: vi.fn(),
    trash: vi.fn(),
    emptyTrash: vi.fn()
  } as unknown as ReaderDesktopApi["readingNotes"];

  render(<ReadingNoteLibrary api={readingNotes} onReturnToBooks={() => undefined} />);

  fireEvent.click(await screen.findByRole("button", { name: /How reinforcing loops amplify change/i }));

  expect(await screen.findByRole("dialog", { name: "Edit reading note" })).toBeTruthy();
  expect(screen.getByLabelText("Saved reading notes")).toBeTruthy();
  expect(document.querySelector(".reading-note-reader-overlay")).not.toBeNull();
  expect(document.querySelector(".reading-note-library-canvas")).toBeNull();

  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit reading note" })).toBeNull());
  expect(screen.getByLabelText("Saved reading notes")).toBeTruthy();
});

// The reported draft combines fenced diagrams, rich text, lists, and a pasted table.
const pointCloudDraftMarkdown = [
  "重要：**這些模型會把原始點雲轉換成神經網路可以使用的特徵表示，再利用這些特徵完成分類、分割或偵測。**",
  "```text\n原始點雲\n（三維座標及其他輸入特徵）\n        ↓\nPointNet／PointNet++／PointCNN／DGCNN\n        ↓\n學到的特徵\n        ↓\n分類、逐點分割、偵測\n```",
  "| 模型 | 白話理解 |\n| --- | --- |\n| **PointNet** | 看每個點，再看整體。 |\n| **PointNet++** | 分層看局部和整體。 |\n| **PointCNN** | 像做卷積一樣看附近的一群點。 |\n| **DGCNN** | 把點連成會動態更新的鄰居關係圖。 |",
  "- **局部特徵**：某個點附近的形狀或點與鄰居的關係。\n- **逐點特徵**：每個點各自代表什麼。\n- **全域特徵**：整片點雲整體看起來像什麼物體。",
  "1. **分類：這整片點雲是什麼？**\n2. **語意分割：每一個點分別屬於什麼？**\n3. **偵測：目標在什麼位置？**",
  "> **點雲特徵提取與理解模型：把散亂的三維點轉成有意義的局部、逐點或全域特徵，供後續任務使用。**"
].join("\n\n");

test.each(["apply", "reject", "error", "stop"] as const)(
  "a point-cloud draft with code and a table survives AI streaming and %s",
  async (outcome) => {
    const readingNotes = api();
    let emit: ((snapshot: ReadingNoteAiSnapshot) => void) | undefined;
    readingNotes.ai.onStateChanged = vi.fn((listener) => {
      emit = listener;
      return () => undefined;
    });
    let finish: ((snapshot: ReadingNoteAiSnapshot) => void) | undefined;
    readingNotes.ai.send = vi.fn(() => new Promise<ReadingNoteAiSnapshot>((resolve) => {
      finish = resolve;
    }));
    const createEditor = vi.spyOn(BlockNoteEditor, "create");
    render(<ReadingNoteEditorDialog api={readingNotes} mode="create" source={source}
      onClose={() => undefined} onSaved={() => undefined} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
      target: { value: "測試" }
    });
    const originalEditor = document.querySelector<HTMLElement>('.bn-editor[contenteditable="true"]')!;
    const editor = createEditor.mock.results[0]!.value as BlockNoteEditor;
    await act(async () => {
      editor.replaceBlocks(editor.document, await editor.tryParseMarkdownToBlocks(pointCloudDraftMarkdown));
    });
    await waitFor(() => expect(originalEditor.querySelector("table")).not.toBeNull());
    expect(originalEditor.querySelector("pre")?.textContent).toContain("原始點雲");
    const originalText = originalEditor.textContent;
    // jsdom has no layout hit testing; table handles use the actual event target.
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [] });
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => null });
    fireEvent.mouseMove(originalEditor.querySelector("tr:last-child td:last-child")!);
    fireEvent.click(screen.getByRole("button", { name: "Complete from Draft" }));
    await waitFor(() => expect(readingNotes.ai.send).toHaveBeenCalled());
    expect(readingNotes.ai.startCreate).toHaveBeenCalledWith(expect.objectContaining({
      userDraft: expect.stringContaining("PointNet")
    }));
    const snapshot: ReadingNoteAiSnapshot = {
      sessionId: "session-1", mode: "create", phase: "responding", messages: [],
      hasChanges: false, status: "AI is responding…"
    };
    act(() => emit?.({ ...snapshot, streamingDraft: {
      title: "點雲特徵提取", content: "點雲模型會學習特徵。\n\n```text\n原始點雲\n↓"
    } }));
    expect(screen.getByRole("region", { name: "AI streaming note preview" }).textContent)
      .toContain("原始點雲");
    expect(originalEditor.isConnected).toBe(true);
    expect(originalEditor.closest("[hidden]")).not.toBeNull();
    expect(originalEditor.getAttribute("contenteditable")).toBe("false");
    expect(readingNotes.create).not.toHaveBeenCalled();
    expect(readingNotes.update).not.toHaveBeenCalled();
    if (outcome === "stop") {
      readingNotes.ai.stop = vi.fn(async () => ({ ...snapshot, phase: "ready" as const, status: "Stopped." }));
      fireEvent.click(screen.getByRole("button", { name: "Stop" }));
      await waitFor(() => expect(screen.queryByRole("region", { name: "AI streaming note preview" })).toBeNull());
    }
    await act(async () => finish?.({
      ...snapshot, phase: outcome === "error" ? "error" : "ready",
      status: outcome === "error" ? "AI could not complete this note." : "Done.",
      ...(outcome === "error" || outcome === "stop" ? {} : {
        draft: { title: "點雲特徵提取", content: `點雲模型會學習特徵。\n\n${pointCloudDraftMarkdown}` },
        hasChanges: true
      })
    }));
    if (outcome === "apply" || outcome === "reject") {
      await screen.findByRole("region", { name: "AI proposed note preview" });
      fireEvent.click(screen.getByRole("button", {
        name: outcome === "apply" ? "Apply changes" : "Don't apply changes"
      }));
    }
    await screen.findByRole("textbox", { name: "Reading note title" });
    const restored = document.querySelector<HTMLElement>('.bn-editor[contenteditable="true"]')!;
    expect(restored.querySelector("table")).not.toBeNull();
    expect(restored.querySelector("pre")?.textContent).toContain("原始點雲");
    expect(restored.textContent).toContain("DGCNN");
    if (outcome === "apply") {
      expect(restored.textContent).toContain("點雲模型會學習特徵。");
      fireEvent.click(screen.getByRole("button", { name: "Save note" }));
      await waitFor(() => expect(readingNotes.create).toHaveBeenCalled());
      const stored = vi.mocked(readingNotes.create).mock.calls[0]![0].content;
      expect(stored.blocks.some((block) => block.type === "table")).toBe(true);
      expect(readingNoteDocumentToMarkdown(stored)).toContain("點雲模型會學習特徵。");
      fireEvent.click(screen.getByRole("button", { name: "Undo applied change" }));
      expect(restored.textContent).toBe(originalText);
    } else {
      expect(restored.textContent).toBe(originalText);
      expect(readingNotes.create).not.toHaveBeenCalled();
    }
  }
);

test("F73 conversation-generated content opens editable and saves explicitly without a handwritten draft", async () => {
  const local = api();
  const save = vi.fn(async (_input: { title: string; content: import("../src/shared/reading-note-document").ReadingNoteDocument }) => savedNote);
  const onSaved = vi.fn();
  const initialDraft = { title: "AI 已整理的概念", content: markdownToReadingNoteDocument("討論後釐清的理解。"), save };
  render(<ReadingNoteEditorDialog api={local as unknown as ReaderDesktopApi["readingNotes"]} mode="create"
    source={source} initialDraft={initialDraft} onClose={vi.fn()} onSaved={onSaved} />);
  expect((screen.getByRole("textbox", { name: "Reading note title" }) as HTMLTextAreaElement).value).toBe(initialDraft.title);
  expect(screen.getByText("討論後釐清的理解。")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), { target: { value: "我修改的標題" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].title).toBe("我修改的標題");
  expect(readingNoteDocumentToMarkdown(save.mock.calls[0][0].content)).toContain("討論後釐清的理解。");
  expect(local.beginDraft).not.toHaveBeenCalled();
  expect(local.create).not.toHaveBeenCalled();
});

test("F73 initial conversation markdown preserves tables, formulas and separate list items in the editable document", async () => {
  const local = api();
  const save = vi.fn(async (_input: { title: string; content: import("../src/shared/reading-note-document").ReadingNoteDocument }) => savedNote);
  const markdown = "理解 $E=mc^2$。\n\n| 概念 | 說明 |\n| --- | --- |\n| 質量 | 能量 |\n\n- 第一個理解\n- 第二個理解";
  render(<ReadingNoteEditorDialog api={local as unknown as ReaderDesktopApi["readingNotes"]} mode="create" source={source}
    initialDraft={{ title: "概念", content: markdownToReadingNoteDocument(markdown), markdown, save }} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByRole("table")).toBeTruthy();
  await waitFor(() => expect(document.querySelector(".katex")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const blocks = save.mock.calls[0]![0]!.content.blocks;
  expect(blocks.some(block => block.type === "table")).toBe(true);
  expect(blocks.filter(block => block.type === "bulletListItem")).toHaveLength(2);
});

test("F73 failed conversation draft save retains edits and allows retry; cancel never saves", async () => {
  const local = api();
  const save = vi.fn().mockRejectedValueOnce(new Error("磁碟暫時無法寫入")).mockResolvedValue(savedNote);
  const close = vi.fn();
  render(<ReadingNoteEditorDialog api={local as unknown as ReaderDesktopApi["readingNotes"]} mode="create" source={source}
    initialDraft={{ title: "概念", content: savedNote.content, save, stagedAttachmentIds: ["staged"] }} onClose={close} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), { target: { value: "保留修改" } });
  fireEvent.click(screen.getByRole("button", { name: "Close reading note draft" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await screen.findByText("磁碟暫時無法寫入");
  expect(screen.getByRole("textbox", { name: "Reading note title" })).toHaveProperty("value", "保留修改");
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledTimes(2);
});
