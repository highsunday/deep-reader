export const READING_NOTE_DOCUMENT_VERSION = 1 as const;

export type ReadingNoteBlockType =
  | "paragraph"
  | "heading"
  | "bulletListItem"
  | "numberedListItem"
  | "checkListItem"
  | "quote"
  | "codeBlock"
  | "divider"
  | "table"
  | "image"
  | "mathBlock";

export interface ReadingNoteText {
  type: "text";
  text: string;
  styles: Record<string, boolean | number | string>;
}

export interface ReadingNoteLink {
  type: "link";
  href: string;
  content: ReadingNoteText[];
}

export interface ReadingNoteInlineMath {
  type: "inlineMath";
  props: { latex: string };
}

export type ReadingNoteInlineContent = ReadingNoteText | ReadingNoteLink | ReadingNoteInlineMath;

export interface ReadingNoteTableContent {
  type: "tableContent";
  columnWidths: Array<number | null>;
  headerRows?: number;
  rows: Array<{ cells: ReadingNoteInlineContent[][] }>;
}

export interface ReadingNoteBlock {
  id: string;
  type: ReadingNoteBlockType;
  props: Record<string, boolean | number | string>;
  content?: ReadingNoteInlineContent[] | ReadingNoteTableContent;
  children: ReadingNoteBlock[];
}

export interface ReadingNoteDocument {
  version: typeof READING_NOTE_DOCUMENT_VERSION;
  blocks: ReadingNoteBlock[];
}

const blockTypes = new Set<ReadingNoteBlockType>([
  "paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem",
  "quote", "codeBlock", "divider", "table", "image", "mathBlock"
]);

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeProps(value: unknown): value is Record<string, boolean | number | string> {
  return object(value) && Object.values(value).every((item) =>
    typeof item === "boolean" || typeof item === "number" && Number.isFinite(item) ||
    typeof item === "string");
}

function text(value: unknown): ReadingNoteText {
  if (!object(value) || value.type !== "text" || typeof value.text !== "string" ||
    !safeProps(value.styles)) throw new Error("Invalid reading-note text content.");
  return { type: "text", text: value.text, styles: { ...value.styles } };
}

function inline(value: unknown): ReadingNoteInlineContent {
  if (object(value) && value.type === "inlineMath") {
    if (!object(value.props) || typeof value.props.latex !== "string") {
      throw new Error("Invalid reading-note inline math content.");
    }
    return { type: "inlineMath", props: { latex: value.props.latex } };
  }
  if (object(value) && value.type === "link") {
    if (typeof value.href !== "string" || !Array.isArray(value.content)) {
      throw new Error("Invalid reading-note link content.");
    }
    return { type: "link", href: value.href, content: value.content.map(text) };
  }
  return text(value);
}

function tableContent(value: unknown): ReadingNoteTableContent {
  if (!object(value) || value.type !== "tableContent" || !Array.isArray(value.columnWidths) ||
    !value.columnWidths.every((width) => width === null || typeof width === "number" && Number.isFinite(width) && width > 0) ||
    (value.headerRows !== undefined && (!Number.isInteger(value.headerRows) || (value.headerRows as number) < 0)) ||
    !Array.isArray(value.rows)) throw new Error("Invalid reading-note table content.");
  const rows = value.rows.map((row) => {
    if (!object(row) || !Array.isArray(row.cells)) throw new Error("Invalid reading-note table row.");
    return { cells: row.cells.map((cell) => {
      if (!Array.isArray(cell)) throw new Error("Invalid reading-note table cell.");
      return cell.map(inline);
    }) };
  });
  return {
    type: "tableContent",
    columnWidths: value.columnWidths.map((width) => width as number | null),
    ...(typeof value.headerRows === "number" ? { headerRows: value.headerRows } : {}),
    rows
  };
}

function block(value: unknown): ReadingNoteBlock {
  if (!object(value) || typeof value.id !== "string" || !value.id.trim() ||
    typeof value.type !== "string" || !blockTypes.has(value.type as ReadingNoteBlockType) ||
    !safeProps(value.props) || !Array.isArray(value.children)) {
    throw new Error("Invalid reading-note block.");
  }
  const type = value.type as ReadingNoteBlockType;
  let content: ReadingNoteBlock["content"];
  if (type === "table") content = tableContent(value.content);
  else if (type !== "divider" && type !== "image" && type !== "mathBlock") {
    if (!Array.isArray(value.content)) throw new Error("Invalid reading-note block content.");
    content = value.content.map(inline);
  } else if (value.content !== undefined && (!Array.isArray(value.content) || value.content.length)) {
    throw new Error("Invalid atomic reading-note block content.");
  }
  return {
    id: value.id.trim(),
    type,
    props: { ...value.props },
    ...(content !== undefined ? { content } : {}),
    children: value.children.map(block)
  };
}

export function parseReadingNoteDocument(value: unknown): ReadingNoteDocument {
  if (!object(value) || value.version !== READING_NOTE_DOCUMENT_VERSION || !Array.isArray(value.blocks)) {
    throw new Error("Invalid reading-note document.");
  }
  const blocks = value.blocks.map(block);
  const ids = new Set<string>();
  const visit = (items: ReadingNoteBlock[]) => items.forEach((item) => {
    if (ids.has(item.id)) throw new Error("Reading-note block identifiers must be unique.");
    ids.add(item.id);
    visit(item.children);
  });
  visit(blocks);
  return { version: READING_NOTE_DOCUMENT_VERSION, blocks };
}

function stableId(index: number, value: string): string {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${index}-${(hash >>> 0).toString(36)}`;
}

function inlineMarkdown(value: string): ReadingNoteInlineContent[] {
  const result: ReadingNoteInlineContent[] = [];
  const pattern = /(\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|\$([^$\n]+)\$)/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) result.push({ type: "text", text: value.slice(cursor, index), styles: {} });
    if (match[2]) result.push({ type: "text", text: match[2], styles: { bold: true } });
    else if (match[3]) result.push({ type: "text", text: match[3], styles: { italic: true } });
    else if (match[4]) result.push({ type: "text", text: match[4], styles: { code: true } });
    else if (match[5] && match[6]) result.push({
      type: "link", href: match[6], content: [{ type: "text", text: match[5], styles: {} }]
    });
    else if (match[7]) result.push({ type: "inlineMath", props: { latex: match[7] } });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) result.push({ type: "text", text: value.slice(cursor), styles: {} });
  return result;
}

export function markdownToReadingNoteDocument(markdown: string): ReadingNoteDocument {
  const normalized = markdown.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return {
    version: READING_NOTE_DOCUMENT_VERSION,
    blocks: [{ id: "empty-paragraph", type: "paragraph", props: {}, content: [], children: [] }]
  };
  const chunks = normalized.split(/\n{2,}/);
  const blocks = chunks.map<ReadingNoteBlock>((chunk, index) => {
    const value = chunk.trim();
    const id = stableId(index, value);
    const displayMath = value.match(/^\$\$\s*\n?([\s\S]*?)\n?\s*\$\$$/);
    if (displayMath) return {
      id, type: "mathBlock", props: { latex: displayMath[1]!.trim() }, children: []
    } as ReadingNoteBlock;
    const heading = value.match(/^(#{1,3})\s+([\s\S]+)$/);
    if (heading) return {
      id, type: "heading", props: { level: heading[1]!.length },
      content: inlineMarkdown(heading[2]!), children: []
    } as ReadingNoteBlock;
    const quote = value.match(/^>\s?([\s\S]+)$/);
    if (quote) return { id, type: "quote", props: {}, content: inlineMarkdown(quote[1]!), children: [] } as ReadingNoteBlock;
    const code = value.match(/^```([^\n]*)\n([\s\S]*?)\n```$/);
    if (code) return {
      id, type: "codeBlock", props: code[1] ? { language: code[1] } : {},
      content: [{ type: "text", text: code[2]!, styles: {} }], children: []
    } as ReadingNoteBlock;
    const task = value.match(/^- \[([ xX])\]\s+([\s\S]+)$/);
    if (task) return {
      id, type: "checkListItem", props: { checked: task[1]!.toLowerCase() === "x" },
      content: inlineMarkdown(task[2]!), children: []
    } as ReadingNoteBlock;
    const bullet = value.match(/^[-*+]\s+([\s\S]+)$/);
    if (bullet) return { id, type: "bulletListItem", props: {}, content: inlineMarkdown(bullet[1]!), children: [] } as ReadingNoteBlock;
    const numbered = value.match(/^\d+[.)]\s+([\s\S]+)$/);
    if (numbered) return { id, type: "numberedListItem", props: {}, content: inlineMarkdown(numbered[1]!), children: [] } as ReadingNoteBlock;
    if (/^---+$/.test(value)) return { id, type: "divider", props: {}, children: [] } as ReadingNoteBlock;
    return { id, type: "paragraph", props: {}, content: inlineMarkdown(value), children: [] } as ReadingNoteBlock;
  });
  return parseReadingNoteDocument({ version: READING_NOTE_DOCUMENT_VERSION, blocks });
}

function inlineToMarkdown(content: ReadingNoteInlineContent[]): string {
  return content.map((item) => {
    if (item.type === "inlineMath") return `$${item.props.latex}$`;
    if (item.type === "link") return `[${item.content.map(({ text }) => text).join("")}](${item.href})`;
    let value = item.text;
    if (item.styles.code) value = `\`${value}\``;
    if (item.styles.bold) value = `**${value}**`;
    if (item.styles.italic) value = `_${value}_`;
    if (item.styles.strike) value = `~~${value}~~`;
    return value;
  }).join("");
}

export function readingNoteDocumentToMarkdown(document: ReadingNoteDocument): string {
  const render = (item: ReadingNoteBlock, depth: number): string => {
    const content = Array.isArray(item.content) ? inlineToMarkdown(item.content) : "";
    let markdown: string;
    if (item.type === "heading") markdown = `${"#".repeat(Number(item.props.level) || 1)} ${content}`;
    else if (item.type === "bulletListItem") markdown = `- ${content}`;
    else if (item.type === "numberedListItem") markdown = `1. ${content}`;
    else if (item.type === "checkListItem") markdown = `- [${item.props.checked ? "x" : " "}] ${content}`;
    else if (item.type === "quote") markdown = `> ${content}`;
    else if (item.type === "codeBlock") markdown = `\`\`\`${String(item.props.language ?? "")}\n${content}\n\`\`\``;
    else if (item.type === "divider") markdown = "---";
    else if (item.type === "image") {
      const assetId = String(item.props.assetId ?? "");
      const caption = String(item.props.caption ?? "");
      markdown = `![${String(item.props.alt ?? "")}](reading-note-asset:${assetId}${caption ? ` "${caption}"` : ""})`;
    }
    else if (item.type === "mathBlock") markdown = `$$\n${String(item.props.latex ?? "")}\n$$`;
    else if (item.type === "table" && item.content && !Array.isArray(item.content)) {
      const rows = item.content.rows.map(({ cells }) => `| ${cells.map(inlineToMarkdown).join(" | ")} |`);
      if (rows.length) rows.splice(1, 0, `| ${item.content.columnWidths.map(() => "---").join(" | ")} |`);
      markdown = rows.join("\n");
    }
    else markdown = content;
    const indented = markdown.split("\n").map(line => `${"  ".repeat(depth)}${line}`).join("\n");
    const children = item.children.map(child => render(child, depth + 1));
    return children.length ? `${indented}\n${children.join("\n")}` : indented;
  };
  return parseReadingNoteDocument(document).blocks.map(item => render(item, 0)).join("\n\n");
}

export function readingNoteDocumentIsEmpty(document: ReadingNoteDocument): boolean {
  return parseReadingNoteDocument(document).blocks.every((item) => {
    if (item.type === "image" || item.type === "table" || item.type === "mathBlock") return false;
    return !Array.isArray(item.content) || !inlineToMarkdown(item.content).trim();
  });
}

export function readingNoteDocumentAttachmentIds(document: ReadingNoteDocument): string[] {
  const ids: string[] = [];
  const visit = (blocks: ReadingNoteBlock[]) => blocks.forEach((item) => {
    if (item.type === "image" && typeof item.props.assetId === "string" && item.props.assetId) {
      ids.push(item.props.assetId);
    }
    visit(item.children);
  });
  visit(parseReadingNoteDocument(document).blocks);
  return ids;
}
