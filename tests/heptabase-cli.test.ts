import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  exists: vi.fn(() => true),
}));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs", () => ({ existsSync: mocks.exists }));
import { HeptabaseCliError, runHeptabaseCli } from "../src/main/heptabase-cli";
beforeEach(() => {
  mocks.exists.mockReturnValue(true);
  mocks.execFile.mockReset();
});
test("F79 CLI uses argv, bounded output and timeout without a shell", async () => {
  mocks.execFile.mockImplementation((_file, args, options, done) => {
    expect(args).toEqual([
      "note",
      "create",
      "--content-file",
      "/tmp/a $(x).md",
    ]);
    expect(options).toMatchObject({
      shell: false,
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
    done(null, '{"id":"created"}', "");
  });
  expect(
    await runHeptabaseCli([
      "note",
      "create",
      "--content-file",
      "/tmp/a $(x).md",
    ]),
  ).toEqual({ id: "created" });
});
test("F79 CLI invalid output and interrupted writes remain uncertain; explicit failures are definite", async () => {
  mocks.execFile.mockImplementation((_f, _a, _o, done) =>
    done(null, "bad json", ""),
  );
  await expect(runHeptabaseCli(["note", "create"])).rejects.toMatchObject({
    definite: false,
  });
  mocks.execFile.mockImplementation((_f, _a, _o, done) =>
    done(new Error("killed"), "", ""),
  );
  await expect(runHeptabaseCli(["note", "create"])).rejects.toBeInstanceOf(
    HeptabaseCliError,
  );
  mocks.execFile.mockImplementation((_f, _a, _o, done) =>
    done(
      new Error("failed"),
      '{"status":"failed","failureReasonCode":"validationError"}',
      "",
    ),
  );
  await expect(runHeptabaseCli(["note", "create"])).rejects.toMatchObject({
    definite: true,
  });
});
test("F79 missing CLI provides settings guidance without launching anything", async () => {
  mocks.exists.mockReturnValue(false);
  expect(() => runHeptabaseCli(["--version"])).toThrow(/Settings/);
  expect(mocks.execFile).not.toHaveBeenCalled();
});
