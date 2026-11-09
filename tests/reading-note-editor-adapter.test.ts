import assert from "node:assert/strict";
import { test } from "vitest";
import {
  markdownToReadingNoteDocument,
  readingNoteDocumentToMarkdown,
  type ReadingNoteDocument
} from "../src/shared/reading-note-document";
import {
  blockNoteBlocksToReadingNoteDocument,
  protectedAttachmentIdsMatch,
  readingNoteDocumentToBlockNoteBlocks
} from "../src/renderer/reading-note-editor-adapter";

test("editor blocks round-trip image metadata and table column widths without file paths", () => {
  const document: ReadingNoteDocument = {
    version: 1 as const,
    blocks: [{
      id: "image-block",
      type: "image" as const,
      props: {
        assetId: "asset-1",
        alt: "Feedback diagram",
        caption: "A balancing loop",
        width: 640,
        alignment: "center"
      },
      children: []
    }, {
      id: "table-block",
      type: "table" as const,
      props: {},
      content: {
        type: "tableContent" as const,
        columnWidths: [180, 240],
        headerRows: 1,
        rows: [{ cells: [[{ type: "text" as const, text: "Cause", styles: {} }], [{ type: "text" as const, text: "Effect", styles: {} }]] }]
      },
      children: []
    }]
  };

  const editorBlocks = readingNoteDocumentToBlockNoteBlocks(document);
  const image = editorBlocks[0] as { props: Record<string, unknown> };
  assert.equal(image.props.url, "reading-note-asset:asset-1");
  assert.equal(image.props.name, "Feedback diagram");
  assert.doesNotMatch(JSON.stringify(editorBlocks), /Users\/|file:\/\//);
  assert.deepEqual(blockNoteBlocksToReadingNoteDocument(editorBlocks), document);
});

test("AI attachment validation accepts reordering but rejects added, missing, or duplicate IDs", () => {
  const original = "![one](reading-note-asset:asset-1)\n![two](reading-note-asset:asset-2)";
  assert.equal(protectedAttachmentIdsMatch(
    original,
    "![two](reading-note-asset:asset-2)\n![one](reading-note-asset:asset-1)"
  ), true);
  assert.equal(protectedAttachmentIdsMatch(original, "![one](reading-note-asset:asset-1)"), false);
  assert.equal(protectedAttachmentIdsMatch(
    original,
    `${original}\n![again](reading-note-asset:asset-1)`
  ), false);
  assert.equal(protectedAttachmentIdsMatch(
    original,
    `${original}\n![new](reading-note-asset:asset-3)`
  ), false);
  const readerCopied = `${original}\n![same attachment](reading-note-asset:asset-1)`;
  assert.equal(protectedAttachmentIdsMatch(
    readerCopied,
    "![same attachment](reading-note-asset:asset-1)\n![two](reading-note-asset:asset-2)\n![one](reading-note-asset:asset-1)"
  ), true);
});

test("reading-note math nodes survive document, editor, and Markdown round-trips", () => {
  const markdown = [
    "The candidate is $A_t$.",
    "",
    "$$",
    "A_{t-1}=f_\\theta(A_t,c,t)",
    "$$"
  ].join("\n");
  const document = markdownToReadingNoteDocument(markdown);
  assert.ok(Array.isArray(document.blocks[0]!.content));
  assert.equal(document.blocks[0]!.content[1]?.type, "inlineMath");
  assert.equal(document.blocks[1]!.type, "mathBlock");

  const editorBlocks = readingNoteDocumentToBlockNoteBlocks(document);
  assert.deepEqual(blockNoteBlocksToReadingNoteDocument(editorBlocks), document);
  assert.equal(readingNoteDocumentToMarkdown(document), markdown);
});

test("existing standalone formula paragraphs center without changing inline math or prose", () => {
  const standalone = {
    id: "standalone",
    type: "paragraph" as const,
    props: {},
    content: [
      { type: "inlineMath" as const, props: { latex: "V(x)" } },
      { type: "text" as const, text: ",  ", styles: {} },
      { type: "inlineMath" as const, props: { latex: "P=P^T" } }
    ],
    children: []
  };
  const prose = {
    id: "prose",
    type: "paragraph" as const,
    props: { textAlignment: "left" },
    content: [
      { type: "text" as const, text: "Let ", styles: {} },
      { type: "inlineMath" as const, props: { latex: "P" } },
      { type: "text" as const, text: " be positive.", styles: {} }
    ],
    children: []
  };
  const singleFormula = {
    id: "single-formula",
    type: "paragraph" as const,
    props: {},
    content: [{ type: "inlineMath" as const, props: { latex: "x=Ax+b" } }],
    children: []
  };
  const original: ReadingNoteDocument = { version: 1, blocks: [standalone, singleFormula, prose] };
  const blocks = readingNoteDocumentToBlockNoteBlocks(original) as Array<{ props: Record<string, unknown> }>;

  assert.equal(blocks[0]?.props.textAlignment, "center");
  assert.equal(blocks[1]?.props.textAlignment, "center");
  assert.equal(blocks[2]?.props.textAlignment, "left");
  assert.deepEqual(original.blocks[0], standalone);
  assert.deepEqual((blockNoteBlocksToReadingNoteDocument(blocks) as ReadingNoteDocument).blocks[0]?.content, standalone.content);
});
