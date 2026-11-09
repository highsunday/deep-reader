export interface SelfRetellingTask {
  version: 1;
  kind: "task";
  practiceId: string;
  title: string;
  instruction: string;
}

export interface SelfRetellingScore {
  score: number;
  reason: string;
}

export interface SelfRetellingComparison {
  summary: string;
  accuracyDelta: number;
  completenessDelta: number;
  ownWordsDelta: number;
  totalDelta: number;
}

export interface SelfRetellingGrade {
  version: 1;
  kind: "grade";
  practiceId: string;
  attempt: 1 | 2;
  feedback: {
    strengths: string[];
    corrections: string[];
    omissions: string[];
    expression: string[];
  };
  revisedRetelling: string;
  scores: {
    accuracy: SelfRetellingScore;
    completeness: SelfRetellingScore;
    ownWords: SelfRetellingScore;
    total: number;
  };
  comparison?: SelfRetellingComparison;
}

interface ArtifactMessage {
  role: "user" | "assistant";
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function integerInRange(value: unknown, minimum: number, maximum: number): boolean {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isTask(value: unknown): value is SelfRetellingTask {
  return isRecord(value) && value.version === 1 && value.kind === "task" &&
    isString(value.practiceId) && isString(value.title) && isString(value.instruction);
}

function isScore(value: unknown): value is SelfRetellingScore {
  return isRecord(value) && integerInRange(value.score, 0, 5) && isString(value.reason);
}

function isComparison(value: unknown): value is SelfRetellingComparison {
  return isRecord(value) && isString(value.summary) &&
    integerInRange(value.accuracyDelta, -5, 5) &&
    integerInRange(value.completenessDelta, -5, 5) &&
    integerInRange(value.ownWordsDelta, -5, 5) &&
    integerInRange(value.totalDelta, -15, 15);
}

function isGrade(value: unknown): value is SelfRetellingGrade {
  if (!isRecord(value) || !isRecord(value.feedback) || !isRecord(value.scores)) {
    return false;
  }
  const scores = value.scores;
  if (!isScore(scores.accuracy) || !isScore(scores.completeness) ||
    !isScore(scores.ownWords) || !integerInRange(scores.total, 0, 15) ||
    scores.total !== scores.accuracy.score + scores.completeness.score +
      scores.ownWords.score) return false;
  const attempt = value.attempt;
  return value.version === 1 && value.kind === "grade" &&
    isString(value.practiceId) && (attempt === 1 || attempt === 2) &&
    isStringArray(value.feedback.strengths) &&
    isStringArray(value.feedback.corrections) &&
    isStringArray(value.feedback.omissions) &&
    isStringArray(value.feedback.expression) &&
    isString(value.revisedRetelling) &&
    (attempt === 1 ? value.comparison === undefined : isComparison(value.comparison));
}

function fencedJson(text: string, language: string): unknown[] {
  const values: unknown[] = [];
  const expression = new RegExp(
    `\\\`\\\`\\\`${language}\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\``,
    "g"
  );
  for (const match of text.matchAll(expression)) {
    try {
      values.push(JSON.parse(match[1]));
    } catch {
      // Incomplete streaming artifacts remain ordinary text until valid.
    }
  }
  return values;
}

function comparisonMatches(first: SelfRetellingGrade, second: SelfRetellingGrade): boolean {
  const comparison = second.comparison;
  return Boolean(comparison) &&
    comparison?.accuracyDelta === second.scores.accuracy.score - first.scores.accuracy.score &&
    comparison.completenessDelta ===
      second.scores.completeness.score - first.scores.completeness.score &&
    comparison.ownWordsDelta === second.scores.ownWords.score - first.scores.ownWords.score &&
    comparison.totalDelta === second.scores.total - first.scores.total;
}

export function selfRetellingArtifacts(messages: ArtifactMessage[]): {
  task?: SelfRetellingTask;
  grades: SelfRetellingGrade[];
} {
  let task: SelfRetellingTask | undefined;
  let grades: SelfRetellingGrade[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const candidate of fencedJson(message.text, "self-retelling-task")) {
      if (isTask(candidate)) {
        task = candidate;
        grades = [];
      }
    }
    for (const candidate of fencedJson(message.text, "self-retelling-grade")) {
      if (!task || !isGrade(candidate) || candidate.practiceId !== task.practiceId) continue;
      if (candidate.attempt === 1) grades = [candidate];
      else if (grades[0]?.attempt === 1 && comparisonMatches(grades[0], candidate)) {
        grades = [grades[0], candidate];
      }
    }
  }
  return { task, grades };
}

export function stripSelfRetellingArtifacts(text: string): string {
  return text.replace(/```self-retelling-(?:task|grade)\s*\n[\s\S]*?\n```/g, "").trim();
}

export function formatSelfRetellingSubmission(
  task: SelfRetellingTask,
  attempt: 1 | 2,
  answer: string
): string {
  return [
    "$submit-self-retelling",
    `Practice ID: ${task.practiceId}`,
    `Attempt: ${attempt}`,
    "",
    "Learner retelling:",
    answer.trim()
  ].join("\n");
}

export function selfRetellingAnswers(
  messages: ArtifactMessage[],
  practiceId: string
): [string, string] {
  const answers: [string, string] = ["", ""];
  const expression = /^\$submit-self-retelling\r?\nPractice ID: ([^\r\n]+)\r?\nAttempt: ([12])\r?\n\r?\nLearner retelling:\r?\n([\s\S]+)$/;
  for (const message of messages) {
    if (message.role !== "user") continue;
    const match = message.text.match(expression);
    if (!match || match[1] !== practiceId) continue;
    const attempt = Number(match[2]);
    const answer = match[3].trim();
    if ((attempt === 1 || attempt === 2) && answer) answers[attempt - 1] = answer;
  }
  return answers;
}
