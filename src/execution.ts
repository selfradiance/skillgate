import { promises as fs, type Stats } from "node:fs";
import path from "node:path";
import { MAX_REFERENCE_DEPTH, MAX_REFERENCE_FILES, MAX_SURFACE_BYTES } from "./discovery.js";
import type { Finding, ParsedInspection, TextSurface } from "./types.js";

const INSTALL_HOOK_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly"
]);
const REVIEW_SCRIPTS = new Set(["start", "dev", "serve"]);
const EXECUTION_DIRS = ["bin", "commands", "scripts", "tools", ".claude", ".cursor"];
const CODE_EXTENSIONS = new Set([
  ".bash",
  ".cjs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".mjs",
  ".php",
  ".pl",
  ".ps1",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",
  ".zsh"
]);

type ExecutionPatternCode = "shell_execution_surface" | "network_execution_surface" | "dynamic_code_execution_surface";

interface Pattern {
  label: string;
  regex: RegExp;
}

interface PatternGroup {
  code: ExecutionPatternCode;
  message: string;
  patterns: Pattern[];
}

const SCRIPT_TOKEN_GROUPS: PatternGroup[] = [
  {
    code: "shell_execution_surface",
    message: "Package script contains an obvious shell or process execution token.",
    patterns: [
      commandPattern("bash"),
      commandPattern("sh"),
      commandPattern("zsh"),
      commandPattern("powershell"),
      commandPattern("pwsh"),
      commandPattern("cmd.exe"),
      commandPattern("python"),
      commandPattern("python3"),
      { label: "npm exec", regex: /\bnpm\s+exec\b/i },
      commandPattern("npx"),
      commandPattern("chmod"),
      { label: "rm -rf", regex: /\brm\s+-rf\b/i }
    ]
  },
  {
    code: "network_execution_surface",
    message: "Package script contains an obvious network or transfer token.",
    patterns: [
      commandPattern("curl"),
      commandPattern("wget"),
      commandPattern("nc"),
      commandPattern("netcat"),
      commandPattern("ssh"),
      commandPattern("scp")
    ]
  },
  {
    code: "dynamic_code_execution_surface",
    message: "Package script contains an obvious dynamic execution token.",
    patterns: [
      { label: "node -e", regex: /\bnode\s+-e\b/i },
      { label: "eval", regex: /\beval\b/i },
      commandPattern("base64")
    ]
  }
];

const CODE_PATTERN_GROUPS: PatternGroup[] = [
  {
    code: "shell_execution_surface",
    message: "Code-like file contains a shell or process execution pattern.",
    patterns: [
      { label: "child_process", regex: /\bchild_process\b/ },
      { label: "exec(", regex: /\bexec\s*\(/ },
      { label: "execSync(", regex: /\bexecSync\s*\(/ },
      { label: "spawn(", regex: /\bspawn\s*\(/ },
      { label: "spawnSync(", regex: /\bspawnSync\s*\(/ },
      { label: "system(", regex: /\bsystem\s*\(/ },
      { label: "os.system", regex: /\bos\.system\b/ },
      { label: "subprocess", regex: /\bsubprocess\b/ },
      { label: "Runtime.getRuntime", regex: /\bRuntime\.getRuntime\b/ },
      { label: "ProcessBuilder", regex: /\bProcessBuilder\b/ }
    ]
  },
  {
    code: "dynamic_code_execution_surface",
    message: "Code-like file contains a dynamic code execution pattern.",
    patterns: [
      { label: "eval(", regex: /\beval\s*\(/ },
      { label: "new Function(", regex: /\bnew\s+Function\s*\(/ },
      { label: "Function(", regex: /\bFunction\s*\(/ },
      { label: "import(", regex: /\bimport\s*\(/ },
      { label: "vm.runIn", regex: /\bvm\.runIn/ },
      { label: "setTimeout(string)", regex: /\bsetTimeout\s*\(\s*["'`]/ },
      { label: "setInterval(string)", regex: /\bsetInterval\s*\(\s*["'`]/ }
    ]
  },
  {
    code: "network_execution_surface",
    message: "Code-like file contains a network or download pattern.",
    patterns: [
      { label: "fetch(", regex: /\bfetch\s*\(/ },
      { label: "axios", regex: /\baxios\b/ },
      { label: "http.request", regex: /\bhttp\.request\b/ },
      { label: "https.request", regex: /\bhttps\.request\b/ },
      { label: "curl", regex: /\bcurl\b/ },
      { label: "wget", regex: /\bwget\b/ },
      { label: "WebSocket", regex: /\bWebSocket\b/ },
      { label: "socket", regex: /\bsocket\b/ },
      { label: "net.connect", regex: /\bnet\.connect\b/ }
    ]
  }
];

interface ScanState {
  inspectedFiles: number;
}

export async function inspectExecutionSurface(parsed: ParsedInspection): Promise<Finding[]> {
  const rootRealPath = await fs.realpath(parsed.rootPath);
  const findings: Finding[] = [];
  const packageJson = parsed.textSurfaces.find((surface) => {
    return surface.path === "package.json" && surface.kind === "package_manifest";
  });

  if (packageJson) {
    findings.push(...(await inspectPackageJsonExecution(parsed.rootPath, rootRealPath, packageJson)));
  }

  const state: ScanState = { inspectedFiles: 0 };
  for (const relativeRoot of executionRoots(parsed)) {
    await inspectExecutionDirectory(parsed.rootPath, rootRealPath, relativeRoot, relativeRoot, 0, state, findings);
  }

  return sortFindings(findings);
}

async function inspectPackageJsonExecution(
  rootPath: string,
  rootRealPath: string,
  packageJson: TextSurface
): Promise<Finding[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(packageJson.text);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) {
    return [];
  }

  return sortFindings([
    ...inspectPackageScripts(packageJson.path, parsed["scripts"]),
    ...(await inspectPackageBin(rootPath, rootRealPath, packageJson.path, parsed["bin"]))
  ]);
}

function inspectPackageScripts(file: string, scriptsValue: unknown): Finding[] {
  if (!isRecord(scriptsValue)) {
    return [];
  }

  const findings: Finding[] = [];
  const scripts = Object.entries(scriptsValue)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [scriptName, script] of scripts) {
    if (INSTALL_HOOK_SCRIPTS.has(scriptName)) {
      findings.push({
        severity: "elevated_review",
        surface: "execution",
        file,
        code: "install_hook_present",
        message: "package.json declares an install or publication lifecycle hook.",
        detail: `script: ${scriptName}`,
        matchedText: scriptName
      });
    } else if (REVIEW_SCRIPTS.has(scriptName)) {
      findings.push({
        severity: "review",
        surface: "execution",
        file,
        code: "package_script_present",
        message: "package.json declares a runtime-oriented package script.",
        detail: `script: ${scriptName}`,
        matchedText: scriptName
      });
    }

    findings.push(...findExecutionPatterns(file, `script: ${scriptName}`, script, SCRIPT_TOKEN_GROUPS));
  }

  return findings;
}

async function inspectPackageBin(
  rootPath: string,
  rootRealPath: string,
  file: string,
  binValue: unknown
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const entry of collectBinEntries(binValue)) {
    const candidatePath = path.resolve(rootPath, entry.value);
    const normalizedValue = toPosix(entry.value);

    if (!isPathContained(path.resolve(rootPath), candidatePath)) {
      findings.push(packageRootEscapeFinding(file, `bin ${entry.name}: ${normalizedValue}`));
      continue;
    }

    let realPath: string;
    try {
      await fs.lstat(candidatePath);
      realPath = await fs.realpath(candidatePath);
    } catch {
      if (await isBrokenSymlink(candidatePath)) {
        findings.push(packageRootEscapeFinding(file, `bin ${entry.name}: ${normalizedValue}`));
      }
      continue;
    }

    if (!isPathContained(rootRealPath, realPath)) {
      findings.push(packageRootEscapeFinding(file, `bin ${entry.name}: ${normalizedValue}`));
      continue;
    }

    const stat = await fs.stat(realPath);
    if (!stat.isFile()) {
      continue;
    }

    const prefix = await readPrefix(realPath, Math.min(MAX_SURFACE_BYTES, Math.max(2, stat.size)));
    if (isExecutableMode(stat.mode) || hasShebang(prefix)) {
      findings.push({
        severity: "elevated_review",
        surface: "execution",
        file,
        code: "declared_executable_entrypoint",
        message: "package.json declares an executable command entrypoint.",
        detail: `bin ${entry.name}: ${normalizedValue}`,
        matchedText: entry.name
      });
    }

  }

  return findings;
}

async function inspectExecutionDirectory(
  rootPath: string,
  rootRealPath: string,
  logicalPath: string,
  displayPath: string,
  depth: number,
  state: ScanState,
  findings: Finding[]
): Promise<void> {
  if (depth > MAX_REFERENCE_DEPTH || state.inspectedFiles >= MAX_REFERENCE_FILES) {
    return;
  }

  let realPath: string;
  try {
    await fs.lstat(logicalPathToAbsolute(rootPath, logicalPath));
    realPath = await fs.realpath(logicalPathToAbsolute(rootPath, logicalPath));
  } catch {
    if (await isBrokenSymlink(logicalPathToAbsolute(rootPath, logicalPath))) {
      findings.push(packageRootEscapeFinding(displayPath, "execution path symlink could not be resolved"));
    }
    return;
  }

  if (!isPathContained(rootRealPath, realPath)) {
    findings.push(packageRootEscapeFinding(displayPath, "execution path resolves outside package root"));
    return;
  }

  const stat = await fs.stat(realPath);
  if (!stat.isDirectory()) {
    return;
  }

  const entries = await fs.readdir(realPath, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (state.inspectedFiles >= MAX_REFERENCE_FILES) {
      return;
    }

    const childLogicalPath = path.join(logicalPath, entry.name);
    const childDisplayPath = toPosix(path.join(displayPath, entry.name));
    const childReadPath = path.join(realPath, entry.name);
    let childRealPath: string;

    try {
      childRealPath = await fs.realpath(childReadPath);
    } catch {
      if (entry.isSymbolicLink()) {
        findings.push(packageRootEscapeFinding(childDisplayPath, "execution path symlink could not be resolved"));
      }
      continue;
    }

    if (!isPathContained(rootRealPath, childRealPath)) {
      findings.push(packageRootEscapeFinding(childDisplayPath, "execution path resolves outside package root"));
      continue;
    }

    const childStat = await fs.stat(childRealPath);
    if (childStat.isDirectory()) {
      await inspectExecutionDirectory(
        rootPath,
        rootRealPath,
        childLogicalPath,
        childDisplayPath,
        depth + 1,
        state,
        findings
      );
      continue;
    }

    if (!childStat.isFile()) {
      continue;
    }

    state.inspectedFiles += 1;
    await inspectExecutionFile(childDisplayPath, childRealPath, childStat, findings);
  }

}

async function inspectExecutionFile(
  relativePath: string,
  realPath: string,
  stat: Stats,
  findings: Finding[]
): Promise<void> {
  const prefix = await readPrefix(realPath, Math.min(MAX_SURFACE_BYTES, Math.max(2, stat.size)));
  const executable = isExecutableMode(stat.mode);
  const shebang = hasShebang(prefix);
  const hiddenExecutionPath = relativePath.startsWith(".claude/") || relativePath.startsWith(".cursor/");

  if (executable || shebang) {
    findings.push({
      severity: "elevated_review",
      surface: "execution",
      file: relativePath,
      code: hiddenExecutionPath ? "suspicious_hidden_execution_surface" : "executable_file_present",
      message: hiddenExecutionPath
        ? "Hidden tool configuration directory contains an executable-looking file."
        : "Likely execution directory contains an executable-looking file.",
      detail: shebang ? "shebang present" : "executable permission bit present",
      matchedText: shebang ? "#!" : "executable-bit"
    });
  }

  if (isCodeLikeFile(relativePath, prefix)) {
    findings.push(...findExecutionPatterns(relativePath, "code pattern", prefix, CODE_PATTERN_GROUPS));
  }
}

function findExecutionPatterns(
  file: string,
  detailPrefix: string,
  text: string,
  groups: PatternGroup[]
): Finding[] {
  const findings: Finding[] = [];
  for (const group of groups) {
    const matched = group.patterns.find((pattern) => pattern.regex.test(text));
    if (!matched) {
      continue;
    }

    findings.push({
      severity: "elevated_review",
      surface: "execution",
      file,
      code: group.code,
      message: group.message,
      detail: `${detailPrefix}; pattern matched: ${matched.label}`,
      matchedText: matched.label
    });
  }

  return findings;
}

function collectBinEntries(binValue: unknown): Array<{ name: string; value: string }> {
  if (typeof binValue === "string") {
    return [{ name: "bin", value: binValue }];
  }

  if (!isRecord(binValue)) {
    return [];
  }

  return Object.entries(binValue)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function executionRoots(parsed: ParsedInspection): string[] {
  const roots = [...EXECUTION_DIRS];
  if (parsed.scannedSurfaces.some((surface) => surface.path.startsWith("examples/"))) {
    roots.push("examples");
  }
  return roots;
}

function packageRootEscapeFinding(file: string, detail: string): Finding {
  return {
    severity: "elevated_review",
    surface: "execution",
    file,
    code: "package_root_escape",
    message: "Execution surface path did not resolve inside the inspected package root.",
    detail
  };
}

function commandPattern(command: string): Pattern {
  return {
    label: command,
    regex: new RegExp(`(?:^|[\\s;&|()])${escapeRegExp(command)}(?:$|[\\s;&|()])`, "i")
  };
}

function isCodeLikeFile(relativePath: string, prefix: string): boolean {
  return hasShebang(prefix) || CODE_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function isExecutableMode(mode: number): boolean {
  return (mode & 0o111) !== 0;
}

function hasShebang(text: string): boolean {
  return text.startsWith("#!");
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

async function isBrokenSymlink(absolutePath: string): Promise<boolean> {
  let lstat: Stats;
  try {
    lstat = await fs.lstat(absolutePath);
  } catch {
    return false;
  }

  if (!lstat.isSymbolicLink()) {
    return false;
  }

  try {
    await fs.realpath(absolutePath);
    return false;
  } catch {
    return true;
  }
}

function logicalPathToAbsolute(rootPath: string, relativePath: string): string {
  return path.join(rootPath, relativePath);
}

function isPathContained(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    return (
      a.file.localeCompare(b.file) ||
      a.surface.localeCompare(b.surface) ||
      a.code.localeCompare(b.code) ||
      (a.detail ?? "").localeCompare(b.detail ?? "") ||
      (a.matchedText ?? "").localeCompare(b.matchedText ?? "") ||
      severityRank(a.severity) - severityRank(b.severity) ||
      a.message.localeCompare(b.message)
    );
  });
}

function severityRank(severity: string): number {
  return severity === "elevated_review" ? 0 : 1;
}
