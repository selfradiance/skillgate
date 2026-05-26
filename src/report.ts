import type {
  DeclaredSurfaces,
  Finding,
  InspectionResult,
  ReportSummary,
  ScannedSurface,
  Verdict
} from "./types.js";

export const LIMITATIONS = [
  "This did not execute the Skill.",
  "This did not install the Skill.",
  "This is not malware detection.",
  "This does not prove the Skill is safe."
];

export interface BuildInspectionResultInput {
  tool: InspectionResult["tool"];
  inspectedPath: string;
  timestamp: string;
  verdict: Verdict;
  scannedSurfaces: ScannedSurface[];
  declaredSurfaces: DeclaredSurfaces;
  findings: Finding[];
}

export function buildInspectionResult(input: BuildInspectionResultInput): InspectionResult {
  return {
    tool: input.tool,
    inspectedPath: input.inspectedPath,
    timestamp: input.timestamp,
    verdict: input.verdict,
    summary: buildSummary(input.scannedSurfaces, input.declaredSurfaces, input.findings),
    scannedSurfaces: input.scannedSurfaces.map(({ absolutePath: _absolutePath, ...surface }) => surface),
    declaredSurfaces: input.declaredSurfaces,
    findings: input.findings,
    limitations: LIMITATIONS
  };
}

export function renderHumanReport(report: InspectionResult): string {
  const lines: string[] = [];
  lines.push("SkillGate Intake Report");
  lines.push(`Path: ${report.inspectedPath}`);
  lines.push(`Verdict: ${report.verdict}`);
  lines.push("");
  lines.push("Scanned surfaces:");
  lines.push(...renderList(report.scannedSurfaces.map((surface) => surface.path)));
  lines.push("");
  lines.push("Declared capability surface:");
  lines.push(`- tools: ${renderInlineList(report.declaredSurfaces.tools)}`);
  lines.push(`- capabilities: ${renderInlineList(report.declaredSurfaces.capabilities)}`);
  lines.push(`- permissions: ${renderInlineList(report.declaredSurfaces.permissions)}`);
  lines.push(`- domains: ${renderInlineList(report.declaredSurfaces.allowedDomains)}`);
  lines.push(`- hooks: ${renderInlineList(report.declaredSurfaces.hooks)}`);
  lines.push("");
  lines.push("Findings:");
  if (report.findings.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...renderFindingsForSurface(report.findings, "instruction", "Instruction findings"));
    lines.push(...renderFindingsForSurface(report.findings, "capability", "Capability findings"));
    lines.push(...renderFindingsForSurface(report.findings, "execution", "Execution findings"));
  }
  lines.push("");
  lines.push("Limitations:");
  lines.push(...report.limitations.map((limitation) => `- ${limitation}`));
  return `${lines.join("\n")}\n`;
}

function buildSummary(
  scannedSurfaces: ScannedSurface[],
  declaredSurfaces: DeclaredSurfaces,
  findings: Finding[]
): ReportSummary {
  return {
    scannedSurfaceCount: scannedSurfaces.length,
    findingCount: findings.length,
    instructionFindingCount: findings.filter((finding) => finding.surface === "instruction").length,
    capabilityFindingCount: findings.filter((finding) => finding.surface === "capability").length,
    executionFindingCount: findings.filter((finding) => finding.surface === "execution").length,
    reviewFindingCount: findings.filter((finding) => finding.severity === "review").length,
    elevatedReviewFindingCount: findings.filter((finding) => finding.severity === "elevated_review").length,
    declaredToolCount: declaredSurfaces.tools.length,
    declaredCapabilityCount: declaredSurfaces.capabilities.length,
    declaredPermissionCount: declaredSurfaces.permissions.length,
    declaredDomainCount: declaredSurfaces.allowedDomains.length,
    declaredHookCount: declaredSurfaces.hooks.length
  };
}

function renderFindingsForSurface(
  findings: Finding[],
  surface: Finding["surface"],
  title: string
): string[] {
  const scopedFindings = findings.filter((finding) => finding.surface === surface);
  if (scopedFindings.length === 0) {
    return [];
  }

  const lines = [`${title}:`];
  for (const finding of scopedFindings) {
    const parts = [`- [${finding.severity}] ${finding.file}: ${finding.code}`, finding.message];
    if (finding.detail) {
      parts.push(finding.detail);
    }
    lines.push(parts.join(" - "));
  }
  return lines;
}

function renderList(values: string[]): string[] {
  if (values.length === 0) {
    return ["- none"];
  }
  return values.map((value) => `- ${value}`);
}

function renderInlineList(values: string[]): string {
  if (values.length === 0) {
    return "none";
  }
  return values.join(", ");
}
