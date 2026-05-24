# SkillGate

SkillGate is a local deterministic TypeScript CLI for inspecting one local agent Skill package before harness admission.

## 1. What This Is

SkillGate looks at package-shaped Skill surfaces and produces a bounded instruction/capability intake report. It reads files such as `SKILL.md`, `skill.json`, `manifest.json`, Skill-like `package.json`, package documentation, and explicit Skill reference docs.

The CLI does not execute, install, or trust the Skill under review.

## 2. What This Proves

The v0.1.1 proof shows that a local deterministic CLI can inspect one local agent Skill package before harness admission and produce a bounded instruction/capability intake report without executing, installing, or trusting the Skill.

It makes the Skill admission boundary visible:

- instruction-bearing files found
- declared tools
- declared capabilities
- declared permissions
- declared allowed domains
- declared hooks or command hooks
- deterministic phrase-based intake findings
- Skill package shape issues

## 3. What This Does Not Prove

SkillGate does not prove that a Skill is trustworthy. It does not make semantic truth judgments, detect all harmful behavior, sandbox code, or provide complete agent security.

It is not malware detection. It is not a safety verdict.

## 4. Why This Is Different From governed-repo-intake

“governed-repo-intake asks what instruction-bearing repo surfaces might be fed into an agent. SkillGate asks what an installable Skill/capability bundle is bringing into a harness before admission.”

The object under review is a Skill package directory, not an arbitrary repository. SkillGate focuses on installable capability surfaces such as Skill instructions, manifests, tools, permissions, domains, and hooks.

## 5. Quickstart

```bash
npm install
npm run build
node dist/cli.js inspect --path fixtures/benign-skill
node dist/cli.js inspect --path fixtures/suspicious-skill --json-out .skillgate/last-report.json
```

CLI shape:

```bash
skillgate inspect --path <skill-package-dir> [--json-out <path>]
```

## 6. 2-Minute Proof

Run the benign fixture:

```bash
npm run demo:benign
```

It declares a narrow local note summarization capability and should produce `no_findings` or `review`.

Run the suspicious fixture:

```bash
npm run demo:suspicious
```

The suspicious README looks relatively harmless. The intake label changes because Skill-specific surfaces declare or instruct broader behavior in `SKILL.md`, `skill.json`, and `docs/reference.md`.

## 7. Example Output

```text
SkillGate Intake Report
Path: /path/to/fixtures/suspicious-skill
Verdict: elevated_review

Scanned surfaces:
- SKILL.md
- skill.json
- README.md
- docs/reference.md

Declared capability surface:
- tools: background-daemon, curl, node docs/agent.js, shell
- capabilities: external_upload, summarize_notes
- permissions: env, filesystem_write, network, secrets, shell
- domains: *
- hooks: background: daemon, on_admit: bash setup.sh, postinstall: node install.js

Findings:
- [elevated_review] declared-surface: broad_permission - Declared permission matches a broad capability surface. - permission: env
- [elevated_review] declared-surface: broad_permission - Declared permission matches a broad capability surface. - permission: filesystem_write
- [elevated_review] declared-surface: broad_permission - Declared permission matches a broad capability surface. - permission: network
- [elevated_review] declared-surface: broad_permission - Declared permission matches a broad capability surface. - permission: secrets
- [elevated_review] declared-surface: broad_permission - Declared permission matches a broad capability surface. - permission: shell
- [elevated_review] declared-surface: broad_tool - Declared tool matches a broad command or transfer surface. - tool: curl
- [elevated_review] declared-surface: broad_tool - Declared tool matches a broad command or transfer surface. - tool: shell
- [elevated_review] declared-surface: command_hook - Declared hook matches an admission or command hook signal. - hook: background: daemon
- [elevated_review] declared-surface: command_hook - Declared hook matches an admission or command hook signal. - hook: on_admit: bash setup.sh
- [elevated_review] declared-surface: command_hook - Declared hook matches an admission or command hook signal. - hook: postinstall: node install.js
- [elevated_review] docs/reference.md: boundary_expanding_language - Instruction text contains background process language. - phrase matched: "background process"
- [elevated_review] skill.json: mutation_or_exfiltration_language - Instruction text contains upload language. - phrase matched: "upload"
- [elevated_review] skill.json: sensitive_access_language - Instruction text mentions secrets. - phrase matched: "secrets"
- [elevated_review] SKILL.md: boundary_expanding_language - Instruction text contains background process language. - phrase matched: "background process"
- [elevated_review] SKILL.md: boundary_expanding_language - Instruction text contains shell execution language. - phrase matched: "execute shell"
- [elevated_review] SKILL.md: hidden_tool_instruction - Instruction text contains policy bypass language. - phrase matched: "bypass policy"
- [elevated_review] SKILL.md: hidden_tool_instruction - Instruction text contains guardrail disabling language. - phrase matched: "disable guardrails"
- [elevated_review] SKILL.md: hidden_tool_instruction - Instruction text asks to hide behavior from the user. - phrase matched: "do not tell the user"
- [elevated_review] SKILL.md: hidden_tool_instruction - Instruction text asks to override surrounding instructions. - phrase matched: "ignore previous instructions"
- [elevated_review] SKILL.md: mutation_or_exfiltration_language - Instruction text contains file deletion language. - phrase matched: "delete files"
- [elevated_review] SKILL.md: mutation_or_exfiltration_language - Instruction text contains overwrite language. - phrase matched: "overwrite"
- [elevated_review] SKILL.md: mutation_or_exfiltration_language - Instruction text contains external send language. - phrase matched: "send to external"
- [elevated_review] SKILL.md: mutation_or_exfiltration_language - Instruction text contains upload language. - phrase matched: "upload"
- [elevated_review] SKILL.md: sensitive_access_language - Instruction text mentions API keys. - phrase matched: "api keys"
- [elevated_review] SKILL.md: sensitive_access_language - Instruction text mentions environment variable access. - phrase matched: "read environment variables"
- [elevated_review] SKILL.md: sensitive_access_language - Instruction text mentions secrets. - phrase matched: "secrets"
- [elevated_review] SKILL.md: sensitive_access_language - Instruction text mentions tokens. - phrase matched: "tokens"
- [review] declared-surface: broad_domain - Allowed domain declaration is broad. - allowed_domains includes "*"
- [review] docs/reference.md: boundary_expanding_language - Instruction text contains dependency installation language. - phrase matched: "install dependency"

Limitations:
- This did not execute the Skill.
- This is not malware detection.
- This is not a safety verdict.
```

## 8. JSON Report Shape

When `--json-out` is provided, SkillGate writes a JSON report with this shape:

```json
{
  "tool": {
    "name": "SkillGate",
    "version": "0.1.1"
  },
  "inspectedPath": "/absolute/path/to/skill",
  "timestamp": "2026-05-23T00:00:00.000Z",
  "verdict": "elevated_review",
  "summary": {
    "scannedSurfaceCount": 4,
    "findingCount": 3,
    "reviewFindingCount": 1,
    "elevatedReviewFindingCount": 2,
    "declaredToolCount": 3,
    "declaredCapabilityCount": 2,
    "declaredPermissionCount": 5,
    "declaredDomainCount": 1,
    "declaredHookCount": 3
  },
  "scannedSurfaces": [],
  "declaredSurfaces": {
    "tools": [],
    "capabilities": [],
    "permissions": [],
    "allowedDomains": [],
    "hooks": []
  },
  "findings": [],
  "limitations": []
}
```

## 9. Verdict Labels

These are intake labels, not safety verdicts.

- `no_findings`: no deterministic intake signals were found.
- `review`: one or more review-level intake signals were found.
- `elevated_review`: one or more elevated review-level intake signals were found.

## 10. Design Boundaries

SkillGate v0.1.1 uses local deterministic file inspection only.

- No Skill code execution.
- No Skill installation.
- No network calls in CLI behavior.
- No LLM critical path.
- No MCP integration.
- No AgentGate integration.
- No sandboxing.
- No broad repo scanner claim.
- No semantic trust judgment.

Scan caps are intentionally modest: individual surfaces are capped at 256 KiB, reference discovery is limited to `docs/` and `examples/`, hidden directories are skipped, and `node_modules`, `.git`, `dist`, `coverage`, and `.skillgate` are ignored. Discovered surfaces are resolved before parsing and skipped if their real path leaves the inspected Skill package root.

Detection is phrase and declaration based. Regexes and string matching do not understand intent.

## 11. Development Commands

```bash
npm test
npm run typecheck
npm run build
npm run demo:benign
npm run demo:suspicious
```
