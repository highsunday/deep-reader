export type ReadingNoteAiResponse =
  | { kind: "turn"; reply: string; proposal?: { title: string; content: string } }
  | { kind: "result"; title: string; content: string }
  | { kind: "refusal"; reason: string };

function partialJsonStringProperty(
  source: string,
  property: string,
  startAt: number
): { value: string; complete: boolean; endIndex: number } | undefined {
  const match = new RegExp(`"${property}"\\s*:\\s*"`, "g");
  match.lastIndex = startAt;
  const found = match.exec(source);
  if (!found) return undefined;
  let value = "";
  for (let index = found.index + found[0].length; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"') return { value, complete: true, endIndex: index + 1 };
    if (character !== "\\") {
      value += character;
      continue;
    }
    const escape = source[index + 1];
    if (escape === undefined) return { value, complete: false, endIndex: source.length };
    const simpleEscapes: Record<string, string> = {
      '"': '"',
      "\\": "\\",
      "/": "/",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t"
    };
    if (escape in simpleEscapes) {
      value += simpleEscapes[escape];
      index += 1;
      continue;
    }
    if (escape === "u") {
      const digits = source.slice(index + 2, index + 6);
      if (digits.length < 4) return { value, complete: false, endIndex: source.length };
      if (!/^[0-9a-f]{4}$/i.test(digits)) return undefined;
      value += String.fromCharCode(Number.parseInt(digits, 16));
      index += 5;
      continue;
    }
    return undefined;
  }
  return { value, complete: false, endIndex: source.length };
}

export function parseStreamingReadingNoteAiDraft(
  response: string
): { title: string; content: string } | undefined {
  const normalized = response.trimStart();
  if (!/^```reading-note-ai-turn\s*\n/.test(normalized) &&
    !normalized.startsWith("{")) return undefined;
  const proposal = /"proposal"\s*:\s*\{/.exec(normalized);
  if (!proposal) return undefined;
  const proposalStart = proposal.index + proposal[0].length;
  const title = partialJsonStringProperty(normalized, "title", proposalStart);
  if (!title?.value.trim()) return undefined;
  const content = title.complete
    ? partialJsonStringProperty(normalized, "content", title.endIndex)
    : undefined;
  return {
    title: title.value,
    content: content?.value ?? ""
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join("|") === [...keys].sort().join("|");
}

function text(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

export function parseReadingNoteAiResponse(
  response: string,
  sessionId: string
): ReadingNoteAiResponse {
  const match = response.match(/^```(reading-note-ai-turn|reading-note-ai-result|reading-note-ai-refusal)\s*\n([\s\S]*?)```\s*$/);
  const bare = response.trim();
  if (!match && (!bare.startsWith("{") || !bare.endsWith("}"))) {
    throw new Error("Invalid reading-note AI response.");
  }
  let value: unknown;
  try {
    value = JSON.parse(match?.[2] ?? bare);
  } catch {
    throw new Error("Invalid reading-note AI response.");
  }
  if (!object(value) || value.sessionId !== sessionId) {
    throw new Error("Invalid reading-note AI response.");
  }
  const artifactKind = match?.[1] ?? value.kind;
  if (artifactKind === "reading-note-ai-turn" && value.version === 2 &&
    value.kind === "reading-note-ai-turn" && text(value.reply) &&
    exactKeys(value, ["version", "kind", "sessionId", "reply", "proposal"])) {
    if (value.proposal === null) {
      return { kind: "turn", reply: value.reply.trim() };
    }
    if (object(value.proposal) && exactKeys(value.proposal, ["title", "content"]) &&
      text(value.proposal.title) && text(value.proposal.content)) {
      return {
        kind: "turn",
        reply: value.reply.trim(),
        proposal: {
          title: value.proposal.title.trim(),
          content: value.proposal.content.trim()
        }
      };
    }
    throw new Error("Invalid reading-note AI response.");
  }
  if (artifactKind === "reading-note-ai-turn" && value.version === 2 &&
    value.kind === "reading-note-ai-turn" &&
    exactKeys(value, ["version", "kind", "sessionId", "proposal"]) &&
    object(value.proposal) &&
    exactKeys(value.proposal, ["title", "content", "reply"]) &&
    text(value.proposal.title) && text(value.proposal.content) &&
    text(value.proposal.reply)) {
    return {
      kind: "turn",
      reply: value.proposal.reply.trim(),
      proposal: {
        title: value.proposal.title.trim(),
        content: value.proposal.content.trim()
      }
    };
  }
  if (value.version === 1 && artifactKind === "reading-note-ai-result" && value.kind === "reading-note-ai-result" &&
    text(value.content) && (
      exactKeys(value, ["version", "kind", "sessionId", "title", "content"]) && text(value.title) ||
      exactKeys(value, ["version", "kind", "sessionId", "prompt", "content"]) && text(value.prompt)
    )) {
    const title = text(value.title) ? value.title : value.prompt as string;
    return { kind: "result", title: title.trim(), content: value.content.trim() };
  }
  if (value.version === 1 && artifactKind === "reading-note-ai-refusal" &&
    exactKeys(value, ["version", "kind", "sessionId", "reason"]) &&
    value.kind === "reading-note-ai-refusal" && text(value.reason)) {
    return { kind: "refusal", reason: value.reason.trim() };
  }
  throw new Error("Invalid reading-note AI response.");
}
