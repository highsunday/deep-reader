/** Publisher math vocabulary mapped to reader-owned styles, never arbitrary CSS. */
const mathClasses = new Set(`eq-inline eq eq-num eq-img eq-tag sup sub sup-high sup-10 sup-vertline
it bf bf-it caligraphic fraktur root-index root-kernel nth-root surd prime prime-low prime-char
addop relop metarelop binop arrow plus equals divide times mulop-times minus
mtx intop vertbar open close underline underline-low trigfunction opfunction
opfunction-bracket det perpendicular chi space rpad-space func-space muldot
mulcross frac sep unary bra ket middle-braket vertline bracket-open bracket-close
vertline-open vertline-closed vertline-sup rpad1_7pt lpad stared`.split(/\s+/));

export function epubMathClasses(value: string): string {
  return value.split(/\s+/).filter(name => mathClasses.has(name)).map(name => `epub-math-${name}`).join(' ');
}

interface ImageWidth { kind: '.' | '#'; name: string; width: string }
export function safeImageWidth(value: string): string | undefined {
  const match = /^(\d+(?:\.\d+)?)(em|rem|px|%)$/.exec(value.trim());
  if (!match) return;
  const n = Number(match[1]);
  if (n > 0 && n <= (match[2] === 'px' ? 4096 : 100)) return match[0];
}

/** A deliberately small subset: image class/ID widths, not a general CSS engine. */
export function epubImageWidths(css: string): ImageWidth[] {
  const rules: ImageWidth[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rule of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const declarations = [...rule[2].matchAll(/(?:^|;)\s*width\s*:\s*([^;]+)/g)];
    const width = safeImageWidth(declarations.at(-1)?.[1] ?? '');
    if (!width) continue;
    for (const selector of rule[1].split(',')) {
      const match = /(?:^|\s)img([.#])([\w-]+)\s*$/.exec(selector);
      if (match) rules.push({ kind: match[1] as '.' | '#', name: match[2], width });
    }
  }
  return rules;
}

export function imageWidthFor(rules: ImageWidth[], id: string, classes: string, style: string): string | undefined {
  const inline = /(?:^|;)\s*width\s*:\s*([^;]+)/.exec(style)?.[1];
  const names = new Set(classes.split(/\s+/));
  const matching = rules.filter(rule => rule.kind === '#' ? rule.name === id : names.has(rule.name));
  return safeImageWidth(inline ?? '') ?? matching.filter(rule => rule.kind === '#').at(-1)?.width ?? matching.at(-1)?.width;
}
