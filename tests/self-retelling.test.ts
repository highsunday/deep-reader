import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import {
  composeCodexInput,
  composeCodexTurnInput,
  readerDeveloperInstructions
} from "../src/main/chat-controller";
import { SpawnedCodexAppServerClient } from "../src/main/codex-app-server-client";
import {
  formatSelfRetellingSubmission,
  selfRetellingAnswers,
  selfRetellingArtifacts,
  stripSelfRetellingArtifacts
} from "../src/renderer/self-retelling-artifact";
import { createFakeCodexAppServer } from "./fake-codex-app-server";

const task = {
  version: 1 as const,
  kind: "task" as const,
  practiceId: "retell-one",
  title: "用自己的話說出重點",
  instruction: "先不要看提示，說出你認為最重要的內容與關係。"
};

const firstGrade = {
  version: 1 as const,
  kind: "grade" as const,
  practiceId: "retell-one",
  attempt: 1 as const,
  feedback: {
    strengths: ["掌握核心主張"],
    corrections: [],
    omissions: ["漏掉形成原因"],
    expression: ["把因果關係說得更直接"]
  },
  revisedRetelling: "這段先提出核心主張，再說明它形成的原因。",
  scores: {
    accuracy: { score: 5, reason: "沒有錯誤理解" },
    completeness: { score: 3, reason: "遺漏一個重要原因" },
    ownWords: { score: 4, reason: "大多能自行組織" },
    total: 12
  }
};

const secondGrade = {
  ...firstGrade,
  attempt: 2 as const,
  feedback: { ...firstGrade.feedback, omissions: [] },
  scores: {
    accuracy: { score: 5, reason: "沒有錯誤理解" },
    completeness: { score: 5, reason: "重要重點完整" },
    ownWords: { score: 5, reason: "組織清楚自然" },
    total: 15
  },
  comparison: {
    summary: "第二次補上原因，內容更完整。",
    accuracyDelta: 0,
    completenessDelta: 2,
    ownWordsDelta: 1,
    totalDelta: 3
  }
};

function artifact(language: string, value: unknown) {
  return `\`\`\`${language}\n${JSON.stringify(value)}\n\`\`\``;
}

test("the bounded app-provided skill creates an unprompted two-attempt self-retelling", () => {
  const skill = readFileSync(".agents/skills/practice-self-retelling/SKILL.md", "utf8");
  const instructions = readerDeveloperInstructions();
  const input = composeCodexInput({
    text: "請讓我自我復述這段內容",
    intent: "selfRetelling",
    context: { readingSegment: "作者先提出主張，再說明原因。" }
  });

  assert.match(skill, /最多兩次|at most two/i);
  assert.match(skill, /不得提供.*(?:摘要|重點提示|提綱|標準答案)/);
  assert.match(skill, /內容正確度/);
  assert.match(skill, /重點完整度/);
  assert.match(skill, /自我表達/);
  assert.match(instructions, /practice-self-retelling/);
  assert.match(input, /\$practice-self-retelling/);
  assert.match(input, /do not provide a summary, main-point hint, outline.*model answer/i);
  assert.match(input, /作者先提出主張/);
});

test("every self-retelling creation and submission turn explicitly loads the bundled skill", () => {
  const selfRetellingSkillPath = "/runtime/.agents/skills/practice-self-retelling/SKILL.md";
  const creation = composeCodexTurnInput({
    text: "請讓我用自己的話復述這段內容",
    intent: "selfRetelling",
    context: { readingSegment: "Only this segment." }
  }, { selfRetellingSkillPath });
  const submission = composeCodexTurnInput({
    text: formatSelfRetellingSubmission(task, 1, "我的第一次復述。")
  }, { selfRetellingSkillPath });
  const secondSubmission = composeCodexTurnInput({
    text: formatSelfRetellingSubmission(task, 2, "我的第二次復述。")
  }, { selfRetellingSkillPath });
  const ordinary = composeCodexTurnInput({ text: "這段的主張是什麼？" }, {
    selfRetellingSkillPath
  });

  const expectedSkill = {
    type: "skill",
    name: "practice-self-retelling",
    path: selfRetellingSkillPath
  };
  assert.deepEqual(creation[1], expectedSkill);
  assert.deepEqual(submission[1], expectedSkill);
  assert.deepEqual(secondSubmission[1], expectedSkill);
  assert.equal(ordinary.length, 1);
});

test("a resumed legacy reading conversation loads the self-retelling skill on every practice turn", async () => {
  const fake = createFakeCodexAppServer();
  const selfRetellingSkillPath = "/runtime/.agents/skills/practice-self-retelling/SKILL.md";
  const controller = new (await import("../src/main/chat-controller")).ChatController({
    createClient: () => new SpawnedCodexAppServerClient({
      spawnProcess: () => fake.child
    }),
    workingDirectory: "/tmp/deep-reading-legacy-retelling",
    selfRetellingSkillPath,
    conversationStore: {
      load: () => ({
        version: 1 as const,
        selectedConversationId: "legacy-conversation",
        conversations: [{
          id: "legacy-conversation",
          threadId: "legacy-thread",
          title: "Existing reading conversation",
          createdAt: 1,
          updatedAt: 1,
          source: null,
          messages: []
        }]
      }),
      save: () => undefined
    }
  });
  try {
    await controller.connect();
    await controller.sendMessage({
      text: "請讓我用自己的話復述這段內容",
      intent: "selfRetelling",
      context: { readingSegment: "Only this bounded segment." }
    });
    while (controller.getSnapshot().activeTurnId) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await controller.sendMessage({
      text: formatSelfRetellingSubmission(task, 1, "我的第一次復述。")
    });
    while (controller.getSnapshot().activeTurnId) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    assert.equal(
      fake.requests.find(({ method }) => method === "thread/resume")?.params?.threadId,
      "legacy-thread"
    );
    const turns = fake.requests.filter(({ method }) => method === "turn/start");
    assert.equal(turns.length, 2);
    for (const turn of turns) {
      assert.deepEqual((turn.params?.input as Array<unknown>)[1], {
        type: "skill",
        name: "practice-self-retelling",
        path: selfRetellingSkillPath
      });
    }
  } finally {
    controller.close();
  }
});

test("self-retelling artifacts accept two valid attempts and reject invalid arithmetic", () => {
  const messages = [
    { role: "assistant" as const, text: artifact("self-retelling-task", task) },
    { role: "assistant" as const, text: artifact("self-retelling-grade", firstGrade) },
    { role: "assistant" as const, text: artifact("self-retelling-grade", secondGrade) }
  ];
  assert.deepEqual(selfRetellingArtifacts(messages), {
    task,
    grades: [firstGrade, secondGrade]
  });

  const badTotal = {
    ...firstGrade,
    scores: { ...firstGrade.scores, total: 15 }
  };
  const badDelta = {
    ...secondGrade,
    comparison: { ...secondGrade.comparison, totalDelta: 2 }
  };
  assert.deepEqual(selfRetellingArtifacts([
    messages[0],
    { role: "assistant", text: artifact("self-retelling-grade", badTotal) },
    { role: "assistant", text: artifact("self-retelling-grade", secondGrade) }
  ]), { task, grades: [] });
  assert.deepEqual(selfRetellingArtifacts([
    messages[0], messages[1],
    { role: "assistant", text: artifact("self-retelling-grade", badDelta) }
  ]), { task, grades: [firstGrade] });
});

test("self-retelling submissions preserve practice identity, attempt, and original writing", () => {
  const first = formatSelfRetellingSubmission(task, 1, "  我認為核心是因果關係。  ");
  const second = formatSelfRetellingSubmission(task, 2, "第二次說得更完整。 ");
  assert.equal(first, [
    "$submit-self-retelling",
    "Practice ID: retell-one",
    "Attempt: 1",
    "",
    "Learner retelling:",
    "我認為核心是因果關係。"
  ].join("\n"));
  assert.deepEqual(selfRetellingAnswers([
    { role: "user", text: first },
    { role: "user", text: second }
  ], task.practiceId), ["我認為核心是因果關係。", "第二次說得更完整。"]);
  assert.equal(stripSelfRetellingArtifacts(
    `準備好了。\n${artifact("self-retelling-task", task)}`
  ), "準備好了。");
});
