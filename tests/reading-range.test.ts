// @vitest-environment jsdom

import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  advanceReadingRange,
  annotationSegments,
  contextRangePoint,
  expandReadingRangeToVisualLines,
  extractReadingSegment,
  extractReadingSegmentWithImages,
  hasAnnotationOverlap,
  initialReadingRange,
  markerTopForTextOffset,
  nextReadingSegmentNavigation,
  normalizeAnnotationRange,
  originalSelectionAtContextOffset,
  originalSelectionWithinReadingRange,
  rangeAfterMovingBoundary,
  rangeMarkerScrollTop,
  renderAnnotationHighlights,
  shouldCreateAnnotation,
  shouldDismissRangeContextMenu
} from "../src/renderer/reading-range";
import { prepareReadingSegmentDelivery } from "../src/renderer/reading-segment-delivery";
import { prepareReadingNoteAwareMessage } from "../src/renderer/reading-note-workflow";
import { buildReadingStructure, inferReadingPreference, nextAdaptiveReadingSegment, readingUnits } from "../src/renderer/adaptive-reading-segment";

function structureFor(html: string) {
  const root = document.createElement('article');
  root.innerHTML = html;
  return buildReadingStructure(root);
}

test('B72 TC8: explicit EPUB navigation paragraphs preserve whole-section advancement', () => {
  const index = structureFor('<p id="a" data-reading-heading-level="1"><b>没有老师怎么办？</b></p><p>甲乙</p><p id="b" data-reading-heading-level="1"><b>突破高原期</b></p><p>一二三四五六七八九十</p><p>天地玄黃宇宙洪荒</p><p id="c" data-reading-heading-level="1"><b>找到持续不懈的动机</b></p><p>末節</p>');
  const current = { start: 0, end: index.text.indexOf('突破') };
  assert.deepEqual(inferReadingPreference(index, current), { mode: 'section', level: 1 });
  assert.deepEqual(nextAdaptiveReadingSegment(index, current), { start: current.end, end: index.text.indexOf('找到') });
});

test('B72 TC1/2: complete visible short sections use section mode without changing paragraph targets', () => {
  const index = structureFor('<h2>A</h2><p>甲乙丙丁戊己庚辛壬癸</p><h2>B</h2><p>一二三四五</p><p>六七八九十</p>');
  for (const range of [{ start: 0, end: 10 }, { start: 2, end: 11 }, { start: 2, end: 10 }]) {
    const visible = { start: range.start === 0 ? 0 : 1, end: 11 };
    assert.deepEqual(inferReadingPreference(index, range, visible), { mode: 'section', level: 2 });
  }
  // Exact-offset fallback must not claim an unread character belongs to the section.
  assert.deepEqual(inferReadingPreference(index, { start: 0, end: 10 }), { mode: 'paragraph', targetUnits: 10 });
  const partial = { start: 1, end: 4 };
  assert.deepEqual(inferReadingPreference(index, partial, { start: 1, end: 6 }), { mode: 'paragraph', targetUnits: 3 });
});

test('B72 TC6: unmarked headings and formatting whitespace keep deterministic fallback', () => {
  const index = structureFor('<p><strong>A</strong></p><p>甲乙丙丁戊己庚辛壬癸</p><p>B</p><p>一二三四五</p>  ');
  assert.deepEqual(inferReadingPreference(index, { start: 0, end: 10 }, { start: 0, end: 11 }), { mode: 'paragraph', targetUnits: 10 });
  const section = structureFor('<h2>A</h2>\n<p>甲乙丙丁戊己庚辛壬癸</p>\n<h2>B</h2><p>末節</p>  ');
  const visible = { start: 0, end: section.text.indexOf('B') };
  const current = { start: 0, end: visible.end - 2 };
  const pref = inferReadingPreference(section, current, visible);
  assert.equal(pref.mode, 'section');
  const next = nextAdaptiveReadingSegment(section, current, pref, visible.end)!;
  assert.equal(section.text.slice(next.start, next.end), 'B末節  ');
  assert.equal(nextAdaptiveReadingSegment(section, next, pref), undefined);
});

test('B70: adaptive advancement follows current visual lines while retaining the manual target', () => {
  const root = document.createElement('article');
  root.textContent = 'abcdefghijklmnopqrst';
  const index = buildReadingStructure(root);
  const current = { start: 0, end: 8 };
  const preference = inferReadingPreference(index, current);
  let width = 5;
  const originalCreateRange = document.createRange.bind(document);
  const spy = vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = originalCreateRange();
    Object.defineProperty(range, 'getBoundingClientRect', { value: () => new DOMRect(0, Math.floor(range.startOffset / width) * 20, 10, 18) });
    return range;
  });
  try {
    const next = () => nextAdaptiveReadingSegment(index, current, preference, expandReadingRangeToVisualLines(root, current).end);
    assert.deepEqual(next(), { start: 10, end: 20 });
    width = 3;
    assert.deepEqual(next(), { start: 9, end: 20 });
    width = 20;
    assert.equal(next(), undefined);
    assert.deepEqual(preference, inferReadingPreference(index, current));
  } finally {
    spy.mockRestore();
  }
  assert.deepEqual(nextAdaptiveReadingSegment(index, current, preference, expandReadingRangeToVisualLines(root, current).end), { start: 8, end: 20 });
});

test('F64 TC1/2: complete subsections include longer bodies and nested headings', () => {
  const a = '甲'.repeat(100), b = '乙'.repeat(1000);
  const index = structureFor(`<h1>章</h1><h2>A</h2><p>${a}</p><h2>B</h2><p>${b}</p><h3>B.1</h3><p>內文</p><h2>C</h2><p>完</p>`);
  const endA = index.text.indexOf('B');
  for (const start of [1, 2, 3]) {
    const current = { start, end: endA - (start === 3 ? 1 : 0) };
    const pref = inferReadingPreference(index, current);
    assert.deepEqual(pref, { mode: 'section', level: 2 });
  }
  assert.deepEqual(nextAdaptiveReadingSegment(index, { start: 1, end: endA }), {
    start: endA, end: index.text.indexOf('C')
  });
});

test('F64 TC3: mixed scripts use reading units and choose the nearest paragraph end', () => {
  assert.equal(readingUnits("中文hello世界 don't stop 123"), 8);
  const index = structureFor('<p>一二三四五六七八九十</p><p>甲乙丙</p><p>丁戊己</p><p>庚辛壬</p><p>癸'.concat('長'.repeat(20), '</p>'));
  const current = { start: 0, end: 10 };
  assert.deepEqual(nextAdaptiveReadingSegment(index, current), { start: 10, end: 19 });
  const english = structureFor('<p>one two three four five six</p><p>seven eight nine</p><p>ten eleven twelve</p><p>thirteen fourteen fifteen sixteen</p>');
  const first = english.blocks[0];
  assert.deepEqual(nextAdaptiveReadingSegment(english, first), { start: first.end, end: english.blocks[2].end });
});

test('F64 TC4: paragraphs stop before headings and include a heading with its first body', () => {
  const index = structureFor('<p>一二三四五六七八九十</p><p>甲</p><h2>標題</h2><p>乙</p><p>丙丁戊己庚辛壬癸</p>');
  const pref = { mode: 'paragraph' as const, targetUnits: 10 };
  const next = nextAdaptiveReadingSegment(index, index.blocks[0], pref)!;
  assert.equal(index.text.slice(next.start, next.end), '甲');
  const following = nextAdaptiveReadingSegment(index, next, { mode: 'paragraph', targetUnits: 1 })!;
  assert.equal(index.text.slice(following.start, following.end), '標題乙');
});

test('F64 TC5: automatic output does not change the target; manual ranges change modes', () => {
  const index = structureFor('<h2>A</h2><p>甲乙丙丁戊己庚辛壬癸</p><h2>B</h2><p>一二三四五六</p><p>七八九十</p><h2>C</h2><p>天地玄黃</p><p>宇宙洪荒</p>');
  const section = { start: 0, end: index.text.indexOf('B') };
  assert.equal(inferReadingPreference(index, section).mode, 'section');
  const manual = { start: index.text.indexOf('一'), end: index.text.indexOf('七') };
  const pref = inferReadingPreference(index, manual);
  assert.deepEqual(pref, { mode: 'paragraph', targetUnits: 6 });
  const next = nextAdaptiveReadingSegment(index, manual, pref)!;
  assert.equal(index.text.slice(next.start, next.end), '七八九十');
  assert.deepEqual(pref, { mode: 'paragraph', targetUnits: 6 });
});

test('F64 TC6/8: mid-paragraph continuation never skips or repeats text and stops at chapter end', () => {
  const index = structureFor('<p>甲乙丙丁戊己庚辛壬癸</p><p>一二三四五</p><p>六七八九十</p>  ');
  let current = { start: 0, end: 3 };
  const pref = inferReadingPreference(index, current);
  let result = index.text.slice(0, 3);
  for (let i = 0; i < 10; i += 1) {
    const next = nextAdaptiveReadingSegment(index, current, pref);
    if (!next) break;
    result += index.text.slice(next.start, next.end);
    current = next;
  }
  assert.equal(result, index.text);
  assert.equal(current.end, index.text.length);
  assert.equal(nextAdaptiveReadingSegment(index, current, pref), undefined);
  assert.equal(nextAdaptiveReadingSegment(structureFor('  '), { start: 0, end: 0 }), undefined);
  assert.equal(nextAdaptiveReadingSegment(structureFor(''), { start: 0, end: 0 }), undefined);
});

test('F64 TC7: atomic content, inline annotations, divs and breaks keep exact DOM offsets', () => {
  const index = structureFor('<div>前言<br>續文</div><p><mark>正文</mark>。</p><ul><li>一</li><li>二</li></ul><table><tbody><tr><td>表一</td><td>表二</td></tr></tbody></table><figure><img src="a"><figcaption>圖說</figcaption></figure><div>結尾<span>文字</span></div>');
  assert.deepEqual(index.blocks.map(block => index.text.slice(block.start, block.end)), ['前言', '續文', '正文。', '一二', '表一表二', '圖說', '結尾文字']);
  for (let i = 1; i < index.blocks.length; i += 1) {
    const next = nextAdaptiveReadingSegment(index, index.blocks[i - 1], { mode: 'paragraph', targetUnits: 1 })!;
    assert.equal(next.end, index.blocks[i].end);
  }
});

test('F64 TC9: cached structure navigates a large chapter without accessing DOM', () => {
  const index = structureFor('<p>中文段落內容以及 English words.</p>'.repeat(20000));
  const pref = { mode: 'paragraph' as const, targetUnits: 30 };
  const timings: number[] = [];
  let current = { start: 0, end: 10 };
  for (let i = 0; i < 1000; i += 1) {
    const start = performance.now();
    current = nextAdaptiveReadingSegment(index, current, pref)!;
    timings.push(performance.now() - start);
  }
  const p99 = timings.sort((a, b) => a - b)[989];
  console.info(`F64 cached navigation: 20,000 paragraphs, p99=${p99.toFixed(3)}ms`);
  assert.ok(p99 < 16, `cached navigation p99 was ${p99}ms`);
});

test('F64 TC7: a figure image before caption whitespace stays in the next range', () => {
  const root = document.createElement('article');
  root.innerHTML = `<p>前段</p><figure><img src="${'data:image/png;base64,aGVsbG8='}">\n  <figcaption>圖說</figcaption></figure><p>後段</p>`;
  const index = buildReadingStructure(root);
  const next = nextAdaptiveReadingSegment(index, { start: 0, end: 2 }, { mode: 'paragraph', targetUnits: 1 })!;
  assert.equal(extractReadingSegmentWithImages(root, next).images.length, 1);
  assert.equal(index.text.slice(next.start, next.end).trim(), '圖說');
});

test('F64 TC2/6: near-end subsection selection carries the unread tail into the next whole subsection', () => {
  const index = structureFor(`<h2>A</h2><p>${'甲'.repeat(100)}</p><h2>B</h2><p>乙丙丁</p><h2>C</h2><p>戊</p>`);
  const current = { start: 0, end: 100 };
  assert.equal(inferReadingPreference(index, current).mode, 'section');
  const next = nextAdaptiveReadingSegment(index, current)!;
  assert.equal(index.text.slice(next.start, next.end), '甲B乙丙丁');
});

test('F64 TC4: an empty subsection heading travels with the following readable subsection', () => {
  const index = structureFor('<h2>A</h2><p>甲</p><h2>B</h2><h2>C</h2><p>乙</p><h2>D</h2><p>丙</p>');
  const next = nextAdaptiveReadingSegment(index, { start: 0, end: 2 })!;
  assert.equal(index.text.slice(next.start, next.end), 'BC乙');
});

const formulaImage = "data:image/png;base64,aGVsbG8=";

test("F46 T1/T2: reading segment keeps in-range book images and reuses repeated attachments", () => {
  const root = document.createElement("article");
  root.innerHTML = `<p>Before<img src="${formulaImage}">middle<img src="${formulaImage}">after<img src="${formulaImage}">end</p>`;
  const result = extractReadingSegmentWithImages(root, { start: 6, end: 17 });
  assert.equal(result.readingSegment, "[Book image 1]middle[Book image 1]after");
  assert.deepEqual(result.images, [{ dataUrl: formulaImage }]);
  assert.equal(root.textContent, "Beforemiddleafterend");
});

test("repeated EPUB icons do not consume the eight distinct book-image slots", () => {
  const root = document.createElement("article");
  const sources = ["track", "page-a", "icon", "arrow", "icon", "page-b", "icon", "repeat", "repeat", "page-c"];
  root.innerHTML = sources.map(name => `<span>x<img src="data:image/png;base64,${name}"></span>`).join("");
  const result = extractReadingSegmentWithImages(root, { start: 0, end: sources.length });
  assert.equal(result.images.length, 7);
  assert.equal(result.readingSegment, "x[Book image 1]x[Book image 2]x[Book image 3]x[Book image 4]x[Book image 3]x[Book image 5]x[Book image 3]x[Book image 6]x[Book image 6]x[Book image 7]");
});

test("F46 T4: image-only chapters are a nonempty reading segment", () => {
  const root = document.createElement("article");
  root.innerHTML = `<img src="${formulaImage}">`;
  assert.deepEqual(extractReadingSegmentWithImages(root, { start: 0, end: 0 }), {
    readingSegment: "[Book image 1]",
    images: [{ dataUrl: formulaImage }]
  });
});

test("F46 T2: a trailing image belongs to a full-chapter reading range", () => {
  const root = document.createElement("article");
  root.innerHTML = `<p>Text<img src="${formulaImage}"></p>`;
  assert.deepEqual(extractReadingSegmentWithImages(root, { start: 0, end: 4 }), {
    readingSegment: "Text[Book image 1]",
    images: [{ dataUrl: formulaImage }]
  });
  assert.deepEqual(extractReadingSegmentWithImages(root, { start: 4, end: 4 }), {
    readingSegment: "",
    images: []
  });
});

test("a chapter without a saved range defaults to the complete chapter", () => {
  assert.deepEqual(initialReadingRange("first line\nlast line"), {
    start: 0,
    end: 20
  });
});

test("default chapter markers ignore outer formatting whitespace and span visible content", () => {
  const root = document.createElement("article");
  root.innerHTML = "\n  <h1>Chapter</h1>\n  <p>Body</p>\n";
  document.body.append(root);
  Object.defineProperty(root, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 10, 400, 200)
  });
  const originalCreateRange = document.createRange.bind(document);
  const createRange = vi.spyOn(document, "createRange").mockImplementation(() => {
    const domRange = originalCreateRange();
    Object.defineProperty(domRange, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const character = domRange.startContainer.textContent?.[domRange.startOffset] ?? "";
        if (/\s/u.test(character)) return new DOMRect(0, 0, 0, 0);
        const top = domRange.startContainer.parentElement?.tagName === "H1" ? 40 : 100;
        return new DOMRect(0, top, 10, 20);
      }
    });
    return domRange;
  });

  try {
    const range = initialReadingRange(root.textContent ?? "");
    assert.deepEqual(range, { start: 0, end: root.textContent?.length });
    assert.equal(markerTopForTextOffset(root, range.start), 30);
    assert.equal(markerTopForTextOffset(root, range.end, "after"), 110);
  } finally {
    createRange.mockRestore();
    root.remove();
  }
});

test("chapter markers keep before and after positioning for visible exact offsets", () => {
  const root = document.createElement("article");
  root.textContent = "Visible text";
  document.body.append(root);
  Object.defineProperty(root, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 10, 400, 200)
  });
  const originalCreateRange = document.createRange.bind(document);
  const createRange = vi.spyOn(document, "createRange").mockImplementation(() => {
    const domRange = originalCreateRange();
    Object.defineProperty(domRange, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(0, 40, 10, 20)
    });
    return domRange;
  });

  try {
    assert.equal(markerTopForTextOffset(root, 0), 30);
    assert.equal(markerTopForTextOffset(root, 7, "after"), 50);
  } finally {
    createRange.mockRestore();
    root.remove();
  }
});

test("chapter markers safely fall back when the chapter has no visible glyph", () => {
  const root = document.createElement("article");
  root.textContent = " \n ";
  document.body.append(root);

  try {
    assert.equal(markerTopForTextOffset(root, 0), 0);
    assert.equal(markerTopForTextOffset(root, root.textContent.length, "after"), 0);
  } finally {
    root.remove();
  }
});

test("an in-chapter selection becomes a trimmed annotation range", () => {
  assert.deepEqual(normalizeAnnotationRange("  Alpha beta gamma  ", 0, 20), {
    start: 2,
    end: 18,
    text: "Alpha beta gamma"
  });
});

test("annotation overlap rejects partial and complete intersections but permits adjacency", () => {
  const annotations = [{ id: "a1", start: 5, end: 10, text: "range" }];
  assert.equal(hasAnnotationOverlap(annotations, { start: 4, end: 6 }), true);
  assert.equal(hasAnnotationOverlap(annotations, { start: 5, end: 10 }), true);
  assert.equal(hasAnnotationOverlap(annotations, { start: 10, end: 14 }), false);
});

test("annotation creation requires active mode, a selection, and no overlap", () => {
  const selected = { start: 10, end: 14, text: "idea" };
  assert.equal(shouldCreateAnnotation(false, [], selected), false);
  assert.equal(shouldCreateAnnotation(true, [], null), false);
  assert.equal(shouldCreateAnnotation(true, [selected], selected), false);
  assert.equal(shouldCreateAnnotation(true, [], selected), true);
});

test("an original selection must stay completely inside the current reading range", () => {
  const range = { start: 10, end: 30 };
  assert.equal(originalSelectionWithinReadingRange({ start: 10, end: 30 }, range), true);
  assert.equal(originalSelectionWithinReadingRange({ start: 14, end: 22 }, range), true);
  assert.equal(originalSelectionWithinReadingRange({ start: 9, end: 22 }, range), false);
  assert.equal(originalSelectionWithinReadingRange({ start: 14, end: 31 }, range), false);
  assert.equal(originalSelectionWithinReadingRange({ start: 18, end: 18 }, range), false);
});

test("a context-menu explanation uses only the original selection under the click", () => {
  const selected = { start: 10, end: 30, text: "selected passage" };
  assert.equal(originalSelectionAtContextOffset(selected, 10), selected);
  assert.equal(originalSelectionAtContextOffset(selected, 29), selected);
  assert.equal(originalSelectionAtContextOffset(selected, 9), undefined);
  assert.equal(originalSelectionAtContextOffset(selected, 30), undefined);
  assert.equal(originalSelectionAtContextOffset(null, 20), undefined);
});

test("saved annotation offsets split across chapter text nodes for rendering", () => {
  assert.deepEqual(annotationSegments([6, 4, 6], { start: 6, end: 16 }), [
    { nodeIndex: 1, start: 0, end: 4 },
    { nodeIndex: 2, start: 0, end: 6 }
  ]);
});

test("annotation highlights expose their persisted color to the renderer", () => {
  const root = document.createElement("article");
  root.textContent = "Yellow Green Blue Pink Purple";
  document.body.append(root);

  try {
    renderAnnotationHighlights(root, [
      { id: "green", start: 7, end: 12, text: "Green", color: "green" }
    ]);
    const mark = root.querySelector<HTMLElement>('[data-annotation-id="green"]');
    assert.equal(mark?.textContent, "Green");
    assert.equal(mark?.dataset.annotationColor, "green");
  } finally {
    root.remove();
  }
});

test("context menu START targets the beginning of the previous visual line", () => {
  assert.deepEqual(
    contextRangePoint(
      { left: 100, right: 700, top: 50, bottom: 650 },
      250,
      30,
      "start"
    ),
    { x: 101, y: 220, fallbackOffset: 0 }
  );
});

test("context menu END targets the end of the following visual line", () => {
  assert.deepEqual(
    contextRangePoint(
      { left: 100, right: 700, top: 50, bottom: 650 },
      250,
      30,
      "end",
      987
    ),
    { x: 699, y: 280, fallbackOffset: 987 }
  );
});

test("context menu adjacent-line points clamp to chapter bounds", () => {
  const bounds = { left: 100, right: 700, top: 50, bottom: 650 };
  assert.equal(contextRangePoint(bounds, 55, 30, "start").y, 50);
  assert.equal(contextRangePoint(bounds, 645, 30, "end", 987).y, 650);
});

test("the range context menu closes for all specified dismissal interactions", () => {
  assert.equal(shouldDismissRangeContextMenu("outside-click"), true);
  assert.equal(shouldDismissRangeContextMenu("scroll"), true);
  assert.equal(shouldDismissRangeContextMenu("resize"), true);
  assert.equal(shouldDismissRangeContextMenu("keydown", "Escape"), true);
  assert.equal(shouldDismissRangeContextMenu("keydown", "Enter"), false);
});

test("moving START beyond END carries END to the same position", () => {
  assert.deepEqual(
    rangeAfterMovingBoundary({ start: 10, end: 20 }, "start", 30),
    { start: 30, end: 30 }
  );
});

test("moving END before START carries START to the same position", () => {
  assert.deepEqual(
    rangeAfterMovingBoundary({ start: 10, end: 20 }, "end", 5),
    { start: 5, end: 5 }
  );
});

test("Next segment advances by the current segment word count", () => {
  const text = "one two three   four five six seven";
  const current = { start: 0, end: "one two three".length };
  const next = advanceReadingRange(text, current);

  assert.equal(extractReadingSegment(text, next), "four five six");
  assert.equal(next.start, text.indexOf("four"));
});

test("AI reading segments expand to complete visual lines without changing empty ranges", () => {
  const root = document.createElement("article");
  root.textContent = "abcdefghijklmnopqrst";
  document.body.append(root);
  const originalCreateRange = document.createRange.bind(document);
  const createRange = vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = originalCreateRange();
    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const top = Math.floor(range.startOffset / 5) * 20;
        return new DOMRect(0, top, 50, 18);
      }
    });
    return range;
  });

  try {
    assert.deepEqual(
      expandReadingRangeToVisualLines(root, { start: 7, end: 8 }),
      { start: 5, end: 10 }
    );
    assert.deepEqual(
      expandReadingRangeToVisualLines(root, { start: 0, end: 20 }),
      { start: 0, end: 20 }
    );
    assert.deepEqual(
      expandReadingRangeToVisualLines(root, { start: 7, end: 7 }),
      { start: 7, end: 7 }
    );
  } finally {
    createRange.mockRestore();
    root.remove();
  }
});

test("Next segment can start at the next visual line while preserving exact-range word count", () => {
  const chapter = "one two three four five six";
  const current = { start: 0, end: 7 };

  const navigation = nextReadingSegmentNavigation(chapter, current, 14);

  assert.equal(navigation?.range.start, 14);
  assert.equal(extractReadingSegment(chapter, navigation!.range), "four five");
  assert.equal(nextReadingSegmentNavigation(chapter, current, chapter.length), undefined);
});

test("visual-line expansion falls back to exact offsets when layout geometry is unavailable", () => {
  const root = document.createElement("article");
  root.textContent = "abcdefghijklmnopqrst";
  document.body.append(root);

  try {
    assert.deepEqual(
      expandReadingRangeToVisualLines(root, { start: 7, end: 8 }),
      { start: 7, end: 8 }
    );
  } finally {
    root.remove();
  }
});

test("Next segment clamps to the end of a chapter", () => {
  const text = "one two three four";
  const next = advanceReadingRange(text, { start: 0, end: "one two three".length });

  assert.equal(extractReadingSegment(text, next), "four");
  assert.equal(next.end, text.length);
});

test("Next segment navigation advances the range without requesting a scroll", () => {
  const text = "one two three   four five six seven";
  const current = { start: 0, end: "one two three".length };

  assert.deepEqual(nextReadingSegmentNavigation(text, current), {
    range: {
      start: text.indexOf("four"),
      end: text.indexOf("six") + "six".length
    }
  });
});

test("Next segment navigation does nothing at the end of a chapter", () => {
  const text = "one two three";

  assert.equal(
    nextReadingSegmentNavigation(text, { start: 0, end: text.length }),
    undefined
  );
});

test("START jump aligns the boundary at one quarter of the reading viewport", () => {
  assert.equal(rangeMarkerScrollTop({
    containerScrollTop: 300,
    containerTop: 100,
    containerHeight: 800,
    markerTop: 1000,
    marker: "start"
  }), 1000);
});

test("END jump aligns the boundary at three quarters of the reading viewport", () => {
  assert.equal(rangeMarkerScrollTop({
    containerScrollTop: 300,
    containerTop: 100,
    containerHeight: 800,
    markerTop: 1000,
    marker: "end"
  }), 600);
});

test("range boundary jumps clamp before the beginning of the chapter", () => {
  assert.equal(rangeMarkerScrollTop({
    containerScrollTop: 0,
    containerTop: 100,
    containerHeight: 900,
    markerTop: 150,
    marker: "start"
  }), 0);
});

test("the first question provides the current reading segment", () => {
  const delivery = prepareReadingSegmentDelivery({
    bookId: "book-1",
    bookTitle: "Thinking in Systems",
    chapterId: "chapter-1",
    chapterTitle: "Feedback Loops",
    range: { start: 10, end: 24 },
    readingSegment: "Inside concept."
  });

  assert.deepEqual(delivery.context, {
    bookTitle: "Thinking in Systems",
    chapterTitle: "Feedback Loops",
    readingSegment: "Inside concept."
  });
  assert.equal(typeof delivery.key, "string");
});

test("an unchanged reading range is omitted from ordinary follow-ups", () => {
  const input = {
    bookId: "book-1",
    bookTitle: "Thinking in Systems",
    chapterId: "chapter-1",
    chapterTitle: "Feedback Loops",
    range: { start: 10, end: 24 },
    readingSegment: "Inside concept."
  };
  const first = prepareReadingSegmentDelivery(input);
  const followUp = prepareReadingSegmentDelivery(input, first.key);

  assert.equal(followUp.context, undefined);
  assert.equal(followUp.shouldRemember, false);
});

test("F46 T3: images travel with the first reading segment and are omitted from an unchanged follow-up", () => {
  const input = {
    bookId: "book-1", bookTitle: "Book", chapterId: "chapter-1", chapterTitle: "Chapter",
    range: { start: 0, end: 6 }, readingSegment: "A[Book image 1]B",
    images: [{ dataUrl: formulaImage }]
  };
  const first = prepareReadingSegmentDelivery(input);
  assert.deepEqual(first.context?.images, [{ dataUrl: formulaImage }]);
  assert.equal(prepareReadingSegmentDelivery(input, first.key).context, undefined);
  assert.deepEqual(prepareReadingSegmentDelivery({ ...input, range: { start: 0, end: 7 } }, first.key).context?.images,
    [{ dataUrl: formulaImage }]);
});

test("a reading-note clarification follow-up resends the unchanged segment with its intent", () => {
  const segment = {
    bookId: "book-1",
    bookTitle: "Nonviolent Communication",
    chapterId: "chapter-2",
    chapterTitle: "Communication that blocks compassion",
    range: { start: 10, end: 120 },
    readingSegment: "We learn to be disconnected from what we are feeling and needing."
  };
  const first = prepareReadingSegmentDelivery(segment);
  const prepared = prepareReadingNoteAwareMessage({
    text: "我們如何與感受疏離",
    model: "gpt-5.6-sol",
    segment,
    lastProvidedKey: first.key,
    readingNotePending: true
  });
  assert.equal(prepared.input.intent, "createReadingNote");
  assert.equal(prepared.input.context?.readingSegment, segment.readingSegment);
  assert.equal(prepared.delivery.shouldRemember, true);
});

test("an ordinary follow-up keeps its full reading source even when delivery omits repeated context", () => {
  const segment = {
    bookId: "book-1", bookTitle: "系統之美", chapterId: "chapter-1", chapterTitle: "回饋",
    range: { start: 5, end: 55 }, readingSegment: "第一段\n第二段"
  };
  const first = prepareReadingSegmentDelivery(segment);
  const followUp = prepareReadingNoteAwareMessage({
    text: "再說明一次", model: "gpt-5.6-sol", segment,
    lastProvidedKey: first.key, readingNotePending: false
  });
  assert.equal(followUp.input.context, undefined);
  assert.deepEqual(followUp.input.readingSource, {
    bookId: segment.bookId, chapterId: segment.chapterId, bookTitle: "系統之美", chapterTitle: "回饋", readingSegment: "第一段\n第二段"
  });
});

test("changing START or END provides the new reading segment once", () => {
  const original = prepareReadingSegmentDelivery({
    bookId: "book-1",
    bookTitle: "Thinking in Systems",
    chapterId: "chapter-1",
    chapterTitle: "Feedback Loops",
    range: { start: 10, end: 24 },
    readingSegment: "Inside concept."
  });
  const changed = prepareReadingSegmentDelivery({
    bookId: "book-1",
    bookTitle: "Thinking in Systems",
    chapterId: "chapter-1",
    chapterTitle: "Feedback Loops",
    range: { start: 12, end: 30 },
    readingSegment: "side concept. More"
  }, original.key);
  const followUp = prepareReadingSegmentDelivery({
    bookId: "book-1",
    bookTitle: "Thinking in Systems",
    chapterId: "chapter-1",
    chapterTitle: "Feedback Loops",
    range: { start: 12, end: 30 },
    readingSegment: "side concept. More"
  }, changed.key);

  assert.equal(changed.context?.readingSegment, "side concept. More");
  assert.equal(changed.shouldRemember, true);
  assert.equal(followUp.context, undefined);
});

test("a changed visual-line boundary produces a new reading segment delivery key", () => {
  const input = {
    bookId: "book-1",
    bookTitle: "Thinking in Systems",
    chapterId: "chapter-1",
    chapterTitle: "Feedback Loops",
    range: { start: 7, end: 8 },
    contextRange: { start: 5, end: 10 },
    readingSegment: "fghij"
  };
  const first = prepareReadingSegmentDelivery(input);
  const reflowed = prepareReadingSegmentDelivery({
    ...input,
    contextRange: { start: 0, end: 10 }
  }, first.key);

  assert.equal(reflowed.shouldRemember, true);
  assert.notEqual(reflowed.key, first.key);
});

test("chapter changes and uncommitted failed deliveries provide the segment again", () => {
  const first = prepareReadingSegmentDelivery({
    bookId: "book-1",
    bookTitle: "Thinking in Systems",
    chapterId: "chapter-1",
    chapterTitle: "One",
    range: { start: 0, end: 7 },
    readingSegment: "Content"
  });
  const otherChapter = prepareReadingSegmentDelivery({
    bookId: "book-1",
    bookTitle: "Thinking in Systems",
    chapterId: "chapter-2",
    chapterTitle: "Two",
    range: { start: 0, end: 7 },
    readingSegment: "Content"
  }, first.key);
  const retryAfterFailure = prepareReadingSegmentDelivery({
    bookId: "book-1",
    bookTitle: "Thinking in Systems",
    chapterId: "chapter-1",
    chapterTitle: "One",
    range: { start: 0, end: 7 },
    readingSegment: "Content"
  });

  assert.equal(otherChapter.context?.chapterTitle, "Two");
  assert.equal(otherChapter.context?.readingSegment, "Content");
  assert.equal(retryAfterFailure.context?.readingSegment, "Content");
});

// B34 follow-up: EPUB formatting whitespace has no glyph rectangle in Chromium.
test("invisible chapter boundary whitespace does not disable the other visual boundary", () => {
  const root = document.createElement("article");
  root.innerHTML = "\n  <p>AAAAABBBBBCCCCC</p>\n  ";
  const nativeCreateRange = document.createRange.bind(document);
  const spy = vi.spyOn(document, "createRange").mockImplementation(() => {
    const range = nativeCreateRange();
    Object.defineProperty(range, "getBoundingClientRect", { value: () =>
      range.startContainer.parentElement?.tagName === "P"
        ? new DOMRect(0, Math.floor(range.startOffset / 5) * 20, 10, 20)
        : new DOMRect(0, 0, 0, 0)
    });
    return range;
  });
  try {
    assert.deepEqual(expandReadingRangeToVisualLines(root, { start: 10, end: 21 }), { start: 8, end: 21 });
    assert.deepEqual(expandReadingRangeToVisualLines(root, { start: 0, end: 11 }), { start: 0, end: 13 });
    assert.deepEqual(expandReadingRangeToVisualLines(root, { start: 0, end: 21 }), { start: 0, end: 21 });
  } finally { spy.mockRestore(); }
});

test("B73 a natural-language note request resends current book images after discussion of the same segment", () => {
  const images = [{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }];
  const segment = { bookId: "book", bookTitle: "系統", chapterId: "chapter", chapterTitle: "回饋",
    range: { start: 0, end: 30 }, readingSegment: "負回饋圖解 [Book image 1]", images };
  const first = prepareReadingSegmentDelivery(segment);
  const message = prepareReadingNoteAwareMessage({ text: "把剛才討論的負回饋整理成筆記", model: "gpt-5.6-sol",
    segment, lastProvidedKey: first.key, readingNotePending: false });
  assert.equal(message.input.intent, undefined);
  assert.deepEqual(message.input.context?.images, images);
  assert.equal(message.input.context?.readingSegment, segment.readingSegment);
  assert.equal(message.input.readingSource?.bookImageCount, 1);
});

test("B73 disabled book images never reuse images from a preceding visual turn", () => {
  const segment = { bookId: "book", bookTitle: "系統", chapterId: "chapter", chapterTitle: "回饋",
    range: { start: 0, end: 30 }, readingSegment: "負回饋圖解", images: [] };
  const previous = prepareReadingSegmentDelivery({ ...segment, images: [{ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }] });
  const message = prepareReadingNoteAwareMessage({ text: "整理成筆記", model: "gpt-5.6-sol", segment,
    lastProvidedKey: previous.key, readingNotePending: false });
  assert.equal(message.input.context?.images, undefined);
  assert.equal(message.input.readingSource?.bookImageCount, undefined);
});
