import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";

export interface BundledSkillInstallResult {
  path: string;
  status: "installed" | "unchanged" | "updated";
}

function installBundledSkill(
  runtimePath: string,
  relativePath: string,
  markdown: string
): BundledSkillInstallResult {
  const path = join(runtimePath, relativePath);
  const existed = existsSync(path);
  if (existed && readFileSync(path, "utf8") === markdown) {
    return { path, status: "unchanged" };
  }
  mkdirSync(dirname(path), { recursive: true });
  const nextPath = `${path}.next`;
  writeFileSync(nextPath, markdown, "utf8");
  renameSync(nextPath, path);
  return { path, status: existed ? "updated" : "installed" };
}

export function installBundledSelfRetellingSkill(
  runtimePath: string,
  markdown: string
): BundledSkillInstallResult {
  return installBundledSkill(
    runtimePath,
    ".agents/skills/practice-self-retelling/SKILL.md",
    markdown
  );
}

export function installBundledReadingNoteSkill(
  runtimePath: string,
  markdown: string
): BundledSkillInstallResult {
  return installBundledSkill(
    runtimePath,
    ".agents/skills/create-reading-note/SKILL.md",
    markdown
  );
}

export function installBundledCompleteReadingNoteSkill(
  runtimePath: string,
  markdown: string
): BundledSkillInstallResult {
  return installBundledSkill(
    runtimePath,
    ".agents/skills/complete-reading-note/SKILL.md",
    markdown
  );
}

export function installBundledEditReadingNoteSkill(
  runtimePath: string,
  markdown: string
): BundledSkillInstallResult {
  return installBundledSkill(
    runtimePath,
    ".agents/skills/edit-reading-note/SKILL.md",
    markdown
  );
}
