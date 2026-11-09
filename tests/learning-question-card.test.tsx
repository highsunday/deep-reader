import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { LearningQuestionCard } from "../src/renderer/LearningQuestionCard";

const rendererStyles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

const quiz = {
  version: 1 as const,
  kind: "quiz" as const,
  quizId: "quiz-one",
  title: "系統思考理解測驗",
  themes: [{ id: "theme-1", title: "回饋迴路", summary: "概念與因果" }],
  questions: [
    { id: "q-1", number: 1, themeId: "theme-1", level: "basic" as const, prompt: "這是什麼？" },
    { id: "q-2", number: 2, themeId: "theme-1", level: "relationship" as const, prompt: "為什麼會這樣？" },
    { id: "q-3", number: 3, themeId: "core", level: "core" as const, prompt: "最重要的影響是什麼？" }
  ]
};

const score = (value: number, max: 40 | 30 | 15, reason: string) => ({
  score: value, max, reason
});
const grade = {
  version: 1 as const,
  kind: "grade" as const,
  quizId: "quiz-one",
  results: quiz.questions.map(({ id }) => ({
    id,
    scores: {
      focus: score(38, 40, "切中問題核心"),
      correctness: score(28, 30, "概念正確"),
      ownWords: score(14, 15, "使用自己的話"),
      exampleOrExtension: score(12, 15, "有延伸思考")
    },
    total: 92,
    feedback: "關係說明清楚。",
    improvement: "再補一個具體例子。",
    revisedAnswer: "回饋迴路會讓結果成為下一輪輸入，持續改變系統行為。"
  })),
  summary: {
    average: 92,
    strengths: ["核心概念清楚"],
    nextSteps: ["增加具體應用"],
    encouragement: "你已建立穩固理解。"
  }
};

test("the collapsed quiz artifact renders as a paper card action", () => {
  const markup = renderToStaticMarkup(
    <LearningQuestionCard
      open={false}
      quiz={quiz}
      onOpen={() => undefined}
      onClose={() => undefined}
      onSubmit={() => true}
    />
  );
  assert.match(markup, /理解測驗 · 可作答/);
  assert.match(markup, /系統思考理解測驗/);
  assert.match(markup, /3 題/);
  assert.match(markup, /開始作答/);
});

test("an incomplete expanded paper reports unanswered questions and blocks submission", () => {
  const markup = renderToStaticMarkup(
    <LearningQuestionCard
      open
      quiz={quiz}
      onOpen={() => undefined}
      onClose={() => undefined}
      onSubmit={() => true}
    />
  );
  assert.match(markup, /還有 3 題未回答/);
  assert.match(markup, /已回答 0 \/ 3/);
  assert.match(markup, /<progress[^>]*max="3"[^>]*value="0"/);
  assert.match(markup, /送出並請 AI 批改/);
  assert.match(markup, /disabled=""/);
  assert.equal((markup.match(/<textarea/g) ?? []).length, 3);
});

test("each answer field has a polished visible label and keeps its accessible name", () => {
  const markup = renderToStaticMarkup(
    <LearningQuestionCard
      open
      quiz={quiz}
      onOpen={() => undefined}
      onClose={() => undefined}
      onSubmit={() => true}
    />
  );
  const styles = readFileSync("src/renderer/styles.css", "utf8");

  assert.match(markup, /class="learning-question-answer-label"/);
  assert.match(markup, />你的回答</);
  assert.match(markup, /<small>第 1 題<\/small>/);
  assert.match(markup, /aria-label="第 1 題答案"/);
  assert.doesNotMatch(markup, /visually-hidden/);
  assert.match(styles, /\.learning-question-answer-label\s*\{/);
  assert.match(styles, /\.learning-question-answer-label small\s*\{/);
});

test("the expanded graded card shows themes, core questions, and every rubric score", () => {
  const markup = renderToStaticMarkup(
    <LearningQuestionCard
      open
      quiz={quiz}
      grade={grade}
      initialAnswers={{
        "q-1": "我的第一題答案",
        "q-2": "我的第二題答案",
        "q-3": "我的第三題答案"
      }}
      onOpen={() => undefined}
      onClose={() => undefined}
      onSubmit={() => true}
    />
  );
  assert.match(markup, /回饋迴路/);
  assert.match(markup, /核心問題/);
  assert.match(markup, /重點掌握/);
  assert.match(markup, /38 \/ 40/);
  assert.match(markup, /概念正確/);
  assert.match(markup, /28 \/ 30/);
  assert.match(markup, /自己的話/);
  assert.match(markup, /14 \/ 15/);
  assert.match(markup, /舉例或延伸/);
  assert.match(markup, /12 \/ 15/);
  assert.match(markup, /92 \/ 100/);
  assert.match(markup, /具體改善/);
  assert.match(markup, /AI 修改示範/);
  assert.match(markup, /結果成為下一輪輸入/);
  assert.match(markup, /我的第一題答案/);
});

test("quiz grading feedback uses readable type and spacing", () => {
  assert.match(rendererStyles, /\.learning-question-feedback \{[^}]*padding: 16px;/s);
  assert.match(rendererStyles, /\.learning-question-score strong \{[^}]*26px\/1/s);
  assert.match(rendererStyles, /\.learning-question-rubric span \{[^}]*font-size: 11px;/s);
  assert.match(rendererStyles, /\.learning-question-rubric p \{[^}]*font-size: 12px;[^}]*line-height: 1\.6;/s);
  assert.match(rendererStyles, /\.learning-question-feedback > p \{[^}]*font-size: 13px;[^}]*line-height: 1\.6;/s);
  assert.match(rendererStyles, /\.learning-question-revision p \{[^}]*font-size: 13px;[^}]*line-height: 1\.65;/s);
});
