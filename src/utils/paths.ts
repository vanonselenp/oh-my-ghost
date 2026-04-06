/**
 * Path utilities for oh-my-codex
 * Resolves CLI config, skills, prompts, and state directories.
 *
 * Provider-aware functions (cliConfigHome, cliConfigPath, etc.) delegate to
 * the active CliProvider.  Legacy codex* functions remain as shims that
 * default to the Codex provider paths for backward compatibility.
 */

import { createHash } from "crypto";
import { existsSync } from "fs";
import { readdir, readFile, realpath } from "fs/promises";
import { dirname, join } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import type { CliProvider } from "../providers/types.js";

// ---------------------------------------------------------------------------
// Provider-aware path functions
// ---------------------------------------------------------------------------

/** CLI config home directory, resolved from the given provider. */
export function cliConfigHome(provider: CliProvider): string {
  return provider.configHome();
}

/** CLI config file path, resolved from the given provider. */
export function cliConfigPath(provider: CliProvider): string {
  return provider.configPath();
}

/** CLI prompts directory, resolved from the given provider. */
export function cliPromptsDir(provider: CliProvider): string {
  return provider.promptsDir();
}

/** CLI agents directory, resolved from the given provider. */
export function cliAgentsDir(provider: CliProvider): string {
  return provider.agentsDir();
}

/** Project-level agents directory, resolved from the given provider. */
export function projectAgentsDir(provider: CliProvider, projectRoot?: string): string {
  return provider.projectAgentsDir(projectRoot || process.cwd());
}

/** User-level skills directory, resolved from the given provider. */
export function cliSkillsDir(provider: CliProvider): string {
  return provider.skillsDir();
}

/** Project-level skills directory, resolved from the given provider. */
export function cliProjectSkillsDir(provider: CliProvider, projectRoot?: string): string {
  return provider.projectSkillsDir(projectRoot || process.cwd());
}

// ---------------------------------------------------------------------------
// Legacy Codex-specific shims (delegate to hardcoded Codex paths)
// These remain for backward compatibility until all call sites are migrated.
// ---------------------------------------------------------------------------

/** @deprecated Use cliConfigHome(provider) instead. */
export function codexHome(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

/** @deprecated Use cliConfigPath(provider) instead. */
export function codexConfigPath(): string {
  return join(codexHome(), "config.toml");
}

/** @deprecated Use cliPromptsDir(provider) instead. */
export function codexPromptsDir(): string {
  return join(codexHome(), "prompts");
}

/** @deprecated Use cliAgentsDir(provider) instead. */
export function codexAgentsDir(codexHomeDir?: string): string {
  return join(codexHomeDir || codexHome(), "agents");
}

/** @deprecated Use projectAgentsDir(provider) instead. */
export function projectCodexAgentsDir(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".codex", "agents");
}

/** @deprecated Use cliSkillsDir(provider) instead. */
export function userSkillsDir(): string {
  return join(codexHome(), "skills");
}

/** @deprecated Use cliProjectSkillsDir(provider) instead. */
export function projectSkillsDir(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".codex", "skills");
}

/** Historical legacy user-level skills directory (~/.agents/skills/) */
export function legacyUserSkillsDir(): string {
  return join(homedir(), ".agents", "skills");
}

export type InstalledSkillScope = "project" | "user";

export interface InstalledSkillDirectory {
  name: string;
  path: string;
  scope: InstalledSkillScope;
}

export interface SkillRootOverlapReport {
  canonicalDir: string;
  legacyDir: string;
  canonicalExists: boolean;
  legacyExists: boolean;
  canonicalResolvedDir: string | null;
  legacyResolvedDir: string | null;
  sameResolvedTarget: boolean;
  canonicalSkillCount: number;
  legacySkillCount: number;
  overlappingSkillNames: string[];
  mismatchedSkillNames: string[];
}

async function readInstalledSkillsFromDir(
  dir: string,
  scope: InstalledSkillScope,
): Promise<InstalledSkillDirectory[]> {
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(dir, entry.name),
      scope,
    }))
    .filter((entry) => existsSync(join(entry.path, "SKILL.md")))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Installed skill directories in scope-precedence order.
 * Project skills win over user-level skills with the same directory basename.
 */
export async function listInstalledSkillDirectories(
  projectRoot?: string,
): Promise<InstalledSkillDirectory[]> {
  const orderedDirs: Array<{ dir: string; scope: InstalledSkillScope }> = [
    { dir: projectSkillsDir(projectRoot), scope: "project" },
    { dir: userSkillsDir(), scope: "user" },
  ];

  const deduped: InstalledSkillDirectory[] = [];
  const seenNames = new Set<string>();

  for (const { dir, scope } of orderedDirs) {
    const skills = await readInstalledSkillsFromDir(dir, scope);
    for (const skill of skills) {
      if (seenNames.has(skill.name)) continue;
      seenNames.add(skill.name);
      deduped.push(skill);
    }
  }

  return deduped;
}

export async function detectLegacySkillRootOverlap(
  canonicalDir = userSkillsDir(),
  legacyDir = legacyUserSkillsDir(),
): Promise<SkillRootOverlapReport> {
  const canonicalExists = existsSync(canonicalDir);
  const legacyExists = existsSync(legacyDir);
  const [canonicalSkills, legacySkills, canonicalResolvedDir, legacyResolvedDir] = await Promise.all([
    readInstalledSkillsFromDir(canonicalDir, "user"),
    readInstalledSkillsFromDir(legacyDir, "user"),
    canonicalExists ? realpath(canonicalDir).catch(() => null) : Promise.resolve(null),
    legacyExists ? realpath(legacyDir).catch(() => null) : Promise.resolve(null),
  ]);

  const [canonicalHashes, legacyHashes] = await Promise.all([
    hashSkillDirectory(canonicalSkills),
    hashSkillDirectory(legacySkills),
  ]);
  const canonicalNames = new Set(canonicalSkills.map((skill) => skill.name));
  const legacyNames = new Set(legacySkills.map((skill) => skill.name));
  const overlappingSkillNames = [...canonicalNames]
    .filter((name) => legacyNames.has(name))
    .sort((a, b) => a.localeCompare(b));
  const mismatchedSkillNames = overlappingSkillNames.filter(
    (name) => canonicalHashes.get(name) !== legacyHashes.get(name),
  );
  const sameResolvedTarget =
    canonicalResolvedDir !== null &&
    legacyResolvedDir !== null &&
    canonicalResolvedDir === legacyResolvedDir;

  return {
    canonicalDir,
    legacyDir,
    canonicalExists,
    legacyExists,
    canonicalResolvedDir,
    legacyResolvedDir,
    sameResolvedTarget,
    canonicalSkillCount: canonicalSkills.length,
    legacySkillCount: legacySkills.length,
    overlappingSkillNames,
    mismatchedSkillNames,
  };
}

async function hashSkillDirectory(
  skills: InstalledSkillDirectory[],
): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  for (const skill of skills) {
    try {
      const content = await readFile(join(skill.path, "SKILL.md"), "utf-8");
      hashes.set(skill.name, createHash("sha256").update(content).digest("hex"));
    } catch {
      // Ignore unreadable SKILL.md files; existence is enough for overlap detection.
    }
  }

  return hashes;
}

/** oh-my-codex state directory (.omx/state/) */
export function omxStateDir(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".omx", "state");
}

/** oh-my-codex project memory file (.omx/project-memory.json) */
export function omxProjectMemoryPath(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".omx", "project-memory.json");
}

/** oh-my-codex notepad file (.omx/notepad.md) */
export function omxNotepadPath(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".omx", "notepad.md");
}

/** oh-my-codex plans directory (.omx/plans/) */
export function omxPlansDir(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".omx", "plans");
}

/** oh-my-codex logs directory (.omx/logs/) */
export function omxLogsDir(projectRoot?: string): string {
  return join(projectRoot || process.cwd(), ".omx", "logs");
}

/** Get the package root directory (where agents/, skills/, prompts/ live) */
export function packageRoot(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const candidate = join(__dirname, "..", "..");
    if (existsSync(join(candidate, "package.json"))) {
      return candidate;
    }
    const candidate2 = join(__dirname, "..");
    if (existsSync(join(candidate2, "package.json"))) {
      return candidate2;
    }
  } catch {
    // fall through to cwd fallback
  }
  return process.cwd();
}
