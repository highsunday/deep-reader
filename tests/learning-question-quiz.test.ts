import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  composeCodexInput,
  readerDeveloperInstructions
} from "../src/main/chat-controller";
import {
  formatLearningQuestionSubmission,
  learningQuestionArtifacts,
  learningQuestionSubmissionAnswers,
  stripLearningQuestionArtifacts
} from "../src/renderer/learning-question-artifact";

const quiz = {
  version: 1 as const,
  kind: "quiz" as const,
  quizId: "quiz-one",
  title: "系統思考理解測驗",
  themes: [{ id: "theme-1", title: "回饋迴路", summary: "概念與因果" }],
  questions: [
    { id: "q-1", number: 1, themeId: "theme-1", level: "basic" as const, prompt: "回饋迴路是什麼？" },
    { id: "q-2", number: 2, themeId: "theme-1", level: "relationship" as const, prompt: "結果為什麼會改變下一次輸入？" },
    { id: "q-3", number: 3, themeId: "core", level: "core" as const, prompt: "這個機制最重要的影響是什麼？" }
  ]
};

const grade = {
  version: 1 as const,
  kind: "grade" as const,
  quizId: "quiz-one",
  results: quiz.questions.map(({ id }) => ({
    id,
    scores: {
      focus: { score: 36, max: 40 as const, reason: "切中核心" },
      correctness: { score: 27, max: 30 as const, reason: "概念正確" },
      ownWords: { score: 13, max: 15 as const, reason: "有重新表達" },
      exampleOrExtension: { score: 12, max: 15 as const, reason: "有合理延伸" }
    },
    total: 88,
    feedback: "已掌握主要關係。",
    improvement: "補上關係成立的條件。",
    revisedAnswer: "結果會回到系統，改變下一次輸入，因此形成回饋迴路。"
  })),
  summary: {
    average: 88,
    strengths: ["能辨認核心概念"],
    nextSteps: ["說明因果條件"],
    encouragement: "方向正確，繼續把關係說完整。"
  }
};

function artifact(language: string, value: unknown) {
  return `\`\`\`${language}\n${JSON.stringify(value)}\n\`\`\``;
}

test("the learning-question intent invokes the bounded app-provided skill", () => {
  const input = composeCodexInput({
    text: "請根據這段內容產生理解測驗",
    intent: "learningQuestionQuiz",
    context: { readingSegment: "Only this bounded reading segment." }
  });
  assert.match(input, /\$design-learning-questions/);
  assert.match(input, /Only this bounded reading segment/);
  assert.match(input, /layered open-ended questions/i);
  assert.match(input, /version 2 independent quiz with 1–3 questions/i);
  assert.match(input, /App-provided design-learning-questions skill/i);
  assert.match(input, /Do not use or infer content outside/i);
});

test("the bundled skill defines layered questions and the exact 100-point rubric", () => {
  const skill = readFileSync(new URL(
    "../.agents/skills/design-learning-questions/SKILL.md",
    import.meta.url
  ), "utf8");
  assert.match(skill, /basic/);
  assert.match(skill, /relationship/);
  assert.match(skill, /application/);
  assert.match(skill, /synthesis/);
  assert.match(skill, /first principles/);
  assert.match(skill, /3–5 questions total/);
  assert.match(skill, /at most three indispensable concepts/i);
  assert.match(skill, /Ask one thing per question/i);
  assert.match(skill, /Do not repeat the same concept at different levels/i);
  assert.match(skill, /If removing a question would not weaken/i);
  assert.match(skill, /0–40/);
  assert.match(skill, /0–30/);
  assert.equal((skill.match(/0–15/g) ?? []).length, 2);
  assert.match(skill, /```learning-question-quiz/);
  assert.match(skill, /```learning-question-grade/);
});

test("new reading conversations embed and narrowly route the complete app-provided skill", () => {
  const instructions = readerDeveloperInstructions();
  assert.match(instructions, /<app-provided-skill name="design-learning-questions">/);
  assert.match(instructions, /Create and grade a layered learning quiz/);
  assert.match(instructions, /\$submit-learning-question-quiz/);
  assert.match(instructions, /Do not apply it to unrelated turns/);
});

test("quiz and grade artifacts are accepted only when their structure and arithmetic match", () => {
  const valid = learningQuestionArtifacts([
    { role: "assistant", text: artifact("learning-question-quiz", quiz) },
    { role: "assistant", text: artifact("learning-question-grade", grade) }
  ]);
  assert.deepEqual(valid, { quiz, grade });

  const wrongTotal = structuredClone(grade);
  wrongTotal.results[0].total = 99;
  assert.deepEqual(learningQuestionArtifacts([
    { role: "assistant", text: artifact("learning-question-quiz", quiz) },
    { role: "assistant", text: artifact("learning-question-grade", wrongTotal) }
  ]), { quiz, grade: undefined });

  const missingRevision = structuredClone(grade) as unknown as {
    results: Array<Record<string, unknown>>;
  };
  delete missingRevision.results[0].revisedAnswer;
  assert.deepEqual(learningQuestionArtifacts([
    { role: "assistant", text: artifact("learning-question-quiz", quiz) },
    { role: "assistant", text: artifact("learning-question-grade", missingRevision) }
  ]), { quiz, grade: undefined });

  const unknownTheme = structuredClone(quiz);
  unknownTheme.questions[0].themeId = "missing";
  assert.deepEqual(learningQuestionArtifacts([
    { role: "assistant", text: artifact("learning-question-quiz", unknownTheme) }
  ]), { quiz: undefined, grade: undefined });

  const tooManyQuestions = structuredClone(quiz);
  tooManyQuestions.questions = Array.from({ length: 6 }, (_, index) => ({
    id: `long-${index + 1}`,
    number: index + 1,
    themeId: index === 5 ? "core" : "theme-1",
    level: index === 5 ? "core" as const : "basic" as const,
    prompt: `問題 ${index + 1}`
  }));
  assert.deepEqual(learningQuestionArtifacts([
    { role: "assistant", text: artifact("learning-question-quiz", tooManyQuestions) }
  ]), { quiz: undefined, grade: undefined });

  const tooManyThemes = structuredClone(quiz);
  tooManyThemes.themes = Array.from({ length: 4 }, (_, index) => ({
    id: `theme-${index + 1}`,
    title: `主題 ${index + 1}`,
    summary: `摘要 ${index + 1}`
  }));
  tooManyThemes.questions = [
    ...tooManyThemes.themes.map((theme, index) => ({
      id: `theme-question-${index + 1}`,
      number: index + 1,
      themeId: theme.id,
      level: "basic" as const,
      prompt: `問題 ${index + 1}`
    })),
    { id: "core-question", number: 5, themeId: "core", level: "core" as const, prompt: "核心問題" }
  ];
  assert.deepEqual(learningQuestionArtifacts([
    { role: "assistant", text: artifact("learning-question-quiz", tooManyThemes) }
  ]), { quiz: undefined, grade: undefined });
});

test("submission preserves quiz and question identities while artifacts remain hidden from chat", () => {
  const submission = formatLearningQuestionSubmission(quiz, {
    "q-1": "它會把結果再送回系統。",
    "q-2": "因為結果會改變下一次輸入。",
    "q-3": "它使系統行為持續調整。"
  });
  assert.match(submission, /^\$submit-learning-question-quiz/);
  assert.match(submission, /Quiz ID: quiz-one/);
  assert.match(submission, /q-1 \(Question 1\):/);
  assert.match(submission, /因為結果會改變下一次輸入/);
  assert.equal(stripLearningQuestionArtifacts(
    `測驗已準備好。\n${artifact("learning-question-quiz", quiz)}`
  ), "測驗已準備好。");
  assert.deepEqual(learningQuestionSubmissionAnswers([
    { role: "assistant", text: artifact("learning-question-quiz", quiz) },
    { role: "user", text: submission }
  ], quiz), {
    "q-1": "它會把結果再送回系統。",
    "q-2": "因為結果會改變下一次輸入。",
    "q-3": "它使系統行為持續調整。"
  });
});
