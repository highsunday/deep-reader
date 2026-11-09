function markRange(mask: boolean[], start: number, end: number) {
  for (let index = start; index < end; index += 1) mask[index] = true;
}

function protectedCodeCharacters(markdown: string): boolean[] {
  const protectedCharacters = Array.from<boolean>({ length: markdown.length }).fill(false);
  let fence: { character: "`" | "~"; length: number } | null = null;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline + 1;
    const contentEnd = markdown[lineEnd - 1] === "\n"
      ? lineEnd - (markdown[lineEnd - 2] === "\r" ? 2 : 1)
      : lineEnd;
    const line = markdown.slice(lineStart, contentEnd);
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);

    if (fence) {
      markRange(protectedCharacters, lineStart, lineEnd);
      if (marker
        && marker[1][0] === fence.character
        && marker[1].length >= fence.length
        && marker[2].trim() === "") {
        fence = null;
      }
    } else if (marker) {
      fence = {
        character: marker[1][0] as "`" | "~",
        length: marker[1].length
      };
      markRange(protectedCharacters, lineStart, lineEnd);
    }

    lineStart = lineEnd;
  }

  for (let index = 0; index < markdown.length; index += 1) {
    if (protectedCharacters[index] || markdown[index] !== "`") continue;
    let delimiterLength = 1;
    while (markdown[index + delimiterLength] === "`") delimiterLength += 1;

    let closingIndex = index + delimiterLength;
    while (closingIndex < markdown.length) {
      if (protectedCharacters[closingIndex] || markdown[closingIndex] !== "`") {
        closingIndex += 1;
        continue;
      }
      let closingLength = 1;
      while (markdown[closingIndex + closingLength] === "`") closingLength += 1;
      if (closingLength === delimiterLength) break;
      closingIndex += closingLength;
    }

    if (closingIndex < markdown.length) {
      markRange(protectedCharacters, index, closingIndex + delimiterLength);
      index = closingIndex + delimiterLength - 1;
    } else {
      index += delimiterLength - 1;
    }
  }

  return protectedCharacters;
}

function delimiterIsEscaped(markdown: string, delimiterIndex: number): boolean {
  let precedingBackslashes = 0;
  for (let index = delimiterIndex - 1; index >= 0 && markdown[index] === "\\"; index -= 1) {
    precedingBackslashes += 1;
  }
  return precedingBackslashes % 2 === 1;
}

function findClosingDelimiter(
  markdown: string,
  protectedCharacters: boolean[],
  start: number,
  closingCharacter: ")" | "]"
): number {
  for (let index = start; index < markdown.length - 1; index += 1) {
    if (protectedCharacters[index]) return -1;
    if (markdown[index] === "\\"
      && markdown[index + 1] === closingCharacter
      && !delimiterIsEscaped(markdown, index)) {
      return index;
    }
  }
  return -1;
}

export function normalizeBackslashMathDelimiters(markdown: string): string {
  const protectedCharacters = protectedCodeCharacters(markdown);
  let normalized = "";

  for (let index = 0; index < markdown.length;) {
    const openingCharacter = markdown[index + 1];
    const isOpeningDelimiter = markdown[index] === "\\"
      && (openingCharacter === "(" || openingCharacter === "[")
      && !protectedCharacters[index]
      && !delimiterIsEscaped(markdown, index);

    if (!isOpeningDelimiter) {
      normalized += markdown[index];
      index += 1;
      continue;
    }

    const closingCharacter = openingCharacter === "(" ? ")" : "]";
    const closingIndex = findClosingDelimiter(
      markdown,
      protectedCharacters,
      index + 2,
      closingCharacter
    );
    if (closingIndex === -1) {
      normalized += markdown[index];
      index += 1;
      continue;
    }

    const replacement = openingCharacter === "(" ? "$" : "$$";
    normalized += replacement;
    normalized += markdown.slice(index + 2, closingIndex);
    normalized += replacement;
    index = closingIndex + 2;
  }

  return normalized;
}
