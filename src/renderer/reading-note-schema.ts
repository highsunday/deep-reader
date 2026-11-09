import {
  BlockNoteSchema,
  defaultBlockSpecs,
  defaultInlineContentSpecs,
  defaultStyleSpecs
} from "@blocknote/core";
import { readingNoteImageBlock } from "./ReadingNoteInlineVisual";
import { readingNoteInlineMath, readingNoteMathBlock } from "./ReadingNoteMath";

export const readingNoteSchema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    quote: defaultBlockSpecs.quote,
    codeBlock: defaultBlockSpecs.codeBlock,
    divider: defaultBlockSpecs.divider,
    table: defaultBlockSpecs.table,
    image: readingNoteImageBlock,
    mathBlock: readingNoteMathBlock
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    inlineMath: readingNoteInlineMath
  },
  styleSpecs: defaultStyleSpecs
});
