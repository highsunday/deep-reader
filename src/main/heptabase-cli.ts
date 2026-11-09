import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
export class HeptabaseCliError extends Error {
  constructor(
    message: string,
    readonly definite = false,
  ) {
    super(message);
  }
}
/** Use absolute vendor installation locations; never resolve an executable from a project cwd. */
export function resolveHeptabaseCli(): string {
  const paths =
    process.platform === "win32"
      ? [join(homedir(), ".heptabase", "bin", "heptabase.cmd")]
      : [
          "/opt/homebrew/bin/heptabase",
          "/usr/local/bin/heptabase",
          join(homedir(), ".local/bin/heptabase"),
          join(homedir(), ".heptabase/bin/heptabase"),
        ];
  const executable = paths.find(existsSync);
  if (!executable)
    throw new Error(
      "Heptabase CLI was not found. Install the current Heptabase desktop app and enable Settings → AI Features → CLI.",
    );
  if (process.platform === "win32")
    throw new Error(
      "Direct Heptabase import currently requires macOS or Linux.",
    );
  return executable;
}
export function runHeptabaseCli(args: string[]): Promise<any> {
  const executable = resolveHeptabaseCli();
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        shell: false,
        timeout: args[0] === "file" ? 120_000 : 30_000,
        maxBuffer: 8 * 1024 * 1024,
        cwd: homedir(),
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        let result: any;
        try {
          result = args[0] === "--version" ? stdout.trim() : JSON.parse(stdout);
        } catch {
          /* A killed command may not have a complete JSON response. */
        }
        if (error || result?.error || result?.status === "failed") {
          let details: any;
          try {
            details = JSON.parse(stderr);
          } catch {
            /* Only expose bounded CLI text. */
          }
          const fault = result?.error ?? details?.error;
          const message =
            typeof fault === "string"
              ? fault
              : (fault?.message ??
                result?.failureReasonCode ??
                stderr.trim().slice(0, 800) ??
                error?.message);
          // A timeout or malformed response cannot prove that a remote create did not happen.
          const definite = Boolean(
            result?.status === "failed" ||
              [
                "invalidParams",
                "validationError",
                "forbidden",
                "unauthorized",
                "cliDisabled",
              ].includes(fault?.code),
          );
          reject(
            new HeptabaseCliError(
              message ||
                "Heptabase CLI failed. Check that the desktop app is open and CLI is enabled in Settings → AI Features → CLI.",
              definite,
            ),
          );
        } else if (result === undefined)
          reject(
            new HeptabaseCliError(
              "Heptabase CLI returned an invalid response. Check the desktop app and CLI version.",
            ),
          );
        else resolve(result);
      },
    );
  });
}
