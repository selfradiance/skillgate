# SkillGate Project Context

## Current Claim

A local deterministic CLI can inspect one local agent Skill package before harness admission and produce a bounded instruction/capability intake report without executing, installing, or trusting the Skill.

## Scope Boundaries

- Object under review: one local Skill package directory.
- Core surfaces: `SKILL.md`, `skill.json`, `manifest.json`, Skill-like `package.json`, package `README.md`, and explicit docs/examples reference surfaces.
- No Skill execution.
- No Skill installation.
- No network calls in CLI behavior.
- No LLM in the critical path.
- No MCP integration.
- No AgentGate integration.
- No malware detection.
- No sandboxing.
- No semantic trust judgment.
- No broad repo analysis claim.
- Discovered surfaces must remain within the inspected Skill package root after realpath resolution.

## Repo Location

- Local path: `/Users/jamestoole/Desktop/projects/skillgate`
- GitHub URL: `https://github.com/selfradiance/skillgate`

## Commands

- Install: `npm install`
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Benign demo: `npm run demo:benign`
- Suspicious demo: `npm run demo:suspicious`

## v0.1.1 Status

Hardening pass for package-root containment and bounded manifest label reporting, without expanding the v0.1.0 proof scope.

## Relationship To Nearby Projects

- `governed-repo-intake`: repo/document instruction intake before an agent reads a codebase.
- `SkillGate`: installable Skill/capability bundle admission before an agent gains reusable new behavior or tool surface.
- `ContextGate`: adjacent context admission idea, separate from Skill package intake.
- `mcp-config-inventory`: MCP configuration inventory, separate from Skill package intake.
- `ActionProof`: action evidence and traceability, downstream of admission.
- `MCP Firewall`: MCP tool boundary control, separate from local Skill package inspection.
- `AgentGate`: broader agent admission/control concept. SkillGate v0.1.1 does not integrate with it.

## Future Notes

- Add more manifest dialect examples only when they remain Skill-package-specific.
- Keep rule output explicit enough that a reviewer can see why a label was assigned.
- Avoid replacing deterministic findings with semantic claims.
