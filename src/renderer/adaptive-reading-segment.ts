import type { ReadingRange } from "../shared/contracts";

interface ReadingBlock extends ReadingRange {
  headingLevel?: number;
  units: number;
}

interface ReadingSection extends ReadingRange {
  level: number;
  bodyStart: number;
}

export interface ReadingStructure {
  text: string;
  blocks: ReadingBlock[];
  sections: ReadingSection[];
  imageOffsets: number[];
}

export type ReadingPreference =
  | { mode: "section"; level: number }
  | { mode: "paragraph"; targetUnits: number };

// Count CJK characters separately, and other scripts by word. Offsets remain UTF-16.
export function readingUnits(text: string): number {
  let cjk = 0;
  const other = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, () => {
    cjk += 1;
    return " ";
  });
  return cjk + (other.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0);
}

const atomicTags = new Set(["P", "UL", "OL", "DL", "TABLE", "FIGURE", "BLOCKQUOTE", "PRE"]);
const containerTags = new Set(["DIV", "SECTION", "ARTICLE", "LI"]);

/** Build once per chapter; annotation wrappers and layout never affect offsets. */
export function buildReadingStructure(root: HTMLElement): ReadingStructure {
  const chunks: string[] = [];
  const blocks: ReadingBlock[] = [];
  const imageOffsets: number[] = [];
  let offset = 0;
  let pendingStart = 0;
  let pendingText = "";
  const appendBlock = (start: number, value: string, headingLevel?: number) => {
    const leading = value.length - value.trimStart().length;
    const end = start + value.trimEnd().length;
    if (start + leading < end) {
      blocks.push({ start: start + leading, end, headingLevel, units: readingUnits(value) });
    }
  };
  const flush = () => {
    appendBlock(pendingStart, pendingText);
    pendingText = "";
    pendingStart = offset;
  };
  const appendText = (node: Node): void => {
    if (node.nodeType === 3) {
      const value = node.textContent ?? "";
      chunks.push(value);
      offset += value.length;
    } else {
      if (node.nodeType === 1 && (node as Element).tagName === "IMG") imageOffsets.push(offset);
      node.childNodes.forEach(appendText);
    }
  };
  const visit = (node: Node): void => {
    if (node.nodeType === 3) {
      const value = node.textContent ?? "";
      if (!pendingText) pendingStart = offset;
      pendingText += value;
      chunks.push(value);
      offset += value.length;
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName;
    if (tag === "IMG") imageOffsets.push(offset);
    const navigationLevel = (node as Element).getAttribute("data-reading-heading-level");
    const heading = /^H[1-6]$/.test(tag) ? Number(tag[1])
      : tag === "P" && /^[1-6]$/.test(navigationLevel ?? "") ? Number(navigationLevel) : undefined;
    if (heading || atomicTags.has(tag)) {
      flush();
      const start = offset;
      const value = node.textContent ?? "";
      appendText(node);
      appendBlock(start, value, heading);
      pendingStart = offset;
    } else {
      if (containerTags.has(tag) || tag === "BR" || tag === "HR") flush();
      node.childNodes.forEach(visit);
      if (containerTags.has(tag)) flush();
    }
  };
  root.childNodes.forEach(visit);
  flush();
  const text = chunks.join("");
  const sections: ReadingSection[] = [];
  const stack: ReadingSection[] = [];
  const contentEnd = text.trimEnd().length;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block.headingLevel) continue;
    while (stack.length && stack[stack.length - 1].level >= block.headingLevel) {
      const previous = stack.pop()!;
      previous.end = blocks[i - 1].end;
    }
    const section = {
      start: block.start, end: contentEnd,
      level: block.headingLevel, bodyStart: blocks[i + 1]?.start ?? block.end
    };
    sections.push(section);
    stack.push(section);
  }
  return { text, blocks, sections, imageOffsets };
}

function matchingSection(
  structure: ReadingStructure,
  range: ReadingRange
): ReadingSection | undefined {
  let start = range.start;
  let end = range.end;
  while (start < end && /\s/u.test(structure.text[start])) start += 1;
  while (end > start && /\s/u.test(structure.text[end - 1])) end -= 1;
  let match: ReadingSection | undefined;
  // Compare nearby boundaries; do not repeatedly slice the whole chapter per heading.
  for (const section of structure.sections) {
    const tolerance = Math.min(24, Math.floor((section.end - section.bodyStart) * 0.05));
    const beginsHere = Math.abs(start - section.start) <= tolerance ||
      Math.abs(start - section.bodyStart) <= tolerance;
    const endsHere = Math.abs(end - section.end) <= tolerance;
    if (beginsHere && endsHere && (!match || section.level > match.level)) match = section;
  }
  return match;
}

export function inferReadingPreference(
  structure: ReadingStructure,
  range: ReadingRange,
  visibleRange: ReadingRange = range
): ReadingPreference {
  // Section intent follows the same whole visual lines as the markers and AI.
  // Paragraph targets still come from the exact manual range, not its layout.
  const section = matchingSection(structure, visibleRange);
  return section
    ? { mode: "section", level: section.level }
    : { mode: "paragraph", targetUnits: Math.max(1, readingUnits(structure.text.slice(range.start, range.end))) };
}

function blockAfter(blocks: ReadingBlock[], offset: number): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (blocks[mid].end <= offset) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Keep the manual preference; nextStartOffset may exclude the already-read END visual line. */
export function nextAdaptiveReadingSegment(
  structure: ReadingStructure,
  current: ReadingRange,
  preference = inferReadingPreference(structure, current),
  nextStartOffset = current.end
): ReadingRange | undefined {
  const { text, blocks } = structure;
  let start = Math.max(0, Math.min(text.length, Math.max(current.end, nextStartOffset)));
  let low = 0;
  let high = structure.imageOffsets.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (structure.imageOffsets[mid] < start) low = mid + 1;
    else high = mid;
  }
  const nextImage = structure.imageOffsets[low] ?? text.length;
  while (start < nextImage && /\s/u.test(text[start])) start += 1;
  if (start >= text.length) return undefined;
  const first = blockAfter(blocks, start);
  if (preference.mode === "section") {
    let level = Math.min(preference.level, blocks[first]?.headingLevel ?? preference.level);
    const previous = !blocks[first]?.headingLevel ? matchingSection(structure, current) : undefined;
    let carryTail = previous !== undefined && start < previous.end;
    let hasBody = Boolean(blocks[first] && !blocks[first].headingLevel);
    for (let i = first + 1; i < blocks.length; i += 1) {
      if (blocks[i].headingLevel && blocks[i].headingLevel! <= level) {
        if (carryTail) {
          carryTail = false;
          hasBody = false;
          level = Math.min(level, blocks[i].headingLevel!);
          continue;
        }
        if (!hasBody) continue;
        return { start, end: blocks[i - 1].end };
      }
      hasBody ||= !blocks[i].headingLevel;
    }
    return { start, end: text.length };
  }

  let end = start;
  let units = 0;
  let hasBody = false;
  for (let i = first; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (block.headingLevel && hasBody) break;
    const nextUnits = units + (start > block.start
      ? readingUnits(text.slice(start, block.end)) : block.units);
    if (!block.headingLevel && hasBody &&
      Math.abs(units - preference.targetUnits) <= Math.abs(nextUnits - preference.targetUnits)) break;
    units = nextUnits;
    end = block.end;
    hasBody ||= !block.headingLevel;
    if (hasBody && units >= preference.targetUnits) break;
  }
  // Include trailing formatting whitespace so chapter-end button becomes disabled.
  if (end >= (blocks[blocks.length - 1]?.end ?? 0)) end = text.length;
  return end > start ? { start, end } : { start, end: text.length };
}
