import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectSkillPackage } from "../src/classifier.js";
import { fixturePath } from "./helpers.js";

const fixedDate = new Date("2026-05-23T00:00:00.000Z");

describe("classifier", () => {
  it("does not elevate the benign fixture", async () => {
    const report = await inspectSkillPackage(fixturePath("benign-skill"), fixedDate);

    expect(["no_findings", "review"]).toContain(report.verdict);
    expect(report.verdict).not.toBe("elevated_review");
  });

  it("elevates the suspicious fixture", async () => {
    const report = await inspectSkillPackage(fixturePath("suspicious-skill"), fixedDate);

    expect(report.verdict).toBe("elevated_review");
  });

  it("creates findings for suspicious permissions, tools, hooks, and domains", async () => {
    const report = await inspectSkillPackage(fixturePath("suspicious-skill"), fixedDate);
    const codes = report.findings.map((finding) => finding.code);

    expect(codes).toContain("broad_tool");
    expect(codes).toContain("broad_permission");
    expect(codes).toContain("command_hook");
    expect(codes).toContain("broad_domain");
  });

  it("keeps finding ordering deterministic", async () => {
    const first = await inspectSkillPackage(fixturePath("suspicious-skill"), fixedDate);
    const second = await inspectSkillPackage(fixturePath("suspicious-skill"), fixedDate);

    expect(first.findings).toEqual(second.findings);
  });

  it("reports executable-looking hooks and scripts without running them", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillgate-no-exec-"));
    const markerPath = path.join(tempDir, "executed-marker.txt");
    const markerScript = `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(markerPath)}, "executed");\n`;

    await fs.writeFile(path.join(tempDir, "SKILL.md"), "# No Execution Test\n", "utf8");
    await fs.writeFile(path.join(tempDir, "marker.js"), markerScript, "utf8");
    await fs.writeFile(
      path.join(tempDir, "skill.json"),
      JSON.stringify({
        name: "no-execution-test",
        tools: ["shell"],
        hooks: {
          on_admit: "node marker.js"
        }
      }),
      "utf8"
    );
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({
        name: "no-execution-test",
        skill: {
          commands: ["node marker.js"]
        },
        scripts: {
          postinstall: "node marker.js"
        }
      }),
      "utf8"
    );

    const report = await inspectSkillPackage(tempDir, fixedDate);

    expect(report.declaredSurfaces.tools).toContain("node marker.js");
    expect(report.declaredSurfaces.hooks).toEqual(
      expect.arrayContaining(["on_admit: node marker.js", "postinstall: node marker.js"])
    );
    expect(report.findings.map((finding) => finding.code)).toContain("command_hook");
    await expect(fs.access(markerPath)).rejects.toThrow();
  });
});
