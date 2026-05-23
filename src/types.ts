export const TOOL_NAME = "SkillGate";
export const TOOL_VERSION = "0.1.0";

export type Verdict = "no_findings" | "review" | "elevated_review";
export type FindingSeverity = "review" | "elevated_review";

export type SurfaceKind =
  | "instruction"
  | "manifest"
  | "documentation"
  | "reference"
  | "package_manifest";

export interface ScannedSurface {
  path: string;
  absolutePath: string;
  kind: SurfaceKind;
  reason: string;
  bytes: number;
}

export interface DeclaredSurfaces {
  tools: string[];
  capabilities: string[];
  permissions: string[];
  allowedDomains: string[];
  hooks: string[];
}

export interface TextSurface {
  path: string;
  kind: SurfaceKind;
  text: string;
}

export interface Finding {
  severity: FindingSeverity;
  file: string;
  code: string;
  message: string;
  detail?: string;
  matchedText?: string;
}

export interface ParsedInspection {
  rootPath: string;
  scannedSurfaces: ScannedSurface[];
  declaredSurfaces: DeclaredSurfaces;
  textSurfaces: TextSurface[];
  findings: Finding[];
}

export interface InspectionResult {
  tool: {
    name: typeof TOOL_NAME;
    version: typeof TOOL_VERSION;
  };
  inspectedPath: string;
  timestamp: string;
  verdict: Verdict;
  summary: ReportSummary;
  scannedSurfaces: Array<Omit<ScannedSurface, "absolutePath">>;
  declaredSurfaces: DeclaredSurfaces;
  findings: Finding[];
  limitations: string[];
}

export interface ReportSummary {
  scannedSurfaceCount: number;
  findingCount: number;
  reviewFindingCount: number;
  elevatedReviewFindingCount: number;
  declaredToolCount: number;
  declaredCapabilityCount: number;
  declaredPermissionCount: number;
  declaredDomainCount: number;
  declaredHookCount: number;
}

export const EMPTY_DECLARED_SURFACES: DeclaredSurfaces = {
  tools: [],
  capabilities: [],
  permissions: [],
  allowedDomains: [],
  hooks: []
};
