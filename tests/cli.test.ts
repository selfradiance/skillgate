import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";
import { fixturePath, repoRoot } from "./helpers.js";

function makeIo(cwd = repoRoot): CliIo & { stdoutText: () => string; stderrText: () => string } {
  let stdout = "";
  let stderr = "";
  return {
    cwd,
    stdout: {
      write(chunk: string | Uint8Array): boolean {
        stdout += chunk.toString();
        return true;
      }
    },
    stderr: {
      write(chunk: string | Uint8Array): boolean {
        stderr += chunk.toString();
        return true;
      }
    },
    stdoutText: () => stdout,
    stderrText: () => stderr
  };
}

describe("cli", () => {
  it("--json-out writes valid JSON", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillgate-cli-"));
    const jsonOut = path.join(tempDir, "report.json");
    const io = makeIo();

    const code = await runCli(["inspect", "--path", fixturePath("suspicious-skill"), "--json-out", jsonOut], io);
    const raw = await fs.readFile(jsonOut, "utf8");
    const report = JSON.parse(raw) as { verdict: string; tool: { name: string } };

    expect(code).toBe(0);
    expect(report.tool.name).toBe("SkillGate");
    expect(report.verdict).toBe("elevated_review");
    expect(io.stdoutText()).toContain("SkillGate Intake Report");
  });

  it("does not echo generic manifest value fields in terminal or JSON output", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "skillgate-value-"));
    const jsonOut = path.join(tempDir, "report.json");
    const secretLikeValue = "sk-test-secret-value";
    const io = makeIo();

    await fs.writeFile(path.join(tempDir, "SKILL.md"), "# Value Echo Test\n", "utf8");
    await fs.writeFile(
      path.join(tempDir, "skill.json"),
      JSON.stringify({ name: "value-echo-test", permissions: [{ value: secretLikeValue }] }),
      "utf8"
    );

    const code = await runCli(["inspect", "--path", tempDir, "--json-out", jsonOut], io);
    const raw = await fs.readFile(jsonOut, "utf8");

    expect(code).toBe(0);
    expect(io.stdoutText()).not.toContain(secretLikeValue);
    expect(raw).not.toContain(secretLikeValue);
  });

  it("invalid path exits nonzero", async () => {
    const io = makeIo();
    const code = await runCli(["inspect", "--path", path.join(repoRoot, "missing-skill")], io);

    expect(code).toBe(1);
    expect(io.stderrText()).toContain("Unreadable Skill package path");
  });
});
