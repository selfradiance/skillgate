import path from "node:path";
import { discoverSkillSurfaces, isReadableDirectory } from "./discovery.js";
import { parseSurfaces } from "./parser.js";
import type { DeclaredSurfaces, Finding, InspectionResult, ParsedInspection, Verdict } from "./types.js";
import { TOOL_NAME, TOOL_VERSION } from "./types.js";
import { buildInspectionResult } from "./report.js";
import { inspectExecutionSurface } from "./execution.js";

const SUSPICIOUS_TOOL_TERMS = ["shell", "exec", "terminal", "bash", "zsh", "powershell", "curl", "wget"];
const ELEVATED_PERMISSIONS = ["filesystem_write", "network", "secrets", "env", "shell"];
const REVIEW_PERMISSIONS = ["browser", "email", "calendar"];
const HOOK_TERMS = ["preinstall", "postinstall", "on_admit", "before_run", "after_run", "background", "daemon"];
const BROAD_DOMAIN_TERMS = ["*", "all", "any", "internet", "broad internet access", "http://*", "https://*", "*.com"];

const TEXT_SIGNALS: Array<{
  phrase: string;
  severity: "review" | "elevated_review";
  code: string;
  message: string;
}> = [
  {
    phrase: "ignore previous instructions",
    severity: "elevated_review",
    code: "hidden_tool_instruction",
    message: "Instruction text asks to override surrounding instructions."
  },
  {
    phrase: "do not tell the user",
    severity: "elevated_review",
    code: "hidden_tool_instruction",
    message: "Instruction text asks to hide behavior from the user."
  },
  {
    phrase: "hide this",
    severity: "elevated_review",
    code: "hidden_tool_instruction",
    message: "Instruction text asks to hide behavior."
  },
  {
    phrase: "exfiltrate",
    severity: "elevated_review",
    code: "mutation_or_exfiltration_language",
    message: "Instruction text contains exfiltration language."
  },
  {
    phrase: "upload",
    severity: "elevated_review",
    code: "mutation_or_exfiltration_language",
    message: "Instruction text contains upload language."
  },
  {
    phrase: "send to external",
    severity: "elevated_review",
    code: "mutation_or_exfiltration_language",
    message: "Instruction text contains external send language."
  },
  {
    phrase: "read environment variables",
    severity: "elevated_review",
    code: "sensitive_access_language",
    message: "Instruction text mentions environment variable access."
  },
  {
    phrase: "api keys",
    severity: "elevated_review",
    code: "sensitive_access_language",
    message: "Instruction text mentions API keys."
  },
  {
    phrase: "secrets",
    severity: "elevated_review",
    code: "sensitive_access_language",
    message: "Instruction text mentions secrets."
  },
  {
    phrase: "tokens",
    severity: "elevated_review",
    code: "sensitive_access_language",
    message: "Instruction text mentions tokens."
  },
  {
    phrase: "delete files",
    severity: "elevated_review",
    code: "mutation_or_exfiltration_language",
    message: "Instruction text contains file deletion language."
  },
  {
    phrase: "overwrite",
    severity: "elevated_review",
    code: "mutation_or_exfiltration_language",
    message: "Instruction text contains overwrite language."
  },
  {
    phrase: "execute shell",
    severity: "elevated_review",
    code: "boundary_expanding_language",
    message: "Instruction text contains shell execution language."
  },
  {
    phrase: "install dependency",
    severity: "review",
    code: "boundary_expanding_language",
    message: "Instruction text contains dependency installation language."
  },
  {
    phrase: "background process",
    severity: "elevated_review",
    code: "boundary_expanding_language",
    message: "Instruction text contains background process language."
  },
  {
    phrase: "bypass policy",
    severity: "elevated_review",
    code: "hidden_tool_instruction",
    message: "Instruction text contains policy bypass language."
  },
  {
    phrase: "disable guardrails",
    severity: "elevated_review",
    code: "hidden_tool_instruction",
    message: "Instruction text contains guardrail disabling language."
  }
];

export async function inspectSkillPackage(inputPath: string, now = new Date()): Promise<InspectionResult> {
  const resolvedPath = path.resolve(inputPath);
  if (!(await isReadableDirectory(resolvedPath))) {
    throw new Error(`Unreadable Skill package path: ${inputPath}`);
  }

  const discovery = await discoverSkillSurfaces(resolvedPath);
  const parsed = await parseSurfaces(discovery.rootPath, discovery.scannedSurfaces, discovery.findings);
  const findings = sortFindings([
    ...parsed.findings,
    ...classifyParsedInspection(parsed),
    ...(await inspectExecutionSurface(parsed))
  ]);
  const verdict = deriveVerdict(findings);

  return buildInspectionResult({
    tool: {
      name: TOOL_NAME,
      version: TOOL_VERSION
    },
    inspectedPath: resolvedPath,
    timestamp: now.toISOString(),
    verdict,
    scannedSurfaces: parsed.scannedSurfaces,
    declaredSurfaces: parsed.declaredSurfaces,
    findings
  });
}

export function classifyParsedInspection(parsed: ParsedInspection): Finding[] {
  const findings: Finding[] = [];
  findings.push(...classifyShape(parsed));
  findings.push(...classifyDeclaredSurfaces(parsed.declaredSurfaces));
  findings.push(...classifyTextSurfaces(parsed));
  return sortFindings(findings);
}

export function deriveVerdict(findings: Finding[]): Verdict {
  if (findings.some((finding) => finding.severity === "elevated_review")) {
    return "elevated_review";
  }
  if (findings.some((finding) => finding.severity === "review")) {
    return "review";
  }
  return "no_findings";
}

function classifyShape(parsed: ParsedInspection): Finding[] {
  const findings: Finding[] = [];
  const hasSkillMd = parsed.scannedSurfaces.some((surface) => surface.path === "SKILL.md");
  const hasManifest = parsed.scannedSurfaces.some(
    (surface) => surface.kind === "manifest" || surface.kind === "package_manifest"
  );

  if (parsed.scannedSurfaces.length === 0) {
    findings.push({
      severity: "review",
      surface: "instruction",
      file: ".",
      code: "no_skill_surfaces_found",
      message: "No Skill package surfaces were found."
    });
    return findings;
  }

  if (!hasSkillMd) {
    findings.push({
      severity: "review",
      surface: "instruction",
      file: ".",
      code: "missing_primary_skill_surface",
      message: "No SKILL.md surface was found."
    });
  }

  if (!hasManifest) {
    findings.push({
      severity: "review",
      surface: "capability",
      file: ".",
      code: "missing_manifest_surface",
      message: "No Skill manifest declaration surface was found."
    });
  }

  return findings;
}

function classifyDeclaredSurfaces(declared: DeclaredSurfaces): Finding[] {
  const findings: Finding[] = [];

  for (const tool of declared.tools) {
    const matched = findTerm(tool, SUSPICIOUS_TOOL_TERMS);
    if (matched) {
      findings.push({
        severity: "elevated_review",
        surface: "capability",
        file: "declared-surface",
        code: "broad_tool",
        message: "Declared tool matches a broad command or transfer surface.",
        detail: `tool: ${tool}`,
        matchedText: matched
      });
    }
  }

  for (const permission of declared.permissions) {
    const elevated = findTerm(permission, ELEVATED_PERMISSIONS);
    const review = findTerm(permission, REVIEW_PERMISSIONS);
    if (elevated || review) {
      findings.push({
        severity: elevated ? "elevated_review" : "review",
        surface: "capability",
        file: "declared-surface",
        code: "broad_permission",
        message: "Declared permission matches a broad capability surface.",
        detail: `permission: ${permission}`,
        matchedText: elevated ?? review ?? permission
      });
    }
  }

  for (const domain of declared.allowedDomains) {
    const matched = findDomainTerm(domain);
    if (matched) {
      findings.push({
        severity: "review",
        surface: "capability",
        file: "declared-surface",
        code: "broad_domain",
        message: "Allowed domain declaration is broad.",
        detail: `allowed_domains includes ${JSON.stringify(domain)}`,
        matchedText: matched
      });
    }
  }

  for (const hook of declared.hooks) {
    const matched = findTerm(hook, HOOK_TERMS);
    if (matched) {
      findings.push({
        severity: "elevated_review",
        surface: "capability",
        file: "declared-surface",
        code: "command_hook",
        message: "Declared hook matches an admission or command hook signal.",
        detail: `hook: ${hook}`,
        matchedText: matched
      });
    }
  }

  return findings;
}

function classifyTextSurfaces(parsed: ParsedInspection): Finding[] {
  const findings: Finding[] = [];

  for (const surface of parsed.textSurfaces) {
    const lowerText = surface.text.toLowerCase();
    for (const signal of TEXT_SIGNALS) {
      if (!lowerText.includes(signal.phrase)) {
        continue;
      }

      findings.push({
        severity: signal.severity,
        surface: "instruction",
        file: surface.path,
        code: signal.code,
        message: signal.message,
        detail: `phrase matched: ${JSON.stringify(signal.phrase)}`,
        matchedText: signal.phrase
      });
    }
  }

  return findings;
}

function findTerm(value: string, terms: string[]): string | undefined {
  const normalized = value.toLowerCase();
  return terms.find((term) => normalized.includes(term));
}

function findDomainTerm(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  if (BROAD_DOMAIN_TERMS.includes(normalized)) {
    return normalized;
  }
  if (normalized.includes("*")) {
    return "*";
  }
  return undefined;
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
