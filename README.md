# SkillGate

SkillGate is a local deterministic TypeScript CLI for inspecting one local agent Skill package before harness admission.

## 1. What This Is

SkillGate looks at package-shaped Skill surfaces and produces a bounded intake report. It reads files such as `SKILL.md`, `skill.json`, `manifest.json`, Skill-like `package.json`, package documentation, explicit Skill reference docs, and a narrow set of local execution-surface signals.

The CLI does not execute, install, or trust the Skill under review.

## 2. What This Proves

The v0.2.0 proof shows that a local deterministic CLI can inspect one local agent Skill package before harness admission and report the instruction/capability surface plus the discoverable execution surface the Skill would introduce, without executing, installing, or trusting the Skill.

It makes the Skill admission boundary visible:

- instruction-bearing files found
- declared tools
- declared capabilities
- declared permissions
- declared allowed domains
- declared hooks or command hooks
- package scripts and install hooks
- declared executable entrypoints
- executable-looking files in likely execution directories
- bounded shell/process, network/download, and dynamic-code execution patterns in code-like files
- deterministic phrase-based intake findings
- Skill package shape issues

In v0.2.0, “execution surface” means package scripts, executable files, declared command entrypoints, symlinks, and bounded code patterns suggesting shell/process execution, network/download behavior, or dynamic code execution.

## 3. What This Does Not Prove

SkillGate does not prove that a Skill is trustworthy. It does not make semantic truth judgments, detect all harmful behavior, sandbox code, or provide complete agent security.

SkillGate does not execute Skills. SkillGate does not install Skills. SkillGate does not call the network. SkillGate does not use an LLM in the critical path.

It does not prove malware detection. It does not prove a Skill is safe. It only reports bounded, deterministic intake findings from local package contents.

## 4. Why This Is Different From governed-repo-intake

“governed-repo-intake asks what instruction-bearing repo surfaces might be fed into an agent. SkillGate asks what an installable Skill/capability bundle is bringing into a harness before admission.”

The object under review is a Skill package directory, not an arbitrary repository. SkillGate focuses on installable capability surfaces such as Skill instructions, manifests, tools, permissions, domains, and hooks.

The v0.2.0 execution-surface pass stays within that same object. It is not a general repository scanner and does not inspect unrelated dependency trees or execute package tooling.

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

The suspicious README looks relatively harmless. The intake label changes because Skill-specific surfaces declare or instruct broader behavior in `SKILL.md`, `skill.json`, `docs/reference.md`, and the package execution surface.

## 7. Example Output

```text
SkillGate Intake Report
Path: /path/to/fixtures/suspicious-skill
Verdict: elevated_review

Scanned surfaces:
- SKILL.md
- skill.json
- package.json
- README.md
- docs/reference.md

Declared capability surface:
- tools: background-daemon, curl, node docs/agent.js, shell
- capabilities: external_upload, summarize_notes
- permissions: env, filesystem_write, network, secrets, shell
- domains: *
- hooks: background: daemon, on_admit: bash setup.sh, postinstall: node install.js, postinstall: node scripts/setup.js

Findings:
Instruction findings:
- [elevated_review] SKILL.md: boundary_expanding_language - Instruction text contains background process language. - phrase matched: "background process"
- [elevated_review] SKILL.md: hidden_tool_instruction - Instruction text asks to override surrounding instructions. - phrase matched: "ignore previous instructions"
Capability findings:
- [elevated_review] declared-surface: broad_permission - Declared permission matches a broad capability surface. - permission: env
- [elevated_review] declared-surface: broad_tool - Declared tool matches a broad command or transfer surface. - tool: curl
- [elevated_review] declared-surface: command_hook - Declared hook matches an admission or command hook signal. - hook: background: daemon
- [review] declared-surface: broad_domain - Allowed domain declaration is broad. - allowed_domains includes "*"
Execution findings:
- [elevated_review] bin/notes-helper: executable_file_present - Likely execution directory contains an executable-looking file. - shebang present
- [elevated_review] package.json: declared_executable_entrypoint - package.json declares an executable command entrypoint. - bin notes-helper: bin/notes-helper
- [elevated_review] package.json: install_hook_present - package.json declares an install or publication lifecycle hook. - script: postinstall
- [elevated_review] package.json: network_execution_surface - Package script contains an obvious network or transfer token. - script: sync; pattern matched: curl
- [elevated_review] scripts/setup.js: shell_execution_surface - Code-like file contains a shell or process execution pattern. - code pattern; pattern matched: child_process

Limitations:
- This did not execute the Skill.
- This did not install the Skill.
- This is not malware detection.
- This does not prove the Skill is safe.
```

## 8. JSON Report Shape

When `--json-out` is provided, SkillGate writes a JSON report with this shape:

```json
{
  "tool": {
    "name": "SkillGate",
    "version": "0.2.0"
  },
  "inspectedPath": "/absolute/path/to/skill",
  "timestamp": "2026-05-23T00:00:00.000Z",
  "verdict": "elevated_review",
  "summary": {
    "scannedSurfaceCount": 5,
    "findingCount": 3,
    "instructionFindingCount": 1,
    "capabilityFindingCount": 1,
    "executionFindingCount": 1,
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
  "findings": [
    {
      "severity": "elevated_review",
      "surface": "execution",
      "file": "package.json",
      "code": "install_hook_present",
      "message": "package.json declares an install or publication lifecycle hook.",
      "detail": "script: postinstall",
      "matchedText": "postinstall"
    }
  ],
  "limitations": [
    "This did not execute the Skill.",
    "This did not install the Skill.",
    "This is not malware detection.",
    "This does not prove the Skill is safe."
  ]
}
```

## 9. Verdict Labels

These are intake labels, not safety verdicts.

- `no_findings`: no deterministic intake signals were found.
- `review`: one or more review-level intake signals were found.
- `elevated_review`: one or more elevated review-level intake signals were found, such as a package-root escape, install hook, shell/process execution surface, network/download execution surface, dynamic code execution surface, or executable entrypoint that materially expands runtime behavior.

These labels are intake labels only. They do not say that a Skill is safe or unsafe.

## 10. Design Boundaries

SkillGate v0.2.0 uses local deterministic file inspection only.

- No Skill code execution.
- No Skill installation.
- No network calls in CLI behavior.
- No LLM critical path.
- No MCP integration.
- No AgentGate integration.
- No sandboxing.
- No broad repo scanner claim.
- No semantic trust judgment.
- No malware detection claim.
- No semantic safety claim.

Scan caps are intentionally modest: individual surfaces are capped at 256 KiB, reference discovery is limited to `docs/` and `examples/`, hidden directories are skipped for reference discovery, and `node_modules`, `.git`, `dist`, `coverage`, and `.skillgate` are ignored. Discovered instruction/capability surfaces are resolved before parsing and skipped if their real path leaves the inspected Skill package root.

The execution-surface pass is also bounded. It inspects Skill-root `package.json` scripts and `bin` declarations, then looks under likely execution directories: `bin/`, `scripts/`, `tools/`, `commands/`, `.claude/`, `.cursor/`, and `examples/` only when already pulled in by SkillGate’s package-aware reference discovery. Execution paths are realpath-checked and are not read when they resolve outside the inspected Skill package root.

Detection is phrase, declaration, and bounded code-pattern based. Regexes and string matching do not understand intent.

## 11. Development Commands

```bash
npm test
npm run typecheck
npm run build
npm run demo:benign
npm run demo:suspicious
```
