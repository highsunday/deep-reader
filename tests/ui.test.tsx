import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import {
  AccountSettings,
  AnnotationTool,
  App,
  BookOverview,
  BookShelf,
  ChatMessageList,
  CodexAccountStatus,
  ReaderToolbar,
  ReadingRangeBoundary,
  ReadingRangeContextMenu,
  ReadingContextNotice,
  ReadingSegmentShortcutBar,
  DeleteBookDialog,
  chatPanelWidthFromPointer,
  chatPanelWidthFromStorage,
  navigationAfterBookSelection,
  nextBookIdAfterDeletion,
  resumeChapterId,
  scrollProgressForReader,
  scrollTopForReadingProgress
} from "../src/renderer/App";
import { normalizeBackslashMathDelimiters } from "../src/renderer/markdown-math";
import type { LibraryBook } from "../src/shared/contracts";

const connectedSnapshot = {
  connection: "ready" as const,
  connectionDetail: "Connected as reader@example.com",
  account: { type: "chatgpt", email: "reader@example.com" },
  allowance: {
    phase: "available" as const,
    fiveHour: { remainingPercent: 75, resetsAt: 1_800_000_000 },
    weekly: { remainingPercent: 62, resetsAt: 1_800_500_000 },
    detail: "Shared account allowance loaded."
  },
  threadId: null,
  activeTurnId: null,
  messages: [],
  conversations: [],
  activeConversationId: null,
  managementBusy: false
};

test("START and END boundaries expose the bookmark arrow, label, and line structure", () => {
  for (const marker of ["start", "end"] as const) {
    const markup = renderToStaticMarkup(
      <ReadingRangeBoundary marker={marker} top={120} onPointerDown={() => undefined} />
    );
    assert.match(markup, new RegExp(`class="range-boundary ${marker}"`));
    assert.match(markup, /class="range-boundary-handle"/);
    assert.match(markup, /<span aria-hidden="true"><\/span>/);
    assert.match(markup, /class="range-boundary-label"/);
    assert.match(markup, new RegExp(`>${marker.toUpperCase()}<`));
  }
});

const book: LibraryBook = {
  id: "book-1",
  title: "Thinking in Systems",
  author: "Donella Meadows",
  coverDataUrl: "data:image/png;base64,iVBORw0KGgo=",
  chapters: [
    { id: "chapter-1", title: "The Basics", href: "basics.xhtml", order: 0 },
    { id: "chapter-2", title: "Feedback Loops", href: "feedback.xhtml", order: 1 }
  ],
  readingState: { view: "overview", chapterId: null, scrollProgress: 0 },
  chapterRanges: {},
  chapterAnnotations: {}
};

test("the chapter context menu exposes START, END, annotation colors, and removal", () => {
  const markup = renderToStaticMarkup(
    <ReadingRangeContextMenu
      x={120}
      y={180}
      onMoveStart={() => undefined}
      onMoveEnd={() => undefined}
      annotationId="annotation-1"
      annotationColor="yellow"
      onChangeAnnotationColor={() => undefined}
      onRemoveAnnotation={() => undefined}
    />
  );
  assert.match(markup, /role="menu"/);
  assert.match(markup, /Move start here/);
  assert.match(markup, /Move end here/);
  assert.match(markup, /Remove annotation/);
  for (const color of ["yellow", "green", "blue", "pink", "purple"]) {
    assert.match(markup, new RegExp(`Change annotation color to ${color}`));
  }
  assert.doesNotMatch(markup, /白話說明/);
});

test("the chapter context menu explains an original selection and disables out-of-range text", () => {
  const valid = renderToStaticMarkup(
    <ReadingRangeContextMenu
      x={120}
      y={180}
      onMoveStart={() => undefined}
      onMoveEnd={() => undefined}
      selectedText="Selected passage"
      selectionValid
      onExplainSelection={() => undefined}
    />
  );
  const invalid = renderToStaticMarkup(
    <ReadingRangeContextMenu
      x={120}
      y={180}
      onMoveStart={() => undefined}
      onMoveEnd={() => undefined}
      selectedText="Outside passage"
      selectionValid={false}
      onExplainSelection={() => undefined}
    />
  );
  assert.match(valid, /白話說明/);
  assert.doesNotMatch(valid, /詳細說明/);
  assert.match(valid, /context-menu-explain/);
  assert.doesNotMatch(valid, /context-menu-explain"[^>]*disabled/);
  assert.match(invalid, /context-menu-explain"[^>]*disabled=""/);
});

test("the annotation color tool selects a color and exposes its active state", () => {
  const inactive = renderToStaticMarkup(
    <AnnotationTool activeColor={null} count={0} onSelectColor={() => undefined} />
  );
  const active = renderToStaticMarkup(
    <AnnotationTool activeColor="green" count={2} onSelectColor={() => undefined} />
  );
  for (const color of ["yellow", "green", "blue", "pink", "purple"]) {
    assert.match(inactive, new RegExp(`Use ${color} annotation`));
  }
  assert.equal((inactive.match(/aria-pressed="false"/g) ?? []).length, 5);
  assert.match(active, /annotation-color-button[^\"]* active/);
  assert.match(active, /aria-label="Turn off green annotation mode" aria-pressed="true"/);
  assert.match(active, /<em>2<\/em>/);
});

test("all five annotation colors have toolbar and reading highlight styles", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  for (const color of ["yellow", "green", "blue", "pink", "purple"]) {
    assert.match(styles, new RegExp(`\\.annotation-color-${color}\\s*\\{`));
    assert.match(styles, new RegExp(
      `\\.reader-annotation-highlight\\[data-annotation-color="${color}"\\]`
    ));
  }
});

test("the reader shell has no language-learning navigation", () => {
  const markup = renderToStaticMarkup(<App />);
  assert.doesNotMatch(markup, /<button[^>]*>[^<]*Import EPUB/);
  assert.match(markup, /Settings/);
  assert.match(markup, /reader-panel overview-view/);
  assert.doesNotMatch(markup, /overview-toolbar/);
  assert.doesNotMatch(
    markup,
    /Review|Sentence Practice|Listen &amp; Repeat|Learning Library/
  );
});

test("memory-image progress lives in the lower-right corner of the main reader panel", () => {
  const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  const readerStart = source.indexOf('<section className={`reader-panel');
  const progress = source.indexOf("<MemoryImageGenerationProgress", readerStart);
  const readerEnd = source.indexOf("</section>", readerStart);
  assert.ok(readerStart >= 0 && progress > readerStart && progress < readerEnd);

  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const progressRule = styles.match(/\.memory-image-generation-progress \{([^}]*)\}/)?.[1] ?? "";
  assert.match(progressRule, /position:\s*absolute/);
  assert.match(progressRule, /right:\s*16px/);
  assert.match(progressRule, /bottom:\s*16px/);
  assert.match(progressRule, /max-width:\s*calc\(100% - 32px\)/);
  assert.match(styles, /\.memory-image-activity-row\s*\{[^}]*min-height:\s*34px/);
  assert.doesNotMatch(progressRule, /linear-gradient/);
});

test("the reading conversation composer combines input, model selection, and send controls", () => {
  const markup = renderToStaticMarkup(<App />);
  assert.match(markup, /chat-composer-card/);
  assert.match(markup, /Ask about the marked passage/);
  assert.match(markup, /aria-label="Choose AI model"/);
  for (const model of [
    "GPT-5.6-Sol",
    "GPT-5.6-Terra",
    "GPT-5.6-Luna",
    "GPT-5.5",
    "GPT-5.4",
    "GPT-5.4-Mini",
    "GPT-5.3-Codex-Spark"
  ]) {
    assert.match(markup, new RegExp(model.replaceAll(".", "\\.")));
  }
  assert.match(markup, /aria-label="Send question"/);
  assert.match(markup, /Enter 送出 · Shift\+Enter 換行 · 可直接貼上圖片/);
  assert.doesNotMatch(markup, /Ask AI Tutor/);
});

test("the AI Tutor shows five reading shortcuts and a video preparation entry", () => {
  const enabled = renderToStaticMarkup(
    <ReadingSegmentShortcutBar
      disabled={false}
      onGenerateGuide={() => undefined}
      onStartReadingCoach={() => undefined}
      onStartLearningQuestionQuiz={() => undefined}
      onStartSelfRetelling={() => undefined}
      onCreateReadingNote={() => undefined}
    />
  );
  const disabled = renderToStaticMarkup(
    <ReadingSegmentShortcutBar
      disabled
      onGenerateGuide={() => undefined}
      onStartReadingCoach={() => undefined}
      onStartLearningQuestionQuiz={() => undefined}
      onStartSelfRetelling={() => undefined}
      onCreateReadingNote={() => undefined}
    />
  );

  assert.match(enabled, /class="chat-preset-bar reader-chat-preset-bar"/);
  assert.match(enabled, /role="toolbar"/);
  assert.match(enabled, /aria-label="閱讀區段快捷功能"/);
  assert.match(enabled, /aria-label="Reading Guide"[^>]*data-tooltip="Reading Guide"/);
  assert.match(enabled, /aria-label="Guided Learning"[^>]*data-tooltip="Understand this passage step by step"/);
  assert.match(enabled, /aria-label="Take a Quiz"[^>]*data-tooltip="Answer independently, then review your understanding"/);
  assert.match(enabled, /aria-label="Retell"[^>]*data-tooltip="Explain the passage in your own words"/);
  assert.match(enabled, /aria-label="Create Note"[^>]*data-tooltip="Create Note"/);
  assert.doesNotMatch(enabled, /title=/);
  assert.match(enabled, />Reading Guide</);
  assert.match(enabled, />Guided Learning</);
  assert.match(enabled, />Take a Quiz</);
  assert.match(enabled, />Retell</);
  assert.match(enabled, />Create Note</);
  assert.match(enabled, /aria-label="Create Video"/);
  assert.doesNotMatch(enabled, />白話說明</);
  assert.match(enabled, /<svg/);
  assert.doesNotMatch(enabled, /disabled=""/);
  assert.equal((disabled.match(/disabled=""/g) ?? []).length, 5);

  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.chat-preset-bar\s*\{[^}]*grid-template-columns:\s*repeat\(10,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.chat-preset-bar > \.annotation-analysis-preset:nth-child\(2\)\s*\{[^}]*grid-column:\s*span 4/);
  assert.match(styles, /\.chat-preset-bar > \.annotation-analysis-preset:nth-child\(n \+ 4\)\s*\{[^}]*grid-column:\s*span 5/);
  assert.match(styles, /\.annotation-analysis-preset\s*\{[^}]*min-height:\s*32px[^}]*color:\s*#3f4d43[^}]*background:\s*#fffefa/);
  assert.match(styles, /@container chat-panel \(max-width:\s*330px\)/);
  assert.match(styles, /content:\s*attr\(data-tooltip\)/);
  assert.match(styles, /\.annotation-analysis-preset:focus-visible::after/);
  assert.match(styles, /\.reader-chat-preset-bar > \.reading-note-preset svg\s*\{[^}]*color:/);
  assert.match(styles, /\.chat-form\s*\{[^}]*border-top:\s*0/);
  assert.match(styles, /\.annotation-analysis-preset:hover:not\(:disabled\)\s*\{[^}]*color:\s*var\(--primary\);[^}]*background:\s*#f1f7fa/);
  assert.doesNotMatch(styles, /\.reading-guide-preset\s*\{/);
  assert.doesNotMatch(styles, /\.self-retelling-preset\s*\{/);
  assert.match(styles, /\.annotation-analysis-preset:hover:not\(:disabled\)/);
  assert.match(styles, /\.annotation-analysis-preset:focus-visible/);
  assert.match(
    styles,
    /\.workspace-shell\.chat-collapsed \.reader-chat-preset-bar\s*\{\s*display:\s*none;/
  );
});

test('video covers can load saved blob images under the renderer policy', () => {
  const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  assert.match(html, /img-src 'self' data: blob:/);
});

test("Create Note opens the reader-led draft instead of sending the shortcut into chat", () => {
  const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  assert.match(source, /onCreateReadingNote=\{openReadingNoteDraft\}/);
  assert.match(source, /setReadingNoteDraftSource\(\{/);
  const openDraft = source.match(/function openReadingNoteDraft\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
  assert.doesNotMatch(openDraft, /setLibraryMode\("reading-notes"\)/);
  assert.match(
    source,
    /<section className=\{`reader-panel[\s\S]*?<ReadingNoteEditorDialog[\s\S]*?<\/section>\s*\n\s*<aside className="chat-panel">/
  );
  assert.doesNotMatch(source, /onCreateReadingNote=\{\(\) => void sendReadingSegmentShortcut\("createReadingNote"\)\}/);
});

test("every AI reading-segment entry point uses the shared visual-line context", () => {
  const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  for (const functionName of [
    "sendMessage",
    "explainSelectedPassage",
    "sendReadingSegmentShortcut",
    "openReadingNoteDraft"
  ]) {
    const body = source.match(
      new RegExp(`(?:async )?function ${functionName}\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\n  \\}`)
    )?.[1] ?? "";
    assert.match(body, /readingSegmentContextForArticle\(/, functionName);
    assert.doesNotMatch(body, /extractReadingSegment\(/, functionName);
  }
});

test("collapsing the reader chat does not hide shared chat UI inside the note editor", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

  for (const sharedClass of ["chat-header", "chat-content", "range-notice", "messages", "chat-form"]) {
    assert.match(
      styles,
      new RegExp(`\\.workspace-shell\\.chat-collapsed > \\.chat-panel \\.${sharedClass}`)
    );
    assert.doesNotMatch(
      styles,
      new RegExp(`\\.workspace-shell\\.chat-collapsed \\.${sharedClass}(?:,|\\s*\\{)`)
    );
  }
});

test("reading conversation messages use a compact user bubble and plain AI response", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      messages={[
        { id: "u1", turnId: "t1", role: "user", text: "hi", status: "completed" },
        {
          id: "a1",
          turnId: "t1",
          role: "assistant",
          text: "Hi! What would you like to explore?",
          status: "completed"
        }
      ]}
    />
  );
  assert.match(markup, /class="message user"/);
  assert.match(markup, /aria-label="Your message"/);
  assert.match(markup, /class="message assistant"/);
  assert.match(markup, /aria-label="AI Tutor response"/);
  assert.doesNotMatch(markup, />You<|>AI Tutor</);
});

test("a persisted original selection renders as a collapsible quote in the user message", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      messages={[{
        id: "u1",
        turnId: "t1",
        role: "user",
        text: "請用白話說明這段內容",
        quote: { text: "A long selected passage." },
        status: "completed"
      }]}
    />
  );
  assert.match(markup, /message-quote/);
  assert.match(markup, /A long selected passage\./);
  assert.match(markup, /請用白話說明這段內容/);
  assert.match(markup, /<details/);
});

test("AI Tutor responses render Markdown while reader messages stay plain text", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      messages={[
        {
          id: "u1",
          turnId: "t1",
          role: "user",
          text: "**Reader text**",
          status: "completed"
        },
        {
          id: "a1",
          turnId: "t1",
          role: "assistant",
          text: "## Outline\n\n**Key idea**\n\n- Observe\n- Reflect\n\n```ts\nconst safe = true;\n```",
          status: "completed"
        }
      ]}
    />
  );

  assert.match(markup, /<p>\*\*Reader text\*\*<\/p>/);
  assert.match(markup, /<h2>Outline<\/h2>/);
  assert.match(markup, /<strong>Key idea<\/strong>/);
  assert.match(markup, /<ul>[\s\S]*<li>Observe<\/li>[\s\S]*<li>Reflect<\/li>[\s\S]*<\/ul>/);
  assert.match(markup, /<pre><code class="language-ts">const safe = true;/);
});

test("AI Tutor math renders without turning raw HTML into DOM elements", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      messages={[
        {
          id: "a1",
          turnId: "t1",
          role: "assistant",
          text: '$E = mc^2$\n\n<button onclick="alert(1)">Unsafe</button><script>alert(1)</script>',
          status: "completed"
        }
      ]}
    />
  );

  assert.match(markup, /class="katex"/);
  assert.doesNotMatch(markup, /<(?:button|script)(?:\s|>)/);
  assert.match(markup, /&lt;button/);
});

test("AI Tutor responses render inline and display LaTeX with KaTeX", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      messages={[
        {
          id: "a1",
          turnId: "t1",
          role: "assistant",
          text: "Energy is $E = mc^2$.\n\n$$\n\\int_0^1 x^2\\,dx\n$$",
          status: "completed"
        }
      ]}
    />
  );

  assert.match(markup, /<p>Energy is <span class="katex">/);
  assert.match(markup, /class="katex-display"/);
  assert.match(markup, /<math/);
});

test("AI Tutor responses render backslash inline and display LaTeX delimiters", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      messages={[
        {
          id: "a1",
          turnId: "t1",
          role: "assistant",
          text: "Energy is \\(E=mc^2\\).\n\n\\[\n\\boxed{E_0=mc^2}\n\\]",
          status: "completed"
        }
      ]}
    />
  );

  assert.match(markup, /<p>Energy is <span class="katex">/);
  assert.match(markup, /class="katex-display"/);
  assert.match(markup, /E_0=mc\^2/);
});

test("AI Tutor keeps backslash LaTeX delimiters literal inside code", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      messages={[
        {
          id: "a1",
          turnId: "t1",
          role: "assistant",
          text: "Inline `\\(x\\)`\n\n```tex\n\\[x\\]\n```",
          status: "completed"
        }
      ]}
    />
  );

  assert.match(markup, /<code>\\\(x\\\)<\/code>/);
  assert.match(markup, /<pre><code class="language-tex">\\\[x\\\]/);
  assert.doesNotMatch(markup, /class="katex"/);
});

test("backslash math normalization preserves code, unmatched, and escaped delimiters", () => {
  const codeAndMath = [
    "Inline `\\(x\\)`",
    "",
    "```tex",
    "\\[x\\]",
    "```",
    "",
    "Outside \\(y\\)"
  ].join("\n");
  assert.equal(
    normalizeBackslashMathDelimiters(codeAndMath),
    codeAndMath.replace("Outside \\(y\\)", "Outside $y$")
  );

  const unmatched = "Unclosed \\(x and \\[y";
  assert.equal(normalizeBackslashMathDelimiters(unmatched), unmatched);

  const escaped = String.raw`Literal \\(x\\) and \\[y\\]`;
  assert.equal(normalizeBackslashMathDelimiters(escaped), escaped);

  const dollarDelimited = "Inline $x$\n\n$$\ny\n$$";
  assert.equal(normalizeBackslashMathDelimiters(dollarDelimited), dollarDelimited);
});

test("invalid AI Tutor LaTeX degrades locally without hiding surrounding Markdown", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      messages={[
        {
          id: "a1",
          turnId: "t1",
          role: "assistant",
          text: "Before $\\definitelynotacommand$ after.\n\n**Still visible**",
          status: "completed"
        }
      ]}
    />
  );

  assert.match(markup, /Before/);
  assert.match(markup, /definitelynotacommand/);
  assert.match(markup, /after/);
  assert.match(markup, /<strong>Still visible<\/strong>/);
});

test("AI Tutor display math scrolls horizontally inside a narrow panel", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.message-markdown \.katex-display\s*\{[^}]*overflow-x:\s*auto/);
});

test("AI Tutor boxed math uses the same KaTeX version as its stylesheet", () => {
  const require = createRequire(import.meta.url);
  const rendererRequire = createRequire(require.resolve("rehype-katex"));
  const stylesheetVersion = require("katex/package.json").version;
  const rendererVersion = rendererRequire("katex/package.json").version;
  assert.equal(rendererVersion, stylesheetVersion, "KaTeX markup and CSS must use the same version");

  const markup = renderToStaticMarkup(
    <ChatMessageList activeTurnId={null} messages={[{
      id: "boxed-math", turnId: "t1", role: "assistant", status: "completed",
      text: String.raw`\[\boxed{\dot V=\sum_{k=1}^K\gamma_k(x)(x-x^*)^TA^k(x-x^*)}.\]`
    }]} />
  );
  const styles = readFileSync(require.resolve("katex/dist/katex.css"), "utf8");
  // The box needs its matching positioning rule; without it, its zero-width
  // border appears as a vertical line through the middle of the equation.
  const boxClass = /class="([^"]*\bfbox\b[^"]*)"/.exec(markup)?.[1]
    .split(" ").find(className => className.endsWith("fbox"));
  assert.ok(boxClass, "the actual Markdown renderer must produce a boxed equation");
  assert.match(styles, new RegExp(`\\.katex \\.${boxClass}[\\s,][^{]*\\{[^}]*border:`),
    "the loaded CSS must style the rendered box");
});

test("an empty AI Tutor response keeps the streaming placeholder", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId="t1"
      messages={[
        { id: "a1", turnId: "t1", role: "assistant", text: "", status: "streaming" }
      ]}
    />
  );

  assert.match(markup, /<p>…<\/p>/);
});

test("an active AI response uses the compact Codex responding treatment", () => {
  const markup = renderToStaticMarkup(
    <ChatMessageList activeTurnId="turn-1" messages={[]} />
  );
  assert.match(markup, /class="responding" role="status"/);
  assert.match(markup, /Codex is responding…/);
  assert.doesNotMatch(markup, /AI Tutor is responding/);
});

test("the reading context notice disappears after conversation text exists", () => {
  const emptyMarkup = renderToStaticMarkup(
    <ReadingContextNotice hasRange hasMessages={false} />
  );
  const conversationMarkup = renderToStaticMarkup(
    <ReadingContextNotice hasRange hasMessages />
  );
  assert.match(emptyMarkup, /AI context/);
  assert.match(emptyMarkup, /START → END only/);
  assert.equal(conversationMarkup, "");
});

test("the conversation content is grouped separately from the bottom composer", () => {
  const markup = renderToStaticMarkup(<App />);
  assert.match(
    markup,
    /<div class="chat-content">[\s\S]*class="messages"[\s\S]*<\/div><form class="chat-form reading-chat-form"/
  );
});

test("the AI Tutor exposes compact conversation actions and the 10-item history", () => {
  const markup = renderToStaticMarkup(<App />);
  assert.match(markup, /aria-label="New conversation"/);
  assert.match(markup, /aria-label="Conversation history"/);
  assert.match(markup, /<span>New<\/span>/);
  assert.match(markup, /<span>History<\/span>/);
  assert.match(markup, /aria-label="Copy conversation"[^>]*disabled=""/);
});

test("the AI Tutor panel exposes a mouse resize handle", () => {
  const markup = renderToStaticMarkup(<App />);
  assert.match(markup, /class="chat-resize-handle"/);
  assert.match(markup, /aria-label="Resize AI Tutor panel"/);
  assert.match(markup, /aria-orientation="vertical"/);
});

test("AI Tutor panel width follows the pointer within layout limits", () => {
  assert.equal(chatPanelWidthFromPointer(900, 1_440, false), 540);
  assert.equal(chatPanelWidthFromPointer(1_350, 1_440, false), 380);
  assert.equal(chatPanelWidthFromPointer(100, 1_440, false), 690);
  assert.equal(chatPanelWidthFromPointer(100, 1_440, true), 720);
  assert.equal(chatPanelWidthFromPointer(100, 1_100, false), 410);
});

test("AI Tutor panel storage uses 380px when no valid preference exists", () => {
  assert.equal(chatPanelWidthFromStorage(null), 380);
  assert.equal(chatPanelWidthFromStorage("not-a-number"), 380);
  assert.equal(chatPanelWidthFromStorage("300"), 380);
  assert.equal(chatPanelWidthFromStorage("500"), 500);
  assert.equal(chatPanelWidthFromStorage("999"), 720);
});

test("Settings separates the connected Codex account and memory-image templates into tabs", () => {
  const markup = renderToStaticMarkup(
    <AccountSettings
      snapshot={connectedSnapshot}
      memoryImageTemplates={{} as never}
      onReconnect={() => undefined}
      onClose={() => undefined}
    />
  );
  assert.match(markup, /Account/);
  assert.match(markup, /reader@example\.com/);
  assert.match(markup, /Reconnect Codex/);
  assert.match(markup, /Memory Images/);
  assert.match(markup, /role="tablist" aria-label="Settings sections"/);
  assert.match(markup, /role="tab"[^>]*aria-selected="true"[^>]*>Account</);
  assert.match(markup, /role="tabpanel"[^>]*aria-labelledby="settings-tab-account"/);
  assert.match(markup, /role="tabpanel"[^>]*aria-labelledby="settings-tab-memory-images"/);
  assert.doesNotMatch(markup, /General|Voice|Review|Sentence Practice/);
});

test("Settings keeps its tab bar fixed above a separately scrolling panel", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  assert.match(styles, /\.settings-dialog\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);/s);
  assert.match(styles, /\.settings-tabs\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;/s);
  assert.match(styles, /\.settings-panel\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.match(styles, /\.settings-panel > \.memory-image-settings\s*\{[^}]*padding-top:\s*0;[^}]*border-top:\s*0;/s);
});

test("memory-image template dialogs use a centered layer above Settings", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const genericLayer = Number(styles.match(/\.dialog-backdrop\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
  const templateLayer = Number(styles.match(/\.memory-image-template-dialog-backdrop\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);

  assert.match(styles, /\.dialog-backdrop\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*display:\s*grid;[^}]*place-items:\s*center;/s);
  assert.ok(templateLayer > genericLayer, `Template dialog layer ${templateLayer} must be above generic layer ${genericLayer}`);
  assert.match(styles, /\.memory-image-template-dialog\s*\{[^}]*width:\s*min\(560px,\s*100%\);[^}]*max-height:/s);
});

test("Settings stays above an already open reading-note card", () => {
  const styles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  const settingsLayer = Number(styles.match(/\.settings-backdrop\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);
  const readingNoteLayer = Number(styles.match(/\.reading-note-reader-overlay\s*\{[^}]*z-index:\s*(\d+)/s)?.[1]);

  assert.ok(Number.isFinite(settingsLayer));
  assert.ok(Number.isFinite(readingNoteLayer));
  assert.ok(settingsLayer > readingNoteLayer, `Settings layer ${settingsLayer} must be above reading-note layer ${readingNoteLayer}`);
  assert.match(source, /settingsOpen \? " settings-modal-open" : ""/);
  assert.match(styles, /\.workspace-shell\.settings-modal-open \.reading-note-reader-overlay\s*\{[^}]*visibility:\s*hidden;/s);
});

test("the original Codex connection and allowance card stays in the sidebar", () => {
  const markup = renderToStaticMarkup(
    <CodexAccountStatus snapshot={connectedSnapshot} />
  );
  assert.match(markup, /Codex/);
  assert.match(markup, /Connected/);
  assert.match(markup, /5 hours/);
  assert.match(markup, /75%/);
  assert.match(markup, /Weekly/);
  assert.match(markup, /62%/);
});

test("the sidebar shelf shows scrollable books but not chapter navigation", () => {
  const markup = renderToStaticMarkup(
    <BookShelf books={[{ ...book, pinned: true }]} selectedBookId={book.id} onSelect={() => undefined} />
  );
  assert.match(markup, /Pinned books/);
  assert.doesNotMatch(markup, /library-primary-navigation|主要 Library 導覽/);
  assert.match(markup, /reading-note-library-navigation/);
  assert.match(markup, /<span>Notes<\/span>/);
  assert.match(markup, /Thinking in Systems/);
  assert.match(markup, /Donella Meadows/);
  assert.match(markup, /book-list/);
  assert.doesNotMatch(markup, /The Basics|Feedback Loops|Start reading/);
});

test("the sidebar keeps the book Library and highlights its reading-note page entry", () => {
  const markup = renderToStaticMarkup(
    <BookShelf
      books={[{ ...book, pinned: true }]}
      selectedBookId={book.id}
      mode="reading-notes"
      onModeChange={() => undefined}
      onSelect={() => undefined}
    />
  );
  assert.doesNotMatch(markup, /library-primary-navigation|>書籍<|Saved cards/);
  assert.match(markup, /aria-current="page"/);
  assert.match(markup, /reading-note-library-navigation/);
  assert.match(markup, /Donella Meadows/);
});

test("a selected book has an overview page containing its chapters", () => {
  const markup = renderToStaticMarkup(
    <BookOverview
      book={book}
      onContinue={() => undefined}
      onDelete={() => undefined}
      onOpenChapter={() => undefined}
    />
  );
  assert.match(markup, /Book overview/);
  assert.match(markup, /Thinking in Systems/);
  assert.match(markup, /Start reading/);
  assert.match(markup, /Delete book/);
  assert.match(markup, /Contents/);
  assert.match(markup, /The Basics/);
  assert.match(markup, /Feedback Loops/);
});

test("B76 TC1: the book overview shows chapters and sections but hides deeper levels", () => {
  const hierarchicalBook: LibraryBook = {
    ...book,
    chapters: [
      { id: "chapter-1", title: "Giving From the Heart", href: "chapter.xhtml", order: 0, depth: 0, fragment: null },
      { id: "section-1", title: "Introduction", href: "chapter.xhtml", order: 1, depth: 1, fragment: "intro" },
      { id: "section-2", title: "Deep section", href: "child.xhtml", order: 2, depth: 2 },
      { id: "legacy-chapter", title: "Communication That Blocks Compassion", href: "chapter-2.xhtml", order: 2 }
    ]
  };
  const markup = renderToStaticMarkup(
    <BookOverview
      book={hierarchicalBook}
      onContinue={() => undefined}
      onDelete={() => undefined}
      onOpenChapter={() => undefined}
    />
  );

  assert.match(markup, /class="chapter-list"/);
  assert.doesNotMatch(markup, /Deep section|data-depth="2"/);
  assert.match(markup, /Introduction/);
  assert.match(markup, /class="subchapter"/);
  assert.match(markup, /data-depth="1"/);
  assert.match(markup, /Read section/);
  assert.match(markup, /3 chapters/);
  assert.match(markup, />02<\/span>/);
  assert.match(markup, /Open chapter/);

});

test("book progress resumes the last valid chapter and otherwise starts at the first chapter", () => {
  assert.equal(resumeChapterId(book), "chapter-1");
  assert.equal(resumeChapterId({ ...book, lastChapterId: "chapter-2" }), "chapter-2");
  assert.equal(resumeChapterId({ ...book, lastChapterId: "missing" }), "chapter-1");
  const continued = renderToStaticMarkup(
    <BookOverview
      book={{ ...book, lastChapterId: "chapter-2" }}
      onContinue={() => undefined}
      onDelete={() => undefined}
      onOpenChapter={() => undefined}
    />
  );
  const stale = renderToStaticMarkup(
    <BookOverview
      book={{ ...book, lastChapterId: "missing" }}
      onContinue={() => undefined}
      onDelete={() => undefined}
      onOpenChapter={() => undefined}
    />
  );
  assert.match(continued, /Continue reading/);
  assert.match(stale, /Start reading/);
});

test("book selection restores each book's saved view and chapter", () => {
  const reading = {
    selectedBookId: "book-1",
    activeChapterId: "chapter-2",
    view: "reader" as const
  };
  const overview = {
    selectedBookId: "book-1",
    activeChapterId: undefined,
    view: "overview" as const
  };

  assert.deepEqual(navigationAfterBookSelection(reading, book), reading);
  assert.deepEqual(navigationAfterBookSelection(overview, book), overview);
  assert.deepEqual(navigationAfterBookSelection(reading, {
    ...book,
    id: "book-2",
    lastChapterId: "chapter-2",
    readingState: { view: "reader", chapterId: "chapter-2", scrollProgress: 0.5 }
  }), {
    selectedBookId: "book-2",
    activeChapterId: "chapter-2",
    view: "reader"
  });
  assert.deepEqual(navigationAfterBookSelection(reading, {
    ...book,
    id: "book-3",
    lastChapterId: "chapter-2",
    readingState: { view: "overview", chapterId: "chapter-2", scrollProgress: 0.25 }
  }), {
    selectedBookId: "book-3",
    activeChapterId: undefined,
    view: "overview"
  });
  assert.deepEqual(navigationAfterBookSelection(reading, {
    ...book,
    id: "book-4",
    lastChapterId: "chapter-2",
    readingState: { view: "reader", chapterId: "missing", scrollProgress: 0.75 }
  }), {
    selectedBookId: "book-4",
    activeChapterId: undefined,
    view: "overview"
  });

  const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /if \(mode === "reading-notes"\) setView\("overview"\)/
  );
  assert.match(source, /onScroll=\{handleReaderScroll\}/);
  assert.match(source, /const firstBook = loadedBooks\[0\]/);
  assert.match(source, /readingStateSaveTimerRef\.current = setTimeout\(\(\) => \{/);
  assert.match(source, /\}, 300\);/);
  assert.match(source, /if \(mode === "reading-notes" \|\| mode === "bookshelf"\) saveCurrentReaderPosition\(\);/);
  assert.match(source, /persistBookReadingState\(\s*selectedBook,\s*"overview"/);
});

test("reader scroll state uses a clamped relative position like the original app", () => {
  assert.equal(scrollProgressForReader(400, 1_000, 200), 0.5);
  assert.equal(scrollProgressForReader(900, 1_000, 200), 1);
  assert.equal(scrollProgressForReader(-10, 1_000, 200), 0);
  assert.equal(scrollProgressForReader(100, 200, 200), 0);
  assert.equal(scrollTopForReadingProgress(0.5, 1_000, 200), 400);
  assert.equal(scrollTopForReadingProgress(2, 1_000, 200), 800);
  assert.equal(scrollTopForReadingProgress(Number.NaN, 1_000, 200), 0);
});

test("the delete confirmation names the book and warns that deletion is permanent", () => {
  const markup = renderToStaticMarkup(
    <DeleteBookDialog
      book={book}
      pending={false}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />
  );
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /Delete book\?/);
  assert.match(markup, /Thinking in Systems/);
  assert.match(markup, /cannot be undone/i);
  assert.match(markup, /Cancel/);
  assert.match(markup, /Delete permanently/);
});

test("deletion selects the next book, then the previous book, then no book", () => {
  const books = [
    { ...book, id: "first" },
    { ...book, id: "middle" },
    { ...book, id: "last" }
  ];
  assert.equal(nextBookIdAfterDeletion(books, "middle"), "last");
  assert.equal(nextBookIdAfterDeletion(books, "last"), "middle");
  assert.equal(nextBookIdAfterDeletion([books[0]!], "first"), undefined);
});

test("the reading toolbar exposes chapter navigation and text settings", () => {
  const markup = renderToStaticMarkup(
    <ReaderToolbar
      chapterTitle="Feedback Loops"
      layout={{ fontSize: 19, lineHeight: 1.9, paperWidth: 760 }}
      layoutOpen
      hasPreviousChapter
      hasNextChapter={false}
      onBack={() => undefined}
      onToggleLayout={() => undefined}
      onCloseLayout={() => undefined}
      onChangeLayout={() => undefined}
      onResetLayout={() => undefined}
      onPreviousChapter={() => undefined}
      onNextChapter={() => undefined}
    />
  );
  assert.match(markup, /Back to overview/);
  assert.match(markup, /Feedback Loops/);
  assert.match(markup, /Previous chapter/);
  assert.match(markup, /Next chapter/);
  assert.match(markup, /Text settings/);
  assert.match(markup, /Text size/);
  assert.match(markup, /Line spacing/);
  assert.match(markup, /Page width/);
  assert.match(markup, /Restore defaults/);
  assert.match(markup, /disabled=""/);
});


test("F36 selection elaboration is hidden without selection and disabled when unavailable", () => {
  for (const selectedText of [undefined, "Selected passage"]) {
    for (const selectionValid of [false, true]) {
      for (const explainDisabled of [false, true]) {
        const markup = renderToStaticMarkup(<ReadingRangeContextMenu
          x={0} y={0} onMoveStart={() => undefined} onMoveEnd={() => undefined}
          selectedText={selectedText} selectionValid={selectionValid} explainDisabled={explainDisabled}
          onElaborateSelection={() => undefined}
        />);
        if (!selectedText) assert.doesNotMatch(markup, /詳細闡明/);
        else {
          assert.match(markup, /詳細闡明/);
          assert.equal(/context-menu-elaborate"[^>]*disabled/.test(markup), !selectionValid || explainDisabled);
        }
      }
    }
  }
});

test('B76 TC3: resume and restored reader navigation resolve nested sections to their parent', () => {
  const nested = {...book, chapters: [...book.chapters.slice(0, 1),
    {id: 'nested', title: 'Nested', href: 'basics.xhtml', order: 1, depth: 2}, book.chapters[1]],
    lastChapterId: 'nested', readingState: {view: 'reader' as const, chapterId: 'nested', scrollProgress: 0}};
  assert.equal(resumeChapterId(nested), 'chapter-1');
  assert.equal(navigationAfterBookSelection({view: 'overview'}, nested).activeChapterId, 'chapter-1');
});
