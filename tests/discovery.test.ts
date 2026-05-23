import { describe, expect, it } from "vitest";
import { discoverSkillSurfaces } from "../src/discovery.js";
import { fixturePath } from "./helpers.js";

describe("discovery", () => {
  it("discovers SKILL.md as a first-class Skill surface", async () => {
    const result = await discoverSkillSurfaces(fixturePath("benign-skill"));
    const skillSurface = result.scannedSurfaces.find((surface) => surface.path === "SKILL.md");

    expect(skillSurface).toMatchObject({
      kind: "instruction",
      reason: "primary Skill instruction surface"
    });
  });

  it("returns deterministic surface ordering", async () => {
    const first = await discoverSkillSurfaces(fixturePath("suspicious-skill"));
    const second = await discoverSkillSurfaces(fixturePath("suspicious-skill"));

    expect(first.scannedSurfaces.map((surface) => surface.path)).toEqual(
      second.scannedSurfaces.map((surface) => surface.path)
    );
    expect(first.scannedSurfaces.map((surface) => surface.path)).toEqual([
      "SKILL.md",
      "skill.json",
      "README.md",
      "docs/reference.md",
    ]);
  });
});
