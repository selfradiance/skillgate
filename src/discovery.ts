import { promises as fs, type Stats } from "node:fs";
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
  const rootRealPath = await fs.realpath(rootPath);
  const scannedSurfaces: ScannedSurface[] = [];
  const findings: Finding[] = [];

  for (const surface of ROOT_SURFACES) {
    await addSurfaceIfPresent(rootPath, rootRealPath, surface.file, surface.kind, surface.reason, scannedSurfaces);
  }

  await addPackageJsonIfSkillLike(rootPath, rootRealPath, scannedSurfaces, findings);
  await addReferenceSurfaces(rootPath, rootRealPath, scannedSurfaces);

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
      a.surface.localeCompare(b.surface) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message) ||
      (a.detail ?? "").localeCompare(b.detail ?? "")
    );
  });
}

async function addSurfaceIfPresent(
  rootPath: string,
  rootRealPath: string,
  relativePath: string,
  kind: SurfaceKind,
  reason: string,
  scannedSurfaces: ScannedSurface[]
): Promise<void> {
  const absolutePath = path.join(rootPath, relativePath);
  try {
    const containedFile = await getContainedFile(rootRealPath, absolutePath);
    if (!containedFile) {
      return;
    }

    scannedSurfaces.push({
      path: toPosix(relativePath),
      absolutePath: containedFile.realPath,
      kind,
      reason,
      bytes: containedFile.stat.size
    });
  } catch {
    return;
  }
}

async function addPackageJsonIfSkillLike(
  rootPath: string,
  rootRealPath: string,
  scannedSurfaces: ScannedSurface[],
  findings: Finding[]
): Promise<void> {
  const relativePath = "package.json";
  const absolutePath = path.join(rootPath, relativePath);
  let containedFile;
  try {
    containedFile = await getContainedFile(rootRealPath, absolutePath);
  } catch {
    return;
  }

  if (!containedFile) {
    return;
  }

  try {
    const text = await readPrefix(containedFile.realPath, MAX_SURFACE_BYTES);
    if (!appearsSkillLikePackageJson(text, hasSkillPackageSurface(scannedSurfaces))) {
      return;
    }

    scannedSurfaces.push({
      path: relativePath,
      absolutePath: containedFile.realPath,
      kind: "package_manifest",
      reason: "package.json declares Skill-like capability or execution fields",
      bytes: containedFile.stat.size
    });
  } catch (error) {
    findings.push({
      severity: "review",
      surface: "capability",
      file: relativePath,
      code: "package_shape_issue",
      message: "Could not inspect package.json for Skill-like declarations.",
      detail: error instanceof Error ? error.message : "unknown error"
    });
  }
}

function appearsSkillLikePackageJson(text: string, hasSkillPackageSurface: boolean): boolean {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed)) {
      return false;
    }

    return hasSkillLikeDeclaration(parsed) || (hasSkillPackageSurface && hasPackageExecutionDeclaration(parsed));
  } catch {
    return /"(skill|skills|tools|capabilities|permissions|allowed_domains|allowedDomains|hooks|command_hooks|commandHooks)"\s*:/i.test(
      text
    );
  }
}

function hasPackageExecutionDeclaration(value: Record<string, unknown>): boolean {
  return isRecord(value["scripts"]) || typeof value["bin"] === "string" || isRecord(value["bin"]);
}

function hasSkillPackageSurface(scannedSurfaces: ScannedSurface[]): boolean {
  return scannedSurfaces.some((surface) => {
    return surface.path === "SKILL.md" || surface.kind === "manifest";
  });
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

async function addReferenceSurfaces(
  rootPath: string,
  rootRealPath: string,
  scannedSurfaces: ScannedSurface[]
): Promise<void> {
  const referenceRoots = ["docs", "examples"];
  for (const referenceRoot of referenceRoots) {
    const logicalRoot = path.join(rootPath, referenceRoot);
    try {
      const readRoot = await getContainedDirectory(rootRealPath, logicalRoot);
      if (!readRoot) {
        continue;
      }
      await walkReferenceDirectory(rootPath, rootRealPath, logicalRoot, readRoot, 0, scannedSurfaces);
    } catch {
      continue;
    }
  }
}

async function walkReferenceDirectory(
  rootPath: string,
  rootRealPath: string,
  currentLogicalDir: string,
  currentReadDir: string,
  depth: number,
  scannedSurfaces: ScannedSurface[]
): Promise<void> {
  if (depth > MAX_REFERENCE_DEPTH || scannedSurfaces.length >= MAX_REFERENCE_FILES) {
    return;
  }

  const entries = await fs.readdir(currentReadDir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const logicalPath = path.join(currentLogicalDir, entry.name);
    const readPath = path.join(currentReadDir, entry.name);

    const containedDirectory =
      entry.isDirectory() || entry.isSymbolicLink() ? await getContainedDirectory(rootRealPath, readPath) : undefined;
    if (containedDirectory) {
      if (shouldSkipDirectory(entry.name)) {
        continue;
      }
      await walkReferenceDirectory(rootPath, rootRealPath, logicalPath, containedDirectory, depth + 1, scannedSurfaces);
      continue;
    }

    if (!isReferenceCandidate(entry.name)) {
      continue;
    }

    const containedFile = await getContainedFile(rootRealPath, readPath);
    if (!containedFile) {
      continue;
    }

    const relativePath = toPosix(path.relative(rootPath, logicalPath));
    const text = await readPrefix(containedFile.realPath, MAX_SURFACE_BYTES);
    if (!isExplicitSkillReference(relativePath, text)) {
      continue;
    }

    scannedSurfaces.push({
      path: relativePath,
      absolutePath: containedFile.realPath,
      kind: "reference",
      reason: "explicit Skill instruction/reference surface under docs or examples",
      bytes: containedFile.stat.size
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

async function readPrefix(absolutePath: string, maxBytes: number): Promise<string> {
  const handle = await fs.open(absolutePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
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

async function getContainedFile(
  rootRealPath: string,
  absolutePath: string
): Promise<{ realPath: string; stat: Stats } | undefined> {
  await fs.lstat(absolutePath);
  const realPath = await fs.realpath(absolutePath);
  if (!isPathContained(rootRealPath, realPath)) {
    return undefined;
  }

  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    return undefined;
  }

  return { realPath, stat };
}

async function getContainedDirectory(rootRealPath: string, absolutePath: string): Promise<string | undefined> {
  await fs.lstat(absolutePath);
  const realPath = await fs.realpath(absolutePath);
  if (!isPathContained(rootRealPath, realPath)) {
    return undefined;
  }

  const stat = await fs.stat(realPath);
  if (!stat.isDirectory()) {
    return undefined;
  }

  return realPath;
}

function isPathContained(rootRealPath: string, candidateRealPath: string): boolean {
  const relativePath = path.relative(rootRealPath, candidateRealPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}
