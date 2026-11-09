import assert from "node:assert/strict";
import { test } from "vitest";
import { resolveCodexLaunchSpec } from "../src/main/codex-app-server-client";

test("uses CODEX_PATH when an Electron GUI environment has no useful PATH", () => {
  const launch = resolveCodexLaunchSpec(
    "darwin",
    { CODEX_PATH: "/Applications/Codex.app/Contents/Resources/codex" },
    (path) => path === "/Applications/Codex.app/Contents/Resources/codex"
  );
  assert.deepEqual(launch, {
    command: "/Applications/Codex.app/Contents/Resources/codex",
    args: ["app-server"],
    windowsHide: false
  });
});

test("finds Homebrew Codex when macOS GUI PATH omits Homebrew", () => {
  const launch = resolveCodexLaunchSpec(
    "darwin",
    { PATH: "/usr/bin:/bin" },
    (path) => path === "/opt/homebrew/bin/codex"
  );
  assert.equal(launch.command, "/opt/homebrew/bin/codex");
  assert.deepEqual(launch.args, ["app-server"]);
});

test("prefers the installed ChatGPT Codex runtime over an older PATH CLI on macOS", () => {
  const bundled = "/Applications/ChatGPT.app/Contents/Resources/codex";
  const launch = resolveCodexLaunchSpec("darwin", { PATH: "/Users/example/.local/bin:/usr/bin" },
    (path) => path === bundled || path === "/Users/example/.local/bin/codex");
  assert.equal(launch.command, bundled);
});

test("an explicit CODEX_PATH still overrides the desktop runtime", () => {
  const launch = resolveCodexLaunchSpec("darwin", { CODEX_PATH: "/custom/codex", PATH: "/usr/bin" }, () => true);
  assert.equal(launch.command, "/custom/codex");
});
