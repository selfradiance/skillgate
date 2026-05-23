import { promises as fs } from "node:fs";
import path from "node:path";
import type { Finding, ScannedSurface, SurfaceKind } from "./types.js";

export const MAX_SURFACE_BYTES = 256 * 1024;
export const MAX_REFERENCE_FILES = 100;
export const MAX_REFERENCE_DEPTH = 4;

const SKIPPED_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".skillgate"]);
const ROOT_SURFACES: Array<{
  file: string;
  kind: SurfaceKind;
  reason: string;
}> = [
  {
    file: "SKILL.md",
    kind: "instruction",
    reason: "primary Skill instruction surface"
  },
  {
    file: "skill.json",
    kind: "manifest",
    reason: "Skill manifest declaration surface"
  },
  {
    file: "manifest.json",
    kind: "manifest",
    reason: "Skill manifest declaration surface"
  },
  {
    file: "README.md",
    kind: "documentation",
    reason: "package documentation surface"
  }
];

export interface DiscoveryResult {
  rootPath: string;
  scannedSurfaces: ScannedSurface[];
  findings: Finding[];
}

export async function discoverSkillSurfaces(inputPath: string): Promise<DiscoveryResult> {
  const rootPath = path.resolve(inputPath);
  const scannedSurfaces: ScannedSurface[] = [];
  const findings: Finding[] = [];

  for (const surface of ROOT_SURFACES) {
    await addSurfaceIfPresent(rootPath, surface.file, surface.kind, surface.reason, scannedSurfaces);
  }

  await addPackageJsonIfSkillLike(rootPath, scannedSurfaces, findings);
  await addReferenceSurfaces(rootPath, scannedSurfaces);

  return {
    rootPath,
    scannedSurfaces: sortSurfaces(scannedSurfaces),
    findings: sortFindings(findings)
  };
}

export async function isReadableDirectory(inputPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(inputPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function sortSurfaces(surfaces: ScannedSurface[]): ScannedSurface[] {
  return [...surfaces].sort((a, b) => {
    return surfaceRank(a.path) - surfaceRank(b.path) || a.path.localeCompare(b.path);
  });
}

function surfaceRank(relativePath: string): number {
  const ranks = new Map<string, number>([
    ["SKILL.md", 0],
    ["skill.json", 1],
    ["manifest.json", 2],
    ["package.json", 3],
    ["README.md", 4]
  ]);

  return ranks.get(relativePath) ?? 10;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    return (
      a.file.localeCompare(b.file) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message) ||
      (a.detail ?? "").localeCompare(b.detail ?? "")
    );
  });
}

async function addSurfaceIfPresent(
  rootPath: string,
  relativePath: string,
  kind: SurfaceKind,
  reason: string,
  scannedSurfaces: ScannedSurface[]
): Promise<void> {
  const absolutePath = path.join(rootPath, relativePath);
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      return;
    }

    scannedSurfaces.push({
      path: toPosix(relativePath),
      absolutePath,
      kind,
      reason,
      bytes: stat.size
    });
  } catch {
    return;
  }
}

async function addPackageJsonIfSkillLike(
  rootPath: string,
  scannedSurfaces: ScannedSurface[],
  findings: Finding[]
): Promise<void> {
  const relativePath = "package.json";
  const absolutePath = path.join(rootPath, relativePath);
  let stat;
  try {
    stat = await fs.stat(absolutePath);
  } catch {
    return;
  }

  if (!stat.isFile()) {
    return;
  }

  try {
    const text = await readSnippet(absolutePath);
    if (!appearsSkillLikePackageJson(text)) {
      return;
    }

    scannedSurfaces.push({
      path: relativePath,
      absolutePath,
      kind: "package_manifest",
      reason: "package.json declares Skill-like capability fields",
      bytes: stat.size
    });
  } catch (error) {
    findings.push({
      severity: "review",
      file: relativePath,
      code: "package_shape_issue",
      message: "Could not inspect package.json for Skill-like declarations.",
      detail: error instanceof Error ? error.message : "unknown error"
    });
  }
}

function appearsSkillLikePackageJson(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      return false;
    }

    return hasSkillLikeDeclaration(parsed);
  } catch {
    return /"(skill|skills|tools|capabilities|permissions|allowed_domains|allowedDomains|hooks|command_hooks|commandHooks)"\s*:/i.test(
      text
    );
  }
}

function hasSkillLikeDeclaration(value: Record<string, unknown>): boolean {
  const directKeys = [
    "skill",
    "skills",
    "tools",
    "capabilities",
    "permissions",
    "allowed_domains",
    "allowedDomains",
    "hooks",
    "command_hooks",
    "commandHooks"
  ];

  if (directKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return true;
  }

  const skillObject = value["skill"];
  if (isRecord(skillObject) && hasSkillLikeDeclaration(skillObject)) {
    return true;
  }

  return false;
}

async function addReferenceSurfaces(rootPath: string, scannedSurfaces: ScannedSurface[]): Promise<void> {
  const referenceRoots = ["docs", "examples"];
  for (const referenceRoot of referenceRoots) {
    const absoluteRoot = path.join(rootPath, referenceRoot);
    try {
      const stat = await fs.stat(absoluteRoot);
      if (!stat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    await walkReferenceDirectory(rootPath, absoluteRoot, 0, scannedSurfaces);
  }
}

async function walkReferenceDirectory(
  rootPath: string,
  currentDir: string,
  depth: number,
  scannedSurfaces: ScannedSurface[]
): Promise<void> {
  if (depth > MAX_REFERENCE_DEPTH || scannedSurfaces.length >= MAX_REFERENCE_FILES) {
    return;
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }
      await walkReferenceDirectory(rootPath, path.join(currentDir, entry.name), depth + 1, scannedSurfaces);
      continue;
    }

    if (!entry.isFile() || !isReferenceCandidate(entry.name)) {
      continue;
    }

    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = toPosix(path.relative(rootPath, absolutePath));
    const text = await readSnippet(absolutePath);
    if (!isExplicitSkillReference(relativePath, text)) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    scannedSurfaces.push({
      path: relativePath,
      absolutePath,
      kind: "reference",
      reason: "explicit Skill instruction/reference surface under docs or examples",
      bytes: stat.size
    });
  }
}

function shouldSkipDirectory(name: string): boolean {
  return SKIPPED_DIRS.has(name) || name.startsWith(".");
}

function isReferenceCandidate(name: string): boolean {
  return /\.(md|mdx|txt|json)$/i.test(name);
}

function isExplicitSkillReference(relativePath: string, text: string): boolean {
  const lowerPath = relativePath.toLowerCase();
  const lowerText = text.toLowerCase();
  const pathHints = ["skill", "instruction", "reference", "capability", "tool", "permission", "hook"];
  const textHints = [
    "skill reference",
    "skill instruction",
    "skill capability",
    "capability surface",
    "tool surface",
    "permission surface",
    "hook surface",
    "agent instruction"
  ];

  return pathHints.some((hint) => lowerPath.includes(hint)) || textHints.some((hint) => lowerText.includes(hint));
}

async function readSnippet(absolutePath: string): Promise<string> {
  const handle = await fs.open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(16 * 1024);
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
