import { promises as fs } from "node:fs";
import type {
  DeclaredSurfaces,
  Finding,
  ParsedInspection,
  ScannedSurface,
  TextSurface
} from "./types.js";
import { EMPTY_DECLARED_SURFACES } from "./types.js";
import { MAX_SURFACE_BYTES } from "./discovery.js";
import { ManifestObjectSchema, type ManifestObject } from "./schemas.js";

export async function parseSurfaces(
  rootPath: string,
  scannedSurfaces: ScannedSurface[],
  discoveryFindings: Finding[] = []
): Promise<ParsedInspection> {
  const findings: Finding[] = [...discoveryFindings];
  const textSurfaces: TextSurface[] = [];
  const declaredSurfaces: DeclaredSurfaces = cloneDeclaredSurfaces(EMPTY_DECLARED_SURFACES);

  for (const surface of scannedSurfaces) {
    if (surface.bytes > MAX_SURFACE_BYTES) {
      findings.push({
        severity: "review",
        surface: surfaceKindToFindingSurface(surface.kind),
        file: surface.path,
        code: "surface_too_large",
        message: "Surface exceeds the v0.2.0 scan cap and was not parsed.",
        detail: `${surface.bytes} bytes`
      });
      continue;
    }

    const text = await fs.readFile(surface.absolutePath, "utf8");
    textSurfaces.push({
      path: surface.path,
      kind: surface.kind,
      text
    });

    if (surface.kind === "manifest" || surface.kind === "package_manifest") {
      const parsed = parseManifestText(surface.path, text, findings);
      if (parsed) {
        mergeDeclaredSurfaces(declaredSurfaces, extractDeclaredSurfaces(parsed));
      }
    }
  }

  sortDeclaredSurfaces(declaredSurfaces);

  return {
    rootPath,
    scannedSurfaces,
    declaredSurfaces,
    textSurfaces,
    findings: sortFindings(findings)
  };
}

function parseManifestText(file: string, text: string, findings: Finding[]): ManifestObject | undefined {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    findings.push({
      severity: "review",
      surface: "capability",
      file,
      code: "malformed_manifest",
      message: "Manifest JSON could not be parsed.",
      detail: error instanceof Error ? error.message : "unknown JSON parse error"
    });
    return undefined;
  }

  const result = ManifestObjectSchema.safeParse(json);
  if (!result.success) {
    findings.push({
      severity: "review",
      surface: "capability",
      file,
      code: "manifest_shape_issue",
      message: "Manifest JSON is not an object-shaped Skill declaration surface.",
      detail: result.error.issues.map((issue) => issue.message).join("; ")
    });
    return undefined;
  }

  return result.data;
}

function surfaceKindToFindingSurface(kind: ScannedSurface["kind"]): Finding["surface"] {
  if (kind === "instruction" || kind === "documentation" || kind === "reference") {
    return "instruction";
  }
  return "capability";
}

function extractDeclaredSurfaces(manifest: ManifestObject): DeclaredSurfaces {
  const declared = cloneDeclaredSurfaces(EMPTY_DECLARED_SURFACES);
  const nestedSkill = asRecord(manifest.skill);

  pushAll(declared.tools, collectLabels(manifest.tools));
  pushAll(declared.tools, collectLabels(manifest.commands));
  pushAll(declared.capabilities, collectLabels(manifest.capabilities));
  pushAll(declared.permissions, collectLabels(manifest.permissions));
  pushAll(declared.allowedDomains, collectLabels(manifest.allowed_domains));
  pushAll(declared.allowedDomains, collectLabels(manifest.allowedDomains));
  pushAll(declared.allowedDomains, collectLabels(manifest.domains));
  pushAll(declared.hooks, collectHookLabels(manifest.hooks));
  pushAll(declared.hooks, collectHookLabels(manifest.command_hooks));
  pushAll(declared.hooks, collectHookLabels(manifest.commandHooks));

  if (nestedSkill) {
    pushAll(declared.tools, collectLabels(nestedSkill.tools));
    pushAll(declared.tools, collectLabels(nestedSkill.commands));
    pushAll(declared.capabilities, collectLabels(nestedSkill.capabilities));
    pushAll(declared.permissions, collectLabels(nestedSkill.permissions));
    pushAll(declared.allowedDomains, collectLabels(nestedSkill.allowed_domains));
    pushAll(declared.allowedDomains, collectLabels(nestedSkill.allowedDomains));
    pushAll(declared.allowedDomains, collectLabels(nestedSkill.domains));
    pushAll(declared.hooks, collectHookLabels(nestedSkill.hooks));
    pushAll(declared.hooks, collectHookLabels(nestedSkill.command_hooks));
    pushAll(declared.hooks, collectHookLabels(nestedSkill.commandHooks));
  }

  const scripts = asRecord(manifest.scripts);
  if (scripts) {
    for (const hookName of ["preinstall", "postinstall", "prepare"]) {
      const script = scripts[hookName];
      if (typeof script === "string") {
        declared.hooks.push(`${hookName}: ${script}`);
      }
    }
  }

  sortDeclaredSurfaces(declared);
  return declared;
}

function collectLabels(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectLabels(item));
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const labels: string[] = [];
  for (const key of ["name", "id", "type", "tool", "command", "permission", "scope", "domain", "url", "capability", "action"]) {
    const nested = record[key];
    if (typeof nested === "string") {
      labels.push(nested);
    }
  }

  return labels;
}

function collectHookLabels(value: unknown): string[] {
  if (typeof value === "string" || Array.isArray(value)) {
    return collectLabels(value);
  }

  const record = asRecord(value);
  if (!record) {
    return [];
  }

  const labels: string[] = [];
  for (const [key, nested] of Object.entries(record)) {
    if (typeof nested === "string") {
      labels.push(`${key}: ${nested}`);
    } else {
      labels.push(key);
      labels.push(...collectLabels(nested));
    }
  }

  return labels;
}

function mergeDeclaredSurfaces(target: DeclaredSurfaces, source: DeclaredSurfaces): void {
  pushAll(target.tools, source.tools);
  pushAll(target.capabilities, source.capabilities);
  pushAll(target.permissions, source.permissions);
  pushAll(target.allowedDomains, source.allowedDomains);
  pushAll(target.hooks, source.hooks);
  sortDeclaredSurfaces(target);
}

function pushAll(target: string[], values: string[]): void {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      target.push(trimmed);
    }
  }
}

function sortDeclaredSurfaces(declared: DeclaredSurfaces): void {
  declared.tools = uniqueSorted(declared.tools);
  declared.capabilities = uniqueSorted(declared.capabilities);
  declared.permissions = uniqueSorted(declared.permissions);
  declared.allowedDomains = uniqueSorted(declared.allowedDomains);
  declared.hooks = uniqueSorted(declared.hooks);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function cloneDeclaredSurfaces(value: DeclaredSurfaces): DeclaredSurfaces {
  return {
    tools: [...value.tools],
    capabilities: [...value.capabilities],
    permissions: [...value.permissions],
    allowedDomains: [...value.allowedDomains],
    hooks: [...value.hooks]
  };
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    return (
      a.file.localeCompare(b.file) ||
      a.surface.localeCompare(b.surface) ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message) ||
      (a.detail ?? "").localeCompare(b.detail ?? "") ||
      (a.matchedText ?? "").localeCompare(b.matchedText ?? "") ||
      severityRank(a.severity) - severityRank(b.severity)
    );
  });
}

function severityRank(severity: string): number {
  return severity === "elevated_review" ? 0 : 1;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}
