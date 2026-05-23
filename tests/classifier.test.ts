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
});
