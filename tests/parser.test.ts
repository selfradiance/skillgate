import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { discoverSkillSurfaces } from "../src/discovery.js";
import { parseSurfaces } from "../src/parser.js";
import { fixturePath } from "./helpers.js";

describe("parser", () => {
  it("parses skill.json declarations", async () => {
    const discovery = await discoverSkillSurfaces(fixturePath("suspicious-skill"));
    const parsed = await parseSurfaces(discovery.rootPath, discovery.scannedSurfaces, discovery.findings);

    expect(parsed.declaredSurfaces.tools).toContain("shell");
    expect(parsed.declaredSurfaces.permissions).toContain("filesystem_write");
    expect(parsed.declaredSurfaces.allowedDomains).toEqual(["*"]);
    expect(parsed.declaredSurfaces.hooks).toContain("postinstall: node install.js");
  });

  it("handles malformed manifest JSON as a finding", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillgate-malformed-"));
    await fs.writeFile(path.join(tempDir, "SKILL.md"), "# Temp Skill\n", "utf8");
    await fs.writeFile(path.join(tempDir, "skill.json"), "{ not json", "utf8");

    const discovery = await discoverSkillSurfaces(tempDir);
    const parsed = await parseSurfaces(discovery.rootPath, discovery.scannedSurfaces, discovery.findings);

    expect(parsed.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "review",
          file: "skill.json",
          code: "malformed_manifest"
        })
      ])
    );
  });
});
