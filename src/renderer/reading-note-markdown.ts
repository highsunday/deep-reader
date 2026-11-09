import { markdownToHTML } from "@blocknote/core";
import { normalizeBackslashMathDelimiters } from "./markdown-math";
import { centerStandaloneMathParagraphs } from "./reading-note-editor-adapter";

type MathToken = { token: string; latex: string; display: boolean };

function protectedCodeCharacters(markdown: string): boolean[] {
  const protectedCharacters = Array.from<boolean>({ length: markdown.length }).fill(false);
  let fence: { marker: string; length: number } | undefined;
  let lineStart = 0;
  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline + 1;
    const contentEnd = markdown[lineEnd - 1] === "\n"
      ? lineEnd - (markdown[lineEnd - 2] === "\r" ? 2 : 1)
      : lineEnd;
    const line = markdown.slice(lineStart, contentEnd);
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      for (let index = lineStart; index < lineEnd; index += 1) protectedCharacters[index] = true;
      if (match && match[1]![0] === fence.marker && match[1]!.length >= fence.length) fence = undefined;
    } else if (match) {
      fence = { marker: match[1]![0]!, length: match[1]!.length };
      for (let index = lineStart; index < lineEnd; index += 1) protectedCharacters[index] = true;
    }
    lineStart = lineEnd;
  }

  for (let index = 0; index < markdown.length; index += 1) {
    if (protectedCharacters[index] || markdown[index] !== "`") continue;
    let delimiterLength = 1;
    while (markdown[index + delimiterLength] === "`") delimiterLength += 1;
    let closingIndex = index + delimiterLength;
    while (closingIndex < markdown.length) {
      if (!protectedCharacters[closingIndex] && markdown[closingIndex] === "`") {
        let closingLength = 1;
        while (markdown[closingIndex + closingLength] === "`") closingLength += 1;
        if (closingLength === delimiterLength) break;
        closingIndex += closingLength;
      } else closingIndex += 1;
    }
    if (closingIndex < markdown.length) {
      for (let position = index; position < closingIndex + delimiterLength; position += 1) {
        protectedCharacters[position] = true;
      }
      index = closingIndex + delimiterLength - 1;
    }
  }
  return protectedCharacters;
}

function escaped(markdown: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

function tokenizeMath(markdown: string): { markdown: string; tokens: MathToken[] } {
  const protectedCharacters = protectedCodeCharacters(markdown);
  const tokens: MathToken[] = [];
  let result = "";
  for (let index = 0; index < markdown.length;) {
    if (protectedCharacters[index] || markdown[index] !== "$" || escaped(markdown, index)) {
      result += markdown[index] ?? "";
      index += 1;
      continue;
    }
    const display = markdown[index + 1] === "$";
    const delimiterLength = display ? 2 : 1;
    let closing = index + delimiterLength;
    while (closing < markdown.length) {
      if (!display && markdown[closing] === "\n") break;
      if (!protectedCharacters[closing] && markdown[closing] === "$" && !escaped(markdown, closing) &&
        (display ? markdown[closing + 1] === "$" : markdown[closing + 1] !== "$")) break;
      closing += 1;
    }
    const found = closing < markdown.length && markdown[closing] === "$" &&
      (display ? markdown[closing + 1] === "$" : markdown[closing + 1] !== "$");
    if (!found) {
      result += markdown[index];
      index += 1;
      continue;
    }
    const latex = markdown.slice(index + delimiterLength, closing).trim();
    if (!latex) {
      result += markdown.slice(index, closing + delimiterLength);
      index = closing + delimiterLength;
      continue;
    }
    const token = `READINGNOTEMATH${display ? "BLOCK" : "INLINE"}${tokens.length}TOKEN`;
    tokens.push({ token, latex, display });
    result += token;
    index = closing + delimiterLength;
  }
  return { markdown: result, tokens };
}

export function readingNoteMarkdownToHTML(markdown: string): string {
  const normalized = normalizeBackslashMathDelimiters(markdown);
  const tokenized = tokenizeMath(normalized);
  let html = markdownToHTML(tokenized.markdown);
  for (const { token, latex, display } of tokenized.tokens) {
    const encoded = encodeURIComponent(latex);
    if (display) {
      html = html.replaceAll(token, `<span data-reading-note-display-math="${encoded}"></span>`);
    } else {
      html = html.replaceAll(token, `<span data-reading-note-inline-math="${encoded}"></span>`);
    }
  }
  if (!tokenized.tokens.some(({ display }) => display)) return html;

  // Markdown soft line breaks can put prose and several display formulas in
  // one paragraph. Split that paragraph at each formula before BlockNote
  // parses it, keeping surrounding inline formatting and container structure.
  const document = new DOMParser().parseFromString(html, "text/html");
  let marker: Element | null;
  while ((marker = document.body.querySelector("span[data-reading-note-display-math]"))) {
    const formula = document.createElement("div");
    formula.setAttribute("data-reading-note-display-math", marker.getAttribute("data-reading-note-display-math")!);
    const paragraph = marker.closest("p, h1, h2, h3, h4, h5, h6");
    if (!paragraph) {
      marker.replaceWith(formula);
      continue;
    }

    const before = document.createRange();
    before.selectNodeContents(paragraph);
    before.setEndBefore(marker);
    const after = document.createRange();
    after.selectNodeContents(paragraph);
    after.setStartAfter(marker);
    const replacement = document.createDocumentFragment();
    const appendProse = (range: Range) => {
      const content = range.cloneContents();
      if (!content.textContent?.trim() && !content.querySelector("img, [data-reading-note-inline-math], [data-reading-note-display-math]")) return;
      // Delimiter-line whitespace is a paragraph boundary, not a hard break
      // inside the new prose block (or a standalone inline-math paragraph).
      for (const edge of ["firstChild", "lastChild"] as const) {
        let boundary: ChildNode | null;
        while ((boundary = content[edge])) {
          if (boundary.nodeType === 3) {
            boundary.textContent = edge === "firstChild"
              ? boundary.textContent!.trimStart() : boundary.textContent!.trimEnd();
            if (boundary.textContent) break;
          } else if (boundary.nodeName !== "BR") break;
          boundary.remove();
        }
      }
      const prose = paragraph.cloneNode(false);
      prose.appendChild(content);
      replacement.appendChild(prose);
    };
    appendProse(before);
    replacement.appendChild(formula);
    appendProse(after);
    paragraph.replaceWith(replacement);
  }
  return document.body.innerHTML;
}

export function parseReadingNoteMarkdownToBlocks(
  editor: { tryParseHTMLToBlocks(html: string): unknown[] },
  markdown: string
): unknown[] {
  return centerStandaloneMathParagraphs(
    editor.tryParseHTMLToBlocks(readingNoteMarkdownToHTML(markdown)) as Record<string, unknown>[]
  );
}
