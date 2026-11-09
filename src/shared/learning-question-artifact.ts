export type LearningQuestionLevel =
  | "basic"
  | "relationship"
  | "application"
  | "synthesis"
  | "core";

export interface LearningQuestionTheme {
  id: string;
  title: string;
  summary: string;
}

export interface LearningQuestion {
  id: string;
  number: number;
  themeId: string;
  level: LearningQuestionLevel;
  prompt: string;
}

export interface LearningQuestionQuiz {
  version: 1 | 2;
  kind: "quiz";
  quizId: string;
  title: string;
  themes: LearningQuestionTheme[];
  questions: LearningQuestion[];
}

export interface LearningQuestionScore {
  score: number;
  max: 40 | 30 | 15;
  reason: string;
}

export interface LearningQuestionResult {
  id: string;
  scores: {
    focus: LearningQuestionScore;
    correctness: LearningQuestionScore;
    ownWords: LearningQuestionScore;
    exampleOrExtension: LearningQuestionScore;
  };
  total: number;
  assessment?: "independent" | "needs-guidance" | "unverified";
  feedback: string;
  improvement: string;
  revisedAnswer: string;
}

export interface LearningQuestionGrade {
  version: 1 | 2;
  kind: "grade";
  quizId: string;
  results: LearningQuestionResult[];
  summary: {
    average: number;
    strengths: string[];
    nextSteps: string[];
    encouragement: string;
  };
}

export type LearningQuestionAnswers = Record<string, string>;

interface ArtifactMessage {
  role: "user" | "assistant";
  text: string;
}

const LEVELS: LearningQuestionLevel[] = [
  "basic", "relationship", "application", "synthesis", "core"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length;
}

function isTheme(value: unknown): value is LearningQuestionTheme {
  return isRecord(value) && isString(value.id) && value.id !== "core" &&
    isString(value.title) && isString(value.summary);
}

function isQuestion(value: unknown): value is LearningQuestion {
  return isRecord(value) && isString(value.id) &&
    Number.isInteger(value.number) && Number(value.number) > 0 &&
    isString(value.themeId) &&
    LEVELS.includes(value.level as LearningQuestionLevel) &&
    isString(value.prompt) &&
    (value.level === "core" ? value.themeId === "core" : value.themeId !== "core");
}

function isQuiz(value: unknown): value is LearningQuestionQuiz {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || value.kind !== "quiz" ||
    !isString(value.quizId) || !isString(value.title) ||
    !Array.isArray(value.themes) || !value.themes.length ||
    !value.themes.every(isTheme) || !Array.isArray(value.questions) ||
    !value.questions.length || !value.questions.every(isQuestion)) return false;
  const themes = value.themes as LearningQuestionTheme[];
  const questions = value.questions as LearningQuestion[];
  if (themes.length > 3 || questions.length < (value.version === 2 ? 1 : 3) || questions.length > (value.version === 2 ? 3 : 5)) return false;
  const coreQuestionCount = questions.filter(({ level }) => level === "core").length;
  if (value.version === 1 && (coreQuestionCount < 1 || coreQuestionCount > 2)) return false;
  const themeIds = themes.map(({ id }) => id);
  return unique(themeIds) && unique(questions.map(({ id }) => id)) &&
    questions.every(({ themeId }) => themeId === "core" || themeIds.includes(themeId)) &&
    questions.every(({ number }, index) => number === index + 1) &&
    (value.version === 2 || coreQuestionCount > 0);
}

function isScore(
  value: unknown,
  expectedMax: 40 | 30 | 15
): value is LearningQuestionScore {
  return isRecord(value) && Number.isInteger(value.score) &&
    Number(value.score) >= 0 && Number(value.score) <= expectedMax &&
    value.max === expectedMax && isString(value.reason);
}

function isResult(value: unknown): value is LearningQuestionResult {
  if (!isRecord(value) || !isRecord(value.scores) || !isString(value.id) ||
    !isString(value.feedback) || !isString(value.improvement) ||
    !isString(value.revisedAnswer)) return false;
  const scores = value.scores;
  if (!isScore(scores.focus, 40) || !isScore(scores.correctness, 30) ||
    !isScore(scores.ownWords, 15) || !isScore(scores.exampleOrExtension, 15)) {
    return false;
  }
  const total = scores.focus.score + scores.correctness.score +
    scores.ownWords.score + scores.exampleOrExtension.score;
  return Number.isInteger(value.total) && value.total === total;
}

function isGrade(value: unknown, quiz: LearningQuestionQuiz): value is LearningQuestionGrade {
  if (!isRecord(value) || value.version !== quiz.version || value.kind !== "grade" ||
    value.quizId !== quiz.quizId || !Array.isArray(value.results) ||
    value.results.length !== quiz.questions.length ||
    !value.results.every(isResult) || !isRecord(value.summary)) return false;
  const results = value.results as LearningQuestionResult[];
  const resultIds = results.map(({ id }) => id);
  const average = Math.round(results.reduce((sum, result) => sum + result.total, 0) /
    results.length);
  return (quiz.version === 1 || results.every(r => ["independent", "needs-guidance", "unverified"].includes(r.assessment ?? ""))) && unique(resultIds) &&
    quiz.questions.every(({ id }) => resultIds.includes(id)) &&
    value.summary.average === average &&
    Array.isArray(value.summary.strengths) && value.summary.strengths.every(isString) &&
    Array.isArray(value.summary.nextSteps) && value.summary.nextSteps.every(isString) &&
    isString(value.summary.encouragement);
}

function fencedJson(text: string, language: string): unknown[] {
  const blocks: unknown[] = [];
  const expression = new RegExp(
    `\\\`\\\`\\\`${language}\\s*\\n([\\s\\S]*?)\\n\\\`\\\`\\\``,
    "g"
  );
  for (const match of text.matchAll(expression)) {
    try {
      blocks.push(JSON.parse(match[1]));
    } catch {
      // Incomplete streaming artifacts remain ordinary text until valid.
    }
  }
  return blocks;
}

export function learningQuestionArtifacts(messages: ArtifactMessage[]): {
  quiz?: LearningQuestionQuiz;
  grade?: LearningQuestionGrade;
} {
  let quiz: LearningQuestionQuiz | undefined;
  let grade: LearningQuestionGrade | undefined;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const candidate of fencedJson(message.text, "learning-question-quiz")) {
      if (isQuiz(candidate)) {
        quiz = candidate;
        grade = undefined;
      }
    }
    for (const candidate of fencedJson(message.text, "learning-question-grade")) {
      if (quiz && isGrade(candidate, quiz)) grade = candidate;
    }
  }
  return { quiz, grade };
}

export function stripLearningQuestionArtifacts(text: string): string {
  return text.replace(
    /```learning-question-(?:quiz|grade)\s*\n[\s\S]*?\n```/g,
    ""
  ).trim();
}

export function formatLearningQuestionSubmission(
  quiz: LearningQuestionQuiz,
  answers: LearningQuestionAnswers,
  hinted: string[] = []
): string {
  return [
    "$submit-learning-question-quiz",
    `Quiz ID: ${quiz.quizId}`,
    ...(quiz.version === 2 ? [`有提示的題目: ${hinted.join(", ") || "無按鈕提示紀錄；仍須檢查對話中的提示或答案曝光"}`] : []),
    "",
    ...quiz.questions.flatMap((question) => [
      `${question.id} (Question ${question.number}):`,
      answers[question.id]?.trim() ?? "",
      ""
    ])
  ].join("\n").trimEnd();
}

export function learningQuestionSubmissionAnswers(
  messages: ArtifactMessage[],
  quiz: LearningQuestionQuiz
): LearningQuestionAnswers {
  const marker = "$submit-learning-question-quiz";
  const quizLine = `Quiz ID: ${quiz.quizId}`;
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    if (message.role !== "user" || !message.text.startsWith(marker) ||
      !message.text.includes(quizLine)) continue;
    const answers: LearningQuestionAnswers = {};
    for (let index = 0; index < quiz.questions.length; index += 1) {
      const question = quiz.questions[index];
      const header = `${question.id} (Question ${question.number}):\n`;
      const start = message.text.indexOf(header);
      if (start < 0) continue;
      const answerStart = start + header.length;
      const next = quiz.questions[index + 1];
      const nextHeader = next ? `\n\n${next.id} (Question ${next.number}):\n` : undefined;
      const end = nextHeader ? message.text.indexOf(nextHeader, answerStart) : message.text.length;
      const answer = message.text.slice(answerStart, end < 0 ? message.text.length : end).trim();
      if (answer) answers[question.id] = answer;
    }
    return answers;
  }
  return {};
}
