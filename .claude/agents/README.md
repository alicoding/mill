# The agent stable — owned roles, and the roles deliberately skipped

One agent, one lane, no duplication — the registry the 2026-08-17
ecosystem research settled (evidence one-liners below; the full
report lives in that session's record). A new agent needs a
RECURRING concrete problem, not a plausible role. Read on demand,
never boot-loaded.

## Owned
- **explorer** (Haiku) — bulk read-only recon; keeps exploration
  out of the orchestrator's context. (Matches the official
  "subagents for investigation" pattern.)
- **test-investigator** (Sonnet) — suite runs + root causes only.
  (The one role where a standing agent is the converged answer;
  tighter-scoped than every community "test-automator".)
- **research** (Sonnet) — the Research→Adopt→Compose step as an
  agent; primary-source verdicts. (Mill-specific codification of
  our own mandated process, not adopted from precedent.)
- **architect** (Opus) — design decision records: options,
  tradeoffs, a pick; never writes files. (The read-only half of the
  official adversarial-review pattern; decisions stay the
  orchestrator's.)
- **pr-shepherd** (Sonnet, memory) — CI babysitting/rebase per its
  playbook. Scope HARD-STOPS before review comments, approvals, or
  any merge action beyond re-arming auto-merge — the one documented
  incident class for PR agents (hallucinated reviews, bad
  approvals, workflow-file edits) lives exactly past that line.

## Deliberately skipped, with the evidence
- **code-reviewer**: the official /code-review plugin is strictly
  stronger (parallel multi-model pipeline, cross-validation,
  confidence gating) than any single hand-rolled reviewer.
- **security-reviewer**: the official posture is a deterministic
  hook, not a standing agent; Mill's guardrail gate is the
  domain-appropriate mechanism. Occasional deep dives go to
  architect.
- **docs-writer**: zero official precedent, and design/spec/docs
  contracts are explicitly non-delegable here (CLAUDE.md).
- **debugger**: subsumed by test-investigator — a second file for
  the same lane is the duplication trap observed live in the big
  community collections.
- **refactorer**: weakest footprint of any surveyed role; overlaps
  code-review's simplification lane.
