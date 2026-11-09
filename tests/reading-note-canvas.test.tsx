// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ReadingNoteSourceContext } from "../src/renderer/reading-note-source-context";
import { StrictMode } from "react";
import { BlockNoteEditor } from "@blocknote/core";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import type { ReaderDesktopApi, ReadingNote, ReadingNoteAiSnapshot } from "../src/shared/contracts";
import type { ReadingNoteDocument } from "../src/shared/reading-note-document";
import { ReadingNoteCanvas, readingNoteSchema } from "../src/renderer/ReadingNoteCanvas";
import { parseReadingNoteMarkdownToBlocks, readingNoteMarkdownToHTML } from "../src/renderer/reading-note-markdown";
import { blockNoteBlocksToReadingNoteDocument } from "../src/renderer/reading-note-editor-adapter";

beforeAll(() => {
  globalThis.ClipboardEvent = class extends Event { readonly clipboardData = null; } as typeof ClipboardEvent;
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
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const note: ReadingNote = {
  id: "note-1",
  sourceDraftId: "draft-1",
  title: "Original title",
  content: {
    version: 1,
    blocks: [{
      id: "paragraph-1",
      type: "paragraph",
      props: {},
      content: [{ type: "text", text: "Editable content", styles: {} }],
      children: []
    }]
  },
  bookTitle: "Systems Thinking",
  chapterTitle: "Feedback",
  createdAt: 1,
  updatedAt: 1,
  revision: 1
};

function api(update = vi.fn(async (input) => ({ ...note, ...input, revision: 2, updatedAt: 2 }))) {
  return {
    update,
    attachments: {
      upload: vi.fn(),
      readDataUrl: vi.fn(),
      copyForNote: vi.fn()
    },
    ai: {
      startCreate: vi.fn(),
      complete: vi.fn(),
      startEdit: vi.fn(),
      startTransform: vi.fn(),
      send: vi.fn(),
      accept: vi.fn(),
      reject: vi.fn(),
      stop: vi.fn(),
      save: vi.fn(),
      discard: vi.fn()
    }
  } as unknown as ReaderDesktopApi["readingNotes"];
}

test("an active note is immediately editable and autosaves its title", async () => {
  const update = vi.fn(async (input) => ({ ...note, ...input, revision: 2, updatedAt: 2 }));
  render(<ReadingNoteCanvas api={api(update)} note={note} onBack={() => undefined} />);

  const title = screen.getByRole("textbox", { name: "Reading note title" });
  expect(title.hasAttribute("readonly")).toBe(false);
  expect(screen.queryByRole("button", { name: /^(Edit|Save changes)$/i })).toBeNull();

  fireEvent.change(title, { target: { value: "A better title" } });

  await waitFor(() => expect(update).toHaveBeenCalledTimes(1), { timeout: 2_000 });
  expect(update.mock.calls[0]?.[0]).toMatchObject({
    id: "note-1",
    baseRevision: 1,
    title: "A better title"
  });
  expect(screen.getByRole("status").textContent).toContain("Saved");
});

test("Heptabase import waits for pending note edits", async () => {
  const order: string[] = [];
  const update = vi.fn(async (input) => {
    order.push("save");
    return { ...note, ...input, revision: 2, updatedAt: 2 };
  });
  const readingNotes = api(update);
  readingNotes.heptabase = { get: vi.fn(async () => undefined), retry: vi.fn(), start: vi.fn() };
  readingNotes.heptabase!.start = vi.fn(async () => {
    order.push("import");
    return { id: "batch", running: false, items: [] };
  });
  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "Latest title" }
  });
  await waitFor(() => expect((screen.getByRole("button", { name: "Import to Heptabase" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Import to Heptabase" }));
  await waitFor(() => expect(readingNotes.heptabase!.start).toHaveBeenCalledWith([note.id]));
  expect(update.mock.calls[0]?.[0]).toMatchObject({ title: "Latest title" });
  expect(order).toEqual(["save", "import"]);
});

test("a failed save blocks import and explains the failure", async () => {
  const readingNotes = api(vi.fn(async () => { throw new Error("Save unavailable"); }));
  readingNotes.heptabase = { get: vi.fn(async () => undefined), retry: vi.fn(), start: vi.fn() };
  readingNotes.heptabase!.start = vi.fn(async () => ({ id: "batch", running: false, items: [] }));
  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "Latest title" }
  });
  await waitFor(() => expect((screen.getByRole("button", { name: "Import to Heptabase" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Import to Heptabase" }));
  await waitFor(() => expect(screen.getAllByRole("alert").some(element => element.textContent?.includes("Save unavailable"))).toBe(true));
  expect(readingNotes.heptabase!.start).not.toHaveBeenCalled();
});

test("a new note keeps its source draft alive across StrictMode remounting", async () => {
  const liveDrafts = new Set<string>();
  const beginDraft = vi.fn(async () => {
    liveDrafts.add("draft-new");
    return { draftId: "draft-new" };
  });
  const discardDraft = vi.fn(async (draftId: string) => {
    liveDrafts.delete(draftId);
  });
  const create = vi.fn(async (input) => {
    if (!liveDrafts.has(input.draftId)) throw new Error("Reading-note draft not found.");
    liveDrafts.delete(input.draftId);
    return {
      ...note,
      id: "note-new",
      sourceDraftId: input.draftId,
      title: input.title,
      content: input.content
    };
  });
  const draftApi = {
    ...api(),
    beginDraft,
    discardDraft,
    create,
    attachments: {
      ...api().attachments,
      discardStaged: vi.fn(async () => 0)
    }
  } as unknown as ReaderDesktopApi["readingNotes"];

  render(
    <StrictMode>
      <ReadingNoteCanvas
        api={draftApi}
        persistence="explicit"
        source={{
          bookTitle: "Systems Thinking",
          chapterTitle: "Feedback",
          readingSegment: "A feedback loop changes its own future inputs."
        }}
        onBack={() => undefined}
      />
    </StrictMode>
  );

  await waitFor(() => expect(beginDraft).toHaveBeenCalledTimes(1));
  expect(screen.queryByLabelText("Reading note metadata")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), {
    target: { value: "A new note" }
  });

  await new Promise((resolve) => window.setTimeout(resolve, 650));
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));

  await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Saved")).toBeTruthy();
  expect(discardDraft).not.toHaveBeenCalled();
});

test("an untouched source draft is discarded after leaving the canvas", async () => {
  const beginDraft = vi.fn(async () => ({ draftId: "draft-unused" }));
  const discardDraft = vi.fn(async () => undefined);
  const draftApi = {
    ...api(),
    beginDraft,
    discardDraft,
    attachments: {
      ...api().attachments,
      discardStaged: vi.fn(async () => 0)
    }
  } as unknown as ReaderDesktopApi["readingNotes"];

  const view = render(
    <ReadingNoteCanvas
      api={draftApi}
      source={{ bookTitle: "Systems Thinking", chapterTitle: "Feedback", readingSegment: "Source" }}
      onBack={() => undefined}
    />
  );
  await waitFor(() => expect(beginDraft).toHaveBeenCalledTimes(1));

  view.unmount();

  await waitFor(() => expect(discardDraft).toHaveBeenCalledWith("draft-unused"));
});

test("a trashed note renders the same canvas read-only without AI controls", () => {
  render(<ReadingNoteCanvas api={api()} note={{ ...note, trashedAt: 2 }} readOnly onBack={() => undefined} />);

  expect(screen.getByRole("textbox", { name: "Reading note title" }).hasAttribute("readonly")).toBe(true);
  expect(screen.queryByRole("region", { name: "AI writing tools" })).toBeNull();
});

test("the note content scrolls independently within a focused reading measure", () => {
  render(<ReadingNoteCanvas api={api()} note={note} onBack={() => undefined} />);

  const aiTools = screen.getByRole("region", { name: "AI writing tools" });
  expect(aiTools.parentElement?.classList.contains("reading-note-canvas-ai-float")).toBe(true);
  expect(document.querySelector(".reading-note-canvas-scroll")).not.toBeNull();

  const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");
  expect(styles).not.toMatch(/\.reading-note-library\.reading-note-library-canvas/);
  expect(styles).toMatch(/\.reading-note-canvas-scroll\s*\{[^}]*overflow-y:\s*auto;/s);
  expect(styles).toMatch(/\.reading-note-canvas-ai-float\s*\{[^}]*position:\s*absolute;[^}]*left:\s*50%;[^}]*bottom:\s*18px;[^}]*width:\s*min\(620px,\s*calc\(100% - 48px\)\);[^}]*transform:\s*translateX\(-50%\);/s);
  expect(styles).toMatch(/\.reading-note-canvas-paper\s*\{[^}]*width:\s*min\(1040px,\s*calc\(100% - 32px\)\);[^}]*padding:\s*36px 28px 176px;/s);
  expect(styles).toMatch(/\.reading-note-title-input\s*\{[^}]*padding:\s*0 32px;/s);
  expect(styles).toMatch(/\.reading-note-canvas \.bn-editor\s*\{[^}]*padding-inline:\s*32px;/s);
});

test("a discussion-only AI turn replies without changing or autosaving the note", async () => {
  const update = vi.fn(async (input) => ({ ...note, ...input, revision: 2, updatedAt: 2 }));
  const readingNotes = api(update);
  readingNotes.ai.startTransform = vi.fn(async () => ({
    sessionId: "discussion-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [],
    hasChanges: false,
    status: "Ready."
  }));
  readingNotes.ai.send = vi.fn(async () => ({
    sessionId: "discussion-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [
      { id: "user-1", role: "user" as const, text: "What is unclear here?" },
      { id: "assistant-1", role: "assistant" as const, text: "The causal link could use one concrete intermediate step." }
    ],
    hasChanges: false,
    status: "AI replied without changing the note."
  }));

  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "What is unclear here?" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  expect(await screen.findByText(/causal link could use one concrete intermediate step/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Apply changes" })).toBeNull();
  await new Promise((resolve) => window.setTimeout(resolve, 650));
  expect(update).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox", { name: "Reading note title" }) as HTMLTextAreaElement).value)
    .toBe("Original title");
});

test("the AI editing conversation renders compact backslash-delimited math", async () => {
  const readingNotes = api();
  readingNotes.ai.startTransform = vi.fn(async () => ({
    sessionId: "math-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [],
    hasChanges: false,
    status: "Ready."
  }));
  readingNotes.ai.send = vi.fn(async () => ({
    sessionId: "math-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [
      { id: "user-1", role: "user" as const, text: "Explain the conditioning formula." },
      {
        id: "assistant-1",
        role: "assistant" as const,
        text: String.raw`\[c=\operatorname{VLM}(\text{image},\text{instruction})\]`
      }
    ],
    hasChanges: false,
    status: "AI replied without changing the note."
  }));

  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Explain the conditioning formula." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  const responses = await screen.findAllByRole("article", { name: "AI Note Editor response" });
  const response = responses[0]!;
  expect(response.querySelector(".katex")).not.toBeNull();
  expect(response.querySelector("math")).not.toBeNull();
});

test("the AI editing conversation renders display and dollar math without weakening Markdown safety", async () => {
  const readingNotes = api();
  readingNotes.ai.startTransform = vi.fn(async () => ({
    sessionId: "math-safety-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [],
    hasChanges: false,
    status: "Ready."
  }));
  readingNotes.ai.send = vi.fn(async () => ({
    sessionId: "math-safety-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [
      { id: "user-1", role: "user" as const, text: "Show the formulas safely." },
      {
        id: "assistant-1",
        role: "assistant" as const,
        text: [
          "\\[",
          "A_T=[a_1,a_2,\\ldots,a_H]",
          "\\]",
          "",
          "Inline $E=mc^2$ and code `\\(x\\)`.",
          "",
          '<button onclick="alert(1)">Unsafe</button>'
        ].join("\n")
      }
    ],
    hasChanges: false,
    status: "AI replied without changing the note."
  }));

  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Show the formulas safely." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  const response = await screen.findByRole("article", { name: "AI Note Editor response" });
  expect(response.querySelector(".katex-display")).not.toBeNull();
  expect(response.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
  expect(response.querySelector("code")?.textContent).toBe(String.raw`\(x\)`);
  expect(response.querySelector("button")).toBeNull();
  expect(response.textContent).toContain("<button");
});

test("adjacent display formulas become lossless note blocks without blank lines", () => {
  const markdown = String.raw`學到的速度模型是：
\[\dot x=\sum_{k=1}^{K}\gamma_k(x)(A^kx+b^k).\]
輸入位置 $x$，得到速度。
\[V(x)=\frac12(x-x^*)^T(x-x^*).\]
能量的變化率為：
\[\dot V(x)<0.\]
因此逐漸靠近目標。`;
  const editor = BlockNoteEditor.create({ schema: readingNoteSchema });
  const content = blockNoteBlocksToReadingNoteDocument(parseReadingNoteMarkdownToBlocks(editor, markdown));
  expect(content.blocks.filter(block => block.type === "mathBlock").map(block => block.props.latex)).toEqual([
    String.raw`\dot x=\sum_{k=1}^{K}\gamma_k(x)(A^kx+b^k).`,
    String.raw`V(x)=\frac12(x-x^*)^T(x-x^*).`,
    String.raw`\dot V(x)<0.`
  ]);
  expect(content.blocks.map(block => block.type)).toEqual([
    "paragraph", "mathBlock", "paragraph", "mathBlock", "paragraph", "mathBlock", "paragraph"
  ]);
  expect(JSON.stringify(content)).not.toContain("READINGNOTEMATH");
  expect(content.blocks[2]?.content).toEqual(expect.arrayContaining([
    { type: "inlineMath", props: { latex: "x" } }
  ]));
});

test("splitting display math preserves surrounding formatting, lists, links, and literal code", () => {
  const html = readingNoteMarkdownToHTML(String.raw`**Before \[x^2\] after**

- Before \[y^2\] [after](https://example.com)

Keep \(z\) inline and \`$literal$\` as code.

\`\`\`tex
$$literal$$
\`\`\``.replaceAll("\\`", "`"));
  const container = document.createElement("div");
  container.innerHTML = html;
  expect(container.querySelectorAll("div[data-reading-note-display-math]")).toHaveLength(2);
  expect([...container.querySelectorAll("strong")].map(element => element.textContent?.trim())).toEqual(["Before", "after"]);
  expect(container.querySelector("li div[data-reading-note-display-math]")?.getAttribute("data-reading-note-display-math")).toBe("y%5E2");
  expect(container.querySelector("li a")?.textContent).toBe("after");
  expect(container.querySelectorAll("[data-reading-note-inline-math]")).toHaveLength(1);
  expect([...container.querySelectorAll("code")].map(element => element.textContent?.trim())).toEqual(["$literal$", "$$literal$$"]);
  expect(html).not.toContain("READINGNOTEMATH");
  const editor = BlockNoteEditor.create({ schema: readingNoteSchema });
  const content = blockNoteBlocksToReadingNoteDocument(editor.tryParseHTMLToBlocks(html));
  const saved = JSON.stringify(content);
  expect(saved).toContain('"type":"bulletListItem"');
  expect(saved).toContain('"latex":"x^2"');
  expect(saved).toContain('"latex":"y^2"');
  expect(saved).toContain('"href":"https://example.com"');
  expect(saved).not.toContain("READINGNOTEMATH");
});

test.each(["blank lines", "single newlines"])("applying an AI proposal renders and saves math with %s around display formulas", async (spacing) => {
  const update = vi.fn(async (input) => ({ ...note, ...input, revision: 2, updatedAt: 2 }));
  const readingNotes = api(update);
  readingNotes.ai.startTransform = vi.fn(async () => ({
    sessionId: "applied-math-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [],
    hasChanges: false,
    status: "Ready."
  }));
  readingNotes.ai.send = vi.fn(async () => ({
    sessionId: "applied-math-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [
      { id: "user-1", role: "user" as const, text: "Fix the formulas." },
      { id: "assistant-1", role: "assistant" as const, text: "I prepared a math-aware version." }
    ],
    draft: {
      title: "Diffusion path",
      content: [
        "The candidate action is $A_t$.",
        ...(spacing === "blank lines" ? [""] : []),
        "$$",
        "A_{t-1}=f_\\theta(A_t,c,t)",
        "$$",
        ...(spacing === "blank lines" ? [""] : []),
        "$V(x)$, $P=P^T$",
        "",
        "Inline code keeps `$not_math$` literal.",
        "",
        "```tex",
        "$$not_math$$",
        "```"
      ].join("\n")
    },
    hasChanges: true,
    status: "Previewing AI changes."
  }));
  readingNotes.ai.accept = vi.fn(async () => ({
    sessionId: "applied-math-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [
      { id: "assistant-1", role: "assistant" as const, text: "I prepared a math-aware version." }
    ],
    hasChanges: false,
    status: "AI changes applied."
  }));

  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Fix the formulas." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  fireEvent.click(await screen.findByRole("button", { name: "Apply changes" }));

  await screen.findByText("AI changes applied.");
  const paper = document.querySelector(".reading-note-canvas-paper")!;
  expect(paper.textContent).not.toContain("READINGNOTEMATH");
  expect(paper.querySelector(".katex")).not.toBeNull();
  expect(paper.querySelector(".katex-display")).not.toBeNull();
  expect(paper.querySelector("math")).not.toBeNull();
  expect(paper.querySelectorAll(".katex")).toHaveLength(4);
  expect(paper.querySelector('[data-content-type="paragraph"][data-text-alignment="center"]')).not.toBeNull();
  expect(paper.querySelector("code")?.textContent).toContain("$not_math$");
  await waitFor(() => expect(update).toHaveBeenCalled());
  const savedContent = update.mock.calls.at(-1)?.[0].content as ReadingNoteDocument;
  expect(savedContent.blocks.some((block) => block.type === "mathBlock")).toBe(true);
  expect(savedContent.blocks.some((block) => block.type === "paragraph" &&
    block.props.textAlignment === "center" && Array.isArray(block.content) &&
    block.content.filter((item) => item.type === "inlineMath").length === 2)).toBe(true);
  expect(savedContent.blocks.some((block) => Array.isArray(block.content) &&
    block.content.some((item) => item.type === "inlineMath"))).toBe(true);

  cleanup();
  render(<ReadingNoteCanvas api={api()} note={{ ...note, content: savedContent, revision: 2 }} onBack={() => undefined} />);
  const reopenedPaper = document.querySelector(".reading-note-canvas-paper")!;
  await waitFor(() => expect(reopenedPaper.querySelectorAll(".katex")).toHaveLength(4));
  expect(reopenedPaper.querySelector('[data-content-type="paragraph"][data-text-alignment="center"]')).not.toBeNull();
  expect(reopenedPaper.querySelector(".katex-display")).not.toBeNull();
});

test("saved display math fills the note width so its formula can be centered", async () => {
  const styleElement = document.createElement("style");
  styleElement.textContent = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");
  document.head.append(styleElement);
  try {
    render(<ReadingNoteCanvas api={api()} note={{
      ...note,
      content: { version: 1, blocks: [{
        id: "saved-display-formula",
        type: "mathBlock",
        props: { latex: "f(x^*)=0" },
        children: []
      }] }
    }} browseMode onBack={() => undefined} />);
    const formula = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(".reading-note-display-math");
      expect(element).not.toBeNull();
      return element!;
    });
    const wrapper = formula.closest<HTMLElement>(".node-mathBlock");
    expect(wrapper).not.toBeNull();
    expect(getComputedStyle(wrapper!).width).toBe("100%");
    expect(getComputedStyle(formula).width).toBe("100%");
    expect(getComputedStyle(formula).textAlign).toBe("center");
  } finally {
    styleElement.remove();
  }
});

test("an AI proposal is visible immediately but does not autosave a saved note before Apply", async () => {
  const update = vi.fn(async (input) => ({ ...note, ...input, revision: 2, updatedAt: 2 }));
  const readingNotes = api(update);
  readingNotes.ai.startTransform = vi.fn(async () => ({
    sessionId: "preview-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [],
    hasChanges: false,
    status: "Ready."
  }));
  readingNotes.ai.send = vi.fn(async () => ({
    sessionId: "preview-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [
      { id: "user-1", role: "user" as const, text: "Rewrite this." },
      { id: "assistant-1", role: "assistant" as const, text: "Here is a clearer version." }
    ],
    draft: {
      title: "AI preview title",
      content: "AI preview content that has not been applied."
    },
    hasChanges: true,
    status: "Previewing AI changes."
  }));

  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Rewrite this." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));

  const preview = await screen.findByRole("region", { name: "AI proposed note preview" });
  expect(screen.getByRole("button", { name: "追蹤修訂" }).getAttribute("aria-pressed")).toBe("true");
  expect(preview.querySelector("ins")).toBeTruthy();
  expect(preview.querySelector("del")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "修改前" }));
  expect(preview.textContent).toContain("Original title");
  expect(preview.textContent).toContain("Editable content");
  fireEvent.click(screen.getByRole("button", { name: "修改後" }));
  expect(preview.textContent).toContain("AI preview title");
  expect(preview.textContent).toContain("AI preview content that has not been applied.");
  const previewTitle = screen.getByRole("heading", { name: "AI preview title" });
  const metadata = screen.getByLabelText("Reading note metadata");
  const previewContent = screen.getByText("AI preview content that has not been applied.");
  expect(previewTitle.compareDocumentPosition(metadata) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(metadata.compareDocumentPosition(previewContent) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await new Promise((resolve) => window.setTimeout(resolve, 650));
  expect(update).not.toHaveBeenCalled();
});

test("stopping an AI turn restores the last version and reports the stopped state", async () => {
  const readingNotes = api();
  let onStateChanged: ((snapshot: ReadingNoteAiSnapshot) => void) | undefined;
  readingNotes.ai.onStateChanged = vi.fn((listener) => {
    onStateChanged = listener;
    return () => undefined;
  });
  readingNotes.ai.startTransform = vi.fn(async () => ({
    sessionId: "stop-1",
    mode: "transform" as const,
    phase: "ready" as const,
    messages: [],
    hasChanges: false,
    status: "Ready."
  }));
  readingNotes.ai.send = vi.fn(() => new Promise<ReadingNoteAiSnapshot>(() => undefined));
  readingNotes.ai.stop = vi.fn(async () => ({
    sessionId: "stop-1",
    mode: "transform" as const,
    phase: "error" as const,
    messages: [],
    hasChanges: false,
    status: "AI editing stopped. The last valid version is unchanged."
  }));

  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.click(screen.getByRole("button", { name: "Open AI editor" }));
  const model = screen.getByRole("combobox", { name: "Choose AI model" }) as HTMLSelectElement;
  expect(model.value).toBe("gpt-5.6-sol");
  fireEvent.change(screen.getByRole("textbox", { name: "Message AI about this note" }), {
    target: { value: "Rewrite this." }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(model.disabled).toBe(true));
  act(() => onStateChanged?.({
    sessionId: "stop-1",
    mode: "transform",
    phase: "responding",
    streamingDraft: {
      title: "Partial AI title",
      content: "Partial AI content"
    },
    messages: [],
    hasChanges: false,
    status: "Updating note…"
  }));
  expect(screen.getByRole("region", { name: "AI streaming note preview" }).textContent)
    .toContain("Partial AI content");
  fireEvent.click(await screen.findByRole("button", { name: "Stop" }));

  expect(await screen.findByText(/last valid version is unchanged/i)).toBeTruthy();
  expect(screen.queryByRole("region", { name: "AI streaming note preview" })).toBeNull();
  expect(model.disabled).toBe(false);
  expect((screen.getByRole("textbox", { name: "Reading note title" }) as HTMLTextAreaElement).value)
    .toBe("Original title");
});

test("long titles wrap and a saved canvas provides an explicit close control", async () => {
  const onBack = vi.fn();
  render(
    <ReadingNoteCanvas
      api={api()}
      note={{ ...note, title: "依照作者的發音系統，英文的母音如何隨著上下文改變" }}
      onBack={onBack}
      onDelete={() => undefined}
    />
  );

  const title = screen.getByRole("textbox", { name: "Reading note title" });
  expect(title.tagName).toBe("TEXTAREA");
  expect(title.classList.contains("reading-note-title-input")).toBe(true);
  fireEvent.change(title, { target: { value: "First line\nSecond line" } });
  expect((title as HTMLTextAreaElement).value).toBe("First line Second line");

  const trash = screen.getByRole("button", { name: "Move to Trash" });
  const close = screen.getByRole("button", { name: "Close reading note" });
  expect(screen.queryByRole("button", { name: "Back to Reading Notes" })).toBeNull();
  expect(trash.classList.contains("reading-note-canvas-trash")).toBe(true);
  expect(close.classList.contains("reading-note-canvas-close")).toBe(true);
  expect(trash.querySelector("svg")).not.toBeNull();
  expect(close.querySelector("svg")).not.toBeNull();
  fireEvent.click(close);
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));

  const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");
  expect(styles).toMatch(/\.reading-note-title-input\s*\{[^}]*font:\s*700 clamp\(30px,\s*4cqw,\s*42px\)/s);
  expect(styles).toMatch(/@container \(max-width:\s*700px\)[\s\S]*\.reading-note-title-input\s*\{[^}]*font-size:\s*28px;/s);
});

test("note-content headings remain visually subordinate to the note title", () => {
  const styles = readFileSync(join(process.cwd(), "src/renderer/styles.css"), "utf8");

  expect(styles).toMatch(/\.reading-note-canvas \[data-content-type="heading"\]\[data-level="1"\]\s*\{[^}]*--level:\s*1\.625em;/s);
  expect(styles).toMatch(/\.reading-note-canvas \[data-content-type="heading"\]\[data-level="2"\]\s*\{[^}]*--level:\s*1\.5em;/s);
  expect(styles).toMatch(/\.reading-note-canvas \[data-content-type="heading"\]\[data-level="3"\]\s*\{[^}]*--level:\s*1\.25em;/s);
});

test("saved note places review schedule after the note content", async () => {
  const readingNotesApi = api();
  readingNotesApi.review = {
    status: vi.fn(async () => ({ enrolled: true, paused: false, eligible: true, dueAt: null })),
    details: vi.fn(async () => ({ enrolled: true, paused: false, eligible: true, dueAt: null,
      lastReviewedAt: null, lastRating: null, totalReviews: 0, history: [] })),
    onChanged: () => () => {}
  } as unknown as NonNullable<ReaderDesktopApi["readingNotes"]["review"]>;
  const { container } = render(<ReadingNoteCanvas api={readingNotesApi} note={note} browseMode onBack={() => undefined} />);
  await screen.findByText("Not reviewed yet");
  const paper = container.querySelector(".reading-note-canvas-paper")!;
  expect(paper.lastElementChild?.getAttribute("aria-label")).toBe("Review schedule");
  expect(screen.getByRole("textbox", { name: "Reading note title" }).hasAttribute("readonly")).toBe(true);
});

test.each([false, true])("clipboard image uploads before insertion and saves a managed attachment (HTML: %s)", async (withHtml) => {
  let finishUpload!: (value: { id: string; url: string }) => void;
  const noteApi = api();
  const upload = vi.fn(() => new Promise<{ id: string; url: string }>(resolve => { finishUpload = resolve; }));
  noteApi.attachments.upload = upload as unknown as typeof noteApi.attachments.upload;
  noteApi.attachments.readDataUrl = vi.fn(async () => "data:image/png;base64,iVBORw0KGgo=");
  const { container } = render(<ReadingNoteCanvas api={noteApi} note={note} onBack={() => undefined} />);
  const file = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "image.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer });
  fireEvent.paste(container.querySelector(".tiptap")!, { clipboardData: {
    types: withHtml ? ["text/html", "Files"] : ["Files"],
    items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
    files: [file],
    getData: (type: string) => withHtml && type === "text/html" ? '<img src="https://example.com/image.png">' : ""
  } });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(noteApi.update).not.toHaveBeenCalled();
  await act(async () => { finishUpload({ id: "pasted-image", url: "reading-note-asset:pasted-image" }); });
  await waitFor(() => expect(noteApi.update).toHaveBeenCalled(), { timeout: 2000 });
  const saved = vi.mocked(noteApi.update).mock.calls.at(-1)![0];
  expect(saved.content.blocks).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "image", props: expect.objectContaining({ assetId: "pasted-image" }) })
  ]));
  expect(screen.queryByRole("alert")).toBeNull();
});

function pasteTestImage(container: HTMLElement) {
  const file = new File(["image"], "image.png", { type: "image/png" });
  Object.defineProperty(file, "arrayBuffer", { value: async () => new ArrayBuffer(8) });
  fireEvent.paste(container.querySelector(".tiptap")!, { clipboardData: {
    types: ["Files"],
    items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
    files: [file], getData: () => ""
  } });
}

test("failed clipboard image upload preserves content and allows another paste", async () => {
  const noteApi = api();
  noteApi.attachments.upload = vi.fn().mockRejectedValueOnce(new Error("Images must be 20 MB or smaller."))
    .mockResolvedValueOnce({ id: "retry-image", url: "reading-note-asset:retry-image" });
  noteApi.attachments.readDataUrl = vi.fn(async () => "data:image/png;base64,iVBORw0KGgo=");
  const { container } = render(<ReadingNoteCanvas api={noteApi} note={note} onBack={() => undefined} />);
  pasteTestImage(container);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("20 MB"));
  expect(container.querySelector(".tiptap")!.textContent).toContain("Editable content");
  expect(noteApi.update).not.toHaveBeenCalled();
  pasteTestImage(container);
  await waitFor(() => expect(noteApi.update).toHaveBeenCalled(), { timeout: 2000 });
  expect(screen.queryByRole("alert")).toBeNull();
});

test("closing the canvas during clipboard image upload discards the late attachment", async () => {
  const noteApi = api();
  let finishUpload!: (value: { id: string; url: string }) => void;
  noteApi.attachments.upload = vi.fn(() => new Promise(resolve => { finishUpload = resolve; })) as typeof noteApi.attachments.upload;
  noteApi.attachments.discardStaged = vi.fn(async () => 1);
  const { container, unmount } = render(<ReadingNoteCanvas api={noteApi} note={note} onBack={() => undefined} />);
  pasteTestImage(container);
  await waitFor(() => expect(noteApi.attachments.upload).toHaveBeenCalled());
  unmount();
  await act(async () => { finishUpload({ id: "late-image", url: "reading-note-asset:late-image" }); });
  expect(noteApi.attachments.discardStaged).toHaveBeenCalledWith(["late-image"]);
  expect(noteApi.update).not.toHaveBeenCalled();
});

test("plain text clipboard paste still saves note content", async () => {
  const noteApi = api();
  const { container } = render(<ReadingNoteCanvas api={noteApi} note={note} onBack={() => undefined} />);
  fireEvent.paste(container.querySelector(".tiptap")!, { clipboardData: {
    types: ["text/plain"], items: [], files: [], getData: () => "Pasted words"
  } });
  await waitFor(() => expect(noteApi.update).toHaveBeenCalled(), { timeout: 2000 });
  expect(JSON.stringify(vi.mocked(noteApi.update).mock.calls.at(-1)![0].content)).toContain("Pasted words");
  expect(noteApi.attachments.upload).not.toHaveBeenCalled();
});

test('F66 TC9/11: accepted candidate becomes next comparison baseline and modes never save', async () => {
  const update = vi.fn(async input => ({ ...note, ...input, revision: 2, updatedAt: 2 }));
  const readingNotes = api(update);
  const state = { sessionId: 'track', mode: 'transform' as const, phase: 'ready' as const, messages: [], hasChanges: false, status: 'Ready' };
  readingNotes.ai.startTransform = vi.fn(async () => state);
  readingNotes.ai.send = vi.fn().mockResolvedValueOnce({ ...state, draft: { title: note.title, content: 'Editable content' } })
    .mockResolvedValueOnce({ ...state, draft: { title: note.title, content: 'Revised content' } })
    .mockResolvedValueOnce({ ...state, draft: { title: note.title, content: 'Final content' } });
  readingNotes.ai.reject = vi.fn(async () => state);
  readingNotes.ai.accept = vi.fn(async () => state);
  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open AI editor' }));
  async function send() {
    fireEvent.change(screen.getByRole('textbox', { name: 'Message AI about this note' }), { target: { value: 'Revise' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
    await screen.findByRole('region', { name: 'AI proposed note preview' });
  }
  await send();
  expect(screen.getByText('沒有內容變更')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '查看修訂' }));
  expect(screen.queryByRole('textbox', { name: 'Message AI about this note' })).toBeNull();
  expect(screen.getByRole('button', { name: '修改前' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: "Don't apply changes" }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'AI proposed note preview' })).toBeNull());
  expect(update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Open AI editor' }));
  await send();
  fireEvent.click(screen.getByRole('button', { name: '修改後' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  await send();
  expect(screen.getByRole('button', { name: '追蹤修訂' }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '修改前' }));
  const preview = screen.getByRole('region', { name: 'AI proposed note preview' });
  expect(preview.textContent).toContain('Revised content');
  expect(preview.textContent).not.toContain('Editable content');
  fireEvent.click(screen.getByRole('button', { name: "Don't apply changes" }));
  await waitFor(() => expect(screen.queryByRole('region', { name: 'AI proposed note preview' })).toBeNull());
  expect(update).toHaveBeenCalledTimes(1);
});

test('F66 UIUX: long requests collapse, duplicate preview status hides, and apply errors remain visible', async () => {
  const readingNotes = api();
  const state = { sessionId: 'compact', mode: 'transform' as const, phase: 'ready' as const, messages: [], hasChanges: false, status: 'Ready' };
  const request = '請保留原意，加入清楚的例子。'.repeat(30);
  readingNotes.ai.startTransform = vi.fn(async () => state);
  readingNotes.ai.send = vi.fn(async () => ({ ...state, messages: [{ id: 'request', role: 'user' as const, text: request }], draft: { title: note.title, content: 'Improved content' }, status: 'Previewing AI changes. Apply them to keep this version.' }));
  readingNotes.ai.accept = vi.fn(async () => { throw new Error('儲存失敗，請重試'); });
  render(<ReadingNoteCanvas api={readingNotes} note={note} onBack={() => undefined} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open AI editor' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Message AI about this note' }), { target: { value: request } });
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }));
  await screen.findByRole('region', { name: 'AI proposed note preview' });
  expect(document.querySelector('.reading-note-ai-panel-feedback')).toBeNull();
  const details = document.querySelector<HTMLDetailsElement>('.note-ai-request-details')!;
  expect(details).not.toBeNull(); expect(details.open).toBe(false);
  fireEvent.click(details.querySelector('summary')!);
  expect(details.textContent).toContain(request);
  fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }));
  expect(await screen.findByText('儲存失敗，請重試')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Apply changes' })).toBeTruthy();
});


test("source jump waits for saves, prevents repeat clicks and closes before opening the chapter", async () => {
  const order: string[] = [];
  let release!: () => void;
  const update = vi.fn(async input => {
    await new Promise<void>(resolve => { release = resolve; });
    order.push("save");
    return { ...note, ...input, revision: 2, updatedAt: 2 };
  });
  const open = vi.fn(() => { order.push("open"); });
  render(<ReadingNoteSourceContext.Provider value={{ books: [{ id: "b", title: note.bookTitle, chapters: [{ id: "c", title: note.chapterTitle }] }], open }}>
    <ReadingNoteCanvas api={api(update)} note={note} onBack={() => { order.push("close"); }} />
  </ReadingNoteSourceContext.Provider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), { target: { value: "Changed" } });
  const link = screen.getByRole("button", { name: "開啟原文章節" });
  fireEvent.click(link);
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  expect(open).not.toHaveBeenCalled();
  expect(link.hasAttribute("disabled")).toBe(true);
  fireEvent.click(link);
  await act(async () => { release(); });
  await waitFor(() => expect(open).toHaveBeenCalledWith({ bookId: "b", chapterId: "c" }));
  expect(order).toEqual(["save", "close", "open"]);
});

test("source save failure keeps edits open and a retry can navigate", async () => {
  const update = vi.fn().mockRejectedValueOnce(new Error("Save unavailable"))
    .mockImplementation(async input => ({ ...note, ...input, revision: 2, updatedAt: 2 }));
  const close = vi.fn(), open = vi.fn();
  render(<ReadingNoteSourceContext.Provider value={{ books: [{ id: "b", title: note.bookTitle, chapters: [{ id: "c", title: note.chapterTitle }] }], open }}>
    <ReadingNoteCanvas api={api(update)} note={note} onBack={close} />
  </ReadingNoteSourceContext.Provider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "開啟原文章節" }));
  await waitFor(() => expect(screen.getAllByRole("alert").some(el => el.textContent?.includes("Save unavailable"))).toBe(true));
  expect(close).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "開啟原文章節" }));
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
});

test("source navigation also saves edits made while its first save is pending", async () => {
  const releases: (() => void)[] = [];
  const update = vi.fn(async input => {
    await new Promise<void>(resolve => { releases.push(resolve); });
    return { ...note, ...input, revision: input.baseRevision + 1, updatedAt: 2 };
  });
  const open = vi.fn();
  render(<ReadingNoteSourceContext.Provider value={{ books: [{ id: "b", title: note.bookTitle, chapters: [{ id: "c", title: note.chapterTitle }] }], open }}>
    <ReadingNoteCanvas api={api(update)} note={note} onBack={() => undefined} />
  </ReadingNoteSourceContext.Provider>);
  const title = screen.getByRole("textbox", { name: "Reading note title" });
  fireEvent.change(title, { target: { value: "First edit" } });
  fireEvent.click(screen.getByRole("button", { name: "開啟原文章節" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  fireEvent.change(title, { target: { value: "Latest edit" } });
  await act(async () => { releases.shift()!(); });
  expect(open).not.toHaveBeenCalled();
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update.mock.calls[1][0].title).toBe("Latest edit");
  await act(async () => { releases.shift()!(); });
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
});

test("source jump drains autosaves already queued while its save is in flight", async () => {
  const releases: (() => void)[] = [];
  const update = vi.fn(async input => {
    await new Promise<void>(resolve => { releases.push(resolve); });
    return { ...note, ...input, revision: input.baseRevision + 1, updatedAt: 2 };
  });
  const open = vi.fn();
  render(<ReadingNoteSourceContext.Provider value={{ books: [{ id: "b", title: note.bookTitle, chapters: [{ id: "c", title: note.chapterTitle }] }], open }}>
    <ReadingNoteCanvas api={api(update)} note={note} onBack={() => undefined} />
  </ReadingNoteSourceContext.Provider>);
  fireEvent.change(screen.getByRole("textbox", { name: "Reading note title" }), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "開啟原文章節" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  // Let the existing autosave timer expire while the source save is still pending.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 550)); });
  await act(async () => { releases.shift()!(); });
  if (update.mock.calls.length > 1) {
    expect(open).not.toHaveBeenCalled();
    await act(async () => { releases.shift()!(); });
  }
  await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
  expect(update).toHaveBeenCalledTimes(1);
});
