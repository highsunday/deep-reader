import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import {
  BUILT_IN_MEMORY_IMAGE_PURPOSES,
  BUILT_IN_MEMORY_IMAGE_STYLES,
  LocalMemoryImageTemplateStore
} from "../src/main/memory-image-template-store";

test("F30 new settings offer six learning purposes, five primary styles and compatible legacy choices", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-memory-template-"));
  try {
    const store = new LocalMemoryImageTemplateStore(directory);
    const settings = store.get();

    assert.deepEqual(settings.purposes, BUILT_IN_MEMORY_IMAGE_PURPOSES);
    assert.deepEqual(settings.styles, BUILT_IN_MEMORY_IMAGE_STYLES);
    assert.deepEqual(settings.purposes.slice(0, 6).map(({ name }) => name),
      ["概念結構", "概念對照", "因果拆解", "流程分鏡", "視覺聯想", "空間記憶"]);
    assert.deepEqual(settings.styles.slice(0, 5).map(({ name }) => name),
      ["極簡向量", "清爽手繪", "溫暖插畫", "柔和立體", "淡彩水彩"]);
    assert.ok(settings.purposes.some(({ id }) => id === "purpose-process-contrast"));
    assert.ok(settings.styles.some(({ id }) => id === "style-vintage-encyclopedia"));
    assert.equal(settings.defaultPurposeId, "purpose-concept-structure");
    assert.equal(settings.defaultStyleId, "style-minimal-vector");
    assert.ok(settings.purposes.every(({ builtIn, kind }) => builtIn && kind === "purpose"));
    assert.ok(settings.styles.every(({ builtIn, kind }) => builtIn && kind === "style"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("custom purpose and style CRUD persists while built-ins stay immutable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-memory-template-"));
  try {
    let nextId = 0;
    const store = new LocalMemoryImageTemplateStore(directory, {
      createId: () => `custom-${++nextId}`
    });
    const created = store.create({
      kind: "purpose",
      name: "  Visual ladder  ",
      prompt: "  Arrange the ideas as ascending steps.  "
    });
    assert.equal(created.id, "custom-1");
    assert.equal(created.name, "Visual ladder");
    assert.equal(created.prompt, "Arrange the ideas as ascending steps.");
    assert.equal(created.builtIn, false);

    const changed = store.update({
      kind: "purpose",
      id: created.id,
      name: "Concept ladder",
      prompt: "Show prerequisites as lower steps and consequences above."
    });
    assert.equal(changed.name, "Concept ladder");
    store.setDefault({ kind: "purpose", id: created.id });

    const reloaded = new LocalMemoryImageTemplateStore(directory);
    assert.equal(reloaded.get().defaultPurposeId, created.id);
    assert.equal(reloaded.get().purposes.find(({ id }) => id === created.id)?.prompt,
      "Show prerequisites as lower steps and consequences above.");

    assert.throws(() => reloaded.update({
      kind: "purpose",
      id: "purpose-surreal-association",
      name: "Changed",
      prompt: "Changed"
    }), /built-in/i);
    assert.throws(() => reloaded.remove({ kind: "style", id: "style-minimal-vector" }), /built-in/i);
    assert.throws(() => reloaded.remove({ kind: "style", id: created.id }), /not found/i);

    reloaded.remove({ kind: "purpose", id: created.id });
    assert.equal(reloaded.get().defaultPurposeId, "purpose-concept-structure");
    assert.equal(reloaded.get().purposes.some(({ id }) => id === created.id), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("F30 upgrades keep previously saved default IDs and custom prompt text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-memory-template-"));
  try {
    await writeFile(join(directory, "memory-image-templates.json"), JSON.stringify({
      version: 1, defaultPurposeId: "purpose-process-contrast", defaultStyleId: "style-vintage-encyclopedia",
      customPurposes: [{ id: "custom-original", kind: "purpose", name: "Original", prompt: "My exact instructions" }], customStyles: []
    }));
    const settings = new LocalMemoryImageTemplateStore(directory).get();
    assert.equal(settings.defaultPurposeId, "purpose-process-contrast");
    assert.equal(settings.defaultStyleId, "style-vintage-encyclopedia");
    assert.equal(settings.purposes.find(({ id }) => id === "custom-original")?.prompt, "My exact instructions");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("invalid or corrupt custom settings never remove the built-in fallback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-memory-template-"));
  try {
    const store = new LocalMemoryImageTemplateStore(directory);
    assert.throws(() => store.create({ kind: "style", name: " ", prompt: "Valid" }), /name/i);
    assert.throws(() => store.create({ kind: "style", name: "Valid", prompt: " ".repeat(3) }), /prompt/i);
    assert.throws(() => store.create({ kind: "style", name: "n".repeat(61), prompt: "Valid" }), /name/i);
    assert.throws(() => store.create({ kind: "style", name: "Valid", prompt: "p".repeat(4_001) }), /prompt/i);
    assert.throws(() => store.setDefault({ kind: "style", id: "missing" }), /not found/i);

    const settings = store.get();
    assert.equal(settings.defaultPurposeId, "purpose-concept-structure");
    assert.equal(settings.defaultStyleId, "style-minimal-vector");
    assert.equal(settings.purposes.length, 7);
    assert.equal(settings.styles.length, 6);

    await writeFile(join(directory, "memory-image-templates.json"), "{not valid json", "utf8");
    const recovered = new LocalMemoryImageTemplateStore(directory).get();
    assert.equal(recovered.defaultPurposeId, "purpose-concept-structure");
    assert.equal(recovered.defaultStyleId, "style-minimal-vector");
    assert.equal(recovered.purposes.length, 7);
    assert.equal(recovered.styles.length, 6);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("side defaults persist independently, migrate legacy preferences, and recover after template deletion", async () => {
  const { memoryImageDefaults } = await import("../src/shared/memory-image-defaults");
  const directory = await mkdtemp(join(tmpdir(), "deep-reading-side-defaults-"));
  try {
    const store = new LocalMemoryImageTemplateStore(directory);
    assert.equal(memoryImageDefaults(store.get(), "understand").purposeId, "purpose-concept-structure");
    assert.equal(memoryImageDefaults(store.get(), "recall").styleId, "style-warm-illustration");
    store.setDefault({ kind: "purpose", id: "purpose-concept-contrast", side: "understand" });
    store.setDefault({ kind: "style", id: "style-storybook-watercolor", side: "understand" });
    store.setDefault({ kind: "purpose", id: "purpose-memory-palace", side: "recall" });
    const custom = store.create({ kind: "style", name: "Ink", prompt: "Draw with ink." });
    store.setDefault({ kind: "style", id: custom.id, side: "recall" });
    const reloaded = new LocalMemoryImageTemplateStore(directory);
    assert.equal(memoryImageDefaults(reloaded.get(), "understand").styleId, "style-storybook-watercolor");
    assert.equal(memoryImageDefaults(reloaded.get(), "recall").styleId, custom.id);
    assert.throws(() => reloaded.setDefault({ kind: "purpose", id: "purpose-concept-structure", side: "recall" }), /other side/);
    reloaded.remove({ kind: "style", id: custom.id });
    assert.equal(memoryImageDefaults(reloaded.get(), "recall").styleId, "style-clay-miniature");
    assert.equal(memoryImageDefaults(reloaded.get(), "understand").styleId, "style-storybook-watercolor");
    // Older shared custom preferences remain usable without mixing up built-in front/back purposes.
    const legacy = { ...store.get(), defaultsBySide: undefined, defaultStyleId: custom.id };
    assert.equal(memoryImageDefaults(legacy, "recall").styleId, custom.id);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("B39 custom purposes retain their side and cannot become the other side's default", async () => {
  const { purposeMatchesSide, memoryImageDefaults } = await import("../src/shared/memory-image-defaults");
  const directory = await mkdtemp(join(tmpdir(), "side-purpose-"));
  try {
    const store = new LocalMemoryImageTemplateStore(directory);
    const back = store.create({ kind: "purpose", name: "誇張圖像", prompt: "Exaggerate the scene", side: "recall" });
    const front = store.create({ kind: "purpose", name: "Diagram", prompt: "Explain relationships", side: "understand" });
    const reloaded = new LocalMemoryImageTemplateStore(directory);
    const saved = reloaded.get().purposes.find(item => item.id === back.id)!;
    assert.equal(saved.side, "recall");
    assert.equal(purposeMatchesSide(saved, "understand"), false);
    assert.equal(purposeMatchesSide(saved, "recall"), true);
    assert.equal(reloaded.get().purposes.find(item => item.id === front.id)?.side, "understand");
    assert.throws(() => reloaded.setDefault({ kind: "purpose", id: back.id, side: "understand" }), /other side/);
    reloaded.setDefault({ kind: "purpose", id: back.id, side: "recall" });
    reloaded.update({ kind: "purpose", id: back.id, name: back.name, prompt: back.prompt, side: "understand" });
    assert.notEqual(memoryImageDefaults(reloaded.get(), "recall").purposeId, back.id);
    assert.throws(() => reloaded.create({ kind: "purpose", name: "Invalid", prompt: "Invalid", side: "wrong" as never }), /side/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("B39 legacy purpose migration uses unique side defaults and keeps styles shared", async () => {
  const directory = await mkdtemp(join(tmpdir(), "legacy-side-purpose-"));
  try {
    await writeFile(join(directory, "memory-image-templates.json"), JSON.stringify({
      version: 1, defaultPurposeId: "old-back", defaultStyleId: "old-style",
      customPurposes: ["old-front", "old-back"].map(id => ({ id, kind: "purpose", name: id, prompt: "Exact prompt" })),
      customStyles: [{ id: "old-style", kind: "style", name: "Ink", prompt: "Exact style" }],
      defaultsBySide: { understand: { purposeId: "old-front" } }
    }));
    const store = new LocalMemoryImageTemplateStore(directory);
    assert.equal(store.get().purposes.find(item => item.id === "old-front")?.side, "understand");
    assert.equal(store.get().purposes.find(item => item.id === "old-back")?.side, "recall");
    assert.equal(store.get().purposes.find(item => item.id === "old-back")?.prompt, "Exact prompt");
    const style = store.create({ kind: "style", name: "Shared", prompt: "Ink", side: "understand" });
    assert.equal(style.side, undefined);
    for (const side of ["understand", "recall"] as const) store.setDefault({ kind: "style", id: style.id, side });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
