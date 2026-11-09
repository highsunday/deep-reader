import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { ChatMessageList } from "../src/renderer/App";
import { SelfRetellingCard } from "../src/renderer/SelfRetellingCard";

const rendererStyles = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");

const task = {
  version: 1 as const,
  kind: "task" as const,
  practiceId: "retell-one",
  title: "用自己的話說出重點",
  instruction: "回想這段最重要的內容與關係。"
};

const firstGrade = {
  version: 1 as const,
  kind: "grade" as const,
  practiceId: "retell-one",
  attempt: 1 as const,
  feedback: {
    strengths: ["核心主張正確"],
    corrections: ["不要把結果誤認為原因"],
    omissions: ["補上兩者的關係"],
    expression: ["先講主張，再講原因"]
  },
  revisedRetelling: "作者先提出主張，接著說明形成原因。",
  scores: {
    accuracy: { score: 4, reason: "大致正確" },
    completeness: { score: 3, reason: "仍有遺漏" },
    ownWords: { score: 4, reason: "能自行組織" },
    total: 11
  }
};

const secondGrade = {
  ...firstGrade,
  attempt: 2 as const,
  scores: {
    accuracy: { score: 5, reason: "正確" },
    completeness: { score: 5, reason: "完整" },
    ownWords: { score: 5, reason: "清楚" },
    total: 15
  },
  comparison: {
    summary: "第二次更完整，也清楚說出因果關係。",
    accuracyDelta: 1,
    completenessDelta: 2,
    ownWordsDelta: 1,
    totalDelta: 4
  }
};

test("the self-retelling task renders as a collapsible original-app-style action", () => {
  const markup = renderToStaticMarkup(
    <SelfRetellingCard open={false} task={task} grades={[]} onOpen={() => undefined}
      onClose={() => undefined} onSubmit={() => true} />
  );
  assert.match(markup, /自我復述 · 可作答/);
  assert.match(markup, /用自己的話說出重點/);
  assert.match(markup, /開始復述/);
});

test("an expanded task has one freeform field and blocks an empty submission", () => {
  const markup = renderToStaticMarkup(
    <SelfRetellingCard open task={task} grades={[]} onOpen={() => undefined}
      onClose={() => undefined} onSubmit={() => true} />
  );
  assert.equal((markup.match(/<textarea/g) ?? []).length, 1);
  assert.match(markup, /aria-label="第 1 次自我復述"/);
  assert.match(markup, /請用自己的話說出這段的重點/);
  assert.match(markup, /送出並請 AI 回饋/);
  assert.match(markup, /disabled=""/);
  assert.doesNotMatch(markup, /標準答案|重點提示/);
});

test("first feedback leads to one retry while the second shows comparison and stops", () => {
  const firstMarkup = renderToStaticMarkup(
    <SelfRetellingCard open task={task} grades={[firstGrade]}
      initialAnswers={["第一次復述", ""]} onOpen={() => undefined}
      onClose={() => undefined} onSubmit={() => true} />
  );
  assert.match(firstMarkup, /掌握正確/);
  assert.match(firstMarkup, /需要修正/);
  assert.match(firstMarkup, /重要遺漏/);
  assert.match(firstMarkup, /表達改善/);
  assert.match(firstMarkup, /11 \/ 15/);
  assert.match(firstMarkup, /AI 修改示範/);
  assert.match(firstMarkup, /再復述一次/);

  const secondMarkup = renderToStaticMarkup(
    <SelfRetellingCard open task={task} grades={[firstGrade, secondGrade]}
      initialAnswers={["第一次復述", "第二次復述"]} onOpen={() => undefined}
      onClose={() => undefined} onSubmit={() => true} />
  );
  assert.match(secondMarkup, /兩次比較/);
  assert.match(secondMarkup, /第二次更完整/);
  assert.match(secondMarkup, /\+4/);
  assert.doesNotMatch(secondMarkup, />再復述一次</);
  assert.equal((secondMarkup.match(/<textarea/g) ?? []).length, 0);
});

test("the reading conversation hides artifacts and makes only the latest retelling interactive", () => {
  const newerTask = { ...task, practiceId: "retell-two", title: "第二份自我復述" };
  const message = (id: string, value: typeof task) => ({
    id,
    turnId: id,
    role: "assistant" as const,
    text: `準備好了。\n\`\`\`self-retelling-task\n${JSON.stringify(value)}\n\`\`\``,
    status: "completed" as const
  });
  const markup = renderToStaticMarkup(
    <ChatMessageList
      activeTurnId={null}
      messages={[message("a1", task), message("a2", newerTask)]}
      onSubmitSelfRetelling={() => true}
    />
  );
  assert.equal((markup.match(/自我復述 · 可作答/g) ?? []).length, 1);
  assert.match(markup, /第二份自我復述/);
  assert.doesNotMatch(markup, /self-retelling-task/);
  assert.doesNotMatch(markup, /retell-one/);
});

test("self-retelling feedback uses readable type, spacing, and a narrow-panel layout", () => {
  assert.match(rendererStyles, /\.self-retelling-grade \{[^}]*padding: 18px;[^}]*gap: 16px;/s);
  assert.match(rendererStyles, /\.self-retelling-grade > header strong \{[^}]*26px\/1/s);
  assert.match(rendererStyles, /\.self-retelling-feedback-group h4 \{[^}]*font-size: 11px;/s);
  assert.match(rendererStyles, /\.self-retelling-feedback-group ul \{[^}]*font-size: 13px;[^}]*line-height: 1\.65;/s);
  assert.match(rendererStyles, /\.self-retelling-scores p \{[^}]*font-size: 12px;[^}]*line-height: 1\.55;/s);
  assert.match(rendererStyles, /\.self-retelling-revision p \{[^}]*font-size: 13px;[^}]*line-height: 1\.65;/s);
  assert.match(rendererStyles, /@container chat-panel \(max-width: 560px\)[\s\S]*?\.self-retelling-feedback-grid,[\s\S]*?\.self-retelling-scores \{\s*grid-template-columns: minmax\(0, 1fr\);/s);
});
