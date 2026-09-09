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
- **reviewer** (Haiku) — fresh-context diff review against the
  builder's own brief, `divergences.md`, and
  `adopt-converged-patterns.md`; ≤5 severity-tagged findings,
  dispatched by the builder before `gh pr create` (goal 0383). This
  supersedes the 2026-08-17 skip below: that call rested on the
  managed `/code-review` GitHub App, which is Team/Enterprise-gated
  and neutral-by-design (never blocks a merge on its own); goal 0383's
  data found zero review of any kind on 16 same-day merged PRs, so the
  enforcement half — blocking on Important findings — has to live in
  Mill's own dispatch path regardless, which is what a Mill-owned
  agent gives for the same plumbing cost.

## Size classes (`maxTurns`) and the resume rule

- **builder**: 120 (a hotfix brief with an ≤80k-token ceiling: 60), with
  a mandatory self-checkpoint commit at turn ~80 (see the agent body's
  "Checkpoint commits" section)
- **pr-shepherd**: 100
- **closeout**: 40 (batches of at most 3 merged PRs per dispatch)
- **verifier**: 60
- **reviewer**: 40

Every dispatch-owning agent's token ceiling is CUMULATIVE across
resumes, not reset per resume (the class: a builder against a 300k
ceiling spent 852k across resumes because each `SendMessage` resume
re-granted the full allowance). The orchestrator counts resumes: at
most TWO per brief. A third resume's need means the remaining work is
re-briefed as a new slice with its own ceiling, never a third resume of
the same one.

## Deliberately skipped, with the evidence
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
