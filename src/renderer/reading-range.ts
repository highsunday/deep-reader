import type { Annotation, ReadingRange, ReadingSegmentImage } from "../shared/contracts";
import { DEFAULT_ANNOTATION_COLOR } from "../shared/contracts";

function clamp(text: string, offset: number): number {
  return Math.min(text.length, Math.max(0, Math.trunc(offset)));
}

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function firstReadableOffset(text: string, offset: number): number {
  let current = clamp(text, offset);
  while (current < text.length && /\s/u.test(text[current])) current += 1;
  return current;
}

function wordCount(text: string): number {
  return Array.from(text.matchAll(WORD_PATTERN)).length;
}

function endAfterWords(text: string, start: number, desiredWords: number): number {
  let end = start;
  let found = 0;
  for (const match of text.slice(start).matchAll(WORD_PATTERN)) {
    end = start + (match.index ?? 0) + match[0].length;
    found += 1;
    if (found >= desiredWords) return end;
  }
  return text.length;
}

export function initialReadingRange(text: string): ReadingRange {
  return { start: 0, end: text.length };
}

export function rangeAfterMovingBoundary(
  current: ReadingRange,
  marker: "start" | "end",
  offset: number
): ReadingRange {
  const nextOffset = Math.max(0, Math.trunc(offset));
  if (marker === "start") {
    return nextOffset > current.end
      ? { start: nextOffset, end: nextOffset }
      : { start: nextOffset, end: current.end };
  }
  return nextOffset < current.start
    ? { start: nextOffset, end: nextOffset }
    : { start: current.start, end: nextOffset };
}

interface HorizontalBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export function contextRangePoint(
  bounds: HorizontalBounds,
  clickedY: number,
  lineHeight: number,
  marker: "start" | "end",
  textLength = 0
): { x: number; y: number; fallbackOffset: number } {
  const safeLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 1;
  return marker === "start"
    ? {
        x: bounds.left + 1,
        y: Math.max(bounds.top, clickedY - safeLineHeight),
        fallbackOffset: 0
      }
    : {
        x: bounds.right - 1,
        y: Math.min(bounds.bottom, clickedY + safeLineHeight),
        fallbackOffset: Math.max(0, textLength)
      };
}

export function shouldDismissRangeContextMenu(
  interaction: "outside-click" | "scroll" | "resize" | "keydown",
  key?: string
): boolean {
  return interaction !== "keydown" || key === "Escape";
}

export function extractReadingSegment(
  text: string,
  range: ReadingRange
): string {
  const start = clamp(text, range.start);
  const end = Math.max(start, clamp(text, range.end));
  return text.slice(start, end).trim();
}

export function extractReadingSegmentWithImages(
  root: HTMLElement,
  range: ReadingRange
): { readingSegment: string; images: ReadingSegmentImage[] } {
  const text = root.textContent ?? "";
  const start = clamp(text, range.start);
  const end = Math.max(start, clamp(text, range.end));
  const imageOnly = text.length === 0 && start === end;
  const parts: string[] = [];
  const images: ReadingSegmentImage[] = [];
  const imageIndexByDataUrl = new Map<string, number>();
  let offset = 0;

  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? "";
      const from = Math.max(0, start - offset);
      const to = Math.min(value.length, end - offset);
      if (from < to) parts.push(value.slice(from, to));
      offset += value.length;
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "IMG") {
      if ((start <= offset && offset < end) ||
        (start < end && end === text.length && offset === end) || imageOnly) {
        const image = node as HTMLImageElement;
        const dataUrl = image.getAttribute("src") ?? "";
        let index = imageIndexByDataUrl.get(dataUrl);
        if (index === undefined) {
          images.push({ dataUrl });
          index = images.length;
          imageIndexByDataUrl.set(dataUrl, index);
        }
        parts.push(`[Book image ${index}]`);
      }
      return;
    }
    node.childNodes.forEach(visit);
  };
  root.childNodes.forEach(visit);
  return { readingSegment: parts.join("").trim(), images };
}

export function advanceReadingRange(
  text: string,
  current: ReadingRange,
  nextStartOffset = current.end
): ReadingRange {
  const desiredWords = Math.max(1, wordCount(extractReadingSegment(text, current)));
  const start = firstReadableOffset(text, nextStartOffset);
  return { start, end: endAfterWords(text, start, desiredWords) };
}

export function nextReadingSegmentNavigation(
  text: string,
  current: ReadingRange,
  nextStartOffset = current.end
): { range: ReadingRange } | undefined {
  if (current.end >= text.length || nextStartOffset >= text.length) return undefined;
  return {
    range: advanceReadingRange(text, current, nextStartOffset)
  };
}

export function rangeMarkerScrollTop({
  containerScrollTop,
  containerTop,
  containerHeight,
  markerTop,
  marker
}: {
  containerScrollTop: number;
  containerTop: number;
  containerHeight: number;
  markerTop: number;
  marker: "start" | "end";
}): number {
  const viewportRatio = marker === "start" ? 1 / 4 : 3 / 4;
  return Math.max(
    0,
    containerScrollTop + markerTop - containerTop - containerHeight * viewportRatio
  );
}

function textNodes(root: Node): Text[] {
  const document = root.ownerDocument;
  if (!document) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  return nodes;
}

function glyphRectangleAtTextOffset(
  root: HTMLElement,
  nodes: readonly Text[],
  textOffset: number
): DOMRect | null {
  let remaining = Math.max(0, Math.trunc(textOffset));
  for (const node of nodes) {
    if (node.data.length === 0) continue;
    if (remaining < node.data.length) {
      const range = root.ownerDocument.createRange();
      range.setStart(node, remaining);
      range.setEnd(node, remaining + 1);
      if (typeof range.getBoundingClientRect !== "function") return null;
      const rectangle = range.getBoundingClientRect();
      return rectangle.height > 0 && Number.isFinite(rectangle.top) &&
        Number.isFinite(rectangle.bottom)
        ? rectangle
        : null;
    }
    remaining -= node.data.length;
  }
  return null;
}

function rectanglesShareVisualLine(left: DOMRect, right: DOMRect): boolean {
  return Math.min(left.bottom, right.bottom) > Math.max(left.top, right.top) ||
    Math.abs(left.top - right.top) < 1;
}

export function expandReadingRangeToVisualLines(
  root: HTMLElement,
  range: ReadingRange
): ReadingRange {
  const text = root.textContent ?? "";
  const boundedStart = clamp(text, range.start);
  const boundedEnd = Math.max(boundedStart, clamp(text, range.end));
  if (boundedStart === boundedEnd) {
    return { start: boundedStart, end: boundedEnd };
  }

  const nodes = textNodes(root);
  const startRectangle = glyphRectangleAtTextOffset(root, nodes, boundedStart);
  const endRectangle = glyphRectangleAtTextOffset(root, nodes, boundedEnd - 1);
  // EPUB formatting whitespace may have no rectangle at one boundary.
  // Preserve that offset without discarding the other boundary's visible line.
  let start = boundedStart;
  while (startRectangle && start > 0) {
    const previous = glyphRectangleAtTextOffset(root, nodes, start - 1);
    if (!previous || !rectanglesShareVisualLine(startRectangle, previous)) break;
    start -= 1;
  }

  let end = boundedEnd;
  while (endRectangle && end < text.length) {
    const next = glyphRectangleAtTextOffset(root, nodes, end);
    if (!next || !rectanglesShareVisualLine(endRectangle, next)) break;
    end += 1;
  }
  return { start, end };
}

function offsetForDomPoint(
  root: HTMLElement,
  target: Node,
  localOffset = 0
): number | null {
  let offset = 0;
  for (const node of textNodes(root)) {
    if (node === target || node.parentElement === target) {
      return offset + Math.min(node.data.length, Math.max(0, localOffset));
    }
    if (target instanceof Element && target.contains(node)) return offset;
    offset += node.data.length;
  }
  return null;
}

export function normalizeAnnotationRange(
  text: string,
  startOffset: number,
  endOffset: number
): Omit<Annotation, "id"> | null {
  const rawStart = clamp(text, Math.min(startOffset, endOffset));
  const rawEnd = clamp(text, Math.max(startOffset, endOffset));
  const selected = text.slice(rawStart, rawEnd);
  const leading = selected.match(/^\s*/u)?.[0].length ?? 0;
  const trailing = selected.match(/\s*$/u)?.[0].length ?? 0;
  const start = rawStart + leading;
  const end = Math.max(start, rawEnd - trailing);
  return start === end ? null : { start, end, text: text.slice(start, end) };
}

export function annotationRangeFromSelection(
  root: HTMLElement,
  selection: Selection | null
): Omit<Annotation, "id"> | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const start = offsetForDomPoint(root, range.startContainer, range.startOffset);
  const end = offsetForDomPoint(root, range.endContainer, range.endOffset);
  return start === null || end === null
    ? null
    : normalizeAnnotationRange(root.textContent ?? "", start, end);
}

export function hasAnnotationOverlap(
  annotations: readonly Pick<Annotation, "start" | "end">[],
  candidate: Pick<Annotation, "start" | "end">
): boolean {
  return annotations.some(({ start, end }) => candidate.start < end && candidate.end > start);
}

export function shouldCreateAnnotation(
  active: boolean,
  annotations: readonly Pick<Annotation, "start" | "end">[],
  selected: Omit<Annotation, "id"> | null
): selected is Omit<Annotation, "id"> {
  return active && selected !== null && !hasAnnotationOverlap(annotations, selected);
}

export function originalSelectionWithinReadingRange(
  selected: Pick<Annotation, "start" | "end">,
  range: ReadingRange
): boolean {
  return selected.start < selected.end &&
    selected.start >= range.start &&
    selected.end <= range.end;
}

export function originalSelectionAtContextOffset<T extends Pick<Annotation, "start" | "end">>(
  selected: T | null,
  offset: number
): T | undefined {
  return selected && offset >= selected.start && offset < selected.end
    ? selected
    : undefined;
}

export function annotationSegments(
  nodeLengths: readonly number[],
  annotation: Pick<Annotation, "start" | "end">
): Array<{ nodeIndex: number; start: number; end: number }> {
  let offset = 0;
  return nodeLengths.flatMap((length, nodeIndex) => {
    const nodeStart = offset;
    const nodeEnd = nodeStart + length;
    offset = nodeEnd;
    const start = Math.max(annotation.start, nodeStart);
    const end = Math.min(annotation.end, nodeEnd);
    return start < end
      ? [{ nodeIndex, start: start - nodeStart, end: end - nodeStart }]
      : [];
  });
}

export function renderAnnotationHighlights(
  root: HTMLElement,
  annotations: readonly Annotation[]
): void {
  for (const highlight of Array.from(root.querySelectorAll("mark[data-annotation-id]"))) {
    highlight.replaceWith(...Array.from(highlight.childNodes));
  }
  root.normalize();
  const ordered = [...annotations].sort(
    (left, right) => right.start - left.start || right.end - left.end
  );
  for (const annotation of ordered) {
    const nodes = textNodes(root);
    const targets = annotationSegments(
      nodes.map(({ data }) => data.length),
      annotation
    );
    for (const target of targets.reverse()) {
      const node = nodes[target.nodeIndex];
      if (!node) continue;
      const range = root.ownerDocument.createRange();
      range.setStart(node, target.start);
      range.setEnd(node, target.end);
      const mark = root.ownerDocument.createElement("mark");
      mark.className = "reader-annotation-highlight";
      mark.dataset.annotationId = annotation.id;
      mark.dataset.annotationColor = annotation.color ?? DEFAULT_ANNOTATION_COLOR;
      range.surroundContents(mark);
    }
  }
}

export function textOffsetAtPoint(
  root: HTMLElement,
  x: number,
  y: number,
  fallbackTarget?: EventTarget | null
): number | null {
  const document = root.ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => {
      offsetNode: Node;
      offset: number;
    } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = document.caretPositionFromPoint?.(x, y);
  if (caret && root.contains(caret.offsetNode)) {
    return offsetForDomPoint(root, caret.offsetNode, caret.offset);
  }
  const range = document.caretRangeFromPoint?.(x, y);
  if (range && root.contains(range.startContainer)) {
    return offsetForDomPoint(root, range.startContainer, range.startOffset);
  }
  const target = root.ownerDocument.elementFromPoint?.(x, y) ?? fallbackTarget;
  const targetNode = target && typeof target === "object" && "nodeType" in target
    ? target as Node
    : null;
  return targetNode && root.contains(targetNode)
    ? offsetForDomPoint(root, targetNode)
    : null;
}

export function markerTopForTextOffset(
  root: HTMLElement,
  textOffset: number,
  edge: "before" | "after" = "before"
): number {
  const nodes = textNodes(root);
  const entries: Array<{ node: Text; start: number; end: number }> = [];
  let textLength = 0;
  for (const node of nodes) {
    entries.push({ node, start: textLength, end: textLength + node.data.length });
    textLength += node.data.length;
  }
  const boundedOffset = Math.min(textLength, Math.max(0, Math.trunc(textOffset)));

  const rectangleAt = (entry: (typeof entries)[number], localOffset: number) => {
    const character = entry.node.data[localOffset];
    if (!character || /\s/u.test(character)) return null;
    const range = root.ownerDocument.createRange();
    range.setStart(entry.node, localOffset);
    range.setEnd(entry.node, localOffset + 1);
    const rectangle = range.getBoundingClientRect();
    return rectangle.height > 0 && Number.isFinite(rectangle.top) &&
      Number.isFinite(rectangle.bottom)
      ? rectangle
      : null;
  };
  const searchForward = (offset: number) => {
    for (const entry of entries) {
      if (entry.end <= offset) continue;
      const first = Math.max(0, offset - entry.start);
      for (let index = first; index < entry.node.data.length; index += 1) {
        const rectangle = rectangleAt(entry, index);
        if (rectangle) return rectangle;
      }
    }
    return null;
  };
  const searchBackward = (offset: number) => {
    for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
      const entry = entries[entryIndex]!;
      if (entry.start >= offset) continue;
      const last = Math.min(entry.node.data.length, offset - entry.start) - 1;
      for (let index = last; index >= 0; index -= 1) {
        const rectangle = rectangleAt(entry, index);
        if (rectangle) return rectangle;
      }
    }
    return null;
  };

  const rectangle = edge === "after"
    ? searchBackward(boundedOffset) ?? searchForward(boundedOffset)
    : searchForward(boundedOffset) ?? searchBackward(boundedOffset);
  if (!rectangle) return 0;
  const markerEdge = edge === "after" ? rectangle.bottom : rectangle.top;
  return Math.max(0, markerEdge - root.getBoundingClientRect().top);
}
