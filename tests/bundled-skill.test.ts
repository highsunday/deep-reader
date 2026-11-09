import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "vitest";
import {
  installBundledCompleteReadingNoteSkill,
  installBundledEditReadingNoteSkill,
  installBundledReadingNoteSkill,
  installBundledSelfRetellingSkill
} from "../src/main/bundled-skill";

test("the bundled self-retelling skill is atomically installed, preserved, and updated", async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), "deep-reading-skill-runtime-"));
  try {
    const installed = installBundledSelfRetellingSkill(runtimePath, "bundled-v1");
    assert.equal(installed.status, "installed");
    assert.equal(installed.path, join(
      runtimePath,
      ".agents/skills/practice-self-retelling/SKILL.md"
    ));
    assert.equal(await readFile(installed.path, "utf8"), "bundled-v1");

    assert.deepEqual(
      installBundledSelfRetellingSkill(runtimePath, "bundled-v1"),
      { path: installed.path, status: "unchanged" }
    );
    assert.deepEqual(
      installBundledSelfRetellingSkill(runtimePath, "bundled-v2"),
      { path: installed.path, status: "updated" }
    );
    assert.equal(await readFile(installed.path, "utf8"), "bundled-v2");
    await assert.rejects(readFile(`${installed.path}.next`, "utf8"));
    assert.equal(dirname(installed.path), join(
      runtimePath,
      ".agents/skills/practice-self-retelling"
    ));
  } finally {
    await rm(runtimePath, { recursive: true, force: true });
  }
});

test("the bundled reader-led note skills install into separate runtime boundaries", async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), "deep-reading-note-ai-skills-"));
  try {
    const complete = installBundledCompleteReadingNoteSkill(runtimePath, "complete-v1");
    const edit = installBundledEditReadingNoteSkill(runtimePath, "edit-v1");
    assert.equal(complete.path, join(
      runtimePath,
      ".agents/skills/complete-reading-note/SKILL.md"
    ));
    assert.equal(edit.path, join(
      runtimePath,
      ".agents/skills/edit-reading-note/SKILL.md"
    ));
    assert.equal(await readFile(complete.path, "utf8"), "complete-v1");
    assert.equal(await readFile(edit.path, "utf8"), "edit-v1");
  } finally {
    await rm(runtimePath, { recursive: true, force: true });
  }
});

test("the bundled reading-note skill is atomically installed", async () => {
  const runtimePath = await mkdtemp(join(tmpdir(), "deep-reading-note-skill-runtime-"));
  try {
    const installed = installBundledReadingNoteSkill(runtimePath, "reading-note-v1");
    assert.equal(installed.path, join(
      runtimePath,
      ".agents/skills/create-reading-note/SKILL.md"
    ));
    assert.equal(await readFile(installed.path, "utf8"), "reading-note-v1");
    assert.equal(
      installBundledReadingNoteSkill(runtimePath, "reading-note-v1").status,
      "unchanged"
    );
  } finally {
    await rm(runtimePath, { recursive: true, force: true });
  }
});

test("desktop startup installs the bundled skill and passes its path to the chat controller", () => {
  const source = readFileSync(new URL("../src/main/main.ts", import.meta.url), "utf8");
  assert.match(source, /installBundledSelfRetellingSkill\(/);
  assert.match(source, /selfRetellingSkillPath:\s*selfRetellingSkill\.path/);
  assert.match(source, /installBundledReadingNoteSkill\(/);
  assert.match(source, /readingNoteSkillPath:\s*readingNoteSkill\.path/);
  assert.match(source, /installBundledCompleteReadingNoteSkill\(/);
  assert.match(source, /installBundledEditReadingNoteSkill\(/);
  assert.match(source, /new ReadingNoteAiController\(/);
  assert.match(source, /getConversationContext:\s*\(\) => chat\?\.getReadingNoteConversationContext\(\)/);
});
