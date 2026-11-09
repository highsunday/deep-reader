import type {
  ReadingNoteBlock,
  ReadingNoteDocument,
  ReadingNoteInlineContent,
  ReadingNoteTableContent
} from "../shared/reading-note-document";
import { parseReadingNoteDocument } from "../shared/reading-note-document";

type EditorBlock = Record<string, unknown>;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function props(value: unknown): Record<string, boolean | number | string> {
  if (!object(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean | number | string] => {
    const item = entry[1];
    return typeof item === "boolean" || typeof item === "string" ||
      typeof item === "number" && Number.isFinite(item);
  }));
}

function editorInline(value: ReadingNoteInlineContent): unknown {
  if (value.type === "inlineMath") return { type: "inlineMath", props: { latex: value.props.latex } };
  return value.type === "link"
    ? { type: "link", href: value.href, content: value.content.map(editorInline) }
    : { type: "text", text: value.text, styles: { ...value.styles } };
}

function documentInline(value: unknown): ReadingNoteInlineContent {
  if (object(value) && value.type === "inlineMath" && object(value.props) &&
    typeof value.props.latex === "string") {
    return { type: "inlineMath", props: { latex: value.props.latex } };
  }
  if (object(value) && value.type === "link" && typeof value.href === "string" && Array.isArray(value.content)) {
    return {
      type: "link",
      href: value.href,
      content: value.content.map((item) => {
        const parsed = documentInline(item);
        if (parsed.type !== "text") throw new Error("Nested links are not valid reading-note content.");
        return parsed;
      })
    };
  }
  if (!object(value) || value.type !== "text" || typeof value.text !== "string") {
    throw new Error("Invalid rich-text inline content.");
  }
  return { type: "text", text: value.text, styles: props(value.styles) };
}

function toEditorBlock(block: ReadingNoteBlock): EditorBlock {
  if (block.type === "image") {
    return {
      id: block.id,
      type: "image",
      props: {
        url: `reading-note-asset:${String(block.props.assetId ?? "")}`,
        name: String(block.props.alt ?? ""),
        caption: String(block.props.caption ?? ""),
        ...(typeof block.props.width === "number" ? { previewWidth: block.props.width } : {}),
        textAlignment: String(block.props.alignment ?? "left"),
        showPreview: true
      },
      children: []
    };
  }
  if (block.type === "table" && block.content && !Array.isArray(block.content)) {
    return {
      id: block.id,
      type: "table",
      props: { ...block.props },
      content: {
        type: "tableContent",
        columnWidths: block.content.columnWidths.map((width) => width ?? undefined),
        ...(block.content.headerRows !== undefined ? { headerRows: block.content.headerRows } : {}),
        rows: block.content.rows.map(({ cells }) => ({
          cells: cells.map((cell) => cell.map(editorInline))
        }))
      },
      children: block.children.map(toEditorBlock)
    };
  }
  return {
    id: block.id,
    type: block.type,
    props: { ...block.props },
    ...(Array.isArray(block.content) ? { content: block.content.map(editorInline) } : {}),
    children: block.children.map(toEditorBlock)
  };
}

export function readingNoteDocumentToBlockNoteBlocks(document: ReadingNoteDocument): EditorBlock[] {
  return centerStandaloneMathParagraphs(parseReadingNoteDocument(document).blocks.map(toEditorBlock));
}

function isStandaloneMathContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  let hasMath = false;
  for (const item of content) {
    if (!object(item)) return false;
    if (item.type === "inlineMath") {
      hasMath = true;
    } else if (item.type !== "text" || typeof item.text !== "string" ||
      !/^[ \t\u00a0,，;；、.。:：]*$/.test(item.text)) {
      return false;
    }
  }
  return hasMath;
}

export function centerStandaloneMathParagraphs(blocks: EditorBlock[]): EditorBlock[] {
  return blocks.map((block) => ({
    ...block,
    ...(block.type === "paragraph" && isStandaloneMathContent(block.content)
      ? { props: { ...(object(block.props) ? block.props : {}), textAlignment: "center" } }
      : {}),
    ...(Array.isArray(block.children)
      ? { children: centerStandaloneMathParagraphs(block.children as EditorBlock[]) }
      : {})
  }));
}

function table(value: unknown): ReadingNoteTableContent {
  if (!object(value) || value.type !== "tableContent" || !Array.isArray(value.rows) ||
    !Array.isArray(value.columnWidths)) throw new Error("Invalid editor table content.");
  return {
    type: "tableContent",
    columnWidths: value.columnWidths.map((width) =>
      typeof width === "number" && Number.isFinite(width) ? width : null),
    ...(typeof value.headerRows === "number" ? { headerRows: value.headerRows } : {}),
    rows: value.rows.map((row) => {
      if (!object(row) || !Array.isArray(row.cells)) throw new Error("Invalid editor table row.");
      return {
        cells: row.cells.map((cell) => {
          const content = object(cell) && Array.isArray(cell.content) ? cell.content : cell;
          if (!Array.isArray(content)) throw new Error("Invalid editor table cell.");
          return content.map(documentInline);
        })
      };
    })
  };
}

function fromEditorBlock(value: unknown): ReadingNoteBlock {
  if (!object(value) || typeof value.id !== "string" || typeof value.type !== "string") {
    throw new Error("Invalid editor block.");
  }
  const children = Array.isArray(value.children) ? value.children.map(fromEditorBlock) : [];
  if (value.type === "image") {
    const editorProps = props(value.props);
    const url = String(editorProps.url ?? "");
    if (!url.startsWith("reading-note-asset:")) throw new Error("Remote reading-note images are not allowed.");
    return {
      id: value.id,
      type: "image",
      props: {
        assetId: url.slice("reading-note-asset:".length),
        alt: String(editorProps.name ?? ""),
        caption: String(editorProps.caption ?? ""),
        ...(typeof editorProps.previewWidth === "number" ? { width: editorProps.previewWidth } : {}),
        alignment: String(editorProps.textAlignment ?? "left")
      },
      children: []
    };
  }
  if (value.type === "table") {
    return { id: value.id, type: "table", props: props(value.props), content: table(value.content), children };
  }
  return {
    id: value.id,
    type: value.type as ReadingNoteBlock["type"],
    props: props(value.props),
    ...(Array.isArray(value.content) ? { content: value.content.map(documentInline) } : {}),
    children
  };
}

export function blockNoteBlocksToReadingNoteDocument(blocks: unknown[]): ReadingNoteDocument {
  return parseReadingNoteDocument({ version: 1, blocks: blocks.map(fromEditorBlock) });
}

function attachmentIds(markdown: string): string[] {
  return [...markdown.matchAll(/reading-note-asset:([A-Za-z0-9_-]+)/g)].map((match) => match[1]!);
}

export function protectedAttachmentIdsMatch(beforeMarkdown: string, afterMarkdown: string): boolean {
  const before = attachmentIds(beforeMarkdown).sort();
  const after = attachmentIds(afterMarkdown).sort();
  return before.length === after.length && before.every((id, index) => id === after[index]);
}
