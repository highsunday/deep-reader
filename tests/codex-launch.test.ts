import assert from "node:assert/strict";
import { test } from "vitest";
import { codexChildEnvironment, resolveCodexLaunchSpec } from "../src/main/codex-app-server-client";

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

test("Finder launch prefers the current nested ChatGPT native runtime over a Node CLI", () => {
  const native = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
  const launch = resolveCodexLaunchSpec("darwin", { HOME: "/Users/example", PATH: "/usr/bin:/bin" },
    path => path === native || path === "/opt/homebrew/bin/codex");
  assert.equal(launch.command, native);
});

test("Finder launch discovers a user-installed standalone CLI without a shell PATH", () => {
  const launch = resolveCodexLaunchSpec("darwin", { HOME: "/Users/example", PATH: "/usr/bin:/bin" },
    path => path === "/Users/example/.local/bin/codex");
  assert.equal(launch.command, "/Users/example/.local/bin/codex");
});


test("macOS child PATH preserves existing entries and supports Node-based Homebrew CLIs", () => {
  const environment = { HOME: "/Users/example", PATH: "/custom/bin:/usr/bin:/bin", CODEX_PATH: "/custom/codex", CUSTOM_SETTING: "preserved" };
  const child = codexChildEnvironment("darwin", environment);
  assert.equal(child.PATH, "/custom/bin:/usr/bin:/bin:/Users/example/.local/bin:/opt/homebrew/bin:/usr/local/bin");
  assert.equal(child.CODEX_PATH, environment.CODEX_PATH);
  assert.equal(child.CUSTOM_SETTING, environment.CUSTOM_SETTING);
  assert.equal(environment.PATH, "/custom/bin:/usr/bin:/bin");
  assert.deepEqual(codexChildEnvironment("linux", environment), environment);
  assert.deepEqual(codexChildEnvironment("win32", environment), environment);
});
