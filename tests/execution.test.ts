import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { inspectSkillPackage } from "../src/classifier.js";

const fixedDate = new Date("2026-05-23T00:00:00.000Z");

describe("execution surface intake", () => {
  it("reports package.json postinstall as an elevated install hook", async () => {
    const tempDir = await makeSkillPackage();
    await writeJson(path.join(tempDir, "package.json"), {
      scripts: {
        postinstall: "node scripts/setup.js"
      }
    });

    const report = await inspectSkillPackage(tempDir, fixedDate);

    expect(report.verdict).toBe("elevated_review");
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        surface: "execution",
        severity: "elevated_review",
        file: "package.json",
        code: "install_hook_present",
        matchedText: "postinstall"
      })
    );
  });

  it("reports declared executable bin entrypoints", async () => {
    const tempDir = await makeSkillPackage();
    await fs.mkdir(path.join(tempDir, "bin"));
    await fs.writeFile(path.join(tempDir, "bin", "runner"), "#!/usr/bin/env node\nconsole.log('runner');\n", "utf8");
    await writeJson(path.join(tempDir, "package.json"), {
      bin: {
        runner: "bin/runner"
      }
    });

    const report = await inspectSkillPackage(tempDir, fixedDate);

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        surface: "execution",
        file: "package.json",
        code: "declared_executable_entrypoint",
        matchedText: "runner"
      })
    );
  });

  it("reports executable-looking files under likely execution directories", async () => {
    const tempDir = await makeSkillPackage();
    await fs.mkdir(path.join(tempDir, "scripts"));
    await fs.writeFile(path.join(tempDir, "scripts", "run.sh"), "#!/bin/sh\necho run\n", "utf8");

    const report = await inspectSkillPackage(tempDir, fixedDate);

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        surface: "execution",
        file: "scripts/run.sh",
        code: "executable_file_present",
        matchedText: "#!"
      })
    );
  });

  it("reports shell/process execution patterns in code-like files", async () => {
    const tempDir = await makeSkillPackage();
    await fs.mkdir(path.join(tempDir, "scripts"));
    await fs.writeFile(
      path.join(tempDir, "scripts", "run.js"),
      "import { exec } from 'node:child_process';\nexec('true');\n",
      "utf8"
    );

    const report = await inspectSkillPackage(tempDir, fixedDate);

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        surface: "execution",
        file: "scripts/run.js",
        code: "shell_execution_surface"
      })
    );
  });

  it("reports network/download patterns in code-like files and package scripts", async () => {
    const tempDir = await makeSkillPackage();
    await fs.mkdir(path.join(tempDir, "scripts"));
    await fs.writeFile(path.join(tempDir, "scripts", "net.js"), "fetch('https://example.invalid');\n", "utf8");
    await writeJson(path.join(tempDir, "package.json"), {
      scripts: {
        sync: "curl https://example.invalid/file"
      }
    });

    const report = await inspectSkillPackage(tempDir, fixedDate);
    const networkFindings = report.findings.filter((finding) => finding.code === "network_execution_surface");

    expect(networkFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surface: "execution", file: "scripts/net.js", matchedText: "fetch(" }),
        expect.objectContaining({ surface: "execution", file: "package.json", matchedText: "curl" })
      ])
    );
  });

  it("reports dynamic code execution patterns in code-like files and package scripts", async () => {
    const tempDir = await makeSkillPackage();
    await fs.mkdir(path.join(tempDir, "scripts"));
    await fs.writeFile(path.join(tempDir, "scripts", "dynamic.js"), "const fn = new Function('return 1');\n", "utf8");
    await writeJson(path.join(tempDir, "package.json"), {
      scripts: {
        diagnose: "node -e \"eval('1')\""
      }
    });

    const report = await inspectSkillPackage(tempDir, fixedDate);
    const dynamicFindings = report.findings.filter((finding) => finding.code === "dynamic_code_execution_surface");

    expect(dynamicFindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ surface: "execution", file: "scripts/dynamic.js" }),
        expect.objectContaining({ surface: "execution", file: "package.json", matchedText: "node -e" })
      ])
    );
  });

  it("blocks and reports package-root escape for declared bin paths", async () => {
    const tempDir = await makeSkillPackage();
    const outsideFile = path.join(path.dirname(tempDir), "outside.js");
    await fs.writeFile(outsideFile, "eval('outside');\n", "utf8");
    await writeJson(path.join(tempDir, "package.json"), {
      bin: {
        escape: "../outside.js"
      }
    });

    const report = await inspectSkillPackage(tempDir, fixedDate);

    expect(report.findings).toContainEqual(
      expect.objectContaining({
        surface: "execution",
        file: "package.json",
        code: "package_root_escape"
      })
    );
    expect(report.findings).not.toContainEqual(
      expect.objectContaining({
        code: "dynamic_code_execution_surface",
        matchedText: "eval("
      })
    );
  });

  it("keeps JSON-serializable execution output deterministic", async () => {
    const tempDir = await makeSkillPackage();
    await fs.mkdir(path.join(tempDir, "scripts"));
    await fs.writeFile(path.join(tempDir, "scripts", "run.sh"), "#!/bin/sh\necho run\n", "utf8");

    const first = await inspectSkillPackage(tempDir, fixedDate);
    const second = await inspectSkillPackage(tempDir, fixedDate);

    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
    expect(first.summary.executionFindingCount).toBeGreaterThan(0);
    expect(first.findings.some((finding) => finding.surface === "execution")).toBe(true);
  });
});

async function makeSkillPackage(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillgate-execution-"));
  await fs.writeFile(path.join(tempDir, "SKILL.md"), "# Execution Intake Test\n", "utf8");
  await writeJson(path.join(tempDir, "skill.json"), {
    name: "execution-intake-test",
    capabilities: ["local_fixture"]
  });
  return tempDir;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
