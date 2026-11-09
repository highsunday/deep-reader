import { bookImagePattern } from "./reading-note-artifact";
import type { ReadingSegmentImage } from "./contracts";
import {
  markdownToReadingNoteDocument,
  parseReadingNoteDocument,
  type ReadingNoteBlock,
  type ReadingNoteDocument
} from "./reading-note-document";

const managedImagePattern = /^!\[[^\]\n]*\]\(reading-note-asset:[A-Za-z0-9_-]+(?:\s+"[^"\n]*")?\)$/;

/** Validate every image paragraph before previewing or materializing a model proposal. */
export function validatedSourceImageReferences(
  markdown: string,
  sourceImages: ReadingSegmentImage[] | undefined
): Array<{ index: number; alt: string }> {
  const references: Array<{ index: number; alt: string }> = [];
  for (const chunk of markdown.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    if (!chunk.includes("![")) continue;
    const marker = chunk.trim().match(bookImagePattern);
    if (marker) {
      const index = Number(marker[2]);
      if (!Number.isSafeInteger(index) || !sourceImages?.[index - 1]) {
        throw new Error(`Book image ${marker[2]} is unavailable in this reading segment.`);
      }
      references.push({ index, alt: marker[1]! });
    } else if (!managedImagePattern.test(chunk.trim())) {
      throw new Error("AI included an image outside the current reading segment.");
    }
  }
  return references;
}

export function materializedSourceImageMarkdown(
  markdown: string,
  assetIds: ReadonlyMap<number, string>
): string {
  return markdown.replace(/^[ \t]*!\[([^\]\n]{1,160})\]\(book-image:([1-9]\d*)\)[ \t]*$/gm, (_match, alt: string, index: string) => {
    const assetId = assetIds.get(Number(index));
    if (!assetId) throw new Error(`Book image ${index} is unavailable in this reading segment.`);
    return `![${alt}](reading-note-asset:${assetId})`;
  });
}

/** Confirm that acceptance changed only the selected source markers into managed assets. */
export function acceptedSourceImageMarkdown(
  proposal: string,
  applied: string,
  sourceImages: ReadingSegmentImage[] | undefined
): boolean {
  const selected = validatedSourceImageReferences(proposal, sourceImages);
  if (!selected.length) return proposal === applied;
  const proposedChunks = proposal.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  const appliedChunks = applied.replace(/\r\n?/g, "\n").split(/\n{2,}/);
  if (proposedChunks.length !== appliedChunks.length) return false;
  const assets = new Map<number, string>();
  const sourceByAsset = new Map<string, number>();
  return proposedChunks.every((chunk, index) => {
    const marker = chunk.trim().match(bookImagePattern);
    if (!marker) return chunk === appliedChunks[index];
    const asset = appliedChunks[index]?.trim().match(/^!\[([^\]\n]{1,160})\]\(reading-note-asset:([A-Za-z0-9_-]+)\)$/);
    if (!asset || asset[1] !== marker[1]) return false;
    const number = Number(marker[2]);
    const previous = assets.get(number);
    if (previous && previous !== asset[2]) return false;
    const otherSource = sourceByAsset.get(asset[2]!);
    if (otherSource !== undefined && otherSource !== number) return false;
    assets.set(number, asset[2]!);
    sourceByAsset.set(asset[2]!, number);
    return true;
  });
}

/** Replace model-selected source-image markers with managed image blocks at their chosen positions. */
export function documentWithBookImages(
  markdown: string,
  assetIds: ReadonlyMap<number, string>
): ReadingNoteDocument {
  const blocks: ReadingNoteBlock[] = [];
  const chunks = markdown.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  for (const [index, chunk] of chunks.entries()) {
    const match = chunk.trim().match(bookImagePattern);
    if (!match) {
      const textBlocks = markdownToReadingNoteDocument(chunk).blocks;
      blocks.push(...textBlocks.map((block, offset) => ({ ...block, id: `section-${index}-${offset}-${block.id}` })));
      continue;
    }
    const imageNumber = Number(match[2]);
    const assetId = assetIds.get(imageNumber);
    if (!assetId) throw new Error(`Book image ${imageNumber} is unavailable for this draft.`);
    blocks.push({
      id: `book-image-${index}`,
      type: "image",
      props: { assetId, alt: match[1]! },
      children: []
    });
  }
  return parseReadingNoteDocument({ version: 1, blocks });
}
