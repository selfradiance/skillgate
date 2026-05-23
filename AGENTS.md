# Coding Agent Instructions

SkillGate is a narrow TypeScript CLI proof. Keep it focused on local Skill package admission.

- Treat the inspected object as one local Skill package directory.
- Do not broaden the tool into a generic repo scanner.
- Do not execute, install, or trust the Skill under review.
- Keep classification deterministic, inspectable, and test-covered.
- Keep output labels as intake labels only: `no_findings`, `review`, and `elevated_review`.
- Do not add external services, an LLM critical path, MCP integration, AgentGate integration, or background behavior.
- Preserve deterministic ordering for surfaces, declarations, and findings.
- Prefer small explicit rules over clever inference.

Development commands:

- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run demo:benign`
- `npm run demo:suspicious`
